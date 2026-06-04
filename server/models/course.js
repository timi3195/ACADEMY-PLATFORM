const mongoose = require("mongoose");

const courseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true
    },

    code: {
      type: String,
      required: true,
      unique: true
    },

    // Reference to Department instead of string
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: true
    },

    // Course level (ND1, ND2, HND1, HND2)
    level: {
      type: String,
      enum: ["ND1", "ND2", "HND1", "HND2"],
      required: true
    },

    // Semester in which course is offered
    semester: {
      type: String,
      enum: ["First", "Second"],
      default: "First"
    },

    // Credit units
    creditUnits: {
      type: Number,
      default: 3
    },

    description: {
      type: String,
      default: ""
    },

    isPremium: {
      type: Boolean,
      default: false
    },

    // Lecturers assigned to this course
    lecturers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }],

    // Number of students enrolled
    enrollmentCount: {
      type: Number,
      default: 0
    }
  },
  { timestamps: true }
);

// Indexes for fast queries (unique: true on code already creates index)
courseSchema.index({ department: 1 });
courseSchema.index({ level: 1 });
courseSchema.index({ semester: 1 });
courseSchema.index({ isPremium: 1 });
// Text index for search
courseSchema.index({ title: "text", code: "text", description: "text" });

module.exports = mongoose.model("Course", courseSchema);