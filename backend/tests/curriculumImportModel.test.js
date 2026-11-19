const test = require("node:test");
const assert = require("node:assert/strict");
const CurriculumImport = require("../models/CurriculumImport");
const extractionLimits = require("../config/curriculumExtractionLimits");

const ids = {
  school: "507f1f77bcf86cd799439011",
  department: "507f1f77bcf86cd799439012",
  admin: "507f1f77bcf86cd799439013"
};
const validImport = () => ({
  _id: "507f1f77bcf86cd799439019",
  school: ids.school,
  department: ids.department,
  programmeHeading: "Computer Science",
  programmeHeadingKey: "supplied-but-ignored",
  document: {
    provider: "local-disk",
    storageFilename: `curriculum-imports/${"507f1f77bcf86cd799439019"}/source.pdf`,
    status: "stored",
    originalFilename: "curriculum.pdf",
    mimeType: "application/pdf",
    size: 1024,
    contentHash: "a".repeat(64)
  },
  uploadedBy: ids.admin,
  version: 1,
  draftEntries: [{
    title: "Introduction to Computing",
    code: "CIT 101",
    creditUnits: 3,
    level: "ND1",
    semester: "First",
    entryIdentity: "page:2:row:1",
    sourceEvidence: [{
      field: "title",
      page: 2,
      excerpt: "Introduction to Computing",
      extractionMethod: "pdf_text",
      confidence: 0.98
    }],
    uncertaintyFlags: [],
    idempotencyKey: "a".repeat(64)
  }]
});

test("curriculum import accepts private document metadata and a source-evidenced draft", async () => {
  const model = new CurriculumImport(validImport());
  await assert.doesNotReject(model.validate());
  assert.equal(model.programmeHeadingKey, "computer science");
  assert.match(model.draftEntries[0].idempotencyKey, /^[a-f0-9]{64}$/);
  assert.equal(model.draftEntries[0].createdCourse, null);
  assert.equal(model.draftEntries[0].reviewStatus, "pending");
  assert.equal(CurriculumImport.schema.path("document.url"), undefined);
});

test("incomplete draft fields require an uncertainty indicator and cannot be approved", async () => {
  const entry = {
    ...validImport().draftEntries[0],
    creditUnits: null,
    uncertaintyFlags: []
  };
  const model = new CurriculumImport({ ...validImport(), draftEntries: [entry] });
  await assert.rejects(model.validate(), /missing or unconfirmed fields/);

  entry.uncertaintyFlags = ["missing_required_field"];
  const validDraft = new CurriculumImport({ ...validImport(), draftEntries: [entry] });
  await assert.doesNotReject(validDraft.validate());

  entry.reviewStatus = "approved";
  entry.reviewer = ids.admin;
  entry.reviewedAt = new Date();
  entry.reviewHistory = [{ reviewer: ids.admin, action: "approved" }];
  const approvedDraft = new CurriculumImport({ ...validImport(), draftEntries: [entry] });
  await assert.rejects(approvedDraft.validate(), /every required course field/);
});

test("curriculum import rejects unsupported course field values and unsafe diagnostics", async () => {
  const model = new CurriculumImport({
    ...validImport(),
    diagnostics: [{
      stage: "extraction",
      code: "PROVIDER_ERROR",
      message: "provider credentials or connection details"
    }],
    draftEntries: [{
      ...validImport().draftEntries[0],
      level: "ND3"
    }]
  });
  await assert.rejects(model.validate(), (error) => {
    assert.ok(error.errors["diagnostics.0.code"]);
    assert.ok(error.errors["draftEntries.0.level"]);
    return true;
  });
});

test("curriculum import requires a storage location matching its provider", async () => {
  const model = new CurriculumImport({
    ...validImport(),
    document: {
      ...validImport().document,
      storageFilename: ""
    }
  });
  await assert.rejects(model.validate(), /storage reference is invalid/);
});

test("curriculum imports cannot persist uploads above the configured limit", async () => {
  const model = new CurriculumImport({
    ...validImport(),
    document: {
      ...validImport().document,
      size: extractionLimits.maxUploadBytes + 1
    }
  });
  await assert.rejects(model.validate(), /maximum allowed value/);

  const legacyRecord = CurriculumImport.hydrate({
    ...validImport(),
    document: {
      ...validImport().document,
      size: extractionLimits.maxUploadBytes + 1
    }
  });
  await assert.rejects(legacyRecord.validate(), /maximum allowed value/);
});

test("curriculum storage references reject traversal and paths outside the private namespace", async () => {
  for (const storageKey of [
    "curriculum-imports/507f1f77bcf86cd799439019/../secret.pdf",
    "other-content/507f1f77bcf86cd799439019/source.pdf",
    "https://example.invalid/source.pdf",
    "curriculum-imports\\507f1f77bcf86cd799439019\\source.pdf"
  ]) {
    const model = new CurriculumImport({
      ...validImport(),
      document: {
        ...validImport().document,
        provider: "object-storage",
        storageFilename: "",
        storageKey
      }
    });
    await assert.rejects(model.validate(), /storage reference is invalid/);
  }
});

test("curriculum storage metadata rejects unsafe original filenames and MIME-extension mismatch", async () => {
  const unsafeFilename = new CurriculumImport({
    ...validImport(),
    document: {
      ...validImport().document,
      originalFilename: "..\\private.pdf"
    }
  });
  await assert.rejects(unsafeFilename.validate());

  const mismatchedExtension = new CurriculumImport({
    ...validImport(),
    document: {
      ...validImport().document,
      storageFilename: `curriculum-imports/${"507f1f77bcf86cd799439019"}/source.docx`
    }
  });
  await assert.rejects(mismatchedExtension.validate(), /storage reference is invalid/);
});

test("reviewed and created-course fields cannot bypass review state", async () => {
  const model = new CurriculumImport({
    ...validImport(),
    draftEntries: [{
      ...validImport().draftEntries[0],
      reviewStatus: "approved",
      createdCourse: "507f1f77bcf86cd799439014"
    }]
  });
  await assert.rejects(model.validate(), /reviewer/);
});

test("approval requires all Course fields and source evidence or an audited Admin confirmation", async () => {
  const entry = validImport().draftEntries[0];
  entry.reviewHistory = [];
  entry.sourceEvidence = [{
    field: "title",
    page: 2,
    excerpt: "Introduction to Computing",
    extractionMethod: "pdf_text"
  }];
  for (const [field, value] of [
    ["code", "CIT 101"],
    ["creditUnits", "3"],
    ["level", "ND1"],
    ["semester", "First"]
  ]) {
    entry.reviewHistory.push({
      reviewer: ids.admin,
      action: "confirmed",
      field,
      newValue: value,
      note: "Confirmed against the official source."
    });
  }
  entry.reviewHistory.push({ reviewer: ids.admin, action: "approved" });
  entry.reviewStatus = "approved";
  entry.reviewer = ids.admin;
  entry.reviewedAt = new Date();
  const accepted = new CurriculumImport({ ...validImport(), draftEntries: [entry] });
  await assert.doesNotReject(accepted.validate());

  const model = new CurriculumImport({
    ...validImport(),
    draftEntries: [{
      ...validImport().draftEntries[0],
      semester: null,
      reviewStatus: "approved",
      reviewer: ids.admin,
      reviewedAt: new Date(),
      reviewHistory: [{
        reviewer: ids.admin,
        action: "approved"
      }]
    }]
  });
  await assert.rejects(model.validate(), (error) => {
    assert.ok(error.errors["draftEntries.0.semester"]);
    return true;
  });
});

test("approval cannot treat empty evidence as proof of a source value", async () => {
  const entry = validImport().draftEntries[0];
  const model = new CurriculumImport({
    ...validImport(),
    draftEntries: [{
      ...entry,
      sourceEvidence: [{ field: "title", extractionMethod: "gemini" }],
      reviewStatus: "approved",
      reviewer: ids.admin,
      reviewedAt: new Date(),
      reviewHistory: [{
        reviewer: ids.admin,
        action: "approved"
      }]
    }]
  });
  await assert.rejects(model.validate(), (error) => {
    assert.ok(error.errors["draftEntries.0.title"]);
    return true;
  });
});

test("curriculum import rejects duplicate draft idempotency keys", async () => {
  const entry = validImport().draftEntries[0];
  const model = new CurriculumImport({
    ...validImport(),
    draftEntries: [entry, { ...entry }]
  });
  await assert.rejects(model.validate(), /unique idempotency keys/);
});

test("curriculum extraction limits validate page, image, and timeout ceilings", () => {
  assert.equal(extractionLimits.isPdfPageCountWithinLimit(50), true);
  assert.equal(extractionLimits.isPdfPageCountWithinLimit(51), false);
  assert.equal(extractionLimits.isPdfPageCountWithinLimit(0), false);
  assert.equal(extractionLimits.isRenderedPageWithinLimits(1000, 2000), true);
  assert.equal(extractionLimits.isRenderedPageWithinLimits(1001, 2000), false);
  assert.equal(extractionLimits.isRenderedPageWithinLimits(2001, 1), false);
  assert.equal(
    extractionLimits.isDocumentProcessingTimeWithinLimit(extractionLimits.maxDocumentProcessingMs),
    true
  );
  assert.equal(
    extractionLimits.isDocumentProcessingTimeWithinLimit(extractionLimits.maxDocumentProcessingMs + 1),
    false
  );
});

test("extracted segments enforce count, character, and UTF-8 byte limits", async () => {
  assert.equal(extractionLimits.isExtractedSegmentsWithinLimits([{
    text: "Course title",
    locator: "page:1:block:1",
    extractionMethod: "pdf_text"
  }]), true);
  assert.equal(extractionLimits.isExtractedSegmentsWithinLimits(
    Array.from({ length: extractionLimits.maxStoredSegments + 1 }, () => ({ text: "x" }))
  ), false);
  assert.equal(extractionLimits.isExtractedSegmentsWithinLimits([{
    text: "x".repeat(extractionLimits.maxExtractedTextCharacters + 1)
  }]), false);

  const tooMuchText = new CurriculumImport({
    ...validImport(),
    extractedSegments: Array.from(
      { length: extractionLimits.maxStoredSegments + 1 },
      (_unused, index) => ({
        text: "x",
        locator: `page:1:block:${index}`,
        extractionMethod: "pdf_text"
      })
    )
  });
  await assert.rejects(tooMuchText.validate(), /configured limits/);

  const oversizedText = new CurriculumImport({
    ...validImport(),
    extractedSegments: [{
      text: "x".repeat(extractionLimits.maxExtractedTextCharacters + 1),
      locator: "page:1:block:1",
      extractionMethod: "pdf_text"
    }]
  });
  await assert.rejects(oversizedText.validate(), /configured limits/);
});

test("curriculum import enforces the diagnostic count limit", async () => {
  assert.equal(extractionLimits.isDiagnosticCountWithinLimit(
    Array.from({ length: extractionLimits.maxDiagnostics }, () => ({}))
  ), true);
  assert.equal(extractionLimits.isDiagnosticCountWithinLimit(
    Array.from({ length: extractionLimits.maxDiagnostics + 1 }, () => ({}))
  ), false);

  const model = new CurriculumImport({
    ...validImport(),
    diagnostics: Array.from({ length: extractionLimits.maxDiagnostics + 1 }, () => ({
      stage: "extraction",
      code: "TEXT_EXTRACTION_FAILED",
      message: "Text could not be extracted from the document."
    }))
  });
  await assert.rejects(model.validate(), /diagnostics exceed the configured limit/);
});

test("legacy pending imports are not marked as explicitly requested jobs", async () => {
  const model = new CurriculumImport({
    ...validImport(),
    extractionStatus: "pending",
    extractionJob: undefined
  });
  await assert.doesNotReject(model.validate());
  assert.equal(model.extractionJob.requestedAt, null);
  assert.equal(model.extractionJob.generation, 0);
  assert.equal(model.extractionJob.attempt, 0);
});

test("job metadata requires a valid explicit request and consistent lease fields", async () => {
  const validJob = {
    requestedAt: new Date(),
    generation: 1,
    attempt: 1,
    leaseToken: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    leaseExpiresAt: new Date(Date.now() + 60_000),
    heartbeatAt: new Date(),
    nextAttemptAt: null,
    errorCode: ""
  };
  const valid = new CurriculumImport({
    ...validImport(),
    status: "processing",
    extractionStatus: "processing",
    extractionJob: validJob
  });
  await assert.doesNotReject(valid.validate());

  const missingRequest = new CurriculumImport({
    ...validImport(),
    extractionJob: { generation: 1 }
  });
  await assert.rejects(missingRequest.validate(), /explicit request/);

  const malformedLease = new CurriculumImport({
    ...validImport(),
    extractionJob: {
      requestedAt: new Date(),
      generation: 1,
      leaseToken: "not-a-lease-token"
    }
  });
  await assert.rejects(malformedLease.validate());

  const unsafeErrorCode = new CurriculumImport({
    ...validImport(),
    extractionJob: {
      requestedAt: new Date(),
      generation: 1,
      errorCode: "provider credentials"
    }
  });
  await assert.rejects(unsafeErrorCode.validate());
});

test("processing imports require a complete lease and consistent processing statuses", async () => {
  for (const fields of [
    {
      status: "processing",
      extractionStatus: "processing",
      extractionJob: { requestedAt: new Date(), generation: 1, attempt: 1 }
    },
    {
      status: "processing",
      extractionStatus: "pending",
      extractionJob: {
        requestedAt: new Date(),
        generation: 1,
        attempt: 1,
        leaseToken: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        leaseExpiresAt: new Date(Date.now() + 60_000),
        heartbeatAt: new Date()
      }
    }
  ]) {
    const model = new CurriculumImport({ ...validImport(), ...fields });
    await assert.rejects(model.validate(), /complete active lease|active lease requires/);
  }
});

test("worker claim and expired-lease indexes are declared without automatic index creation", () => {
  assert.equal(CurriculumImport.schema.options.autoIndex, false);
  const workerIndexes = CurriculumImport.schema.indexes()
    .filter(([, options]) => [
      "curriculum_import_pending_claim",
      "curriculum_import_lease_recovery"
    ].includes(options.name));

  assert.deepEqual(
    workerIndexes.find(([, options]) =>
      options.name === "curriculum_import_pending_claim")?.[0],
    {
      status: 1,
      extractionStatus: 1,
      "document.status": 1,
      "document.mimeType": 1,
      "extractionJob.requestedAt": 1,
      "extractionJob.nextAttemptAt": 1,
      uploadedAt: 1,
      _id: 1
    }
  );
  assert.deepEqual(
    workerIndexes.find(([, options]) =>
      options.name === "curriculum_import_lease_recovery")?.[0],
    {
      status: 1,
      extractionStatus: 1,
      "extractionJob.requestedAt": 1,
      "extractionJob.leaseExpiresAt": 1,
      "extractionJob.attempt": 1
    }
  );
});
