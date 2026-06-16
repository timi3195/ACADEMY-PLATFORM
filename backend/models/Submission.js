const mongoose = require("mongoose");

const submissionSchema = new mongoose.Schema(
  {
    assignment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Assignment",
      required: true
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true
    },
    // Response content
    responses: [{
      questionId: mongoose.Schema.Types.ObjectId,
      answer: String, // text answer
      selectedOption: String, // for multiple choice
      attachmentUrl: String // for file uploads
    }],
    // General text submission
    textSubmission: {
      type: String,
      default: ""
    },
    // File submission
    submittedFiles: [{
      filename: String,
      fileUrl: String,
      fileType: String,
      uploadedAt: { type: Date, default: Date.now }
    }],
    // Submission status
    status: {
      type: String,
      enum: ["draft", "submitted", "graded", "returned"],
      default: "draft"
    },
    submittedAt: Date,
    // Grading information
    score: {
      type: Number,
      default: null
    },
    maxScore: {
      type: Number,
      default: null
    },
    percentage: {
      type: Number,
      default: null
    },
    grade: {
      type: String,
      default: null // A, B, C, etc.
    },
    // Feedback
    feedback: {
      type: String,
      default: ""
    },
    questionFeedback: [{
      questionId: mongoose.Schema.Types.ObjectId,
      feedback: String,
      pointsEarned: Number
    }],
    gradedAt: Date,
    gradedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    // Late submission tracking
    isLate: {
      type: Boolean,
      default: false
    },
    daysLate: {
      type: Number,
      default: 0
    },
    // Attempt tracking
    attempt: {
      type: Number,
      default: 1
    },
    // AI Analysis (optional)
    aiAnalysis: {
      plagiarismScore: Number,
      summary: String,
      suggestions: [String]
    }
  },
  { timestamps: true }
);

// Indexes for fast queries
submissionSchema.index({ assignment: 1, student: 1 }, { unique: true });
submissionSchema.index({ course: 1 });
submissionSchema.index({ student: 1 });
submissionSchema.index({ status: 1 });
submissionSchema.index({ submittedAt: 1 });

module.exports = mongoose.models.Submission || mongoose.model("Submission", submissionSchema);
