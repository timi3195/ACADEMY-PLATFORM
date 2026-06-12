const mongoose = require("mongoose");

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

  timeStarted: {
    type: Date,
    default: Date.now
  },

  timeEnded: Date,

  duration: Number,

  weakTopics: [String],

  createdAt: {
    type: Date,
    default: Date.now
  }

});

module.exports = mongoose.models.QuizSession || mongoose.model("QuizSession", quizSessionSchema);