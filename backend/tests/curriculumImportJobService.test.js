const test = require("node:test");
const assert = require("node:assert/strict");
const limits = require("../config/curriculumExtractionLimits");
const jobService = require("../services/curriculumImportJobService");
const {
  CurriculumJobPersistenceFake
} = require("./helpers/curriculumJobPersistenceFake");

const IMPORT_ID = "507f1f77bcf86cd799439019";
const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const START = new Date("2025-01-01T00:00:00.000Z");
const TOKENS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333"
];

const createImport = ({
  mimeType = DOCX_MIME,
  extractionStatus = "pending",
  status = "uploaded",
  requestedAt = START,
  attempt = 0,
  leaseToken = null,
  leaseExpiresAt = null,
  generation = 1,
  nextAttemptAt = null
} = {}) => ({
  _id: IMPORT_ID,
  status,
  extractionStatus,
  document: { status: "stored", mimeType },
  extractionJob: {
    requestedAt,
    generation,
    attempt,
    leaseToken,
    leaseExpiresAt,
    heartbeatAt: leaseToken ? START : null,
    nextAttemptAt,
    errorCode: "",
    diagnosticAt: null
  },
  diagnostics: [],
  extractedSegments: []
});

const result = {
  status: "succeeded",
  extractionMethod: "docx_text",
  segments: [],
  ocrCandidatePages: [],
  diagnostics: []
};

const claim = (model, attempt = 0, token = TOKENS[attempt]) =>
  jobService.claimNextCurriculumImport({
    CurriculumImportModel: model,
    leaseToken: token
  });

test("atomic claim gives one worker a queued job and increments attempt", async () => {
  const record = createImport();
  const model = new CurriculumJobPersistenceFake([record], START);
  const claims = await Promise.all([
    claim(model, 0, TOKENS[0]),
    claim(model, 0, TOKENS[1])
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(record.extractionStatus, "processing");
  assert.equal(record.extractionJob.attempt, 1);
  assert.equal(record.extractionJob.leaseExpiresAt.getTime(), START.getTime() + limits.processingLeaseMs);
  assert.equal(record.extractionJob.heartbeatAt.getTime(), START.getTime());
});

test("lease timestamps and expiry checks use database time rather than caller clocks", async () => {
  const record = createImport();
  const model = new CurriculumJobPersistenceFake([record], START);
  const first = await jobService.claimNextCurriculumImport({
    CurriculumImportModel: model,
    now: new Date("2035-01-01T00:00:00.000Z"),
    leaseToken: TOKENS[0]
  });
  assert.equal(first.extractionJob.leaseExpiresAt.getTime(), START.getTime() + limits.processingLeaseMs);

  const lease = {
    importId: IMPORT_ID,
    generation: 1,
    attempt: 1,
    leaseToken: TOKENS[0]
  };
  model.serverNow = new Date(START.getTime() + 1_000);
  assert.equal(await jobService.renewCurriculumImportLease({
    lease,
    CurriculumImportModel: model,
    now: new Date("2020-01-01T00:00:00.000Z")
  }), true);
  assert.equal(
    record.extractionJob.leaseExpiresAt.getTime(),
    START.getTime() + 1_000 + limits.processingLeaseMs
  );
  model.serverNow = new Date(record.extractionJob.leaseExpiresAt);
  assert.equal(await jobService.renewCurriculumImportLease({
    lease,
    CurriculumImportModel: model,
    now: START
  }), false);
});

test("an expired lease cannot persist a result or failure before recovery", async () => {
  const record = createImport();
  const model = new CurriculumJobPersistenceFake([record], START);
  const claimed = await claim(model, 0);
  const lease = {
    importId: IMPORT_ID,
    generation: 1,
    attempt: 1,
    leaseToken: claimed.extractionJob.leaseToken
  };
  model.serverNow = new Date(claimed.extractionJob.leaseExpiresAt);
  assert.equal(await jobService.persistCurriculumImportResult({
    lease,
    result,
    CurriculumImportModel: model
  }), false);
  assert.equal(await jobService.persistCurriculumImportFailure({
    lease,
    errorCode: "CHILD_PROCESS_FAILED",
    CurriculumImportModel: model
  }), false);
  assert.equal(record.extractionStatus, "processing");
});

test("crashed attempts honor 30-second and 120-second backoff boundaries", async () => {
  const record = createImport();
  const model = new CurriculumJobPersistenceFake([record], START);

  const first = await claim(model, 0);
  model.serverNow = new Date(first.extractionJob.leaseExpiresAt);
  assert.equal(await claim(model, 1), null);
  const firstRetryAt = record.extractionJob.nextAttemptAt;
  assert.equal(
    firstRetryAt.getTime(),
    model.serverNow.getTime() + limits.processingRetryBackoffMs[0]
  );
  model.serverNow = new Date(firstRetryAt.getTime() - 1);
  assert.equal(await claim(model, 1), null);
  model.serverNow = new Date(firstRetryAt);
  const second = await claim(model, 1);
  assert.equal(second.extractionJob.attempt, 2);

  model.serverNow = new Date(second.extractionJob.leaseExpiresAt);
  assert.equal(await claim(model, 2), null);
  const secondRetryAt = record.extractionJob.nextAttemptAt;
  assert.equal(
    secondRetryAt.getTime(),
    model.serverNow.getTime() + limits.processingRetryBackoffMs[1]
  );
  model.serverNow = new Date(secondRetryAt.getTime() - 1);
  assert.equal(await claim(model, 2), null);
  model.serverNow = new Date(secondRetryAt);
  const third = await claim(model, 2);
  assert.equal(third.extractionJob.attempt, 3);
});

test("ordinary failures use the same backoff and third failure is terminal", async () => {
  const record = createImport();
  const model = new CurriculumJobPersistenceFake([record], START);
  for (let attempt = 1; attempt <= limits.maxProcessingAttempts; attempt += 1) {
    const current = await claim(model, attempt - 1);
    assert.equal(current.extractionJob.attempt, attempt);
    const lease = {
      importId: IMPORT_ID,
      generation: 1,
      attempt,
      leaseToken: TOKENS[attempt - 1]
    };
    const failureTime = new Date(model.serverNow.getTime() + 1);
    model.serverNow = failureTime;
    assert.equal(await jobService.persistCurriculumImportFailure({
      lease,
      errorCode: "CHILD_PROCESS_FAILED",
      CurriculumImportModel: model
    }), true);
    if (attempt < limits.maxProcessingAttempts) {
      assert.equal(record.extractionStatus, "pending");
      assert.equal(
        record.extractionJob.nextAttemptAt.getTime(),
        failureTime.getTime() + limits.processingRetryBackoffMs[attempt - 1]
      );
      assert.equal(await claim(model, attempt), null);
      model.serverNow = new Date(record.extractionJob.nextAttemptAt);
    } else {
      assert.equal(record.extractionStatus, "failed");
      assert.equal(record.status, "failed");
      assert.equal(record.extractionJob.nextAttemptAt, null);
    }
  }
});

test("expired final-attempt lease fails terminally instead of remaining stuck", async () => {
  const record = createImport({
    extractionStatus: "processing",
    status: "processing",
    attempt: limits.maxProcessingAttempts,
    leaseToken: TOKENS[2],
    leaseExpiresAt: START
  });
  const model = new CurriculumJobPersistenceFake([record], new Date(START.getTime() + 1));
  assert.equal(await claim(model, 2), null);
  assert.equal(record.status, "failed");
  assert.equal(record.extractionStatus, "failed");
  assert.equal(record.extractionJob.errorCode, "PROCESSING_TIMEOUT");
  assert.equal(record.extractionJob.leaseToken, null);
});

test("stale worker completion and failure are fenced after the retry is claimed", async () => {
  const record = createImport();
  const model = new CurriculumJobPersistenceFake([record], START);
  const first = await claim(model, 0);
  const firstLease = {
    importId: IMPORT_ID,
    generation: first.extractionJob.generation,
    attempt: first.extractionJob.attempt,
    leaseToken: first.extractionJob.leaseToken
  };
  model.serverNow = new Date(first.extractionJob.leaseExpiresAt);
  assert.equal(await claim(model, 1), null);
  model.serverNow = new Date(record.extractionJob.nextAttemptAt);
  const second = await claim(model, 1);
  const secondLease = {
    importId: IMPORT_ID,
    generation: second.extractionJob.generation,
    attempt: second.extractionJob.attempt,
    leaseToken: second.extractionJob.leaseToken
  };

  model.serverNow = new Date(model.serverNow.getTime() + 1);
  assert.equal(await jobService.persistCurriculumImportResult({
    lease: firstLease,
    result,
    CurriculumImportModel: model
  }), false);
  assert.equal(await jobService.persistCurriculumImportFailure({
    lease: firstLease,
    errorCode: "CHILD_PROCESS_FAILED",
    CurriculumImportModel: model
  }), false);
  assert.equal(record.extractedSegments.length, 0);
  assert.equal(await jobService.persistCurriculumImportResult({
    lease: secondLease,
    result,
    CurriculumImportModel: model
  }), true);
  assert.equal(record.extractionStatus, "succeeded");
});

test("malformed processing records fail safely and release invalid leases", async () => {
  const record = createImport({
    extractionStatus: "processing",
    status: "processing",
    attempt: 1
  });
  const missingRequest = createImport({
    extractionStatus: "processing",
    status: "processing",
    requestedAt: null,
    attempt: 1,
    leaseToken: TOKENS[0],
    leaseExpiresAt: new Date(START.getTime() + limits.processingLeaseMs)
  });
  const model = new CurriculumJobPersistenceFake([record, missingRequest], START);
  assert.equal(await claim(model, 1), null);
  for (const malformed of [record, missingRequest]) {
    assert.equal(malformed.status, "failed");
    assert.equal(malformed.extractionStatus, "failed");
    assert.equal(malformed.extractionJob.errorCode, "INTERNAL_PROCESSING_ERROR");
    assert.equal(malformed.extractionJob.leaseToken, null);
  }
});

test("OCR model absence records a safe diagnostic without bypassing a scheduled retry", async () => {
  const pdf = createImport({ mimeType: PDF_MIME });
  const model = new CurriculumJobPersistenceFake([pdf], START);
  assert.equal(await jobService.recordOcrModelUnavailable({
    CurriculumImportModel: model
  }), true);
  assert.equal(pdf.extractionJob.errorCode, "OCR_MODEL_UNAVAILABLE");
  assert.equal(pdf.diagnostics[0].code, "OCR_MODEL_UNAVAILABLE");
  assert.equal(await jobService.claimNextCurriculumImport({
    CurriculumImportModel: model,
    ocrAvailable: false
  }), null);

  const retryPdf = createImport({
    mimeType: PDF_MIME,
    nextAttemptAt: new Date(START.getTime() + limits.processingRetryBackoffMs[0])
  });
  const retryModel = new CurriculumJobPersistenceFake([retryPdf], START);
  assert.equal(await jobService.recordOcrModelUnavailable({
    CurriculumImportModel: retryModel
  }), false);
  assert.equal(retryPdf.extractionJob.nextAttemptAt.getTime(),
    START.getTime() + limits.processingRetryBackoffMs[0]);
});

test("DOCX may be claimed when the local OCR model is unavailable", async () => {
  const docx = createImport({ mimeType: DOCX_MIME });
  const model = new CurriculumJobPersistenceFake([docx], START);
  const claimed = await jobService.claimNextCurriculumImport({
    CurriculumImportModel: model,
    ocrAvailable: false,
    leaseToken: TOKENS[0]
  });
  assert.ok(claimed);
  assert.equal(claimed.document.mimeType, DOCX_MIME);
});
