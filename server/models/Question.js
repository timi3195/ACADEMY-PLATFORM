const mongoose = require("mongoose");

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

  question: {
    type: String,
    required: true
  },

  options: {
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
// TEXT INDEX for full-text search
questionSchema.index({ question: "text", topic: "text", explanation: "text" });

questionSchema.path('options').validate(function(value) {
  if ((!value || value.length < 2) && (!this.subQuestions || this.subQuestions.length === 0)) {
    return false;
  }
  return true;
}, 'Options must be provided unless this question has sub-questions.');

questionSchema.path('answer').validate(function(value) {
  if ((!value || value.trim() === '') && (!this.subQuestions || this.subQuestions.length === 0)) {
    return false;
  }
  return true;
}, 'Answer must be provided unless this question has sub-questions.');

module.exports = mongoose.models.Question || mongoose.model("Question", questionSchema);