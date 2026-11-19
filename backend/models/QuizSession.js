const mongoose = require("mongoose");

const presentedOptionSchema = new mongoose.Schema({
  optionId: { type: String, required: true, immutable: true },
  text: { type: String, required: true, immutable: true }
}, { _id: false });

const sourceSnapshotSchema = new mongoose.Schema({
  paperId: { type: mongoose.Schema.Types.ObjectId, ref: "PastQuestionPaper", immutable: true },
  title: { type: String, immutable: true },
  examinationYear: { type: String, immutable: true },
  level: { type: String, immutable: true },
  semester: { type: String, immutable: true },
  page: { type: Number, immutable: true },
  excerpt: { type: String, immutable: true }
}, { _id: false });

const attemptQuestionSchema = new mongoose.Schema({
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Question",
    immutable: true
  },
  question: { type: String, immutable: true },
  questionType: {
    type: String,
    enum: ["objective", "fill_in_gap", "theory"],
    immutable: true
  },
  questionOrder: { type: Number, min: 1, immutable: true },
  blankCount: { type: Number, min: 1, max: 20, immutable: true },
  marks: { type: Number, min: 0, immutable: true },
  topic: { type: String, immutable: true },
  presentedOptions: {
    type: [presentedOptionSchema],
    default: [],
    immutable: true
  },
  sourceSnapshot: { type: sourceSnapshotSchema, immutable: true },
  markingVersionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "QuestionMarkingVersion",
    immutable: true
  },
  markingSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    immutable: true
  },
  gradingResult: { type: mongoose.Schema.Types.Mixed, default: undefined },
  selectedOptionId: String,
  selectedAnswers: { type: [String], default: undefined },
  theoryResponse: String,
  correctOptionId: String,
  selectedAnswer: String,
  correctAnswer: String,
  isCorrect: Boolean
}, { _id: false });

const quizSessionSchema = new mongoose.Schema({

  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course",
    required: true
  },

  questions: { type: [attemptQuestionSchema], default: [] },

  attemptFormatVersion: { type: Number, min: 1 },

  activeAttempt: { type: Boolean, default: undefined },

  gradingStatus: {
    type: String,
    enum: ["pending", "grading", "failed", "needs_review", "graded"],
    default: undefined
  },

  gradingToken: { type: String, select: false },

  gradingStartedAt: Date,

  gradingAttemptCount: { type: Number, min: 0, default: 0 },

  gradingErrorCode: {
    type: String,
    enum: ["", "provider_error", "grading_timeout", "invalid_output", "request_too_large", "quota_exceeded", "not_configured"],
    default: ""
  },

  score: {
    type: Number,
    default: 0
  },

  totalMarks: {
    type: Number,
    min: 0,
    default: undefined
  },

  provisionalScore: {
    type: Number,
    min: 0,
    default: undefined
  },

  provisionalMaxMarks: {
    type: Number,
    min: 0,
    default: undefined
  },

  provisionalPercentage: {
    type: Number,
    min: 0,
    max: 100,
    default: undefined
  },

  totalQuestions: {
    type: Number,
    default: 0
  },

  percentage: {
    type: Number,
    default: 0
  },

  status: {
    type: String,
    enum: ["in_progress", "completed"],
    default: undefined
  },

  timeStarted: {
    type: Date,
    default: Date.now
  },

  startedAt: Date,

  expiresAt: Date,

  durationMinutes: {
    type: Number,
    min: 1,
    max: 180
  },

  timeEnded: Date,

  completedAt: Date,

  completionReason: {
    type: String,
    enum: ["manual", "expired"]
  },

  duration: Number,

  weakTopics: [String],

  stateVersion: {
    type: Number,
    default: 0,
    min: 0
  },

  lastAnswerUpdatedAt: Date,

  createdAt: {
    type: Date,
    default: Date.now
  }

});

quizSessionSchema.index({ user: 1, status: 1, createdAt: -1 });
quizSessionSchema.index({ status: 1, expiresAt: 1 });
quizSessionSchema.index(
  { user: 1, course: 1 },
  {
    unique: true,
    partialFilterExpression: { activeAttempt: true },
    name: "unique_active_attempt_per_user_course"
  }
);

module.exports = mongoose.models.QuizSession || mongoose.model("QuizSession", quizSessionSchema);