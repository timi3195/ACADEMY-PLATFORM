const mongoose = require("mongoose");

const sourcePaperMetadataSchema = new mongoose.Schema({
  title: { type: String, required: true },
  examinationYear: { type: String, required: true },
  level: { type: String, enum: ["ND1", "ND2", "HND1", "HND2"], required: true },
  semester: { type: String, enum: ["First", "Second"], required: true }
}, { _id: false });

const QUESTION_TYPES = ["objective", "fill_in_gap", "theory"];

const questionSchema = new mongoose.Schema({

  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course",
    required: true
  },

  // Link to department for faster filtering
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Department",
    required: true
  },

  topic: {
    type: String,
    required: true
  },

  questionNumber: {
    type: String,
    default: ""
  },

  question: {
    type: String,
    required: true
  },

  questionType: {
    type: String,
    enum: QUESTION_TYPES,
    default: undefined
  },

  questionOrigin: {
    type: String,
    enum: ["verified_past_paper", "original_practice"],
    default: "verified_past_paper"
  },

  blankCount: {
    type: Number,
    min: 1,
    max: 20,
    default: undefined
  },

  options: {
    type: [String],
    default: []
  },

  optionIds: {
    type: [String],
    default: []
  },

  answer: {
    type: String,
    default: ""
  },

  explanation: {
    type: String,
    default: ""
  },

  subQuestions: {
    type: [
      new mongoose.Schema({
        label: { type: String, default: '' },
        question: { type: String, required: true },
        options: { type: [String], default: [] },
        answer: { type: String, default: '' },
        explanation: { type: String, default: '' },
        year: { type: String, default: () => new Date().getFullYear().toString() },
        session: { type: String, enum: ['Rain', 'Harmattan'], default: 'Rain' },
        marks: { type: Number, default: 2 },
        difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
        isPremium: { type: Boolean, default: false }
      }, { _id: false })
    ],
    default: []
  },

  // Year of the exam (e.g., "2024", "2023")
  year: {
    type: String,
    required: true
  },

  // Exam session (e.g., "Rain", "Harmattan")
  session: {
    type: String,
    enum: ["Rain", "Harmattan"],
    default: "Rain"
  },

  // Marks allocated to this question
  marks: {
    type: Number,
    default: 2
  },

  difficulty: {
    type: String,
    enum: ["easy", "medium", "hard"],
    default: "medium"
  },

  isPremium: {
    type: Boolean,
    default: false
  },

  approvalStatus: {
    type: String,
    enum: ["draft", "approved", "rejected"],
    default: "draft"
  },

  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },

  approvedAt: {
    type: Date,
    default: null
  },

  extractionKey: {
    type: String,
    default: undefined
  },

  extractionBatchId: {
    type: String,
    default: ""
  },

  extractionDraftId: {
    type: String,
    default: ""
  },

  sourcePaper: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "PastQuestionPaper",
    default: null
  },

  sourcePaperMetadata: {
    type: sourcePaperMetadataSchema,
    default: undefined
  },

  sourceExamYear: {
    type: String,
    default: ""
  },

  sourceAcademicSession: {
    type: String,
    default: ""
  },

  sourcePage: {
    type: Number,
    min: 1,
    default: null
  },

  sourceExcerpt: {
    type: String,
    default: ""
  },

  // Track how many times this question was answered
  timesAnswered: {
    type: Number,
    default: 0
  },

  // Track correct attempts for analytics
  correctAttempts: {
    type: Number,
    default: 0
  }

}, { timestamps: true });

questionSchema.set("toJSON", {
  transform: (_document, value) => {
    delete value.isPremium;
    for (const subQuestion of value.subQuestions || []) delete subQuestion.isPremium;
    return value;
  }
});

// INDEXES FOR LARGE-SCALE PERFORMANCE
questionSchema.index({ course: 1 });
questionSchema.index({ department: 1 });
questionSchema.index({ topic: 1 });
questionSchema.index({ year: 1 });
questionSchema.index({ session: 1 });
questionSchema.index({ difficulty: 1 });
questionSchema.index({ isPremium: 1 });
// Compound indexes for common queries
questionSchema.index({ course: 1, year: 1, session: 1 });
questionSchema.index({ department: 1, year: 1 });
questionSchema.index({ extractionKey: 1 }, { unique: true, sparse: true });
// TEXT INDEX for full-text search
questionSchema.index({ question: "text", topic: "text", explanation: "text" });

questionSchema.path('options').validate(function(value) {
  if (this.approvalStatus === "draft") return true;
  if (this.questionType && this.questionType !== "objective") return true;
  if ((!value || value.length < 2) && (!this.subQuestions || this.subQuestions.length === 0)) {
    return false;
  }
  return true;
}, 'Options must be provided unless this question has sub-questions.');

questionSchema.path('answer').validate(function(value) {
  if (this.questionType) return true;
  if ((!value || value.trim() === '') && (!this.subQuestions || this.subQuestions.length === 0)) {
    return false;
  }
  return true;
}, 'Answer must be provided unless this question has sub-questions.');

questionSchema.path('blankCount').validate(function(value) {
  return this.approvalStatus === "draft" ||
    this.questionType !== "fill_in_gap" ||
    (Number.isInteger(value) && value >= 1 && value <= 20);
}, "Fill-in-the-gap questions must specify between 1 and 20 blanks.");

module.exports = mongoose.models.Question || mongoose.model("Question", questionSchema);