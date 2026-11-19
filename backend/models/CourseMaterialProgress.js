const mongoose = require("mongoose");

const courseMaterialProgressSchema = new mongoose.Schema({
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
  material: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "File",
    required: true
  },
  completed: {
    type: Boolean,
    default: false,
    required: true
  },
  completedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

courseMaterialProgressSchema.index(
  { student: 1, material: 1 },
  { unique: true, name: "unique_student_material_progress" }
);
courseMaterialProgressSchema.index(
  { student: 1, course: 1 },
  { name: "student_course_progress" }
);

module.exports = mongoose.models.CourseMaterialProgress ||
  mongoose.model("CourseMaterialProgress", courseMaterialProgressSchema);
