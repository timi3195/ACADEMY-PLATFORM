const crypto = require("crypto");
const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const QuestionExtraction = require("../models/QuestionExtraction");
const Course = require("../models/course");
const User = require("../models/User");
const protect = require("../config/middleware/authMiddleware");
const { getCourseAccess } = require("../services/questionAccessService");
const storageService = require("../services/storageService");
const imageValidation = require("../services/questionImageValidationService");
const ocrService = require("../services/ocrService");
const questionStructuringService = require("../services/questionStructuringService");
const questionExtractionReviewService = require("../services/questionExtractionReviewService");

const router = express.Router();
const PROCESSING_LOCK_MS = 30 * 60 * 1000;
const MAX_RETRIES = 5;
const MAX_ACTIVE_PROCESSING = 2;
const MAX_ACTIVE_UPLOADS = 2;
const UPLOAD_SEMAPHORE = { active: 0 };
const ACTIVE_UPLOADS = { count: 0 };
const RETRYABLE_STATUSES = {
  ocr: ["uploaded", "failed", "partially_failed"],
  structuring: ["extracted", "failed", "partially_failed"]
};
const configuredDailyLimit = Number(process.env.QUESTION_EXTRACTION_DAILY_BATCH_LIMIT);
const MAX_DAILY_BATCHES = Number.isInteger(configuredDailyLimit) && configuredDailyLimit > 0 && configuredDailyLimit <= 100
  ? configuredDailyLimit
  : 10;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: imageValidation.MAX_IMAGE_BYTES,
    files: imageValidation.MAX_IMAGE_COUNT,
    fields: 8,
    fieldSize: 1024
  }
});

const replyError = (res, error, fallback = "Unable to process question extraction request.") => {
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  if (status >= 500) console.error("Question extraction API error:", error?.message || "Unexpected failure");
  return res.status(status).json({
    success: false,
    message: status >= 500 ? fallback : error.message
  });
};

const requireUploader = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select("role lecturerStatus").lean();
    if (!user || !["admin", "lecturer"].includes(user.role) ||
        (user.role === "lecturer" && user.lecturerStatus !== "approved")) {
      return res.status(403).json({ success: false, message: "Approved lecturer or administrator access is required." });
    }
    req.extractionUser = user;
    return next();
  } catch (error) {
    console.error("Question extraction authorization lookup failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to verify extraction permissions." });
  }
};

const uploadImages = (req, res, next) => {
  if (ACTIVE_UPLOADS.count >= MAX_ACTIVE_UPLOADS) {
    return res.status(429).json({ success: false, message: "Image upload capacity is busy. Please retry shortly." });
  }
  ACTIVE_UPLOADS.count += 1;
  upload.array("images", imageValidation.MAX_IMAGE_COUNT)(req, res, (error) => {
    ACTIVE_UPLOADS.count -= 1;
    if (!error) return next();
    const statusCode = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(statusCode).json({
      success: false,
      message: statusCode === 413 ? "An image exceeds the upload size limit." : "Invalid image upload request."
    });
  });
};

const checkDailyUploadLimit = async (req, res, next) => {
  try {
    const dailyStart = new Date();
    dailyStart.setUTCHours(0, 0, 0, 0);
    const dailyCount = await QuestionExtraction.countDocuments({
      uploadedBy: req.user.id,
      createdAt: { $gte: dailyStart }
    });
    if (dailyCount >= MAX_DAILY_BATCHES) {
      return res.status(429).json({ success: false, message: "Daily image extraction upload limit reached." });
    }
    return next();
  } catch (error) {
    console.error("Question extraction daily limit lookup failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to verify the daily upload limit." });
  }
};

const safeId = (value) => mongoose.Types.ObjectId.isValid(value);
const idOf = (value) => String(value?._id || value || "");

const toImageView = (batch, image) => ({
  id: idOf(image._id),
  originalName: image.originalName,
  mimeType: image.mimeType,
  size: image.size,
  width: image.width,
  height: image.height,
  ocrStatus: image.ocrStatus,
  ocrConfidence: image.ocrConfidence,
  previewUrl: `/api/question-extractions/${batch.batchId}/images/${idOf(image._id)}`
});

const toSummary = (batch) => ({
  batchId: batch.batchId,
  course: batch.course,
  department: batch.department,
  academicLevel: batch.academicLevel,
  semester: batch.semester,
  academicSession: batch.academicSession,
  sourceExamYear: batch.sourceExamYear,
  status: batch.status,
  processingStage: batch.processingStage,
  imageCount: batch.images?.length || 0,
  questionCount: batch.drafts?.length || 0,
  retryCount: batch.retryCount,
  processingRetryAfter: batch.processingLockUntil || null,
  processingErrors: batch.processingErrors || [],
  reviewStatus: batch.reviewStatus || "pending",
  approvedDraftCount: (batch.drafts || []).filter((draft) => draft.reviewStatus === "approved").length,
  rejectedDraftCount: (batch.drafts || []).filter((draft) => draft.reviewStatus === "rejected").length,
  createdAt: batch.createdAt,
  updatedAt: batch.updatedAt
});

const toBatchView = (batch) => ({
  ...toSummary(batch),
  images: (batch.images || []).map((image) => toImageView(batch, image)),
  ocrText: batch.ocrText || "",
  drafts: batch.drafts || [],
  ocrProvider: batch.ocrProvider,
  ocrVersion: batch.ocrVersion,
  aiProvider: batch.aiProvider,
  aiModel: batch.aiModel,
  structuringWarnings: batch.structuringWarnings || [],
  reviewStatus: batch.reviewStatus
});

const authorizeBatch = async (req, res, batchId) => {
  if (typeof batchId !== "string" || batchId.length > 64) {
    res.status(404).json({ success: false, message: "Extraction batch not found." });
    return null;
  }
  const batch = await QuestionExtraction.findOne({ batchId });
  if (!batch) {
    res.status(404).json({ success: false, message: "Extraction batch not found." });
    return null;
  }
  const access = await getCourseAccess(req.user.id, batch.course);
  if (!access.allowed || (req.extractionUser.role === "lecturer" && !access.manager)) {
    res.status(403).json({ success: false, message: "You are no longer authorized for this extraction course." });
    return null;
  }
  return batch;
};

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

const loadImageBuffer = async (image) => {
  const stream = await storageService.getObjectReadStream(image);
  return streamToBuffer(stream, imageValidation.MAX_IMAGE_BYTES);
};

const publicProcessingError = (stage) => stage === "ocr"
  ? "OCR could not read one or more images. The original images remain available for retry."
  : "AI structuring could not finish. Saved OCR text is preserved; retry structuring or use a smaller source batch.";

const appendProcessingError = (batch, stage, message, imageId = null) => {
  batch.processingErrors.push({
    stage,
    imageId,
    message,
    occurredAt: new Date()
  });
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

const persistProcessingBatch = async (batch, token) => {
  const values = typeof batch.toObject === "function"
    ? batch.toObject({ depopulate: true })
    : { ...batch };
  delete values._id;
  delete values.__v;
  values.updatedAt = new Date();

  const result = await QuestionExtraction.updateOne(
    { _id: batch._id, processingLockToken: token },
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

const processBatch = async ({ batchId, stage, isRetry = false }) => {
  if (UPLOAD_SEMAPHORE.active >= MAX_ACTIVE_PROCESSING) return { accepted: false };
  UPLOAD_SEMAPHORE.active += 1;
  const token = crypto.randomUUID();

  try {
    const now = new Date();
    const claimFilter = {
      batchId,
      $or: [
        { status: { $in: RETRYABLE_STATUSES[stage] } },
        { status: "processing", processingLockUntil: { $lte: now } }
      ]
    };
    if (isRetry) claimFilter.retryCount = { $lt: MAX_RETRIES };

    const batch = await QuestionExtraction.findOneAndUpdate(claimFilter, {
      $set: {
        status: "processing",
        processingStage: stage,
        processingLockToken: token,
        processingLockUntil: new Date(now.getTime() + PROCESSING_LOCK_MS)
      },
      ...(isRetry ? { $inc: { retryCount: 1 } } : {})
    }, { new: true });

    if (!batch) return { accepted: false };
    batch.processingErrors = (batch.processingErrors || []).filter((entry) =>
      stage === "ocr" ? !["ocr", "structuring"].includes(entry.stage) : entry.stage !== "structuring"
    );

    if (stage === "ocr") {
      const inputs = [];
      for (const image of batch.images) {
        try {
          inputs.push({ imageId: idOf(image._id), buffer: await loadImageBuffer(image) });
        } catch {
          image.ocrStatus = "failed";
          image.ocrError = publicProcessingError("ocr");
          appendProcessingError(batch, "ocr", image.ocrError, image._id);
          await persistProcessingBatch(batch, token);
        }
      }

      const results = await ocrService.recognizeImages(inputs, async (result) => {
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
        await persistProcessingBatch(batch, token);
      });
      const completedImageIds = new Set(results.map((result) => String(result.imageId)));
      for (const input of inputs) {
        if (completedImageIds.has(String(input.imageId))) continue;
        const image = batch.images.find((item) => idOf(item._id) === String(input.imageId));
        if (!image) continue;
        image.ocrStatus = "failed";
        image.ocrError = publicProcessingError("ocr");
        appendProcessingError(batch, "ocr", image.ocrError, image._id);
      }

      const provider = ocrService.getProviderInfo();
      batch.ocrProvider = provider.provider;
      batch.ocrVersion = provider.version;
      updateAggregateOcrText(batch);
      batch.status = "extracted";
      batch.processingStage = "structuring";
      await persistProcessingBatch(batch, token);
    } else {
      updateAggregateOcrText(batch);
    }

    const pages = getOcrPages(batch);
    if (!pages.length) {
      batch.status = "failed";
      appendProcessingError(batch, "ocr", "No readable OCR text is available. Retry OCR or upload clearer images.");
    } else {
      try {
        const structured = await questionStructuringService.structureQuestionDrafts({
          pages,
          userId: String(batch.uploadedBy)
        });
        batch.drafts = structured.drafts;
        batch.aiProvider = structured.provider;
        batch.aiModel = structured.model;
        batch.structuringWarnings = structured.warnings;
        const failedImages = batch.images.some((image) => image.ocrStatus !== "succeeded");
        batch.status = failedImages ? "partially_failed" : "needs_review";
      } catch {
        batch.status = "partially_failed";
        appendProcessingError(batch, "structuring", publicProcessingError("structuring"));
        console.error("Question extraction structuring failed; OCR text retained.");
      }
    }

    batch.processingStage = "none";
    batch.processingLockToken = "";
    batch.processingLockUntil = null;
    await persistProcessingBatch(batch, token);
    return { accepted: true, batch };
  } catch (error) {
    const batch = await QuestionExtraction.findOne({ batchId, processingLockToken: token });
    if (batch) {
      updateAggregateOcrText(batch);
      batch.status = batch.ocrText ? "partially_failed" : "failed";
      batch.processingStage = "none";
      batch.processingLockToken = "";
      batch.processingLockUntil = null;
      const message = error.code === "OCR_LANGUAGE_DATA_UNAVAILABLE"
        ? error.message
        : publicProcessingError(stage);
      appendProcessingError(batch, stage, message);
      await persistProcessingBatch(batch, token);
    } else if (error.code === "EXTRACTION_PROCESSING_LEASE_LOST") {
      return { accepted: false, leaseLost: true };
    }
    console.error("Question extraction processing failed:", error.message);
    return { accepted: true, processingFailed: true };
  } finally {
    UPLOAD_SEMAPHORE.active -= 1;
  }
};

router.use(protect, requireUploader);

router.get("/limits", (req, res) => res.json({
  success: true,
  limits: {
    maxImages: imageValidation.MAX_IMAGE_COUNT,
    maxImageBytes: imageValidation.MAX_IMAGE_BYTES,
    maxBatchBytes: imageValidation.MAX_BATCH_BYTES,
    maxImagePixels: imageValidation.MAX_IMAGE_PIXELS,
    maxBatchPixels: imageValidation.MAX_BATCH_PIXELS
  }
}));

router.get("/courses", async (req, res) => {
  try {
    const filter = req.extractionUser.role === "admin"
      ? {}
      : { lecturers: req.user.id };
    const courses = await Course.find(filter)
      .select("_id title code department level semester")
      .sort({ title: 1 })
      .lean();
    return res.json({ success: true, courses });
  } catch (error) {
    console.error("Authorized extraction course lookup failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load authorized courses." });
  }
});

router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));
    const filter = req.extractionUser.role === "admin"
      ? {}
      : {
        course: {
          $in: (await Course.find({ lecturers: req.user.id }).select("_id").lean())
            .map((course) => course._id)
        }
      };
    if (req.query.status && ["uploaded", "processing", "extracted", "needs_review", "partially_failed", "failed"].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const batches = await QuestionExtraction.find(filter)
      .select("batchId course department academicLevel semester academicSession sourceExamYear status processingStage images drafts retryCount processingLockUntil processingErrors createdAt updatedAt")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    return res.json({ success: true, batches: batches.map(toSummary), page, limit });
  } catch (error) {
    console.error("Extraction batch list lookup failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load extraction batches." });
  }
});

router.post("/", checkDailyUploadLimit, uploadImages, async (req, res) => {
  let storedImages = [];
  let batchPersisted = false;
  try {
    const files = req.files || [];
    imageValidation.validateBatch(files);
    const courseId = typeof req.body.courseId === "string" ? req.body.courseId.trim() : "";
    if (!safeId(courseId)) return res.status(400).json({ success: false, message: "A valid course is required." });

    const academicSession = typeof req.body.academicSession === "string" ? req.body.academicSession.trim() : "";
    if (!/^\d{4}(?:[/-]\d{4})?$/.test(academicSession)) {
      return res.status(400).json({ success: false, message: "Academic session must be a year or year range, such as 2025/2026." });
    }
    const sourceExamYear = typeof req.body.sourceExamYear === "string" ? req.body.sourceExamYear.trim() : "";
    if (sourceExamYear && !/^\d{4}$/.test(sourceExamYear)) {
      return res.status(400).json({ success: false, message: "Source examination year must be a four-digit year." });
    }

    const access = await getCourseAccess(req.user.id, courseId);
    if (!access.allowed || !access.manager) {
      return res.status(access.statusCode || 403).json({ success: false, message: access.message || "Course upload access is required." });
    }
    const validatedImages = [];
    for (const file of files) {
      const validated = await imageValidation.validateImage(file);
      validatedImages.push({ file, validated });
    }
    imageValidation.validateBatchPixels(validatedImages.map(({ validated }) => validated));

    const batchObjectId = new mongoose.Types.ObjectId();
    const batchId = crypto.randomUUID();
    const imageRecords = [];
    for (const { file, validated } of validatedImages) {
      const imageId = new mongoose.Types.ObjectId();
      const storageData = await storageService.storePrivateQuestionImage({
        buffer: file.buffer,
        batchId: batchObjectId.toString(),
        imageId: imageId.toString(),
        extension: validated.extension,
        mimeType: validated.mimeType,
        originalName: file.originalname
      });
      storedImages.push(storageData);
      imageRecords.push({
        _id: imageId,
        extension: validated.extension,
        mimeType: validated.mimeType,
        size: validated.size,
        width: validated.width,
        height: validated.height,
        ...storageData,
        originalName: file.originalname
      });
    }

    const batch = await QuestionExtraction.create({
      _id: batchObjectId,
      batchId,
      uploadedBy: req.user.id,
      course: access.course._id,
      department: access.course.department,
      academicLevel: access.course.level,
      semester: access.course.semester,
      academicSession,
      sourceExamYear,
      images: imageRecords,
      status: "uploaded",
      reviewStatus: "pending"
    });
    batchPersisted = true;

    const processing = await processBatch({ batchId, stage: "ocr" });
    const refreshed = processing.batch || await QuestionExtraction.findOne({ batchId });
    if (!processing.accepted) {
      return res.status(202).json({ success: true, batch: toBatchView(refreshed), message: "Batch is saved and waiting for an available processor." });
    }
    return res.status(201).json({ success: true, batch: toBatchView(refreshed) });
  } catch (error) {
    if (!batchPersisted) {
      await Promise.all(storedImages.map(async (image) => {
        try {
          await storageService.deleteObject(image);
        } catch (cleanupError) {
          console.error("Failed to clean up an incomplete question image upload:", cleanupError.message);
        }
      }));
    }
    return replyError(res, error, "Unable to upload question images.");
  }
});

router.get("/:batchId", async (req, res) => {
  try {
    const batch = await authorizeBatch(req, res, req.params.batchId);
    if (!batch) return;
    return res.json({ success: true, batch: toBatchView(batch) });
  } catch (error) {
    return replyError(res, error);
  }
});

router.patch("/:batchId/drafts/:draftId", async (req, res) => {
  try {
    const batch = await authorizeBatch(req, res, req.params.batchId);
    if (!batch) return;
    if (!safeId(req.params.draftId)) {
      return res.status(404).json({ success: false, message: "Extraction draft not found." });
    }
    await questionExtractionReviewService.editDraft({
      batchId: req.params.batchId,
      draftId: req.params.draftId,
      userId: req.user.id,
      payload: req.body
    });
    const updated = await QuestionExtraction.findOne({ batchId: req.params.batchId });
    return res.json({ success: true, batch: toBatchView(updated) });
  } catch (error) {
    return replyError(res, error, "Unable to update extraction draft.");
  }
});

router.post("/:batchId/drafts/:draftId/approve", async (req, res) => {
  try {
    const batch = await authorizeBatch(req, res, req.params.batchId);
    if (!batch) return;
    if (!safeId(req.params.draftId)) {
      return res.status(404).json({ success: false, message: "Extraction draft not found." });
    }
    const result = await questionExtractionReviewService.approveDraft({
      batchId: req.params.batchId,
      draftId: req.params.draftId,
      userId: req.user.id
    });
    const updated = await QuestionExtraction.findOne({ batchId: req.params.batchId });
    return res.json({
      success: true,
      alreadyApproved: result.alreadyApproved,
      questionId: result.question?._id || null,
      batch: toBatchView(updated)
    });
  } catch (error) {
    return replyError(res, error, "Unable to approve extraction draft.");
  }
});

router.post("/:batchId/drafts/:draftId/reject", async (req, res) => {
  try {
    const batch = await authorizeBatch(req, res, req.params.batchId);
    if (!batch) return;
    if (!safeId(req.params.draftId)) {
      return res.status(404).json({ success: false, message: "Extraction draft not found." });
    }
    const result = await questionExtractionReviewService.rejectDraft({
      batchId: req.params.batchId,
      draftId: req.params.draftId,
      userId: req.user.id,
      reason: req.body?.reason
    });
    return res.json({
      success: true,
      alreadyRejected: result.alreadyRejected,
      batch: toBatchView(result.batch)
    });
  } catch (error) {
    return replyError(res, error, "Unable to reject extraction draft.");
  }
});

router.post("/:batchId/review-selected", async (req, res) => {
  try {
    const batch = await authorizeBatch(req, res, req.params.batchId);
    if (!batch) return;
    const { action, draftIds, reason } = req.body || {};
    if (!["approve", "reject"].includes(action) || !Array.isArray(draftIds) ||
        draftIds.length === 0 || draftIds.length > 100 ||
        draftIds.some((draftId) => !safeId(draftId)) ||
        new Set(draftIds.map(String)).size !== draftIds.length) {
      return res.status(400).json({
        success: false,
        message: "Provide a unique selection of 1 to 100 draft IDs and an approve or reject action."
      });
    }
    const results = await Promise.all(draftIds.map(async (draftId) => {
      try {
        const result = action === "approve"
          ? await questionExtractionReviewService.approveDraft({
            batchId: req.params.batchId,
            draftId,
            userId: req.user.id
          })
          : await questionExtractionReviewService.rejectDraft({
            batchId: req.params.batchId,
            draftId,
            userId: req.user.id,
            reason
          });
        return {
          draftId,
          success: true,
          alreadyReviewed: Boolean(result.alreadyApproved || result.alreadyRejected),
          questionId: result.question?._id || null
        };
      } catch (error) {
        return { draftId, success: false, message: error.message, statusCode: error.statusCode || 500 };
      }
    }));
    const updated = await QuestionExtraction.findOne({ batchId: req.params.batchId });
    return res.json({
      success: results.every((result) => result.success),
      results,
      batch: toBatchView(updated)
    });
  } catch (error) {
    return replyError(res, error, "Unable to review selected extraction drafts.");
  }
});

router.post("/:batchId/retry", async (req, res) => {
  try {
    const batch = await authorizeBatch(req, res, req.params.batchId);
    if (!batch) return;
    if ((batch.drafts || []).some((draft) =>
      draft.reviewStatus !== "pending" || draft.originalContent || (draft.reviewHistory || []).length
    )) {
      return res.status(409).json({
        success: false,
        message: "Extraction cannot be retried after draft review or corrections have started."
      });
    }
    if (batch.status === "needs_review" || batch.status === "approved") {
      return res.status(409).json({ success: false, message: "This batch has completed extraction and does not need retry." });
    }
    if (batch.retryCount >= MAX_RETRIES) {
      return res.status(429).json({ success: false, message: "Maximum extraction retries reached." });
    }
    const hasIncompleteOcr = batch.images.some((image) => image.ocrStatus !== "succeeded");
    const stage = req.body?.stage || (hasIncompleteOcr ? "ocr" : "structuring");
    if (!["ocr", "structuring"].includes(stage)) {
      return res.status(400).json({ success: false, message: "Retry stage must be OCR or structuring." });
    }
    if (stage === "structuring" && !getOcrPages(batch).length) {
      return res.status(409).json({ success: false, message: "OCR text is unavailable. Retry OCR first." });
    }
    if (UPLOAD_SEMAPHORE.active >= MAX_ACTIVE_PROCESSING) {
      return res.status(429).json({ success: false, message: "Extraction processors are busy. Please retry shortly." });
    }

    const processing = await processBatch({ batchId: batch.batchId, stage, isRetry: true });
    const refreshed = processing.batch || await QuestionExtraction.findOne({ batchId: batch.batchId });
    if (!processing.accepted) {
      return res.status(409).json({ success: false, message: "This extraction batch is already processing." });
    }
    return res.json({ success: true, batch: toBatchView(refreshed) });
  } catch (error) {
    return replyError(res, error);
  }
});

router.get("/:batchId/images/:imageId", async (req, res) => {
  try {
    const batch = await authorizeBatch(req, res, req.params.batchId);
    if (!batch) return;
    if (!safeId(req.params.imageId)) return res.status(404).json({ success: false, message: "Image not found." });
    const image = batch.images.find((entry) => idOf(entry._id) === req.params.imageId);
    if (!image) return res.status(404).json({ success: false, message: "Image not found." });

    const stream = await storageService.getObjectReadStream(image);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", image.mimeType);
    stream.on("error", () => {
      if (!res.headersSent) res.status(404).json({ success: false, message: "Original image is unavailable." });
      else res.destroy();
    });
    return stream.pipe(res);
  } catch (error) {
    return replyError(res, error, "Original image is unavailable.");
  }
});

module.exports = router;
