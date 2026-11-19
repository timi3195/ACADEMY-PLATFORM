const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const service = require("../services/curriculumImportService");
const CurriculumImport = require("../models/CurriculumImport");
const extractionLimits = require("../config/curriculumExtractionLimits");
const { createDocx, createPdf } = require("./helpers/curriculumDocumentFixtures");

const SCHOOL_ID = "507f1f77bcf86cd799439011";
const DEPARTMENT_ID = "507f1f77bcf86cd799439012";
const HASH = "b".repeat(64);
const ENTRY_ID = "page:2:row:1";
const IMPORT_ID = "507f1f77bcf86cd799439019";
const ADMIN_ID = "507f1f77bcf86cd799439013";

const findResult = (value) => ({
  select() { return this; },
  sort() { return this; },
  lean: async () => value
});

const createReviewableImport = () => new CurriculumImport({
  _id: IMPORT_ID,
  school: SCHOOL_ID,
  department: DEPARTMENT_ID,
  programmeHeading: "Computer Science",
  programmeHeadingKey: "computer science",
  document: {
    provider: "local-disk",
    storageFilename: `curriculum-imports/${IMPORT_ID}/source.pdf`,
    status: "stored",
    originalFilename: "source.pdf",
    mimeType: "application/pdf",
    size: 100,
    contentHash: HASH
  },
  uploadedBy: ADMIN_ID,
  version: 1,
  status: "needs_review",
  draftEntries: [{
    title: "Introduction to Computing",
    code: "CIT 101",
    creditUnits: 3,
    level: "ND1",
    semester: "First",
    entryIdentity: ENTRY_ID,
    sourceEvidence: [{
      field: "title",
      excerpt: "Introduction to Computing",
      extractionMethod: "pdf_text"
    }]
  }]
});

test("normalizes the plain-text programme heading without a Programme model", () => {
  assert.equal(service.normalizeProgrammeHeading("  Computer   Science "), "computer science");
  assert.throws(() => service.normalizeProgrammeHeading("  "), { code: "INVALID_PROGRAMME_HEADING" });
});

test("draft idempotency keys are stable for the same source entry", () => {
  const entry = {
    schoolId: SCHOOL_ID,
    departmentId: DEPARTMENT_ID,
    programmeHeading: "Computer Science",
    documentVersion: 1,
    entryIdentity: ENTRY_ID,
    title: "Introduction to Computing",
    code: "CIT 101",
    creditUnits: 3,
    level: "ND1",
    semester: "First"
  };
  assert.equal(
    service.buildDraftIdempotencyKey(entry),
    service.buildDraftIdempotencyKey({ ...entry, title: "  INTRODUCTION TO COMPUTING " })
  );
  const key = service.buildDraftIdempotencyKey(entry);
  for (const change of [
    { schoolId: "507f1f77bcf86cd799439098" },
    { departmentId: "507f1f77bcf86cd799439099" },
    { programmeHeading: "Information Technology" },
    { documentVersion: 2 },
    { entryIdentity: "page:2:row:2" }
  ]) {
    assert.notEqual(key, service.buildDraftIdempotencyKey({ ...entry, ...change }));
  }
});

test("API serialization omits private paths, extracted text, excerpts, job metadata, and internal keys", () => {
  const safe = service.serializeCurriculumImport({
    _id: IMPORT_ID,
    programmeHeading: "Computer Science",
    programmeHeadingKey: "computer science",
    document: {
      provider: "local-disk",
      storageFilename: `curriculum-imports/${IMPORT_ID}/source.pdf`,
      storageKey: "",
      originalFilename: "source.pdf",
      mimeType: "application/pdf",
      size: 10,
      contentHash: HASH,
      status: "stored"
    },
    draftEntries: [{
      idempotencyKey: HASH,
      title: "Test",
      sourceEvidence: [{
        field: "title",
        excerpt: "private OCR excerpt",
        page: 1,
        locator: "page:1"
      }]
    }],
    extractedSegments: [{ text: "private extracted text" }],
    extractionJob: { leaseToken: "private-lease-token", generation: 3 }
  });
  assert.equal(safe.programmeHeadingKey, undefined);
  assert.equal(safe.document.storageFilename, undefined);
  assert.equal(safe.document.storageKey, undefined);
  assert.equal(safe.document.contentHash, undefined);
  assert.equal(safe.draftEntries[0].idempotencyKey, undefined);
  assert.equal(safe.draftEntries[0].sourceEvidence[0].excerpt, undefined);
  assert.equal(safe.draftEntries[0].sourceEvidence[0].page, 1);
  assert.equal(safe.extractedSegments, undefined);
  assert.equal(safe.extractionJob, undefined);
  assert.equal(JSON.stringify(safe).includes("private OCR excerpt"), false);
});

test("association validation requires the Department to reference the selected School", async () => {
  let departmentFilter;
  const result = await service.assertImportAssociation({
    schoolId: SCHOOL_ID,
    departmentId: DEPARTMENT_ID,
    SchoolModel: { findById: () => findResult({ _id: SCHOOL_ID }) },
    DepartmentModel: {
      findOne: (filter) => {
        departmentFilter = filter;
        return findResult({ _id: DEPARTMENT_ID, school: SCHOOL_ID });
      }
    }
  });
  assert.deepEqual(departmentFilter, { _id: DEPARTMENT_ID, school: SCHOOL_ID });
  assert.deepEqual(result, { schoolId: SCHOOL_ID, departmentId: DEPARTMENT_ID });
});

test("association validation rejects a missing School and a mismatched Department", async () => {
  await assert.rejects(service.assertImportAssociation({
    schoolId: SCHOOL_ID,
    departmentId: DEPARTMENT_ID,
    SchoolModel: { findById: () => findResult(null) },
    DepartmentModel: { findOne: () => findResult(null) }
  }), { code: "SCHOOL_NOT_FOUND" });

  await assert.rejects(service.assertImportAssociation({
    schoolId: SCHOOL_ID,
    departmentId: DEPARTMENT_ID,
    SchoolModel: { findById: () => findResult({ _id: SCHOOL_ID }) },
    DepartmentModel: { findOne: () => findResult(null) }
  }), { code: "DEPARTMENT_SCHOOL_MISMATCH" });
});

test("version planning identifies duplicate content and otherwise supersedes the latest import", async () => {
  let duplicateFilter;
  const duplicate = await service.planImportVersion({
    schoolId: SCHOOL_ID,
    departmentId: DEPARTMENT_ID,
    programmeHeading: "Computer Science",
    contentHash: HASH,
    CurriculumImportModel: {
      findOne: (filter) => {
        duplicateFilter = filter;
        return findResult({ _id: "existing", version: 2 });
      }
    }
  });
  assert.equal(duplicate.status, "duplicate_retry");
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.existingImportId, "existing");
  assert.equal(duplicateFilter["document.contentHash"], HASH);
  assert.equal(Object.prototype.hasOwnProperty.call(duplicate, "supersedes"), false);

  let queryCount = 0;
  const nextVersion = await service.planImportVersion({
    schoolId: SCHOOL_ID,
    departmentId: DEPARTMENT_ID,
    programmeHeading: "Computer Science",
    contentHash: HASH,
    CurriculumImportModel: {
      findOne: () => {
        queryCount += 1;
        return findResult(queryCount === 1 ? null : { _id: "latest", version: 4 });
      }
    }
  });
  assert.equal(nextVersion.status, "new_version");
  assert.equal(nextVersion.duplicate, false);
  assert.equal(nextVersion.version, 5);
  assert.equal(nextVersion.supersedes, "latest");
});

test("first document version is planned as version one", async () => {
  let calls = 0;
  const result = await service.planImportVersion({
    schoolId: SCHOOL_ID,
    departmentId: DEPARTMENT_ID,
    programmeHeading: "Computer Science",
    contentHash: HASH,
    CurriculumImportModel: {
      findOne: () => {
        calls += 1;
        return findResult(null);
      }
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.status, "new_version");
  assert.equal(result.version, 1);
  assert.equal(result.supersedes, null);
});

test("duplicate upload retry returns the existing import without creating or superseding", async () => {
  let created = false;
  const result = await service.createImportVersion({
    importData: {
      schoolId: SCHOOL_ID,
      departmentId: DEPARTMENT_ID,
      programmeHeading: "Computer Science",
      uploadedBy: "507f1f77bcf86cd799439013",
      document: {
        provider: "local-disk",
        storageFilename: `curriculum-imports/${"507f1f77bcf86cd799439019"}/source.pdf`,
        storageKey: "",
        contentHash: HASH
      }
    },
    SchoolModel: { findById: () => findResult({ _id: SCHOOL_ID }) },
    DepartmentModel: { findOne: () => findResult({ _id: DEPARTMENT_ID, school: SCHOOL_ID }) },
    CurriculumImportModel: {
      isSafeStorageReference: () => true,
      findOne: () => findResult({ _id: "existing-import", version: 3 }),
      create: async () => { created = true; }
    }
  });
  assert.equal(result.status, "duplicate_retry");
  assert.equal(result.existingImportId, "existing-import");
  assert.equal(result.version, 3);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "supersedes"), false);
  assert.equal(created, false);
});

test("file import stores only new hashes and plans later document versions", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "curriculum-import-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const files = [];
  const writePdf = async (name, body) => {
    const filePath = path.join(directory, name);
    const bytes = createPdf({ catalogExtra: `/FixtureLabel (${body})` });
    await fs.writeFile(filePath, bytes);
    return { path: filePath, originalname: name, mimetype: "application/pdf", size: bytes.length };
  };
  const model = {
    isSafeStorageReference: CurriculumImport.isSafeStorageReference,
    findOne: (filter) => {
      if (filter["document.contentHash"]) {
        return findResult(files.find((record) =>
          String(record.school) === String(filter.school) &&
          String(record.department) === String(filter.department) &&
          record.programmeHeadingKey === filter.programmeHeadingKey &&
          record.document.contentHash === filter["document.contentHash"]) || null);
      }
      const versions = files.filter((record) =>
        String(record.school) === String(filter.school) &&
        String(record.department) === String(filter.department) &&
        record.programmeHeadingKey === filter.programmeHeadingKey);
      return findResult(versions.sort((a, b) => b.version - a.version)[0] || null);
    },
    create: async (record) => {
      files.push(record);
      return record;
    }
  };
  let storageWrites = 0;
  const storage = {
    storePrivateCurriculumDocument: async ({ importId, ...metadata }) => {
      storageWrites += 1;
      return {
        ...metadata,
        provider: "local-disk",
        storageFilename: `curriculum-imports/${importId}/doc-${storageWrites}.pdf`,
        storageKey: "",
        status: "stored"
      };
    },
    deletePrivateCurriculumDocument: async () => {}
  };
  const dependencies = {
    schoolId: SCHOOL_ID,
    departmentId: DEPARTMENT_ID,
    programmeHeading: "Computer Science",
    uploadedBy: ADMIN_ID,
    SchoolModel: { findById: () => findResult({ _id: SCHOOL_ID }) },
    DepartmentModel: { findOne: () => findResult({ _id: DEPARTMENT_ID, school: SCHOOL_ID }) },
    CurriculumImportModel: model,
    storage
  };

  const firstFile = await writePdf("first.pdf", "version one");
  const first = await service.createCurriculumImportFromFile({ ...dependencies, file: firstFile });
  assert.equal(first.status, "created");
  assert.equal(first.import.version, 1);
  assert.equal(first.import.supersedes, null);

  const retry = await service.createCurriculumImportFromFile({ ...dependencies, file: firstFile });
  assert.equal(retry.status, "duplicate_retry");
  assert.equal(String(retry.existingImportId), first.import._id.toString());
  assert.equal(storageWrites, 1);
  assert.equal(files.length, 1);

  const secondFile = await writePdf("second.pdf", "version two");
  const second = await service.createCurriculumImportFromFile({ ...dependencies, file: secondFile });
  assert.equal(second.status, "created");
  assert.equal(second.import.version, 2);
  assert.equal(second.import.supersedes.toString(), first.import._id.toString());
  assert.equal(storageWrites, 2);
  assert.equal(files.length, 2);
});

test("invalid storage references are rejected before association or version queries", async () => {
  await assert.rejects(service.createImportVersion({
    importData: {
      schoolId: SCHOOL_ID,
      departmentId: DEPARTMENT_ID,
      programmeHeading: "Computer Science",
      document: {
        provider: "local-disk",
        storageFilename: `curriculum-imports/${"507f1f77bcf86cd799439019"}/../source.pdf`,
        storageKey: "",
        mimeType: "application/pdf",
        contentHash: HASH
      }
    },
    SchoolModel: { findById: () => { throw new Error("Must not query"); } },
    DepartmentModel: { findOne: () => { throw new Error("Must not query"); } },
    CurriculumImportModel: require("../models/CurriculumImport")
  }), { code: "INVALID_STORAGE_REFERENCE" });
});

test("concurrent version conflict returns a safe retry result without overwriting", async () => {
  let queries = 0;
  let createCalls = 0;
  const result = await service.createImportVersion({
    importData: {
      schoolId: SCHOOL_ID,
      departmentId: DEPARTMENT_ID,
      programmeHeading: "Computer Science",
      uploadedBy: "507f1f77bcf86cd799439013",
      document: {
        provider: "local-disk",
        storageFilename: `curriculum-imports/${"507f1f77bcf86cd799439019"}/source.pdf`,
        storageKey: "",
        contentHash: HASH
      }
    },
    SchoolModel: { findById: () => findResult({ _id: SCHOOL_ID }) },
    DepartmentModel: { findOne: () => findResult({ _id: DEPARTMENT_ID, school: SCHOOL_ID }) },
    CurriculumImportModel: {
      isSafeStorageReference: () => true,
      findOne: () => {
        queries += 1;
        return findResult(queries === 1 ? null : { _id: "latest-import", version: 4 });
      },
      create: async () => {
        createCalls += 1;
        const conflict = new Error("duplicate key contains private record data");
        conflict.code = 11000;
        conflict.keyPattern = { department: 1, programmeHeadingKey: 1, version: 1 };
        throw conflict;
      }
    }
  });
  assert.equal(result.status, "version_conflict");
  assert.equal(result.retryable, true);
  assert.match(result.message, /Retry to recheck/);
  assert.equal(result.message.includes("private record data"), false);
  assert.equal(createCalls, 1);
});

test("storage namespace validation rejects traversal and invalid providers", () => {
  const valid = {
    provider: "object-storage",
    storageKey: `curriculum-imports/${"507f1f77bcf86cd799439019"}/source.pdf`,
    storageFilename: "",
    mimeType: "application/pdf"
  };
  assert.equal(require("../models/CurriculumImport").isSafeStorageReference(valid), true);
  assert.equal(require("../models/CurriculumImport").isSafeStorageReference({
    ...valid,
    storageKey: `curriculum-imports/${"507f1f77bcf86cd799439019"}/../source.pdf`
  }), false);
  assert.equal(require("../models/CurriculumImport").isSafeStorageReference({
    ...valid,
    provider: "public-url",
    storageKey: "https://example.invalid/source.pdf"
  }), false);
});

test("version planning rejects malformed identifiers and content hashes", async () => {
  await assert.rejects(service.planImportVersion({
    schoolId: SCHOOL_ID,
    departmentId: DEPARTMENT_ID,
    programmeHeading: "Computer Science",
    contentHash: "not-a-hash"
  }), { code: "INVALID_IMPORT_METADATA" });
});

test("upload validation checks filename, declared MIME, signatures, size, and content hash", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "curriculum-validation-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const pdfPath = path.join(directory, "source.pdf");
  const pdfBytes = createPdf();
  await fs.writeFile(pdfPath, pdfBytes);
  const validatedPdf = await service.validateCurriculumUpload({
    path: pdfPath,
    originalname: "source.pdf",
    mimetype: "application/pdf",
    size: pdfBytes.length
  });
  assert.equal(validatedPdf.size, pdfBytes.length);
  assert.match(validatedPdf.contentHash, /^[a-f0-9]{64}$/);

  await assert.rejects(service.validateCurriculumUpload({
    path: pdfPath,
    originalname: "../source.pdf",
    mimetype: "application/pdf",
    size: pdfBytes.length
  }), { code: "INVALID_UPLOAD" });
  await assert.rejects(service.validateCurriculumUpload({
    path: pdfPath,
    originalname: "source.pdf",
    mimetype: "text/plain",
    size: pdfBytes.length
  }), { code: "INVALID_UPLOAD" });

  const invalidPdfPath = path.join(directory, "invalid.pdf");
  await fs.writeFile(invalidPdfPath, Buffer.from("not a PDF"));
  await assert.rejects(service.validateCurriculumUpload({
    path: invalidPdfPath,
    originalname: "invalid.pdf",
    mimetype: "application/pdf",
    size: 9
  }), { code: "INVALID_UPLOAD" });

  const oversizedPdfPath = path.join(directory, "oversized.pdf");
  await fs.writeFile(oversizedPdfPath, Buffer.alloc(0));
  await fs.truncate(oversizedPdfPath, extractionLimits.maxUploadBytes + 1);
  await assert.rejects(service.validateCurriculumUpload({
    path: oversizedPdfPath,
    originalname: "oversized.pdf",
    mimetype: "application/pdf",
    size: extractionLimits.maxUploadBytes + 1
  }), { code: "INVALID_UPLOAD" });

  const docxPath = path.join(directory, "valid.docx");
  const docxBytes = createDocx();
  await fs.writeFile(docxPath, docxBytes);
  const validatedDocx = await service.validateCurriculumUpload({
    path: docxPath,
    originalname: "valid.docx",
    mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: docxBytes.length
  });
  assert.equal(validatedDocx.mimeType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

  const invalidDocxPath = path.join(directory, "invalid.docx");
  await fs.writeFile(invalidDocxPath, Buffer.from("PK\u0003\u0004not a valid docx"));
  await assert.rejects(service.validateCurriculumUpload({
    path: invalidDocxPath,
    originalname: "invalid.docx",
    mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 21
  }), { code: "INVALID_UPLOAD" });
});

test("entry edits preserve source evidence and append an Admin audit event", async () => {
  const record = createReviewableImport();
  record.save = async function saveAndValidate() {
    await this.validate();
    return this;
  };
  const originalFindById = CurriculumImport.findById;
  CurriculumImport.findById = async () => record;
  try {
    const entryId = String(record.draftEntries[0]._id);
    const result = await service.updateCurriculumEntry({
      importId: IMPORT_ID,
      entryId,
      updates: { title: "Updated title" },
      reviewerId: ADMIN_ID,
      note: "Transcribed from the source."
    });
    assert.equal(result.draftEntries[0].title, "Updated title");
    assert.equal(result.draftEntries[0].sourceEvidence[0].excerpt, undefined);
    assert.equal(result.draftEntries[0].reviewHistory[0].action, "edited");
    assert.equal(result.draftEntries[0].reviewHistory[0].reviewer.toString(), ADMIN_ID);
    assert.equal(result.draftEntries[0].reviewStatus, "needs_confirmation");
  } finally {
    CurriculumImport.findById = originalFindById;
  }
});

test("purpose-specific evidence retrieval retains the Admin review excerpt", async () => {
  const record = createReviewableImport();
  const originalFindById = CurriculumImport.findById;
  CurriculumImport.findById = async () => record;
  try {
    const evidence = await service.getCurriculumEntryEvidence({
      importId: IMPORT_ID,
      entryId: String(record.draftEntries[0]._id)
    });
    assert.equal(evidence.importId, IMPORT_ID);
    assert.equal(evidence.sourceEvidence[0].excerpt, "Introduction to Computing");
    assert.equal(evidence.sourceEvidence[0].extractionMethod, "pdf_text");
  } finally {
    CurriculumImport.findById = originalFindById;
  }
});

test("document streaming ties the private storage path to the requested import", async () => {
  const record = createReviewableImport();
  let streamCalls = 0;
  const originalFindById = CurriculumImport.findById;
  CurriculumImport.findById = async () => record;
  const storage = {
    getPrivateCurriculumDocumentStream: async () => {
      streamCalls += 1;
      return "stream";
    }
  };
  try {
    const result = await service.getCurriculumDocumentStream({
      importId: IMPORT_ID,
      storage
    });
    assert.equal(result.stream, "stream");
    assert.equal(streamCalls, 1);

    record.document.storageFilename = "curriculum-imports/507f1f77bcf86cd799439099/source.pdf";
    await assert.rejects(service.getCurriculumDocumentStream({
      importId: IMPORT_ID,
      storage
    }), { code: "INVALID_STORAGE_REFERENCE" });
    assert.equal(streamCalls, 1);
  } finally {
    CurriculumImport.findById = originalFindById;
  }
});

test("entry approval records confirmation and approval by the acting Admin", async () => {
  const record = createReviewableImport();
  record.save = async function saveAndValidate() {
    await this.validate();
    return this;
  };
  const originalFindById = CurriculumImport.findById;
  CurriculumImport.findById = async () => record;
  try {
    const result = await service.reviewCurriculumEntry({
      importId: IMPORT_ID,
      entryId: String(record.draftEntries[0]._id),
      action: "approve",
      reviewerId: ADMIN_ID,
      note: "Checked against the official document."
    });
    const entry = result.draftEntries[0];
    assert.equal(entry.reviewStatus, "approved");
    assert.equal(entry.reviewer.toString(), ADMIN_ID);
    assert.equal(entry.reviewHistory.filter((event) => event.action === "confirmed").length, 5);
    assert.equal(entry.reviewHistory.at(-1).action, "approved");
    assert.equal(entry.createdCourse, null);
    assert.equal(result.status, "reviewed");
  } finally {
    CurriculumImport.findById = originalFindById;
  }
});

test("entry rejection records the acting Admin and reason", async () => {
  const record = createReviewableImport();
  record.save = async function saveAndValidate() {
    await this.validate();
    return this;
  };
  const originalFindById = CurriculumImport.findById;
  CurriculumImport.findById = async () => record;
  try {
    const result = await service.reviewCurriculumEntry({
      importId: IMPORT_ID,
      entryId: String(record.draftEntries[0]._id),
      action: "reject",
      reviewerId: ADMIN_ID,
      note: "The source does not support this entry."
    });
    const entry = result.draftEntries[0];
    assert.equal(entry.reviewStatus, "rejected");
    assert.equal(entry.reviewer.toString(), ADMIN_ID);
    assert.equal(entry.reviewNote, "The source does not support this entry.");
    assert.equal(entry.reviewHistory.at(-1).action, "rejected");
  } finally {
    CurriculumImport.findById = originalFindById;
  }
});

test("explicit extraction requests queue pending imports and are idempotent", async () => {
  const record = createReviewableImport();
  const originalFindById = CurriculumImport.findById;
  const originalFindOneAndUpdate = CurriculumImport.findOneAndUpdate;
  CurriculumImport.findById = async () => record;
  CurriculumImport.findOneAndUpdate = async (_filter, update) => {
    if (record.status === "superseded" ||
        !(record.extractionStatus === "failed" ||
          (record.extractionStatus === "pending" && !record.extractionJob.requestedAt))) {
      return null;
    }
    record.status = update.$set.status;
    record.extractionStatus = update.$set.extractionStatus;
    for (const [field, value] of Object.entries(update.$set)) {
      if (field.startsWith("extractionJob.")) {
        record.extractionJob.set(field.slice("extractionJob.".length), value);
      } else {
        record.set(field, value);
      }
    }
    record.extractionJob.generation += update.$inc["extractionJob.generation"];
    return record;
  };
  try {
    assert.equal(record.extractionStatus, "pending");
    assert.equal(record.extractionJob.requestedAt, null);
    const queued = await Promise.all([
      service.requestCurriculumExtraction({ importId: IMPORT_ID }),
      service.requestCurriculumExtraction({ importId: IMPORT_ID })
    ]);
    assert.deepEqual(queued.map((result) => result.queued).sort(), [false, true]);
    assert.equal(queued.every((result) => result.status === "pending"), true);
    assert.ok(record.extractionJob.requestedAt instanceof Date);
    assert.equal(record.extractionJob.generation, 1);
    assert.equal(record.extractionJob.attempt, 0);

    assert.deepEqual(await service.requestCurriculumExtraction({ importId: IMPORT_ID }), {
      status: "pending",
      queued: false
    });
    assert.equal(record.extractionJob.generation, 1);

    record.extractionStatus = "failed";
    const retry = await service.requestCurriculumExtraction({ importId: IMPORT_ID });
    assert.deepEqual(retry, { status: "pending", queued: true });
    assert.equal(record.extractionStatus, "pending");
    assert.equal(record.extractionJob.generation, 2);
    assert.equal(record.extractionJob.attempt, 0);
  } finally {
    CurriculumImport.findById = originalFindById;
    CurriculumImport.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("incomplete curriculum entries still cannot be approved", async () => {
  const record = createReviewableImport();
  record.draftEntries[0].semester = null;
  record.draftEntries[0].uncertaintyFlags = ["missing_required_field"];
  record.save = async function saveAndValidate() {
    await this.validate();
    return this;
  };
  const originalFindById = CurriculumImport.findById;
  CurriculumImport.findById = async () => record;
  try {
    await assert.rejects(service.reviewCurriculumEntry({
      importId: IMPORT_ID,
      entryId: String(record.draftEntries[0]._id),
      action: "approve",
      reviewerId: ADMIN_ID,
      note: "Attempted approval."
    }), { code: "INCOMPLETE_DRAFT" });
  } finally {
    CurriculumImport.findById = originalFindById;
  }
});
