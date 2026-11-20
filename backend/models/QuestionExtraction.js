const mongoose = require("mongoose");

const sourcePaperMetadataSchema = new mongoose.Schema({
  title: { type: String, required: true },
  examinationYear: { type: String, required: true },
  level: { type: String, enum: ["ND1", "ND2", "HND1", "HND2"], required: true },
  semester: { type: String, enum: ["First", "Second"], required: true }
}, { _id: false });

const imageSchema = new mongoose.Schema({
  originalName: { type: String, required: true },
  mimeType: { type: String, enum: ["image/jpeg", "image/png"], required: true },
  extension: { type: String, enum: ["jpg", "jpeg", "png"], required: true },
  size: { type: Number, required: true },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  storageProvider: { type: String, enum: ["local-disk", "object-storage"], required: true },
  storageFilename: { type: String, default: "" },
  storageKey: { type: String, default: "" },
  ocrStatus: { type: String, enum: ["pending", "succeeded", "failed"], default: "pending" },
  ocrText: { type: String, default: "" },
  ocrConfidence: { type: Number, default: null },
  ocrProvider: { type: String, default: "" },
  ocrVersion: { type: String, default: "" },
  ocrError: { type: String, default: "" }
}, { timestamps: true });

const optionSchema = new mongoose.Schema({
  optionId: { type: String, default: "" },
  label: { type: String, default: "" },
  text: { type: String, required: true }
}, { _id: false });

const QUESTION_TYPES = ["objective", "fill_in_gap", "theory", "unclassified"];

const reviewHistorySchema = new mongoose.Schema({
  reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  action: { type: String, enum: ["edited", "approved", "rejected"], required: true },
  reviewedAt: { type: Date, default: Date.now },
  previousValues: { type: mongoose.Schema.Types.Mixed, default: undefined },
  updatedValues: { type: mongoose.Schema.Types.Mixed, default: undefined },
  rejectionReason: { type: String, default: "" },
  question: { type: mongoose.Schema.Types.ObjectId, ref: "Question", default: null }
}, { _id: false });

const draftSchema = new mongoose.Schema({
  questionNumber: { type: String, default: "" },
  questionText: { type: String, required: true },
  questionType: { type: String, enum: QUESTION_TYPES, default: undefined },
  blankCount: { type: Number, min: 1, max: 20, default: null },
  options: { type: [optionSchema], default: [] },
  possibleAnswer: { type: String, default: "" },
  answerStatus: { type: String, enum: ["unconfirmed"], default: "unconfirmed" },
  confirmedAnswerOptionId: { type: String, default: "" },
  answerConfirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  answerConfirmedAt: { type: Date, default: null },
  explanation: { type: String, default: "" },
  topic: { type: String, default: "" },
  difficulty: { type: String, enum: ["easy", "medium", "hard"], default: "medium" },
  marks: { type: Number, min: 0.1, max: 100, default: 2 },
  sourceImage: { type: mongoose.Schema.Types.ObjectId, default: null },
  sourcePage: { type: Number, default: null },
  sourceExcerpt: { type: String, default: "" },
  ocrConfidence: { type: Number, default: null },
  structuringConfidence: { type: Number, default: null },
  extractionWarnings: { type: [String], default: [] },
  originalContent: { type: mongoose.Schema.Types.Mixed, default: undefined },
  reviewStatus: { type: String, enum: ["pending", "approving", "approved", "rejected"], default: "pending" },
  reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null },
  reviewLockToken: { type: String, default: "" },
  reviewLockUntil: { type: Date, default: null },
  rejectionReason: { type: String, default: "" },
  approvedQuestion: { type: mongoose.Schema.Types.ObjectId, ref: "Question", default: null },
  markingStatus: {
    type: String,
    enum: ["ready", "uncertain", "invalid", "failed", "needs_source"],
    default: undefined
  },
  markingVersion: { type: mongoose.Schema.Types.ObjectId, ref: "QuestionMarkingVersion", default: null },
  reviewHistory: { type: [reviewHistorySchema], default: [] }
}, { timestamps: true });

const questionExtractionSchema = new mongoose.Schema({
  batchId: { type: String, required: true, unique: true, index: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true, index: true },
  department: { type: mongoose.Schema.Types.ObjectId, ref: "Department", required: true },
  academicLevel: { type: String, required: true },
  semester: { type: String, required: true },
  academicSession: { type: String, required: true },
  sourceExamYear: { type: String, default: "" },
  sourcePaper: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "PastQuestionPaper",
    default: null
  },
  sourcePaperMetadata: { type: sourcePaperMetadataSchema, default: undefined },
  images: { type: [imageSchema], required: true, validate: (images) => images.length > 0 },
  ocrText: { type: String, default: "" },
  drafts: { type: [draftSchema], default: [] },
  status: {
    type: String,
    enum: ["uploaded", "queued", "processing", "extracted", "needs_review", "approved", "partially_failed", "failed"],
    default: "uploaded",
    index: true
  },
  processingStage: { type: String, enum: ["none", "ocr", "structuring"], default: "none" },
  processingErrors: [{
    stage: { type: String, enum: ["upload", "ocr", "structuring"] },
    imageId: { type: mongoose.Schema.Types.ObjectId, default: null },
    category: { type: String, default: "" },
    providerStatus: { type: Number, default: null },
    chunkIndex: { type: Number, default: null },
    message: { type: String, required: true },
    occurredAt: { type: Date, default: Date.now }
  }],
  ocrProvider: { type: String, default: "" },
  ocrVersion: { type: String, default: "" },
  aiProvider: { type: String, default: "" },
  aiModel: { type: String, default: "" },
  structuringWarnings: { type: [String], default: [] },
  structuringCompletedChunks: { type: [String], default: [] },
  retryCount: { type: Number, default: 0 },
  processingAttemptCount: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: null },
  processingLockToken: { type: String, default: "" },
  processingLockUntil: { type: Date, default: null },
  processingLeaseHeartbeatAt: { type: Date, default: null },
  reviewStatus: { type: String, enum: ["pending", "in_progress", "completed"], default: "pending" }
}, { timestamps: true });

questionExtractionSchema.index({ uploadedBy: 1, createdAt: -1 });
questionExtractionSchema.index({ course: 1, createdAt: -1 });
questionExtractionSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
questionExtractionSchema.index({ status: 1, processingLockUntil: 1 });

module.exports = mongoose.models.QuestionExtraction ||
  mongoose.model("QuestionExtraction", questionExtractionSchema);
