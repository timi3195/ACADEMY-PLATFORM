const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const School = require("../models/School");
const Department = require("../models/Department");
const CurriculumImport = require("../models/CurriculumImport");
const storageService = require("./storageService");
const documentValidation = require("./curriculumDocumentValidation");
const extractionLimits = require("../config/curriculumExtractionLimits");

const MAX_CURRICULUM_DOCUMENT_BYTES = extractionLimits.maxUploadBytes;
const COURSE_DRAFT_FIELDS = ["title", "code", "creditUnits", "level", "semester"];
const CURRICULUM_STATUSES = ["uploaded", "processing", "needs_review", "reviewed", "failed", "superseded"];

const createServiceError = (code, message, statusCode) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
};

const saveCurriculumImport = async (record) => {
  try {
    return await record.save();
  } catch (error) {
    if (error?.name === "VersionError") {
      throw createServiceError(
        "CURRICULUM_CONFLICT",
        "This curriculum import changed during the request. Reload it and retry.",
        409
      );
    }
    throw error;
  }
};

const isSafeOriginalFilename = (name) =>
  typeof name === "string" &&
  name.length > 0 &&
  name.length <= 255 &&
  !/[\u0000-\u001f\u007f/\\]/.test(name) &&
  name !== "." &&
  name !== ".." &&
  path.basename(name) === name &&
  path.win32.basename(name) === name;

const validateCurriculumUpload = async (file) => {
  if (!file?.path || !isSafeOriginalFilename(file.originalname)) {
    throw createServiceError("INVALID_UPLOAD", "A valid curriculum document filename is required.", 400);
  }
  const extension = path.extname(file.originalname).toLowerCase();
  const expectedMime = extension === ".pdf"
    ? "application/pdf"
    : extension === ".docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : null;
  if (!expectedMime || file.mimetype !== expectedMime) {
    throw createServiceError("INVALID_UPLOAD", "Only matching PDF and DOCX documents are accepted.", 400);
  }

  let handle;
  let fileSize;
  try {
    handle = await fs.promises.open(file.path, "r");
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size < 5 || stats.size > MAX_CURRICULUM_DOCUMENT_BYTES ||
        (Number.isFinite(file.size) && file.size !== stats.size)) {
      throw createServiceError("INVALID_UPLOAD", "The curriculum document size is invalid.", 400);
    }
    fileSize = stats.size;

    let signatureValid = false;
    if (expectedMime === "application/pdf") {
      const signature = Buffer.alloc(5);
      const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
      if (bytesRead !== signature.length) {
        throw createServiceError("INVALID_UPLOAD", "The document content does not match its file type.", 400);
      }
      signatureValid = signature.equals(Buffer.from("%PDF-"));
    } else {
      const signature = Buffer.alloc(4);
      const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
      signatureValid = bytesRead === signature.length &&
        signature.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    }
    if (!signatureValid) {
      throw createServiceError("INVALID_UPLOAD", "The document content does not match its file type.", 400);
    }
    await handle.close();
    handle = null;
    await documentValidation.validateCurriculumDocument({
      filePath: file.path,
      mimeType: expectedMime,
      fileSize
    });
  } catch (error) {
    if (error.code === "INVALID_UPLOAD") throw error;
    throw createServiceError("INVALID_UPLOAD", "The uploaded curriculum document could not be validated.", 400);
  } finally {
    await handle?.close();
  }

  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file.path)) hash.update(chunk);
  const stats = await fs.promises.stat(file.path);
  return {
    originalFilename: file.originalname,
    mimeType: expectedMime,
    size: stats.size,
    contentHash: hash.digest("hex")
  };
};

const normalizeProgrammeHeading = (heading) => {
  const normalized = CurriculumImport.normalizeProgrammeHeading(heading);
  if (!normalized || normalized.length > 120) {
    throw createServiceError("INVALID_PROGRAMME_HEADING", "A programme heading is required.", 400);
  }
  return normalized;
};

const buildDraftIdempotencyKey = ({
  schoolId,
  departmentId,
  programmeHeading,
  documentVersion,
  entryIdentity,
  title,
  code,
  creditUnits,
  level,
  semester
}) => {
  const key = CurriculumImport.buildDraftIdempotencyKey({
    schoolId,
    departmentId,
    programmeHeading,
    documentVersion,
    entryIdentity,
    title,
    code,
    creditUnits,
    level,
    semester
  });
  if (!key) {
    throw createServiceError("INVALID_IDEMPOTENCY_INPUT", "Curriculum draft identity is invalid.", 400);
  }
  return key;
};

const assertImportAssociation = async ({
  schoolId,
  departmentId,
  SchoolModel = School,
  DepartmentModel = Department
}) => {
  if (!mongoose.isValidObjectId(schoolId) || !mongoose.isValidObjectId(departmentId)) {
    throw createServiceError("INVALID_ASSOCIATION", "A valid School and Department are required.", 400);
  }

  const school = await SchoolModel.findById(schoolId).select("_id").lean();
  if (!school) {
    throw createServiceError("SCHOOL_NOT_FOUND", "The selected School was not found.", 404);
  }

  const department = await DepartmentModel.findOne({
    _id: departmentId,
    school: schoolId
  }).select("_id school").lean();
  if (!department) {
    throw createServiceError(
      "DEPARTMENT_SCHOOL_MISMATCH",
      "The selected Department does not belong to the selected School.",
      400
    );
  }
  return { schoolId: school._id, departmentId: department._id };
};

const planImportVersion = async ({
  schoolId,
  departmentId,
  programmeHeading,
  contentHash,
  CurriculumImportModel = CurriculumImport
}) => {
  if (!mongoose.isValidObjectId(schoolId) ||
      !mongoose.isValidObjectId(departmentId) ||
      typeof contentHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(contentHash)) {
    throw createServiceError("INVALID_IMPORT_METADATA", "Curriculum import metadata is invalid.", 400);
  }
  const programmeHeadingKey = normalizeProgrammeHeading(programmeHeading);
  const identity = { school: schoolId, department: departmentId, programmeHeadingKey };
  const duplicate = await CurriculumImportModel.findOne({
    ...identity,
    "document.contentHash": contentHash
  }).select("_id version").lean();

  if (duplicate) {
    return {
      status: "duplicate_retry",
      duplicate: true,
      retryable: false,
      existingImportId: duplicate._id,
      version: duplicate.version,
      programmeHeadingKey
    };
  }

  const latest = await CurriculumImportModel.findOne(identity)
    .sort({ version: -1 })
    .select("_id version")
    .lean();
  return {
    status: "new_version",
    duplicate: false,
    version: latest ? latest.version + 1 : 1,
    supersedes: latest ? latest._id : null,
    programmeHeadingKey
  };
};

const isVersionUniqueConflict = (error) => {
  if (error?.code !== 11000) return false;
  const fields = Object.keys(error.keyPattern || {}).sort();
  if (fields.join(",") === "department,programmeHeadingKey,version") return true;
  return String(error.message || "").includes("department_1_programmeHeadingKey_1_version_1");
};

const createImportVersion = async ({
  importData,
  SchoolModel = School,
  DepartmentModel = Department,
  CurriculumImportModel = CurriculumImport
}) => {
  const { schoolId, departmentId, programmeHeading, document } = importData || {};
  if (!document || !CurriculumImportModel.isSafeStorageReference({
    ...document,
    expectedImportId: importData?._id
  })) {
    throw createServiceError("INVALID_STORAGE_REFERENCE", "The curriculum document storage reference is invalid.", 400);
  }
  const association = await assertImportAssociation({
    schoolId,
    departmentId,
    SchoolModel,
    DepartmentModel
  });
  const versionPlan = await planImportVersion({
    schoolId: association.schoolId,
    departmentId: association.departmentId,
    programmeHeading,
    contentHash: document.contentHash,
    CurriculumImportModel
  });

  if (versionPlan.status === "duplicate_retry") return versionPlan;

  const record = {
    ...importData,
    school: association.schoolId,
    department: association.departmentId,
    programmeHeadingKey: versionPlan.programmeHeadingKey,
    version: versionPlan.version,
    supersedes: versionPlan.supersedes
  };
  delete record.schoolId;
  delete record.departmentId;

  // A retry after a version conflict replans; identical content then resolves as duplicate_retry.
  try {
    const created = await CurriculumImportModel.create(record);
    return { status: "created", import: created };
  } catch (error) {
    if (isVersionUniqueConflict(error)) {
      return {
        status: "version_conflict",
        retryable: true,
        message: "Another import was saved at this version. Retry to recheck duplicates and plan the next version."
      };
    }
    throw error;
  }
};

const createCurriculumImportFromFile = async ({
  schoolId,
  departmentId,
  programmeHeading,
  file,
  uploadedBy,
  SchoolModel = School,
  DepartmentModel = Department,
  CurriculumImportModel = CurriculumImport,
  storage = storageService
}) => {
  const fileMetadata = await validateCurriculumUpload(file);
  const association = await assertImportAssociation({
    schoolId,
    departmentId,
    SchoolModel,
    DepartmentModel
  });
  const initialPlan = await planImportVersion({
    schoolId: association.schoolId,
    departmentId: association.departmentId,
    programmeHeading,
    contentHash: fileMetadata.contentHash,
    CurriculumImportModel
  });
  if (initialPlan.status === "duplicate_retry") return initialPlan;

  const importId = new mongoose.Types.ObjectId();
  const storedDocument = await storage.storePrivateCurriculumDocument({
    file,
    importId,
    ...fileMetadata
  });
  try {
    const result = await createImportVersion({
      importData: {
        _id: importId,
        schoolId: association.schoolId,
        departmentId: association.departmentId,
        programmeHeading,
        uploadedBy,
        document: storedDocument,
        draftEntries: []
      },
      SchoolModel,
      DepartmentModel,
      CurriculumImportModel
    });
    if (result.status !== "created") {
      await storage.deletePrivateCurriculumDocument({ document: storedDocument, importId });
    }
    return result;
  } catch (error) {
    try {
      await storage.deletePrivateCurriculumDocument({ document: storedDocument, importId });
    } catch {
      throw createServiceError(
        "STORAGE_CLEANUP_FAILED",
        "The curriculum document could not be safely finalized.",
        500
      );
    }
    throw error;
  }
};

const serializeCurriculumImport = (record) => {
  const value = typeof record?.toObject === "function" ? record.toObject() : { ...record };
  delete value.programmeHeadingKey;
  delete value.extractedSegments;
  delete value.extractionJob;
  value.diagnostics = (value.diagnostics || [])
    .filter((diagnostic) => diagnostic.stage !== "extraction");
  if (value.document) {
    value.document = {
      originalFilename: value.document.originalFilename,
      mimeType: value.document.mimeType,
      size: value.document.size,
      status: value.document.status
    };
  }
  value.draftEntries = (value.draftEntries || []).map((entry) => {
    const safeEntry = { ...entry };
    delete safeEntry.idempotencyKey;
    safeEntry.sourceEvidence = (safeEntry.sourceEvidence || []).map((evidence) => {
      const safeEvidence = { ...evidence };
      delete safeEvidence.excerpt;
      return safeEvidence;
    });
    return safeEntry;
  });
  return value;
};

const listCurriculumImports = async ({
  query = {},
  CurriculumImportModel = CurriculumImport
} = {}) => {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw createServiceError("INVALID_PAGINATION", "Pagination values are invalid.", 400);
  }
  const filter = {};
  if (query.status !== undefined) {
    if (!CURRICULUM_STATUSES.includes(query.status)) {
      throw createServiceError("INVALID_STATUS", "The curriculum import status is invalid.", 400);
    }
    filter.status = query.status;
  }
  for (const [parameter, field] of [["schoolId", "school"], ["departmentId", "department"]]) {
    if (query[parameter] !== undefined) {
      if (!mongoose.isValidObjectId(query[parameter])) {
        throw createServiceError("INVALID_FILTER", "A curriculum import filter is invalid.", 400);
      }
      filter[field] = query[parameter];
    }
  }

  const [records, total] = await Promise.all([
    CurriculumImportModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    CurriculumImportModel.countDocuments(filter)
  ]);
  return {
    imports: records.map(serializeCurriculumImport),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  };
};

const getCurriculumImport = async ({
  importId,
  CurriculumImportModel = CurriculumImport
}) => {
  if (!mongoose.isValidObjectId(importId)) return null;
  const record = await CurriculumImportModel.findById(importId);
  return record ? serializeCurriculumImport(record) : null;
};

const getCurriculumDocumentStream = async ({
  importId,
  CurriculumImportModel = CurriculumImport,
  storage = storageService
}) => {
  if (!mongoose.isValidObjectId(importId)) return null;
  const record = await CurriculumImportModel.findById(importId);
  if (!record) return null;
  if (!CurriculumImportModel.isSafeStorageReference({
    ...record.document.toObject(),
    expectedImportId: record._id
  })) {
    throw createServiceError("INVALID_STORAGE_REFERENCE", "The curriculum document is unavailable.", 404);
  }
  const stream = await storage.getPrivateCurriculumDocumentStream({
    document: record.document,
    importId: record._id
  });
  return {
    stream,
    originalFilename: record.document.originalFilename,
    mimeType: record.document.mimeType,
    size: record.document.size
  };
};

const findImportDocument = async ({ importId, CurriculumImportModel = CurriculumImport }) => {
  if (!mongoose.isValidObjectId(importId)) return null;
  return CurriculumImportModel.findById(importId);
};

const getCurriculumEntryEvidence = async ({
  importId,
  entryId,
  CurriculumImportModel = CurriculumImport
}) => {
  if (!mongoose.isValidObjectId(entryId)) return null;
  const record = await findImportDocument({ importId, CurriculumImportModel });
  if (!record) return null;
  const entry = record.draftEntries.id(entryId);
  if (!entry) return null;
  return {
    importId: String(record._id),
    entryId: String(entry._id),
    sourceEvidence: (entry.sourceEvidence || []).map((evidence) => {
      const value = typeof evidence?.toObject === "function"
        ? evidence.toObject()
        : evidence;
      return {
        field: value.field,
        page: value.page,
        locator: value.locator,
        excerpt: value.excerpt,
        extractionMethod: value.extractionMethod,
        confidence: value.confidence
      };
    })
  };
};

const updateCurriculumEntry = async ({
  importId,
  entryId,
  updates,
  reviewerId,
  note = "",
  CurriculumImportModel = CurriculumImport
}) => {
  const record = await findImportDocument({ importId, CurriculumImportModel });
  if (!record) return null;
  if (record.status === "superseded") {
    throw createServiceError("IMPORT_SUPERSEDED", "A superseded import cannot be edited.", 409);
  }
  const entry = record.draftEntries.id(entryId);
  if (!entry) return null;
  const keys = Object.keys(updates || {});
  if (!keys.length || keys.some((field) => !COURSE_DRAFT_FIELDS.includes(field))) {
    throw createServiceError("INVALID_ENTRY_UPDATE", "Only course fields may be edited.", 400);
  }

  let changed = false;
  for (const field of keys) {
    const nextValue = updates[field];
    if (nextValue === undefined) {
      throw createServiceError("INVALID_ENTRY_UPDATE", "An entry field value is invalid.", 400);
    }
    const previousValue = entry[field] === null || entry[field] === undefined ? "" : String(entry[field]);
    const currentValue = nextValue === null ? "" : String(nextValue);
    if (previousValue === currentValue) continue;
    entry[field] = nextValue;
    entry.reviewHistory.push({
      reviewer: reviewerId,
      action: "edited",
      reviewedAt: new Date(),
      field,
      previousValue,
      newValue: currentValue,
      note: String(note).slice(0, 1000)
    });
    changed = true;
  }
  if (!changed) throw createServiceError("NO_ENTRY_CHANGES", "No curriculum entry changes were provided.", 400);

  entry.reviewStatus = "needs_confirmation";
  entry.reviewer = null;
  entry.reviewedAt = null;
  entry.reviewNote = "";
  if (COURSE_DRAFT_FIELDS.some((field) =>
    entry[field] === null || entry[field] === undefined || entry[field] === "")) {
    if (!entry.uncertaintyFlags.includes("missing_required_field")) {
      entry.uncertaintyFlags.push("missing_required_field");
    }
  } else {
    entry.uncertaintyFlags = entry.uncertaintyFlags.filter((flag) => flag !== "missing_required_field");
  }
  record.status = "needs_review";
  await saveCurriculumImport(record);
  return serializeCurriculumImport(record);
};

const reviewCurriculumEntry = async ({
  importId,
  entryId,
  action,
  reviewerId,
  note,
  CurriculumImportModel = CurriculumImport
}) => {
  if (!["approve", "reject"].includes(action)) {
    throw createServiceError("INVALID_REVIEW_ACTION", "Review action must be approve or reject.", 400);
  }
  if (typeof note !== "string" || !note.trim() || note.length > 1000) {
    throw createServiceError("INVALID_REVIEW_NOTE", "A review note is required.", 400);
  }
  const record = await findImportDocument({ importId, CurriculumImportModel });
  if (!record) return null;
  if (record.status === "superseded") {
    throw createServiceError("IMPORT_SUPERSEDED", "A superseded import cannot be reviewed.", 409);
  }
  const entry = record.draftEntries.id(entryId);
  if (!entry) return null;
  if (["approved", "rejected"].includes(entry.reviewStatus)) {
    throw createServiceError("ENTRY_ALREADY_REVIEWED", "This curriculum entry has already been reviewed.", 409);
  }

  const reviewedAt = new Date();
  if (action === "approve") {
    const missingFields = COURSE_DRAFT_FIELDS.filter((field) =>
      entry[field] === null || entry[field] === undefined || entry[field] === "");
    if (missingFields.length) {
      throw createServiceError("INCOMPLETE_DRAFT", "All required course fields must be confirmed before approval.", 400);
    }
    for (const field of COURSE_DRAFT_FIELDS) {
      entry.reviewHistory.push({
        reviewer: reviewerId,
        action: "confirmed",
        reviewedAt,
        field,
        newValue: String(entry[field]),
        note: note.trim()
      });
    }
    entry.reviewStatus = "approved";
  } else {
    entry.reviewStatus = "rejected";
  }
  entry.reviewer = reviewerId;
  entry.reviewedAt = reviewedAt;
  entry.reviewNote = note.trim();
  entry.reviewHistory.push({
    reviewer: reviewerId,
    action: action === "approve" ? "approved" : "rejected",
    reviewedAt,
    note: note.trim()
  });
  const allReviewed = record.draftEntries.every((draft) =>
    ["approved", "rejected"].includes(draft.reviewStatus));
  record.status = allReviewed ? "reviewed" : "needs_review";
  if (allReviewed) {
    record.reviewedBy = reviewerId;
    record.reviewedAt = reviewedAt;
  }
  await saveCurriculumImport(record);
  return serializeCurriculumImport(record);
};

const requestCurriculumExtraction = async ({
  importId,
  CurriculumImportModel = CurriculumImport
}) => {
  if (!mongoose.isValidObjectId(importId)) return null;
  const requestedAt = new Date();
  const queued = await CurriculumImportModel.findOneAndUpdate({
    _id: importId,
    status: { $ne: "superseded" },
    "extractionJob.generation": { $lt: Number.MAX_SAFE_INTEGER },
    $or: [
      {
        extractionStatus: "pending",
        "extractionJob.requestedAt": null
      },
      { extractionStatus: "failed" }
    ]
  }, {
    $set: {
      status: "uploaded",
      extractionStatus: "pending",
      "extractionJob.requestedAt": requestedAt,
      "extractionJob.attempt": 0,
      "extractionJob.leaseToken": null,
      "extractionJob.leaseExpiresAt": null,
      "extractionJob.heartbeatAt": null,
      "extractionJob.nextAttemptAt": null,
      "extractionJob.errorCode": "",
      "extractionJob.diagnosticAt": null,
      extractedSegments: [],
      diagnostics: []
    },
    $inc: { "extractionJob.generation": 1 }
  }, { new: true, runValidators: true });

  if (queued) return { status: "pending", queued: true };

  const record = await findImportDocument({ importId, CurriculumImportModel });
  if (!record) return null;
  if (record.status === "superseded") {
    throw createServiceError("IMPORT_SUPERSEDED", "A superseded import cannot be queued for extraction.", 409);
  }
  if (record.extractionJob?.requestedAt) {
    return { status: record.extractionStatus, queued: false };
  }
  throw createServiceError("EXTRACTION_NOT_RETRYABLE", "Extraction is not eligible for retry.", 409);
};

module.exports = {
  normalizeProgrammeHeading,
  buildDraftIdempotencyKey,
  validateCurriculumUpload,
  assertImportAssociation,
  planImportVersion,
  createImportVersion,
  createCurriculumImportFromFile,
  serializeCurriculumImport,
  listCurriculumImports,
  getCurriculumImport,
  getCurriculumDocumentStream,
  getCurriculumEntryEvidence,
  updateCurriculumEntry,
  reviewCurriculumEntry,
  requestCurriculumExtraction
};
