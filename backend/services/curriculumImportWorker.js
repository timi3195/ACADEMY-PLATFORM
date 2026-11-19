const crypto = require("node:crypto");
const CurriculumImport = require("../models/CurriculumImport");
const extractionService = require("./curriculumDocumentExtractionService");
const storageService = require("./storageService");
const jobService = require("./curriculumImportJobService");
const workerLockService = require("./curriculumImportWorkerLockService");
const {
  DATA_DIRECTORY: OCR_DATA_DIRECTORY,
  verifyLocalOcrModel
} = require("./curriculumOcrModelVerification");
const { runCurriculumDocumentChild } = require("./curriculumDocumentChildProcess");
const limits = require("../config/curriculumExtractionLimits");

const errorCodeFor = (error) => [
  "WORKER_OUTPUT_INVALID",
  "CHILD_PROCESS_FAILED",
  "PROCESSING_TIMEOUT",
  "OCR_FAILED",
  "TEXT_EXTRACTION_FAILED"
].includes(error?.code)
  ? error.code
  : "INTERNAL_PROCESSING_ERROR";

const asPlainDocument = (document) =>
  typeof document?.toObject === "function" ? document.toObject() : document;

const processNextCurriculumImport = async ({
  CurriculumImportModel = CurriculumImport,
  storage = storageService,
  jobs = jobService,
  verifyOcrModel = verifyLocalOcrModel,
  runChild = runCurriculumDocumentChild,
  signal
} = {}) => {
  const ocrModel = await verifyOcrModel();
  if (!ocrModel.available) {
    await jobs.recordOcrModelUnavailable({ CurriculumImportModel });
  }
  const record = await jobs.claimNextCurriculumImport({
    CurriculumImportModel,
    ocrAvailable: ocrModel.available
  });
  if (!record) return false;

  const lease = {
    importId: String(record._id),
    generation: record.extractionJob.generation,
    attempt: record.extractionJob.attempt,
    leaseToken: record.extractionJob.leaseToken
  };
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abortFromParent, { once: true });

  let heartbeatPending = false;
  let leaseLost = controller.signal.aborted;
  const heartbeat = setInterval(async () => {
    if (heartbeatPending || leaseLost) return;
    heartbeatPending = true;
    try {
      const renewed = await jobs.renewCurriculumImportLease({ lease: lease, CurriculumImportModel });
      if (!renewed) {
        leaseLost = true;
        controller.abort();
      }
    } catch {
      leaseLost = true;
      controller.abort();
    } finally {
      heartbeatPending = false;
    }
  }, limits.processingHeartbeatMs);
  heartbeat.unref?.();

  try {
    const document = asPlainDocument(record.document);
    const { bytes, mimeType } = await extractionService.readPrivateDocument({
      document,
      importId: lease.importId,
      storage
    });
    if (mimeType !== document.mimeType) {
      const error = new Error("Stored document type is invalid.");
      error.code = "TEXT_EXTRACTION_FAILED";
      throw error;
    }
    if (controller.signal.aborted) return false;
    const result = await runChild({
      lease,
      document,
      bytes,
      dataDirectory: ocrModel.available ? ocrModel.dataDirectory : OCR_DATA_DIRECTORY,
      signal: controller.signal
    });
    if (controller.signal.aborted || leaseLost) return false;
    return await jobs.persistCurriculumImportResult({
      lease,
      result,
      CurriculumImportModel
    });
  } catch (error) {
    if (controller.signal.aborted || leaseLost) return false;
    return await jobs.persistCurriculumImportFailure({
      lease,
      errorCode: errorCodeFor(error),
      CurriculumImportModel
    });
  } finally {
    clearInterval(heartbeat);
    signal?.removeEventListener("abort", abortFromParent);
  }
};

const waitForNextPoll = (milliseconds, signal) => new Promise((resolve) => {
  if (signal?.aborted) {
    resolve();
    return;
  }
  const timer = setTimeout(done, milliseconds);
  function done() {
    clearTimeout(timer);
    signal?.removeEventListener("abort", done);
    resolve();
  }
  signal?.addEventListener("abort", done, { once: true });
});

const runCurriculumImportWorker = async ({
  signal,
  jobs = jobService,
  workerLocks = workerLockService,
  processNext = processNextCurriculumImport,
  workerToken = crypto.randomUUID(),
  pollIntervalMs = limits.processingPollMs,
  WorkerLockModel
} = {}) => {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abortFromParent, { once: true });

  let lockHeld = false;
  let lockLost = false;
  let lockHeartbeatPending = false;
  let lockHeartbeat;
  try {
    while (!controller.signal.aborted && !lockLost) {
      const lock = await workerLocks.acquireWorkerLock({
        leaseToken: workerToken,
        WorkerLockModel
      });
      if (!lock) {
        await waitForNextPoll(pollIntervalMs, controller.signal);
        continue;
      }
      lockHeld = true;
      lockHeartbeat = setInterval(async () => {
        if (lockHeartbeatPending || lockLost) return;
        lockHeartbeatPending = true;
        try {
          const renewed = await workerLocks.renewWorkerLock({
            leaseToken: workerToken,
            WorkerLockModel
          });
          if (!renewed) {
            lockLost = true;
            controller.abort();
          }
        } catch {
          lockLost = true;
          controller.abort();
        } finally {
          lockHeartbeatPending = false;
        }
      }, limits.processingHeartbeatMs);
      lockHeartbeat.unref?.();

      while (!controller.signal.aborted && !lockLost) {
        const processed = await processNext({ signal: controller.signal });
        if (!processed) await waitForNextPoll(pollIntervalMs, controller.signal);
      }
    }
  } finally {
    if (lockHeartbeat) clearInterval(lockHeartbeat);
    if (lockHeld) await workerLocks.releaseWorkerLock({ leaseToken: workerToken, WorkerLockModel });
    signal?.removeEventListener("abort", abortFromParent);
  }
};

module.exports = {
  errorCodeFor,
  processNextCurriculumImport,
  runCurriculumImportWorker
};
