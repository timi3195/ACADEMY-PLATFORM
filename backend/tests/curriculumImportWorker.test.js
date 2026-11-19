const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const importService = require("../services/curriculumImportService");
const worker = require("../services/curriculumImportWorker");
const limits = require("../config/curriculumExtractionLimits");

const IMPORT_ID = "507f1f77bcf86cd799439019";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";
const bytes = Buffer.from("bounded generated document");
const storedDocument = (mimeType = DOCX_MIME) => ({
  provider: "local-disk",
  storageFilename: `curriculum-imports/${IMPORT_ID}/source${mimeType === PDF_MIME ? ".pdf" : ".docx"}`,
  storageKey: "",
  status: "stored",
  originalFilename: mimeType === PDF_MIME ? "source.pdf" : "source.docx",
  mimeType,
  size: bytes.length,
  contentHash: crypto.createHash("sha256").update(bytes).digest("hex")
});

test("worker records missing OCR setup and does not claim PDF jobs", async () => {
  let recorded = false;
  let claimOptions;
  const jobs = {
    async recordOcrModelUnavailable() {
      recorded = true;
      return true;
    },
    async claimNextCurriculumImport(options) {
      claimOptions = options;
      return null;
    }
  };
  assert.equal(await worker.processNextCurriculumImport({
    jobs,
    verifyOcrModel: async () => ({ available: false, reason: "missing" })
  }), false);
  assert.equal(recorded, true);
  assert.equal(claimOptions.ocrAvailable, false);
});

test("worker reads private storage, delegates extraction, and persists only through parent", async () => {
  const document = storedDocument();
  const record = {
    _id: IMPORT_ID,
    document,
    extractionJob: {
      generation: 3,
      attempt: 1,
      leaseToken: "11111111-1111-4111-8111-111111111111"
    }
  };
  const calls = [];
  const result = {
    status: "succeeded",
    extractionMethod: "docx_text",
    segments: [],
    ocrCandidatePages: [],
    diagnostics: []
  };
  const processed = await worker.processNextCurriculumImport({
    verifyOcrModel: async () => ({ available: true, dataDirectory: path.resolve("verified-tessdata") }),
    jobs: {
      async claimNextCurriculumImport() {
        return record;
      },
      async renewCurriculumImportLease() {
        return true;
      },
      async persistCurriculumImportResult(input) {
        calls.push(["persist", input]);
        return true;
      }
    },
    storage: {
      async getPrivateCurriculumDocumentStream({ document: readDocument, importId }) {
        assert.equal(importId, IMPORT_ID);
        assert.equal(readDocument.storageFilename, document.storageFilename);
        return require("node:stream").Readable.from([bytes]);
      }
    },
    async runChild(input) {
      calls.push(["child", input]);
      return result;
    }
  });
  assert.equal(processed, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "child");
  assert.deepEqual(calls[0][1].bytes, bytes);
  assert.equal(calls[1][0], "persist");
  assert.equal(calls[1][1].lease.generation, 3);
  assert.equal(calls[1][1].result, result);
});

test("worker never persists a result after parent cancellation", async () => {
  const document = storedDocument();
  const controller = new AbortController();
  let persisted = false;
  const run = worker.processNextCurriculumImport({
    signal: controller.signal,
    verifyOcrModel: async () => ({ available: true, dataDirectory: path.resolve("verified-tessdata") }),
    jobs: {
      async claimNextCurriculumImport() {
        return {
          _id: IMPORT_ID,
          document,
          extractionJob: {
            generation: 1,
            attempt: 1,
            leaseToken: "11111111-1111-4111-8111-111111111111"
          }
        };
      },
      async renewCurriculumImportLease() {
        return true;
      },
      async persistCurriculumImportResult() {
        persisted = true;
        return true;
      }
    },
    storage: {
      async getPrivateCurriculumDocumentStream() {
        return require("node:stream").Readable.from([bytes]);
      }
    },
    async runChild({ signal }) {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("cancelled");
          error.code = "CHILD_PROCESS_FAILED";
          reject(error);
        }, { once: true });
        controller.abort();
      });
    }
  });
  assert.equal(await run, false);
  assert.equal(persisted, false);
});

test("persistent worker processes one document at a time under its singleton lock", async () => {
  const externalController = new AbortController();
  let active = 0;
  let maximumActive = 0;
  let calls = 0;
  let released = false;
  const workerLocks = {
    async acquireWorkerLock() {
      return { leaseToken: "worker-lock" };
    },
    async renewWorkerLock() {
      return true;
    },
    async releaseWorkerLock() {
      released = true;
      return true;
    }
  };
  await worker.runCurriculumImportWorker({
    signal: externalController.signal,
    workerLocks,
    workerToken: "11111111-1111-4111-8111-111111111111",
    pollIntervalMs: 1,
    async processNext() {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (calls === 2) externalController.abort();
      return true;
    }
  });
  assert.equal(maximumActive, 1);
  assert.equal(calls, 2);
  assert.equal(released, true);
});

test("ordinary import serialization excludes extracted text and worker diagnostics", () => {
  const serialized = importService.serializeCurriculumImport({
    _id: IMPORT_ID,
    status: "needs_review",
    extractionStatus: "partially_succeeded",
    extractionJob: {
      leaseToken: "sensitive-lease-token",
      attempt: 2,
      errorCode: "OCR_MODEL_UNAVAILABLE"
    },
    extractedSegments: [{ text: "private extracted content" }],
    diagnostics: [{
      stage: "extraction",
      code: "OCR_MODEL_UNAVAILABLE",
      message: "private worker diagnostic"
    }, {
      stage: "extraction",
      code: "PDF_RENDER_BOUNDS",
      message: "PDF page rendered within configured OCR limits.",
      page: 1,
      width: 1243,
      height: 1609,
      effectiveDpi: 146.3
    }, {
      stage: "validation",
      code: "FILE_TYPE_UNSUPPORTED",
      message: "The uploaded document type is not supported."
    }],
    document: storedDocument(),
    draftEntries: []
  });
  assert.equal(serialized.extractionJob, undefined);
  assert.equal(serialized.extractedSegments, undefined);
  assert.deepEqual(serialized.diagnostics, [{
    stage: "validation",
    code: "FILE_TYPE_UNSUPPORTED",
    message: "The uploaded document type is not supported."
  }]);
  assert.equal(JSON.stringify(serialized).includes("private extracted content"), false);
  assert.equal(JSON.stringify(serialized).includes("sensitive-lease-token"), false);
  assert.equal(JSON.stringify(serialized).includes("private worker diagnostic"), false);
  assert.equal(JSON.stringify(serialized).includes("effectiveDpi"), false);
});

test("worker retains the hard timeout and single-document concurrency configuration", () => {
  assert.equal(limits.maxDocumentProcessingMs, 30 * 60 * 1000);
  assert.equal(limits.workerConcurrency, 1);
});
