const mongoose = require("mongoose");

const fileSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },

  fileUrl: {
    type: String,
    required: true
  },

  // The actual filename stored on disk (server-side). Keeps storage details out of public URLs.
  storageFilename: {
    type: String
  },

  // Original uploaded filename
  originalName: {
    type: String
  },

  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course"
  },

  isPremium: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true  // Automatically adds createdAt and updatedAt
});

module.exports = mongoose.models.File || mongoose.model("File", fileSchema);