const mongoose = require("mongoose");

const assignmentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true
    },
    description: {
      type: String,
      default: ""
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true
    },
    type: {
      type: String,
      enum: ["assignment", "test", "quiz", "project"],
      default: "assignment"
    },
    // File attachments
    attachments: [{
      filename: String,
      fileUrl: String,
      fileType: String, // 'pdf', 'docx', 'image', etc.
      uploadedAt: { type: Date, default: Date.now }
    }],
    // Instructions/Content
    instructions: {
      type: String,
      default: ""
    },
    // Deadline
    dueDate: {
      type: Date,
      required: true
    },
    // Scoring
    totalPoints: {
      type: Number,
      default: 100
    },
    // Assessment structure
    questionStructure: {
      type: String,
      enum: ["freeform", "objective", "hybrid"],
      default: "freeform"
    },
    questions: [{
      _id: mongoose.Schema.Types.ObjectId,
      title: String,
      description: String,
      points: Number,
      type: String, // 'multiple-choice', 'short-answer', 'essay', 'file-upload'
      options: [String], // for multiple choice
      correctAnswer: String, // for auto-grading
      rubric: String // for manual grading guidance
    }],
    // Publishing
    isPublished: {
      type: Boolean,
      default: true
    },
    publishedAt: Date,
    // Grading
    allowLateSubmission: {
      type: Boolean,
      default: false
    },
    latePenaltyPercent: {
      type: Number,
      default: 0
    },
    // Auto-grading
    enableAutoGrade: {
      type: Boolean,
      default: false
    },
    // Visibility
    visibleToStudents: {
      type: Boolean,
      default: true
    },
    // Creator
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    // Statistics
    totalSubmissions: {
      type: Number,
      default: 0
    },
    averageScore: {
      type: Number,
      default: 0
    }
  },
  { timestamps: true }
);

// Indexes for fast queries
assignmentSchema.index({ course: 1 });
assignmentSchema.index({ dueDate: 1 });
assignmentSchema.index({ createdBy: 1 });
assignmentSchema.index({ type: 1 });

module.exports = mongoose.models.Assignment || mongoose.model("Assignment", assignmentSchema);
