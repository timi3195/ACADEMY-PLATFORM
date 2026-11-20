const QuestionExtraction = require("../models/QuestionExtraction");
const storageService = require("./storageService");
const imageValidation = require("./questionImageValidationService");
const ocrService = require("./ocrService");
const questionStructuringService = require("./questionStructuringService");

const idOf = (value) => String(value?._id || value || "");

const streamToBuffer = async (stream, maximumBytes) => {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maximumBytes) throw new Error("Stored image exceeds the processing limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
};

const loadImageBuffer = async (image, storage = storageService) => {
  const stream = await storage.getObjectReadStream(image);
  return streamToBuffer(stream, imageValidation.MAX_IMAGE_BYTES);
};

const publicProcessingError = (stage) => stage === "ocr"
  ? "OCR could not read one or more images. The original images remain available for retry."
  : "AI structuring could not finish. Saved OCR text is preserved; retry structuring or use a smaller source batch.";

const appendProcessingError = (batch, stage, message, imageId = null, details = {}) => {
  batch.processingErrors ||= [];
  batch.processingErrors.push({
    stage,
    imageId,
    category: details.category || "",
    providerStatus: details.providerStatus ?? null,
    chunkIndex: details.chunkIndex ?? null,
    message,
    occurredAt: new Date()
  });
};

const logProcessingFailure = ({ stage, provider, failure, model = "" }) => {
  console.error("[QUESTION_EXTRACTION_PROCESSING_FAILURE]", JSON.stringify({
    stage,
    category: failure.category || "processing_error",
    provider,
    providerStatus: failure.providerStatus || null,
    providerCode: failure.providerCode || "",
    model,
    chunkIndex: failure.chunkIndex || null,
    chunkCount: failure.chunkCount || null,
    sourceCharacterCount: failure.sourceCharacterCount || 0,
    outputCharacterCount: failure.outputCharacterCount ?? null,
    outputTokenCount: failure.outputTokenCount ?? null,
    finishReason: failure.finishReason || ""
  }));
};

const publicFailureFromError = (error) => {
  const failure = questionStructuringService.classifyStructuringError(error);
  if (error?.code === "STRUCTURING_PERSISTENCE_FAILED") {
    failure.category = "persistence_error";
    failure.message = "A completed structuring section could not be saved. OCR text is preserved; retry the unfinished work.";
  }
  return failure;
};

const getOcrPages = (batch) => (batch.images || [])
  .map((image, index) => ({
    imageId: idOf(image._id),
    pageNumber: index + 1,
    text: String(image.ocrText || ""),
    confidence: image.ocrConfidence
  }))
  .filter((page) => page.text.trim());

const updateAggregateOcrText = (batch) => {
  batch.ocrText = (batch.images || [])
    .map((image, index) => image.ocrText
      ? `[IMAGE ${index + 1}]\n${image.ocrText}`
      : "")
    .filter(Boolean)
    .join("\n\n");
};

const persistProcessingBatch = async (batch, token, ExtractionModel = QuestionExtraction) => {
  const values = typeof batch.toObject === "function"
    ? batch.toObject({ depopulate: true })
    : { ...batch };
  delete values._id;
  delete values.__v;
  delete values.processingLockToken;
  delete values.processingLockUntil;
  delete values.processingLeaseHeartbeatAt;
  values.updatedAt = new Date();
  const finalized = batch.processingLockToken !== token;
  if (finalized) {
    values.processingLockToken = "";
    values.processingLockUntil = null;
    values.processingLeaseHeartbeatAt = null;
  }

  const result = await ExtractionModel.updateOne(
    {
      _id: batch._id,
      processingLockToken: token,
      processingLockUntil: { $gt: new Date() }
    },
    { $set: values },
    { runValidators: true }
  );
  if (result.matchedCount !== 1) {
    const error = new Error("Question extraction processing lease was replaced.");
    error.code = "EXTRACTION_PROCESSING_LEASE_LOST";
    throw error;
  }
  batch.updatedAt = values.updatedAt;
};

const processClaimedBatch = async ({
  batch,
  token,
  stage = batch.processingStage,
  ExtractionModel = QuestionExtraction,
  storage = storageService,
  ocr = ocrService,
  structuring = questionStructuringService
}) => {
  if (!batch || !token) throw new TypeError("A claimed extraction batch and lease token are required.");
  batch.processingErrors ||= [];
  batch.processingErrors = batch.processingErrors.filter((entry) =>
    stage === "ocr"
      ? !["ocr", "structuring"].includes(entry.stage)
      : entry.stage !== "structuring"
  );

  if (stage === "ocr") {
    const inputs = [];
    for (const image of batch.images.filter((entry) => entry.ocrStatus !== "succeeded")) {
      try {
        inputs.push({ imageId: idOf(image._id), buffer: await loadImageBuffer(image, storage) });
      } catch (error) {
        const statusCode = Number(error?.statusCode || error?.$metadata?.httpStatusCode);
        if (!Number.isInteger(statusCode) || statusCode >= 500) throw error;
        image.ocrStatus = "failed";
        image.ocrError = publicProcessingError("ocr");
        appendProcessingError(batch, "ocr", image.ocrError, image._id);
        await persistProcessingBatch(batch, token, ExtractionModel);
      }
    }

    const results = inputs.length
      ? await ocr.recognizeImages(inputs, async (result) => {
        const image = batch.images.find((item) => idOf(item._id) === String(result.imageId));
        if (!image) return;
        if (result.error || !String(result.text || "").trim()) {
          image.ocrStatus = "failed";
          image.ocrError = publicProcessingError("ocr");
          appendProcessingError(batch, "ocr", image.ocrError, image._id);
        } else {
          image.ocrStatus = "succeeded";
          image.ocrText = result.text;
          image.ocrConfidence = result.confidence;
          image.ocrProvider = result.provider;
          image.ocrVersion = result.version;
          image.ocrError = "";
        }
        await persistProcessingBatch(batch, token, ExtractionModel);
      })
      : [];
    const completedImageIds = new Set(results.map((result) => String(result.imageId)));
    for (const input of inputs) {
      if (completedImageIds.has(String(input.imageId))) continue;
      const image = batch.images.find((item) => idOf(item._id) === String(input.imageId));
      if (!image) continue;
      image.ocrStatus = "failed";
      image.ocrError = publicProcessingError("ocr");
      appendProcessingError(batch, "ocr", image.ocrError, image._id);
    }

    const provider = ocr.getProviderInfo();
    batch.ocrProvider = provider.provider;
    batch.ocrVersion = provider.version;
    updateAggregateOcrText(batch);
    batch.status = "extracted";
    batch.processingStage = "structuring";
    await persistProcessingBatch(batch, token, ExtractionModel);
  } else {
    updateAggregateOcrText(batch);
  }

  const pages = getOcrPages(batch);
  if (!pages.length) {
    batch.status = "failed";
    appendProcessingError(batch, "ocr", "No readable OCR text is available. Retry OCR or upload clearer images.");
  } else {
    try {
      const structured = await structuring.structureQuestionDrafts({
        pages,
        userId: String(batch.uploadedBy),
        completedChunkKeys: batch.structuringCompletedChunks || [],
        existingDrafts: batch.drafts || [],
        onChunkSuccess: async (section) => {
          batch.drafts = structuring.mergeUniqueDrafts(batch.drafts, section.drafts);
          batch.structuringCompletedChunks = [
            ...new Set([...(batch.structuringCompletedChunks || []), section.chunkKey])
          ];
          batch.structuringWarnings = [
            ...new Set([...(batch.structuringWarnings || []), ...(section.warnings || [])])
          ];
          batch.aiProvider = section.provider;
          batch.aiModel = section.model;
          try {
            await persistProcessingBatch(batch, token, ExtractionModel);
          } catch (error) {
            error.code = "STRUCTURING_PERSISTENCE_FAILED";
            throw error;
          }
        }
      });
      batch.drafts = structuring.mergeUniqueDrafts(batch.drafts, structured.drafts);
      batch.structuringCompletedChunks = [
        ...new Set([
          ...(batch.structuringCompletedChunks || []),
          ...(structured.completedChunkKeys || [])
        ])
      ];
      batch.aiProvider = structured.provider || batch.aiProvider || "gemini";
      batch.aiModel = structured.model || batch.aiModel;
      batch.structuringWarnings = [
        ...new Set([...(batch.structuringWarnings || []), ...(structured.warnings || [])])
      ];
      const failedImages = batch.images.some((image) => image.ocrStatus !== "succeeded");
      const failures = structured.failures || [];
      for (const failure of failures) {
        appendProcessingError(batch, "structuring", failure.message, null, failure);
        logProcessingFailure({
          stage: "structuring",
          provider: "gemini",
          failure,
          model: batch.aiModel
        });
      }
      batch.status = failedImages || failures.length ? "partially_failed" : "needs_review";
    } catch (error) {
      if (error.code === "STRUCTURING_PERSISTENCE_FAILED" ||
          error.code === "EXTRACTION_PROCESSING_LEASE_LOST") {
        throw error;
      }
      const failure = publicFailureFromError(error);
      batch.status = "partially_failed";
      appendProcessingError(batch, "structuring", failure.message, null, failure);
      logProcessingFailure({
        stage: "structuring",
        provider: "gemini",
        failure,
        model: batch.aiModel
      });
    }
  }

  batch.processingStage = "none";
  batch.processingLockToken = "";
  batch.processingLockUntil = null;
  batch.processingLeaseHeartbeatAt = null;
  await persistProcessingBatch(batch, token, ExtractionModel);
  return batch;
};

module.exports = {
  getOcrPages,
  processClaimedBatch,
  persistProcessingBatch
};
