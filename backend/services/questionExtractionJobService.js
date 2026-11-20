const crypto = require("crypto");
const QuestionExtraction = require("../models/QuestionExtraction");
const processingService = require("./questionExtractionProcessingService");

const readLimit = (name, fallback, minimum, maximum) => {
  const configured = process.env[name];
  if (configured === undefined || configured === "") return fallback;
  const value = Number(configured);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
};

const DEFAULT_CONCURRENCY = readLimit("QUESTION_EXTRACTION_WORKER_CONCURRENCY", 1, 1, 4);
const POLL_INTERVAL_MS = readLimit("QUESTION_EXTRACTION_WORKER_POLL_MS", 5000, 250, 60000);
const LEASE_MS = readLimit("QUESTION_EXTRACTION_WORKER_LEASE_MS", 90000, 30000, 600000);
const HEARTBEAT_MS = readLimit("QUESTION_EXTRACTION_WORKER_HEARTBEAT_MS", 20000, 5000, 120000);
const MAX_PROCESSING_ATTEMPTS = readLimit("QUESTION_EXTRACTION_MAX_PROCESSING_ATTEMPTS", 5, 1, 20);
const RETRY_BASE_MS = readLimit("QUESTION_EXTRACTION_RETRY_BASE_MS", 30000, 1000, 300000);
const RETRY_CAP_MS = readLimit("QUESTION_EXTRACTION_RETRY_CAP_MS", 300000, 10000, 3600000);
const ACTIVE_LEASE_STATUSES = ["processing", "extracted"];

if (HEARTBEAT_MS >= LEASE_MS) {
  throw new Error("Question extraction worker heartbeat must be shorter than its lease.");
}

const log = (event, details = {}) => {
  console.log(JSON.stringify({ event, ...details, timestamp: new Date().toISOString() }));
};

const stageForBatch = (batch) => {
  if (["ocr", "structuring"].includes(batch.processingStage)) return batch.processingStage;
  return (batch.images || []).some((image) => image.ocrStatus !== "succeeded") ? "ocr" : "structuring";
};

const retryDelay = (attempt, random = Math.random) => {
  const exponential = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * (2 ** Math.max(0, attempt - 1)));
  return Math.min(RETRY_CAP_MS, Math.round(exponential * (0.75 + random() * 0.5)));
};

const attemptFilter = () => ({
  $or: [
    { processingAttemptCount: { $lt: MAX_PROCESSING_ATTEMPTS } },
    { processingAttemptCount: { $exists: false } }
  ]
});

const recoverExpiredJobs = async ({
  ExtractionModel = QuestionExtraction,
  now = () => new Date(),
  random = Math.random
} = {}) => {
  let recovered = 0;
  let failed = 0;

  while (true) {
    const currentTime = now();
    const expired = await ExtractionModel.findOne({
      status: { $in: ACTIVE_LEASE_STATUSES },
      processingLockUntil: { $lte: currentTime }
    }).sort({ processingLockUntil: 1, createdAt: 1 }).lean();
    if (!expired) break;

    const attempts = Number(expired.processingAttemptCount || 0);
    if (attempts >= MAX_PROCESSING_ATTEMPTS) {
      const result = await ExtractionModel.updateOne({
        _id: expired._id,
        status: { $in: ACTIVE_LEASE_STATUSES },
        processingLockToken: expired.processingLockToken,
        processingLockUntil: { $lte: currentTime }
      }, {
        $set: {
          status: "failed",
          processingStage: "none",
          processingLockToken: "",
          processingLockUntil: null,
          processingLeaseHeartbeatAt: null,
          nextAttemptAt: null
        },
        $push: {
          processingErrors: {
            stage: expired.processingStage === "structuring" ? "structuring" : "ocr",
            category: "worker_attempts_exhausted",
            message: "Automatic processing stopped after repeated worker interruptions.",
            occurredAt: currentTime
          }
        }
      });
      if (result.matchedCount) failed += 1;
      continue;
    }

    const delay = retryDelay(Math.max(1, attempts), random);
    const result = await ExtractionModel.updateOne({
      _id: expired._id,
      status: { $in: ACTIVE_LEASE_STATUSES },
      processingLockToken: expired.processingLockToken,
      processingLockUntil: { $lte: currentTime }
    }, {
      $set: {
        status: "queued",
        processingLockToken: "",
        processingLockUntil: null,
        processingLeaseHeartbeatAt: null,
        nextAttemptAt: new Date(currentTime.getTime() + delay)
      },
      $push: {
        processingErrors: {
          stage: expired.processingStage === "structuring" ? "structuring" : "ocr",
          category: "worker_interrupted",
          message: "Processing was interrupted. The saved progress will be resumed automatically.",
          occurredAt: currentTime
        }
      }
    });
    if (result.matchedCount) {
      recovered += 1;
      log("question_extraction_job_recovered", {
        batchId: expired.batchId,
        attempt: attempts,
        retryDelayMs: delay
      });
    }
  }
  return { recovered, failed };
};

const claimNextJob = async ({
  ExtractionModel = QuestionExtraction,
  now = () => new Date()
} = {}) => {
  await recoverExpiredJobs({ ExtractionModel, now });
  const currentTime = now();
  const token = crypto.randomUUID();
  const batch = await ExtractionModel.findOneAndUpdate({
    status: { $in: ["queued", "uploaded"] },
    $and: [
      { $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: currentTime } }] },
      attemptFilter()
    ]
  }, {
    $set: {
      status: "processing",
      processingLockToken: token,
      processingLockUntil: new Date(currentTime.getTime() + LEASE_MS),
      processingLeaseHeartbeatAt: currentTime,
      nextAttemptAt: null
    },
    $inc: { processingAttemptCount: 1 }
  }, {
    new: true,
    sort: { nextAttemptAt: 1, createdAt: 1 }
  });

  if (!batch) return null;
  const stage = stageForBatch(batch);
  if (batch.processingStage !== stage) {
    const result = await ExtractionModel.updateOne({
      _id: batch._id,
      status: "processing",
      processingLockToken: token
    }, { $set: { processingStage: stage } });
    if (!result.matchedCount) return null;
    batch.processingStage = stage;
  }
  log("question_extraction_job_claimed", {
    batchId: batch.batchId,
    stage,
    attempt: batch.processingAttemptCount
  });
  return { batch, token, stage };
};

const renewLease = async ({
  batchId,
  token,
  ExtractionModel = QuestionExtraction,
  now = () => new Date()
}) => {
  const currentTime = now();
  const result = await ExtractionModel.updateOne({
    batchId,
    status: { $in: ACTIVE_LEASE_STATUSES },
    processingLockToken: token,
    processingLockUntil: { $gt: currentTime }
  }, {
    $set: {
      processingLockUntil: new Date(currentTime.getTime() + LEASE_MS),
      processingLeaseHeartbeatAt: currentTime
    }
  });
  return result.matchedCount === 1;
};

const scheduleRetry = async ({
  job,
  error,
  ExtractionModel = QuestionExtraction,
  now = () => new Date(),
  random = Math.random
}) => {
  const currentTime = now();
  const attempts = Number(job.batch.processingAttemptCount || 1);
  const stage = ["ocr", "structuring"].includes(job.batch.processingStage)
    ? job.batch.processingStage
    : job.stage;
  const exhausted = attempts >= MAX_PROCESSING_ATTEMPTS;
  const message = exhausted
    ? "Automatic processing stopped after repeated worker failures. An administrator may retry the batch."
    : "Processing was interrupted. The saved progress will be resumed automatically.";
  const delay = exhausted ? null : retryDelay(attempts, random);
  const update = {
    $set: {
      status: exhausted ? "failed" : "queued",
      processingLockToken: "",
      processingLockUntil: null,
      processingLeaseHeartbeatAt: null,
      nextAttemptAt: delay === null ? null : new Date(currentTime.getTime() + delay)
    },
    $push: {
      processingErrors: {
        stage,
        category: exhausted ? "worker_attempts_exhausted" : "worker_processing_error",
        message,
        occurredAt: currentTime
      }
    }
  };
  const result = await ExtractionModel.updateOne({
    _id: job.batch._id,
    status: { $in: ACTIVE_LEASE_STATUSES },
    processingLockToken: job.token
  }, update);
  if (result.matchedCount) {
    log("question_extraction_job_failed", {
      batchId: job.batch.batchId,
      stage,
      attempt: attempts,
      retryDelayMs: delay,
      errorCode: typeof error?.code === "string" ? error.code.slice(0, 64) : "PROCESSING_ERROR"
    });
  }
  return result.matchedCount === 1;
};

const wait = (milliseconds, signal) => new Promise((resolve) => {
  if (signal?.aborted) return resolve();
  const timer = setTimeout(done, milliseconds);
  function done() {
    clearTimeout(timer);
    signal?.removeEventListener("abort", done);
    resolve();
  }
  signal?.addEventListener("abort", done, { once: true });
});

const runClaimedJob = async ({
  job,
  signal,
  ExtractionModel = QuestionExtraction,
  processor = processingService.processClaimedBatch
}) => {
  let heartbeatPending = false;
  let leaseLost = false;
  const heartbeat = setInterval(async () => {
    if (heartbeatPending || leaseLost) return;
    heartbeatPending = true;
    try {
      const renewed = await renewLease({
        batchId: job.batch.batchId,
        token: job.token,
        ExtractionModel
      });
      if (!renewed) {
        leaseLost = true;
        log("question_extraction_lease_lost", { batchId: job.batch.batchId });
      }
    } catch (error) {
      leaseLost = true;
      log("question_extraction_heartbeat_failed", {
        batchId: job.batch.batchId,
        errorCode: typeof error?.code === "string" ? error.code.slice(0, 64) : "HEARTBEAT_ERROR"
      });
    } finally {
      heartbeatPending = false;
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  try {
    await processor({
      batch: job.batch,
      token: job.token,
      stage: job.stage,
      ExtractionModel
    });
    log("question_extraction_job_completed", {
      batchId: job.batch.batchId,
      stage: job.stage
    });
    return { processed: true };
  } catch (error) {
    if (error?.code === "EXTRACTION_PROCESSING_LEASE_LOST" || leaseLost) {
      return { processed: false, leaseLost: true };
    }
    await scheduleRetry({ job, error, ExtractionModel });
    return { processed: false, retryScheduled: true };
  } finally {
    clearInterval(heartbeat);
  }
};

const runQuestionExtractionWorker = async ({
  signal,
  concurrency = DEFAULT_CONCURRENCY,
  pollIntervalMs = POLL_INTERVAL_MS,
  ExtractionModel = QuestionExtraction,
  processor = processingService.processClaimedBatch,
  processNext
} = {}) => {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new RangeError("Question extraction worker concurrency must be between 1 and 4.");
  }
  const runLoop = async () => {
    while (!signal?.aborted) {
      try {
        const job = processNext
          ? await processNext()
          : await claimNextJob({ ExtractionModel });
        if (job) {
          await runClaimedJob({ job, signal, ExtractionModel, processor });
        } else {
          await wait(pollIntervalMs, signal);
        }
      } catch (error) {
        log("question_extraction_worker_loop_error", {
          errorCode: typeof error?.code === "string" ? error.code.slice(0, 64) : "WORKER_LOOP_ERROR"
        });
        await wait(pollIntervalMs, signal);
      }
    }
  };

  log("question_extraction_worker_started", { concurrency, pollIntervalMs });
  await Promise.all(Array.from({ length: concurrency }, runLoop));
  log("question_extraction_worker_stopped");
};

module.exports = {
  DEFAULT_CONCURRENCY,
  POLL_INTERVAL_MS,
  LEASE_MS,
  HEARTBEAT_MS,
  MAX_PROCESSING_ATTEMPTS,
  RETRY_BASE_MS,
  RETRY_CAP_MS,
  claimNextJob,
  recoverExpiredJobs,
  renewLease,
  retryDelay,
  runClaimedJob,
  runQuestionExtractionWorker,
  scheduleRetry
};
