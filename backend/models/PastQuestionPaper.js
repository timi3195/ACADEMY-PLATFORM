const mongoose = require("mongoose");

const pastQuestionPaperSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },
  department: { type: mongoose.Schema.Types.ObjectId, ref: "Department", required: true },
  level: { type: String, enum: ["ND1", "ND2", "HND1", "HND2"], required: true },
  semester: { type: String, enum: ["First", "Second"], required: true },
  examinationYear: { type: String, required: true },
  fileUrl: { type: String, required: true },
  storageFilename: { type: String, required: true },
  originalName: { type: String, required: true },
  mimeType: { type: String, required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });

pastQuestionPaperSchema.index({ course: 1, department: 1, level: 1, semester: 1 });

module.exports = mongoose.models.PastQuestionPaper || mongoose.model("PastQuestionPaper", pastQuestionPaperSchema);
