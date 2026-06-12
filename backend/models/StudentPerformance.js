const mongoose = require("mongoose");

const topicMetricSchema = new mongoose.Schema({
  topic: String,
  correctAttempts: {
    type: Number,
    default: 0
  },
  totalAttempts: {
    type: Number,
    default: 0
  },
  accuracy: {
    type: Number,
    default: 0
  },
  lastAttemptDate: Date,
  masteryLevel: {
    type: String,
    enum: ["beginner", "intermediate", "advanced", "expert"],
    default: "beginner"
  },
  estimatedReadiness: {
    type: Number,
    default: 0 // 0-100
  }
});

const performanceTrendSchema = new mongoose.Schema({
  date: Date,
  accuracy: Number,
  questionsAnswered: Number
});

const studentPerformanceSchema = new mongoose.Schema({
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
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Department"
  },

  // Topic-level performance
  topicMetrics: [topicMetricSchema],

  // Overall course metrics
  overallAccuracy: {
    type: Number,
    default: 0
  },
  topStrengths: [String],
  areasToImprove: [String],
  estimatedExamScore: {
    type: Number,
    default: 0
  },
  improvementTrend: {
    type: String,
    enum: ["improving", "stable", "declining"],
    default: "stable"
  },

  // Time-series data
  performanceTrend: [performanceTrendSchema],

  createdAt: {
    type: Date,
    default: Date.now
  },
  lastUpdatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
studentPerformanceSchema.index({ user: 1, course: 1 });
studentPerformanceSchema.index({ user: 1 });
studentPerformanceSchema.index({ "topicMetrics.topic": 1 });

module.exports = mongoose.models.StudentPerformance || mongoose.model("StudentPerformance", studentPerformanceSchema);
