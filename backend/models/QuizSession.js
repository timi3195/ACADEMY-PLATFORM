const mongoose = require("mongoose");

const presentedOptionSchema = new mongoose.Schema({
  optionId: { type: String, required: true },
  text: { type: String, required: true }
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

  questions: [
    {
      questionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Question"
      },

      question: String,

      presentedOptions: {
        type: [presentedOptionSchema],
        default: []
      },

      selectedOptionId: String,

      correctOptionId: String,

      selectedAnswer: String,

      correctAnswer: String,

      isCorrect: Boolean,

      topic: String
    }
  ],

  score: {
    type: Number,
    default: 0
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

module.exports = mongoose.models.QuizSession || mongoose.model("QuizSession", quizSessionSchema);