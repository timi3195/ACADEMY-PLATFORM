const mongoose = require("mongoose");
const extractionLimits = require("../config/curriculumExtractionLimits");

const LEVELS = ["ND1", "ND2", "HND1", "HND2"];
const SEMESTERS = ["First", "Second"];
const DRAFT_FIELDS = ["title", "code", "creditUnits", "level", "semester"];
const UNCERTAINTY_FLAGS = [
  "missing_required_field",
  "ambiguous_value",
  "low_confidence",
  "conflicting_evidence",
  "admin_confirmation_required"
];
const SAFE_DIAGNOSTIC_CODES = [
  "FILE_TYPE_UNSUPPORTED",
  "TEXT_EXTRACTION_FAILED",
  "OCR_FAILED",
  "OCR_MODEL_UNAVAILABLE",
  "PDF_RENDER_BOUNDS",
  "AI_RESPONSE_INVALID",
  "PROCESSING_TIMEOUT",
  "INTERNAL_PROCESSING_ERROR"
];
const SAFE_DIAGNOSTIC_MESSAGES = [
  "The uploaded document type is not supported.",
  "Text could not be extracted from the document.",
  "Text could not be read from the scanned document.",
  "The verified local English OCR model is unavailable. Verify the pinned model installation.",
  "PDF page rendered within configured OCR limits.",
  "The extracted curriculum data did not pass validation.",
  "Document processing timed out.",
  "Document processing could not be completed."
];
const SAFE_EXTRACTION_ERROR_CODES = [
  "",
  "OCR_MODEL_UNAVAILABLE",
  "FILE_TYPE_UNSUPPORTED",
  "TEXT_EXTRACTION_FAILED",
  "OCR_FAILED",
  "PROCESSING_TIMEOUT",
  "INTERNAL_PROCESSING_ERROR",
  "WORKER_OUTPUT_INVALID",
  "CHILD_PROCESS_FAILED"
];
const STORAGE_NAMESPACE = "curriculum-imports";

const normalizeProgrammeHeading = (heading) => {
  if (typeof heading !== "string") return "";
  return heading.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
};

const isSafeStorageReference = ({
  provider,
  storageFilename = "",
  storageKey = "",
  mimeType,
  expectedImportId
} = {}) => {
  const isNamespacedPath = (value) => {
    if (typeof value !== "string" || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return false;
    if (value.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
    const segments = value.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) return false;
    return segments.length === 3 &&
      segments[0] === STORAGE_NAMESPACE &&
      /^[a-f0-9]{24}$/i.test(segments[1]) &&
      (!expectedImportId || segments[1].toLowerCase() === String(expectedImportId).toLowerCase()) &&
      /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/.test(segments[2]);
  };

  const expectedExtension = mimeType === "application/pdf"
    ? ".pdf"
    : mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ? ".docx"
      : null;
  if (!expectedExtension) return false;
  if (provider === "local-disk") {
    return isNamespacedPath(storageFilename) &&
      storageFilename.toLowerCase().endsWith(expectedExtension) &&
      storageKey === "";
  }
  if (provider === "object-storage") {
    return isNamespacedPath(storageKey) &&
      storageKey.toLowerCase().endsWith(expectedExtension) &&
      storageFilename === "";
  }
  return false;
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
  const crypto = require("node:crypto");
  const headingKey = normalizeProgrammeHeading(programmeHeading);
  if (!schoolId || !departmentId || !headingKey ||
      !Number.isInteger(documentVersion) || documentVersion < 1 ||
      typeof entryIdentity !== "string" || !entryIdentity.trim()) {
    return "";
  }
  const identity = [
    String(schoolId).toLowerCase(),
    String(departmentId).toLowerCase(),
    headingKey,
    documentVersion,
    entryIdentity.trim(),
    title ?? "",
    code ?? "",
    creditUnits ?? "",
    level ?? "",
    semester ?? ""
  ].map((value) => String(value).trim().toLocaleLowerCase("en"));
  return crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex");
};

const storageMetadataSchema = new mongoose.Schema({
  provider: {
    type: String,
    enum: ["local-disk", "object-storage"],
    required: true
  },
  storageFilename: { type: String, default: "", maxlength: 512 },
  storageKey: { type: String, default: "", maxlength: 1024 },
  status: {
    type: String,
    enum: ["pending", "stored", "failed"],
    required: true
  },
  originalFilename: {
    type: String,
    required: true,
    maxlength: 255,
    match: /^[^\\/\u0000-\u001f]{1,255}$/
  },
  mimeType: {
    type: String,
    enum: [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ],
    required: true
  },
  size: {
    type: Number,
    required: true,
    min: 1,
    max: extractionLimits.maxUploadBytes
  },
  contentHash: {
    type: String,
    required: true,
    match: /^[a-f0-9]{64}$/
  }
}, { _id: false });

storageMetadataSchema.pre("validate", function validateStorageLocation() {
  const importId = this.ownerDocument()?._id;
  if (!isSafeStorageReference({
    ...this.toObject(),
    mimeType: this.mimeType,
    expectedImportId: importId
  })) {
    this.invalidate("storageKey", "The curriculum document storage reference is invalid");
  }
});

const fieldEvidenceSchema = new mongoose.Schema({
  field: { type: String, enum: DRAFT_FIELDS, required: true },
  page: { type: Number, min: 1, default: null },
  locator: { type: String, default: "", maxlength: 120 },
  excerpt: { type: String, default: "", maxlength: 500 },
  extractionMethod: {
    type: String,
    enum: ["pdf_text", "docx_text", "ocr", "gemini", "admin"],
    required: true
  },
  confidence: { type: Number, min: 0, max: 1, default: null }
}, { _id: false });

const reviewHistorySchema = new mongoose.Schema({
  reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  action: { type: String, enum: ["edited", "confirmed", "approved", "rejected"], required: true },
  reviewedAt: { type: Date, required: true, default: Date.now },
  field: { type: String, enum: DRAFT_FIELDS, default: null },
  previousValue: { type: String, default: "", maxlength: 500 },
  newValue: { type: String, default: "", maxlength: 500 },
  note: { type: String, default: "", maxlength: 1000 }
}, { _id: false });

const draftEntrySchema = new mongoose.Schema({
  title: { type: String, default: null, trim: true, maxlength: 200 },
  code: { type: String, default: null, trim: true, maxlength: 40 },
  creditUnits: { type: Number, default: null, min: 0.1, max: 100 },
  level: { type: String, enum: [...LEVELS, null], default: null },
  semester: { type: String, enum: [...SEMESTERS, null], default: null },
  sourceEvidence: { type: [fieldEvidenceSchema], default: [] },
  uncertaintyFlags: { type: [String], enum: UNCERTAINTY_FLAGS, default: [] },
  entryIdentity: { type: String, required: true, trim: true, maxlength: 120 },
  reviewStatus: {
    type: String,
    enum: ["pending", "needs_confirmation", "approved", "rejected"],
    default: "pending",
    required: true
  },
  reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null },
  reviewNote: { type: String, default: "", maxlength: 1000 },
  reviewHistory: { type: [reviewHistorySchema], default: [] },
  idempotencyKey: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  createdCourse: { type: mongoose.Schema.Types.ObjectId, ref: "Course", default: null }
}, { timestamps: true });

draftEntrySchema.pre("validate", function validateDraftReview() {
  if (["approved", "rejected"].includes(this.reviewStatus)) {
    if (!this.reviewer || !this.reviewedAt) {
      this.invalidate("reviewer", "A reviewed entry requires a reviewer and review timestamp");
    }
    if (!this.reviewHistory.some((event) =>
      event.action === this.reviewStatus && String(event.reviewer) === String(this.reviewer))) {
      this.invalidate("reviewHistory", "The review action must be recorded in the audit history");
    }
  }
  if (this.reviewStatus === "approved") {
    const sourceEvidence = Array.isArray(this.sourceEvidence) ? this.sourceEvidence : [];
    const reviewHistory = Array.isArray(this.reviewHistory) ? this.reviewHistory : [];
    for (const field of DRAFT_FIELDS) {
      const value = this[field];
      if (value === null || value === undefined || value === "") {
        this.invalidate(field, "An approved entry must have every required course field");
        continue;
      }
      const hasEvidence = sourceEvidence.some((evidence) =>
        evidence.field === field &&
        typeof evidence.excerpt === "string" &&
        Boolean(evidence.excerpt.trim()));
      const wasConfirmed = reviewHistory.some((event) =>
        event.action === "confirmed" &&
        event.field === field &&
        event.newValue === String(value) &&
        typeof event.note === "string" &&
        Boolean(event.note.trim()));
      if (!hasEvidence && !wasConfirmed) {
        this.invalidate(field, "An approved field requires source evidence or an audited Admin confirmation");
      }
    }
  }
  if (this.createdCourse && this.reviewStatus !== "approved") {
    this.invalidate("createdCourse", "Only an approved entry may reference a created course");
  }
});

const diagnosticSchema = new mongoose.Schema({
  stage: { type: String, enum: ["upload", "extraction", "validation"], required: true },
  code: { type: String, enum: SAFE_DIAGNOSTIC_CODES, required: true },
  message: { type: String, enum: SAFE_DIAGNOSTIC_MESSAGES, required: true },
  occurredAt: { type: Date, default: Date.now },
  page: { type: Number, min: 1, max: extractionLimits.maxPdfPages },
  width: { type: Number, min: 1, max: extractionLimits.maxRenderedPageDimension },
  height: { type: Number, min: 1, max: extractionLimits.maxRenderedPageDimension },
  effectiveDpi: { type: Number, min: 0.01, max: 150 }
}, { _id: false });

const extractedSegmentSchema = new mongoose.Schema({
  text: { type: String, required: true },
  page: { type: Number, min: 1, default: null },
  locator: { type: String, required: true, maxlength: 200 },
  extractionMethod: {
    type: String,
    enum: ["pdf_text", "docx_text", "ocr"],
    required: true
  },
  confidence: { type: Number, min: 0, max: 1, default: null }
}, { _id: false });

const extractionJobSchema = new mongoose.Schema({
  requestedAt: { type: Date, default: null },
  generation: {
    type: Number,
    default: 0,
    min: 0,
    validate: Number.isSafeInteger
  },
  attempt: {
    type: Number,
    default: 0,
    min: 0,
    validate: Number.isSafeInteger
  },
  leaseToken: {
    type: String,
    default: null,
    maxlength: 36,
    match: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
  },
  leaseExpiresAt: { type: Date, default: null },
  heartbeatAt: { type: Date, default: null },
  nextAttemptAt: { type: Date, default: null },
  errorCode: { type: String, enum: SAFE_EXTRACTION_ERROR_CODES, default: "" },
  diagnosticAt: { type: Date, default: null }
}, { _id: false });

extractionJobSchema.pre("validate", function validateExtractionJob() {
  const importRecord = this.ownerDocument();
  const hasLeaseToken = Boolean(this.leaseToken);
  const hasLeaseMetadata = Boolean(this.leaseExpiresAt || this.heartbeatAt);
  if (hasLeaseToken !== hasLeaseMetadata ||
      (hasLeaseToken && (!this.leaseExpiresAt || !this.heartbeatAt))) {
    this.invalidate("leaseToken", "A lease token, expiry, and heartbeat must be set together.");
  }
  if (!this.requestedAt &&
      (this.generation !== 0 ||
       this.attempt !== 0 ||
       hasLeaseMetadata ||
       this.nextAttemptAt ||
       this.errorCode ||
       this.diagnosticAt)) {
    this.invalidate("requestedAt", "Extraction job metadata requires an explicit request.");
  }
  if (this.requestedAt && this.generation < 1) {
    this.invalidate("generation", "A requested extraction job requires a positive generation.");
  }
  if (this.attempt > extractionLimits.maxProcessingAttempts) {
    this.invalidate("attempt", "The extraction attempt exceeds its configured limit.");
  }
  const processingState = importRecord?.status === "processing" ||
    importRecord?.extractionStatus === "processing";
  if (processingState &&
      (importRecord?.status !== "processing" ||
       importRecord?.extractionStatus !== "processing" ||
       !hasLeaseToken ||
       !this.leaseExpiresAt ||
       !this.heartbeatAt)) {
    this.invalidate("leaseToken", "A processing import requires a complete active lease.");
  }
  if (this.leaseToken &&
      (importRecord?.status !== "processing" ||
       importRecord?.extractionStatus !== "processing")) {
    this.invalidate("leaseToken", "An active lease requires a processing extraction status.");
  }
});

const curriculumImportSchema = new mongoose.Schema({
  school: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
  department: { type: mongoose.Schema.Types.ObjectId, ref: "Department", required: true, index: true },
  programmeHeading: { type: String, required: true, trim: true, maxlength: 120 },
  programmeHeadingKey: { type: String, required: true, lowercase: true, trim: true, maxlength: 120 },
  document: { type: storageMetadataSchema, required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  uploadedAt: { type: Date, required: true, default: Date.now },
  version: { type: Number, required: true, min: 1 },
  supersedes: { type: mongoose.Schema.Types.ObjectId, ref: "CurriculumImport", default: null },
  status: {
    type: String,
    enum: ["uploaded", "processing", "needs_review", "reviewed", "failed", "superseded"],
    default: "uploaded",
    index: true
  },
  extractionStatus: {
    type: String,
    enum: ["pending", "processing", "succeeded", "partially_succeeded", "failed"],
    default: "pending"
  },
  extractionJob: { type: extractionJobSchema, default: () => ({}) },
  extractedSegments: {
    type: [extractedSegmentSchema],
    default: [],
    validate: {
      validator: extractionLimits.isExtractedSegmentsWithinLimits,
      message: "Extracted curriculum text exceeds the configured limits."
    }
  },
  diagnostics: {
    type: [diagnosticSchema],
    default: [],
    validate: {
      validator: extractionLimits.isDiagnosticCountWithinLimit,
      message: "Curriculum diagnostics exceed the configured limit."
    }
  },
  draftEntries: { type: [draftEntrySchema], default: [] },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null }
}, { timestamps: true, optimisticConcurrency: true, autoIndex: false });

curriculumImportSchema.index(
  { department: 1, programmeHeadingKey: 1, version: 1 },
  { unique: true }
);
curriculumImportSchema.index({ school: 1, department: 1, programmeHeadingKey: 1, createdAt: -1 });
curriculumImportSchema.index({ "document.contentHash": 1 });
curriculumImportSchema.index({
  status: 1,
  extractionStatus: 1,
  "document.status": 1,
  "document.mimeType": 1,
  "extractionJob.requestedAt": 1,
  "extractionJob.nextAttemptAt": 1,
  uploadedAt: 1,
  _id: 1
}, { name: "curriculum_import_pending_claim" });
curriculumImportSchema.index({
  status: 1,
  extractionStatus: 1,
  "extractionJob.requestedAt": 1,
  "extractionJob.leaseExpiresAt": 1,
  "extractionJob.attempt": 1
}, { name: "curriculum_import_lease_recovery" });

curriculumImportSchema.statics.normalizeProgrammeHeading = normalizeProgrammeHeading;
curriculumImportSchema.statics.isSafeStorageReference = isSafeStorageReference;
curriculumImportSchema.statics.buildDraftIdempotencyKey = buildDraftIdempotencyKey;

curriculumImportSchema.pre("validate", function validateImportDrafts() {
  this.programmeHeadingKey = normalizeProgrammeHeading(this.programmeHeading);

  for (const entry of this.draftEntries) {
    const missingFields = DRAFT_FIELDS.filter((field) =>
      entry[field] === null || entry[field] === undefined || entry[field] === "");
    const flags = Array.isArray(entry.uncertaintyFlags) ? entry.uncertaintyFlags : [];
    if (missingFields.length &&
        !flags.some((flag) =>
          ["missing_required_field", "admin_confirmation_required"].includes(flag))) {
      entry.invalidate(
        "uncertaintyFlags",
        "An incomplete entry must identify its missing or unconfirmed fields"
      );
    }

    entry.idempotencyKey = buildDraftIdempotencyKey({
      schoolId: this.school,
      departmentId: this.department,
      programmeHeading: this.programmeHeading,
      documentVersion: this.version,
      entryIdentity: entry.entryIdentity,
      title: entry.title,
      code: entry.code,
      creditUnits: entry.creditUnits,
      level: entry.level,
      semester: entry.semester
    });
  }

  const keys = this.draftEntries.map((entry) => entry.idempotencyKey);
  if (new Set(keys).size !== keys.length) {
    this.invalidate("draftEntries", "Draft entries must have unique idempotency keys");
  }
});

module.exports = mongoose.models.CurriculumImport ||
  mongoose.model("CurriculumImport", curriculumImportSchema);
