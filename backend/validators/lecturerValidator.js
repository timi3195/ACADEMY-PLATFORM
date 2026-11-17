const mongoose = require("mongoose");
const { FILE_LEVELS, normalizeAcademicLevel } = require("../utils/academicLevels");

const MATERIAL_TYPES = [
  "Lecture Note", "Textbook", "Past Question", "Assignment", "Lab Manual", "Practical",
  "Research Paper", "Project Guide", "Presentation Slides", "PDF", "DOCX", "PPT", "ZIP",
  "Video", "Book", "Other"
];

const validateMaterial = (body, file, isUpdate) => {
  const errors = [];
  if (!isUpdate && (!body.title || !String(body.title).trim())) {
    errors.push({ field: "title", message: "Title is required" });
  }
  if (!isUpdate && (!body.description || !String(body.description).trim())) {
    errors.push({ field: "description", message: "Description is required" });
  }
  if (!isUpdate && (!mongoose.Types.ObjectId.isValid(String(body.course || "")))) {
    errors.push({ field: "course", message: "Choose an assigned course" });
  }
  if (!isUpdate && !file) errors.push({ field: "file", message: "Material file is required" });
  if (body.course !== undefined && !mongoose.Types.ObjectId.isValid(String(body.course))) {
    errors.push({ field: "course", message: "Choose a valid assigned course" });
  }
  if (body.title !== undefined && !String(body.title).trim()) {
    errors.push({ field: "title", message: "Title cannot be empty" });
  }
  if (body.description !== undefined && !String(body.description).trim()) {
    errors.push({ field: "description", message: "Description cannot be empty" });
  }
  if (body.materialType && !MATERIAL_TYPES.includes(body.materialType)) {
    errors.push({ field: "materialType", message: "Material type is invalid" });
  }
  if (body.status && !["draft", "published"].includes(body.status)) {
    errors.push({ field: "status", message: "Status must be draft or published" });
  }
  if (body.previewPages !== undefined && (!Number.isFinite(Number(body.previewPages)) || Number(body.previewPages) < 0)) {
    errors.push({ field: "previewPages", message: "Preview pages must be a non-negative number" });
  }
  if (body.pageCount !== undefined && (!Number.isFinite(Number(body.pageCount)) || Number(body.pageCount) < 0)) {
    errors.push({ field: "pageCount", message: "Page count must be a non-negative number" });
  }
  if (body.level !== undefined) {
    const level = normalizeAcademicLevel(body.level);
    if (!FILE_LEVELS.includes(level)) errors.push({ field: "level", message: "Invalid level" });
    else body.level = level;
  }
  if (file && !file.originalname) errors.push({ field: "file", message: "Uploaded material is invalid" });
  return errors;
};

exports.validateCreateMaterial = (body, file) => validateMaterial(body, file, false);
exports.validateUpdateMaterial = (body, file) => validateMaterial(body, file, true);
