const mongoose = require("mongoose");

const stepSchema = new mongoose.Schema({
  step: Number,
  description: String,
  formula: String,
  example: String
});

const similarQuestionSchema = new mongoose.Schema({
  question: String,
  options: [String],
  answer: String,
  difficulty: String
});

const pastQuestionExplanationSchema = new mongoose.Schema({
  question: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Question",
    required: true
  },

  // AI Analysis
  explanation: String,
  stepByStepSolution: [stepSchema],
  alternativeSolutions: [String],
  commonMistakes: [String],

  // Generated Practice Questions
  similarQuestions: [similarQuestionSchema],

  // Metadata
  generatedAt: {
    type: Date,
    default: Date.now
  },
  viewCount: {
    type: Number,
    default: 0
  },
  helpfulCount: {
    type: Number,
    default: 0
  },
  unhelpfulCount: {
    type: Number,
    default: 0
  }
});

// Indexes
pastQuestionExplanationSchema.index({ question: 1 });
pastQuestionExplanationSchema.index({ createdAt: -1 });
pastQuestionExplanationSchema.index({ generatedAt: 1 });

module.exports = mongoose.models.PastQuestionExplanation || mongoose.model("PastQuestionExplanation", pastQuestionExplanationSchema);
