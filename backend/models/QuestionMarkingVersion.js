const mongoose = require("mongoose");

const sourcePaperMetadataSchema = new mongoose.Schema({
  title: { type: String, default: "" },
  examinationYear: { type: String, default: "" },
  level: { type: String, default: "" },
  semester: { type: String, default: "" }
}, { _id: false });

const questionMarkingVersionSchema = new mongoose.Schema({
  question: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Question",
    required: true,
    index: true
  },
  course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },
  department: { type: mongoose.Schema.Types.ObjectId, ref: "Department", required: true },
  questionYear: { type: String, required: true },
  questionSession: { type: String, enum: ["Rain", "Harmattan"], default: "Rain" },
  sourceExamYear: { type: String, default: "" },
  sourceAcademicSession: { type: String, default: "" },
  version: { type: Number, required: true, min: 1 },
  generationKey: { type: String, required: true, unique: true },
  questionType: {
    type: String,
    enum: ["objective", "fill_in_gap", "theory"],
    required: true
  },
  questionOrigin: {
    type: String,
    enum: ["verified_past_paper", "original_practice"],
    default: "verified_past_paper"
  },
  contentHash: { type: String, required: true },
  promptVersion: { type: String, required: true },
  schemaVersion: { type: String, required: true },
  provider: { type: String, default: "gemini" },
  markingSource: {
    type: String,
    enum: ["ai_generated", "admin_authored"],
    default: "ai_generated",
    index: true
  },
  model: { type: String, default: "" },
  status: {
    type: String,
    enum: ["generating", "ready", "uncertain", "invalid", "failed", "needs_source"],
    required: true,
    index: true
  },
  marking: { type: mongoose.Schema.Types.Mixed, default: undefined },
  sourcePaper: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "PastQuestionPaper",
    default: null
  },
  sourcePaperMetadata: { type: sourcePaperMetadataSchema, default: undefined },
  sourcePage: { type: Number, min: 1, default: null },
  sourceExcerpt: { type: String, default: "" },
  uncertaintyReasons: { type: [String], default: [] },
  validationErrors: { type: [String], default: [] },
  failureCode: {
    type: String,
    enum: ["", "not_configured", "rate_limited", "provider_error"],
    default: ""
  },
  generationStartedAt: { type: Date, default: null },
  generatedAt: { type: Date, default: null }
}, { timestamps: true });

questionMarkingVersionSchema.index({ question: 1, version: 1 }, { unique: true });
questionMarkingVersionSchema.index({ question: 1, contentHash: 1, createdAt: -1 });

module.exports = mongoose.models.QuestionMarkingVersion ||
  mongoose.model("QuestionMarkingVersion", questionMarkingVersionSchema);
