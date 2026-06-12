const mongoose = require("mongoose");

const activitySchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ["read-notes", "watch-video", "practice-questions", "chat-ai", "take-mini-test"],
    required: true
  },
  title: String,
  description: String,
  topic: String,
  duration: Number, // minutes
  resourceUrl: String,
  completed: {
    type: Boolean,
    default: false
  },
  completedAt: Date,
  score: Number
});

const dayScheduleSchema = new mongoose.Schema({
  day: Number,
  date: Date,
  status: {
    type: String,
    enum: ["pending", "in-progress", "completed"],
    default: "pending"
  },
  activities: [activitySchema],
  summary: String
});

const adjustmentSchema = new mongoose.Schema({
  timestamp: Date,
  reason: String,
  changeDescription: String
});

const learningPathSchema = new mongoose.Schema({
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

  // Path metadata
  title: {
    type: String,
    required: true
  },
  startDate: Date,
  targetExamDate: Date,
  daysRemaining: Number,

  // Schedule
  schedule: [dayScheduleSchema],

  // Adjustments
  adjustmentHistory: [adjustmentSchema],

  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
learningPathSchema.index({ user: 1, course: 1 });
learningPathSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.models.LearningPath || mongoose.model("LearningPath", learningPathSchema);
