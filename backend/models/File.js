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

  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course"
  },

  isPremium: {
    type: Boolean,
    default: false
  },

  uploadedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.models.File || mongoose.model("File", fileSchema);