const test = require("node:test");
const assert = require("node:assert/strict");
const jobs = require("../services/questionExtractionJobService");
const processing = require("../services/questionExtractionProcessingService");

const clone = (value) => ({
  ...value,
  processingLockUntil: value.processingLockUntil && new Date(value.processingLockUntil),
  nextAttemptAt: value.nextAttemptAt && new Date(value.nextAttemptAt)
});

const createModel = (initial = []) => {
  const records = initial.map(clone);
  const matches = (record, filter) => {
    if (filter._id && String(record._id) !== String(filter._id)) return false;
    if (filter.batchId && record.batchId !== filter.batchId) return false;
    if (filter.status && typeof filter.status === "string" && record.status !== filter.status) return false;
    if (filter.status?.$in && !filter.status.$in.includes(record.status)) return false;
    if (filter.processingLockToken !== undefined &&
        record.processingLockToken !== filter.processingLockToken) return false;
    const lock = filter.processingLockUntil;
    if (lock?.$lte && !(record.processingLockUntil && record.processingLockUntil <= lock.$lte)) return false;
    if (lock?.$gt && !(record.processingLockUntil && record.processingLockUntil > lock.$gt)) return false;
    const attempts = filter.processingAttemptCount;
    if (attempts?.$lt && !(record.processingAttemptCount < attempts.$lt)) return false;
    if (attempts?.$exists === false && record.processingAttemptCount !== undefined) return false;
    if (filter.$and) {
      for (const condition of filter.$and) {
        if (condition.$or) {
          if (!condition.$or.some((candidate) => {
            if (candidate.nextAttemptAt === null) return !record.nextAttemptAt;
            return !candidate.nextAttemptAt?.$lte ||
              (record.nextAttemptAt && record.nextAttemptAt <= candidate.nextAttemptAt.$lte);
          })) return false;
        } else if (condition.$or?.some((item) => item.processingAttemptCount)) {
          const eligible = condition.$or.some((item) =>
            item.processingAttemptCount?.$exists === false
              ? record.processingAttemptCount === undefined
              : record.processingAttemptCount < item.processingAttemptCount.$lt
          );
          if (!eligible) return false;
        }
      }
    }
    return true;
  };
  const apply = (record, update) => {
    Object.assign(record, update.$set || {});
    for (const [field, amount] of Object.entries(update.$inc || {})) {
      record[field] = Number(record[field] || 0) + amount;
    }
    for (const [field, value] of Object.entries(update.$push || {})) {
      record[field] ||= [];
      record[field].push(value);
    }
  };
  return {
    records,
    findOne(filter) {
      let result = records.find((record) => matches(record, filter)) || null;
      return {
        sort() { return this; },
        lean: async () => result && clone(result)
      };
    },
    async findOneAndUpdate(filter, update) {
      const record = records.find((candidate) => matches(candidate, filter));
      if (!record) return null;
      apply(record, update);
      return clone(record);
    },
    async updateOne(filter, update) {
      const record = records.find((candidate) => matches(candidate, filter));
      if (!record) return { matchedCount: 0 };
      apply(record, update);
      return { matchedCount: 1 };
    }
  };
};

const makeQueuedJob = (overrides = {}) => ({
  _id: "batch-object-id",
  batchId: "batch-1",
  status: "queued",
  processingStage: "ocr",
  processingLockToken: "",
  processingLockUntil: null,
  processingAttemptCount: 0,
  nextAttemptAt: null,
  images: [{ ocrStatus: "pending" }],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides
});

test("atomic claims allow only one concurrent worker to own a queued batch", async () => {
  const model = createModel([makeQueuedJob()]);
  const [first, second] = await Promise.all([
    jobs.claimNextJob({ ExtractionModel: model }),
    jobs.claimNextJob({ ExtractionModel: model })
  ]);
  assert.equal(Number(Boolean(first)) + Number(Boolean(second)), 1);
  assert.equal(model.records[0].status, "processing");
  assert.ok(model.records[0].processingLockToken);
});

test("lease heartbeat renews an active lease and recovery reschedules an expired lease", async () => {
  const start = new Date("2026-01-01T00:00:00Z");
  const model = createModel([makeQueuedJob({
    status: "processing",
    processingLockToken: "worker-a",
    processingLockUntil: new Date(start.getTime() + 1000),
    processingAttemptCount: 1
  })]);
  const now = () => new Date(start);
  assert.equal(await jobs.renewLease({
    batchId: "batch-1",
    token: "worker-a",
    ExtractionModel: model,
    now
  }), true);
  assert.ok(model.records[0].processingLockUntil > start);

  model.records[0].processingLockUntil = new Date(start.getTime() - 1);
  const recovered = await jobs.recoverExpiredJobs({
    ExtractionModel: model,
    now,
    random: () => 0
  });
  assert.equal(recovered.recovered, 1);
  assert.equal(model.records[0].status, "queued");
  assert.equal(model.records[0].processingLockToken, "");
  assert.equal(model.records[0].nextAttemptAt.getTime(), start.getTime() + 22500);
});

test("the extracted-to-structuring state retains and recovers its worker lease", async () => {
  const start = new Date("2026-01-01T00:00:00Z");
  const model = createModel([makeQueuedJob({
    status: "extracted",
    processingStage: "structuring",
    processingLockToken: "worker-a",
    processingLockUntil: new Date(start.getTime() + 1000),
    processingAttemptCount: 1
  })]);
  const now = () => new Date(start);
  assert.equal(await jobs.renewLease({
    batchId: "batch-1",
    token: "worker-a",
    ExtractionModel: model,
    now
  }), true);

  model.records[0].processingLockUntil = new Date(start.getTime() - 1);
  const recovered = await jobs.recoverExpiredJobs({
    ExtractionModel: model,
    now,
    random: () => 0
  });
  assert.equal(recovered.recovered, 1);
  assert.equal(model.records[0].status, "queued");
});

test("stale worker tokens cannot persist a batch after a newer claim", async () => {
  const model = createModel([makeQueuedJob({
    status: "processing",
    processingLockToken: "new-worker-token",
    processingLockUntil: new Date(Date.now() + 60_000)
  })]);
  await assert.rejects(processing.persistProcessingBatch({
    _id: "batch-object-id",
    status: "needs_review",
    processingLockToken: "old-worker-token"
  }, "old-worker-token", model), (error) => error.code === "EXTRACTION_PROCESSING_LEASE_LOST");
  assert.equal(model.records[0].status, "processing");
});

test("a worker whose lease expired cannot persist even before another claim", async () => {
  const model = createModel([makeQueuedJob({
    status: "processing",
    processingLockToken: "expired-worker-token",
    processingLockUntil: new Date(Date.now() - 1000)
  })]);
  await assert.rejects(processing.persistProcessingBatch({
    ...model.records[0],
    status: "needs_review"
  }, "expired-worker-token", model), (error) => error.code === "EXTRACTION_PROCESSING_LEASE_LOST");
  assert.equal(model.records[0].status, "processing");
});

test("worker shuts down after SIGTERM without starting another poll", async () => {
  const controller = new AbortController();
  let polls = 0;
  const run = jobs.runQuestionExtractionWorker({
    signal: controller.signal,
    concurrency: 1,
    pollIntervalMs: 10000,
    processNext: async () => {
      polls += 1;
      return null;
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();
  await run;
  assert.equal(polls, 1);
});

test("graceful shutdown drains an active job before the worker exits", async () => {
  const controller = new AbortController();
  let markStarted;
  let releaseProcessor;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const waitForRelease = new Promise((resolve) => { releaseProcessor = resolve; });
  let completed = false;
  let polls = 0;
  const run = jobs.runQuestionExtractionWorker({
    signal: controller.signal,
    concurrency: 1,
    pollIntervalMs: 10000,
    processNext: async () => {
      polls += 1;
      if (polls > 1) return null;
      return {
        batch: { batchId: "batch-drain", processingAttemptCount: 1 },
        token: "worker-a",
        stage: "ocr"
      };
    },
    processor: async () => {
      markStarted();
      await waitForRelease;
      completed = true;
    }
  });
  await started;
  controller.abort();
  assert.equal(completed, false);
  releaseProcessor();
  await run;
  assert.equal(completed, true);
  assert.equal(polls, 1);
});

test("automatic retry scheduling uses attempt count and preserves the Admin retry counter", async () => {
  const model = createModel([makeQueuedJob({
    status: "processing",
    processingLockToken: "worker-a",
    processingAttemptCount: 2,
    retryCount: 1
  })]);
  const now = () => new Date("2026-01-01T00:00:00Z");
  const scheduled = await jobs.scheduleRetry({
    job: {
      batch: model.records[0],
      token: "worker-a",
      stage: "structuring"
    },
    error: new Error("temporary"),
    ExtractionModel: model,
    now,
    random: () => 0
  });
  assert.equal(scheduled, true);
  assert.equal(model.records[0].status, "queued");
  assert.equal(model.records[0].retryCount, 1);
  assert.equal(model.records[0].nextAttemptAt.getTime(), now().getTime() + 45000);
});
