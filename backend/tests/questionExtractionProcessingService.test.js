const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("stream");
const { processClaimedBatch } = require("../services/questionExtractionProcessingService");

const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
};

const createHarness = (input) => {
  const record = clone(input);
  const ExtractionModel = {
    async updateOne(filter, update) {
      if (String(filter._id) !== String(record._id) ||
          record.processingLockToken !== filter.processingLockToken ||
          !record.processingLockUntil ||
          record.processingLockUntil <= filter.processingLockUntil.$gt) {
        return { matchedCount: 0 };
      }
      Object.assign(record, clone(update.$set));
      return { matchedCount: 1 };
    }
  };
  const storage = {
    async getObjectReadStream() {
      return Readable.from([Buffer.from("image")]);
    }
  };
  const structuring = {
    mergeUniqueDrafts: (existing, incoming) => [...(existing || []), ...(incoming || [])],
    async structureQuestionDrafts() {
      return { drafts: [], completedChunkKeys: [], provider: "gemini", model: "test", warnings: [], failures: [] };
    }
  };
  return { record, ExtractionModel, storage, structuring };
};

const baseBatch = (overrides = {}) => ({
  _id: "batch-id",
  batchId: "batch-id",
  uploadedBy: "admin-id",
  status: "processing",
  processingStage: "ocr",
  processingLockToken: "token-a",
  processingLockUntil: new Date(Date.now() + 60_000),
  processingErrors: [],
  images: [{
    _id: "image-id",
    ocrStatus: "pending",
    ocrText: "",
    storageFilename: "question-extractions/image-id.png"
  }],
  drafts: [],
  structuringCompletedChunks: [],
  structuringWarnings: [],
  ...overrides
});

test("restarted OCR resumes from per-image text already persisted", async () => {
  const harness = createHarness(baseBatch());
  let ocrCalls = 0;
  let simulateCrash = true;
  const ocr = {
    async recognizeImages(images, onPageResult) {
      ocrCalls += 1;
      const result = {
        imageId: images[0].imageId,
        text: "Persisted question text",
        confidence: 90,
        provider: "tesseract.js",
        version: "test"
      };
      await onPageResult(result);
      return [result];
    },
    getProviderInfo() {
      if (simulateCrash) {
        simulateCrash = false;
        throw new Error("simulated worker interruption");
      }
      return { provider: "tesseract.js", version: "test" };
    }
  };

  await assert.rejects(processClaimedBatch({
    batch: clone(harness.record),
    token: "token-a",
    stage: "ocr",
    ExtractionModel: harness.ExtractionModel,
    storage: harness.storage,
    ocr,
    structuring: harness.structuring
  }), /simulated worker interruption/);
  assert.equal(harness.record.images[0].ocrText, "Persisted question text");

  harness.record.status = "processing";
  harness.record.processingLockToken = "token-b";
  const restartedBatch = await processClaimedBatch({
    batch: clone(harness.record),
    token: "token-b",
    stage: "ocr",
    ExtractionModel: harness.ExtractionModel,
    storage: harness.storage,
    ocr,
    structuring: harness.structuring
  });
  assert.equal(ocrCalls, 1);
  assert.equal(restartedBatch.status, "needs_review");
  assert.equal(harness.record.images[0].ocrText, "Persisted question text");
});

test("restarted structuring skips chunks whose drafts were already persisted", async () => {
  const harness = createHarness(baseBatch({
    processingStage: "structuring",
    images: [{
      _id: "image-id",
      ocrStatus: "succeeded",
      ocrText: "Question text",
      ocrConfidence: 90
    }]
  }));
  harness.record.structuringCompletedChunks = [];
  let firstPass = true;
  const chunkKey = "completed-chunk";
  const structuring = {
    mergeUniqueDrafts: (existing, incoming) => [...(existing || []), ...(incoming || [])],
    async structureQuestionDrafts({ onChunkSuccess, completedChunkKeys }) {
      if (firstPass) {
        firstPass = false;
        await onChunkSuccess({
          chunkKey,
          drafts: [{ questionText: "Saved draft", reviewStatus: "pending" }],
          warnings: [],
          provider: "gemini",
          model: "test"
        });
        const error = new Error("simulated interruption after checkpoint");
        error.code = "STRUCTURING_PERSISTENCE_FAILED";
        throw error;
      }
      assert.deepEqual(completedChunkKeys, [chunkKey]);
      return { drafts: [], completedChunkKeys: [], provider: "gemini", model: "test", warnings: [], failures: [] };
    }
  };

  await assert.rejects(processClaimedBatch({
    batch: clone(harness.record),
    token: "token-a",
    stage: "structuring",
    ExtractionModel: harness.ExtractionModel,
    storage: harness.storage,
    structuring
  }), /simulated interruption/);
  assert.deepEqual(harness.record.structuringCompletedChunks, [chunkKey]);
  assert.equal(harness.record.drafts.length, 1);

  harness.record.status = "processing";
  harness.record.processingLockToken = "token-b";
  const completed = await processClaimedBatch({
    batch: clone(harness.record),
    token: "token-b",
    stage: "structuring",
    ExtractionModel: harness.ExtractionModel,
    storage: harness.storage,
    structuring
  });
  assert.equal(completed.status, "needs_review");
  assert.deepEqual(harness.record.structuringCompletedChunks, [chunkKey]);
  assert.equal(harness.record.drafts.length, 1);
});
