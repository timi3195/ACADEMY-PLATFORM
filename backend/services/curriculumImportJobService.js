const crypto = require("node:crypto");
const CurriculumImport = require("../models/CurriculumImport");
const limits = require("../config/curriculumExtractionLimits");

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const LEASE_TOKEN_PATTERN = "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$";
const SAFE_FAILURE_CODES = new Set([
  "WORKER_OUTPUT_INVALID",
  "CHILD_PROCESS_FAILED",
  "PROCESSING_TIMEOUT",
  "OCR_FAILED",
  "TEXT_EXTRACTION_FAILED",
  "INTERNAL_PROCESSING_ERROR"
]);

const validLeaseExpression = {
  $and: [
    { $eq: [{ $type: "$extractionJob.requestedAt" }, "date"] },
    { $eq: [{ $type: "$extractionJob.leaseToken" }, "string"] },
    {
      $regexMatch: {
        input: {
          $convert: {
            input: "$extractionJob.leaseToken",
            to: "string",
            onError: "",
            onNull: ""
          }
        },
        regex: LEASE_TOKEN_PATTERN
      }
    },
    { $eq: [{ $type: "$extractionJob.leaseExpiresAt" }, "date"] },
    { $eq: [{ $type: "$extractionJob.heartbeatAt" }, "date"] },
    {
      $in: [
        { $type: "$extractionJob.attempt" },
        ["int", "long", "double", "decimal"]
      ]
    },
    { $gte: ["$extractionJob.attempt", 1] },
    { $lte: ["$extractionJob.attempt", limits.maxProcessingAttempts] }
  ]
};

const serverDiagnostics = (code, message) => [{
  $mergeObjects: [
    { $literal: { stage: "extraction", code, message } },
    { occurredAt: "$$NOW" }
  ]
}];

const nextAttemptDueExpression = {
  $or: [
    { $eq: [{ $type: "$extractionJob.nextAttemptAt" }, "null"] },
    { $eq: [{ $type: "$extractionJob.nextAttemptAt" }, "missing"] },
    {
      $and: [
        { $eq: [{ $type: "$extractionJob.nextAttemptAt" }, "date"] },
        { $lte: ["$extractionJob.nextAttemptAt", "$$NOW"] }
      ]
    }
  ]
};

const processingStateFilter = {
  status: "processing",
  extractionStatus: "processing",
  "extractionJob.requestedAt": { $ne: null }
};

const leaseFilter = ({ importId, generation, attempt, leaseToken }) => ({
  _id: importId,
  status: "processing",
  extractionStatus: "processing",
  "extractionJob.generation": generation,
  "extractionJob.attempt": attempt,
  "extractionJob.leaseToken": leaseToken,
  $expr: {
    $and: [
      validLeaseExpression,
      { $gt: ["$extractionJob.leaseExpiresAt", "$$NOW"] }
    ]
  }
});

const terminalFailureUpdate = (errorCode, message) => [{
  $set: {
    status: "failed",
    extractionStatus: "failed",
    updatedAt: "$$NOW",
    "extractionJob.errorCode": errorCode,
    "extractionJob.diagnosticAt": "$$NOW",
    "extractionJob.leaseToken": null,
    "extractionJob.leaseExpiresAt": null,
    "extractionJob.heartbeatAt": null,
    "extractionJob.nextAttemptAt": null,
    diagnostics: serverDiagnostics(errorCode, message)
  }
}];

const finalizeExpiredLeases = async ({
  CurriculumImportModel = CurriculumImport
} = {}) => {
  const malformed = await CurriculumImportModel.updateMany({
    $or: [
      {
        status: "processing",
        extractionStatus: { $ne: "processing" }
      },
      {
        status: { $ne: "processing" },
        extractionStatus: "processing"
      },
      {
        status: "processing",
        extractionStatus: "processing",
        $expr: { $not: [validLeaseExpression] }
      }
    ]
  }, terminalFailureUpdate(
    "INTERNAL_PROCESSING_ERROR",
    "Document processing could not be completed."
  ), { timestamps: false });

  const expiredFinalAttempts = await CurriculumImportModel.updateMany({
    ...processingStateFilter,
    "extractionJob.attempt": { $gte: limits.maxProcessingAttempts },
    $expr: {
      $and: [
        validLeaseExpression,
        { $lte: ["$extractionJob.leaseExpiresAt", "$$NOW"] }
      ]
    }
  }, terminalFailureUpdate(
    "PROCESSING_TIMEOUT",
    "Document processing timed out."
  ), { timestamps: false });

  return (malformed.modifiedCount || 0) + (expiredFinalAttempts.modifiedCount || 0);
};

const recoverExpiredLeases = async ({
  CurriculumImportModel = CurriculumImport
} = {}) => {
  const result = await CurriculumImportModel.updateMany({
    ...processingStateFilter,
    "extractionJob.attempt": {
      $gte: 1,
      $lt: limits.maxProcessingAttempts
    },
    $expr: {
      $and: [
        validLeaseExpression,
        { $lte: ["$extractionJob.leaseExpiresAt", "$$NOW"] }
      ]
    }
  }, [{
    $set: {
      status: "uploaded",
      extractionStatus: "pending",
      updatedAt: "$$NOW",
      "extractionJob.errorCode": "PROCESSING_TIMEOUT",
      "extractionJob.diagnosticAt": "$$NOW",
      "extractionJob.leaseToken": null,
      "extractionJob.leaseExpiresAt": null,
      "extractionJob.heartbeatAt": null,
      "extractionJob.nextAttemptAt": {
        $add: [
          "$$NOW",
          {
            $switch: {
              branches: [
                { case: { $eq: ["$extractionJob.attempt", 1] }, then: limits.processingRetryBackoffMs[0] },
                { case: { $eq: ["$extractionJob.attempt", 2] }, then: limits.processingRetryBackoffMs[1] }
              ],
              default: 0
            }
          }
        ]
      },
      diagnostics: serverDiagnostics(
        "PROCESSING_TIMEOUT",
        "Document processing timed out."
      )
    }
  }], { timestamps: false });
  return result.modifiedCount || 0;
};

const recordOcrModelUnavailable = async ({
  CurriculumImportModel = CurriculumImport
} = {}) => {
  const record = await CurriculumImportModel.findOneAndUpdate({
    status: "uploaded",
    extractionStatus: "pending",
    "document.mimeType": PDF_MIME,
    "extractionJob.requestedAt": { $ne: null },
    "extractionJob.leaseToken": null,
    "extractionJob.errorCode": { $ne: "OCR_MODEL_UNAVAILABLE" },
    $expr: nextAttemptDueExpression
  }, [{
    $set: {
      updatedAt: "$$NOW",
      "extractionJob.errorCode": "OCR_MODEL_UNAVAILABLE",
      "extractionJob.diagnosticAt": "$$NOW",
      "extractionJob.nextAttemptAt": null,
      diagnostics: serverDiagnostics(
        "OCR_MODEL_UNAVAILABLE",
        "The verified local English OCR model is unavailable. Verify the pinned model installation."
      )
    }
  }], { new: true, timestamps: false });
  return Boolean(record);
};

const claimNextCurriculumImport = async ({
  CurriculumImportModel = CurriculumImport,
  ocrAvailable = true,
  leaseToken = crypto.randomUUID()
} = {}) => {
  await finalizeExpiredLeases({ CurriculumImportModel });
  await recoverExpiredLeases({ CurriculumImportModel });
  const eligibleMimes = ocrAvailable ? [PDF_MIME, DOCX_MIME] : [DOCX_MIME];
  return CurriculumImportModel.findOneAndUpdate({
    status: { $in: ["uploaded", "failed"] },
    extractionStatus: "pending",
    "document.status": "stored",
    "document.mimeType": { $in: eligibleMimes },
    "extractionJob.requestedAt": { $ne: null },
    "extractionJob.attempt": { $lt: limits.maxProcessingAttempts },
    "extractionJob.leaseToken": null,
    $expr: nextAttemptDueExpression
  }, [{
    $set: {
      status: "processing",
      extractionStatus: "processing",
      updatedAt: "$$NOW",
      "extractionJob.leaseToken": leaseToken,
      "extractionJob.leaseExpiresAt": { $add: ["$$NOW", limits.processingLeaseMs] },
      "extractionJob.heartbeatAt": "$$NOW",
      "extractionJob.nextAttemptAt": null,
      "extractionJob.errorCode": "",
      "extractionJob.diagnosticAt": null,
      "extractionJob.attempt": {
        $add: [{ $ifNull: ["$extractionJob.attempt", 0] }, 1]
      }
    }
  }], {
    new: true,
    sort: { uploadedAt: 1, _id: 1 },
    timestamps: false
  });
};

const renewCurriculumImportLease = async ({
  lease,
  CurriculumImportModel = CurriculumImport
} = {}) => {
  const record = await CurriculumImportModel.findOneAndUpdate(
    leaseFilter(lease),
    [{
      $set: {
        updatedAt: "$$NOW",
        "extractionJob.heartbeatAt": "$$NOW",
        "extractionJob.leaseExpiresAt": { $add: ["$$NOW", limits.processingLeaseMs] }
      }
    }],
    { new: true, projection: { _id: 1 }, timestamps: false }
  );
  return Boolean(record);
};

const persistCurriculumImportResult = async ({
  lease,
  result,
  CurriculumImportModel = CurriculumImport
} = {}) => {
  const successful = result.status !== "failed";
  const record = await CurriculumImportModel.findOneAndUpdate(
    leaseFilter(lease),
    [{
      $set: {
        status: successful ? "needs_review" : "failed",
        extractionStatus: result.status,
        updatedAt: "$$NOW",
        extractedSegments: { $literal: result.segments },
        diagnostics: { $literal: result.diagnostics },
        "extractionJob.errorCode": "",
        "extractionJob.diagnosticAt": null,
        "extractionJob.leaseToken": null,
        "extractionJob.leaseExpiresAt": null,
        "extractionJob.heartbeatAt": null,
        "extractionJob.nextAttemptAt": null
      }
    }],
    { new: true, timestamps: false }
  );
  return Boolean(record);
};

const persistCurriculumImportFailure = async ({
  lease,
  errorCode,
  CurriculumImportModel = CurriculumImport
} = {}) => {
  const safeCode = SAFE_FAILURE_CODES.has(errorCode) ? errorCode : "INTERNAL_PROCESSING_ERROR";
  const delay = lease.attempt < limits.maxProcessingAttempts
    ? limits.processingRetryBackoffMs[lease.attempt - 1]
    : null;
  const retry = Number.isFinite(delay);
  const message = safeCode === "PROCESSING_TIMEOUT"
    ? "Document processing timed out."
    : safeCode === "OCR_FAILED"
      ? "Text could not be read from the scanned document."
      : safeCode === "TEXT_EXTRACTION_FAILED"
        ? "Text could not be extracted from the document."
        : "Document processing could not be completed.";
  const record = await CurriculumImportModel.findOneAndUpdate(
    leaseFilter(lease),
    [{
      $set: {
        status: retry ? "uploaded" : "failed",
        extractionStatus: retry ? "pending" : "failed",
        updatedAt: "$$NOW",
        "extractionJob.errorCode": safeCode,
        "extractionJob.diagnosticAt": "$$NOW",
        "extractionJob.leaseToken": null,
        "extractionJob.leaseExpiresAt": null,
        "extractionJob.heartbeatAt": null,
        "extractionJob.nextAttemptAt": retry ? { $add: ["$$NOW", delay] } : null,
        diagnostics: serverDiagnostics(
          safeCode === "WORKER_OUTPUT_INVALID" || safeCode === "CHILD_PROCESS_FAILED"
            ? "INTERNAL_PROCESSING_ERROR"
            : safeCode,
          message
        )
      }
    }],
    { new: true, timestamps: false }
  );
  return Boolean(record);
};

module.exports = {
  claimNextCurriculumImport,
  finalizeExpiredLeases,
  persistCurriculumImportFailure,
  persistCurriculumImportResult,
  recordOcrModelUnavailable,
  recoverExpiredLeases,
  renewCurriculumImportLease
};
