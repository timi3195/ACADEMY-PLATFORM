const mongoose = require("mongoose");

const flashcardSchema = new mongoose.Schema({
  question: String,
  answer: String,
  difficulty: {
    type: String,
    enum: ["easy", "medium", "hard"]
  }
});

const studentNoteSchema = new mongoose.Schema({
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

  // Original note
  title: {
    type: String,
    required: true
  },
  fileName: String,
  fileUrl: String, // Cloudinary URL
  fileType: {
    type: String,
    enum: ["pdf", "image", "text"]
  },
  rawContent: String, // OCR'd or extracted text

  // AI Enhancements
  enhancements: {
    summary: String,
    keyPoints: [String],
    mindMap: {
      structure: mongoose.Schema.Types.Mixed, // JSON structure
      visualUrl: String
    },
    flashcards: [flashcardSchema],
    knowledgeGaps: [String],
    examFocus: String,
    relatedPastQuestions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Question"
      }
    ]
  },

  // Tracking
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastReviewedAt: Date,
  reviewCount: {
    type: Number,
    default: 0
  }
});

// Indexes
studentNoteSchema.index({ user: 1, course: 1, createdAt: -1 });
studentNoteSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.models.StudentNote || mongoose.model("StudentNote", studentNoteSchema);
