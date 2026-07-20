const mongoose = require("mongoose");

const fileSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },

  description: {
    type: String,
    default: ""
  },

  coverImageUrl: {
    type: String,
    default: ""
  },

  coverImageFilename: {
    type: String,
    default: ""
  },

  coverImageOriginalName: {
    type: String,
    default: ""
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
    type: String,
    default: ""
  },

  department: {
    type: String,
    default: null
  },

  semester: {
    type: String,
    enum: ["First", "Second", "First Semester", "Second Semester", "Rain Semester", "Harmattan Semester"],
    default: "First Semester"
  },

  lecturer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },

  lecturerName: {
    type: String,
    default: ""
  },

  category: {
    type: String,
    enum: ["Book", "Lecture Notes", "Lab Manual", "Assignment", "Past Question", "Video", "PDF", "DOCX", "PPT", "ZIP", "Other", "Lecture Note", "Textbook", "Practical", "Research Paper", "Project Guide", "Presentation Slides"],
    default: "Other"
  },

  materialType: {
    type: String,
    enum: ["PDF", "DOCX", "PPT", "ZIP", "Video", "Book", "Lab Manual", "Assignment", "Past Question", "Other", "Lecture Note", "Textbook", "Practical", "Research Paper", "Project Guide", "Presentation Slides"],
    default: "Other"
  },

  visibility: {
    type: String,
    enum: ["public", "unlisted", "private"],
    default: "public"
  },

  level: {
    type: String,
    enum: ["100 Level", "200 Level", "300 Level", "400 Level", "500 Level", "PGD", "Masters", "PhD", "Other"],
    default: "100 Level"
  },

  previewPages: {
    type: Number,
    default: 0
  },

  pageCount: {
    type: Number,
    default: 0
  },

  productStatus: {
    type: String,
    enum: ["draft", "published", "archived"],
    default: "draft"
  },

  language: {
    type: String,
    default: "en"
  },

  edition: {
    type: String,
    default: ""
  },

  publisher: {
    type: String,
    default: ""
  },

  status: {
    type: String,
    enum: ["pending", "approved", "rejected", "hidden"],
    default: "pending"
  },

  hidden: {
    type: Boolean,
    default: false
  },

  featured: {
    type: Boolean,
    default: false
  },

  isDeleted: {
    type: Boolean,
    default: false
  },

  deletedAt: {
    type: Date,
    default: null
  },

  price: {
    type: Number,
    default: 0
  },

  isFree: {
    type: Boolean,
    default: false
  },

  isPaid: {
    type: Boolean,
    default: false
  },

  premiumDiscount: {
    type: Number,
    default: 0
  },

  faculty: {
    type: String,
    default: ""
  },

  courseCode: {
    type: String,
    default: ""
  },

  allowDownload: {
    type: Boolean,
    default: true
  },

  allowPreview: {
    type: Boolean,
    default: true
  },

  approved: {
    type: Boolean,
    default: false
  },

  downloads: {
    type: Number,
    default: 0
  },

  views: {
    type: Number,
    default: 0
  },

  purchases: {
    type: Number,
    default: 0
  },

  ratingAverage: {
    type: Number,
    default: 0
  },

  ratingCount: {
    type: Number,
    default: 0
  },

  sales: {
    type: Number,
    default: 0
  },

  tags: {
    type: [String],
    default: []
  },

  // Existing premium course file marker
  isPremium: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true  // Automatically adds createdAt and updatedAt
});

fileSchema.index({ course: 1 });
fileSchema.index({ department: 1 });
fileSchema.index({ lecturer: 1 });
fileSchema.index({ isPremium: 1 });
fileSchema.index({ isFree: 1 });
fileSchema.index({ isPaid: 1 });
fileSchema.index({ approved: 1 });
fileSchema.index({ status: 1 });
fileSchema.index({ hidden: 1 });
fileSchema.index({ featured: 1 });
fileSchema.index({ isDeleted: 1 });
fileSchema.index({ materialType: 1 });
fileSchema.index({ category: 1 });
fileSchema.index({ tags: 1 });
fileSchema.index({ title: "text", description: "text" });

module.exports = mongoose.models.File || mongoose.model("File", fileSchema);