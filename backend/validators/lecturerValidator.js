const mongoose = require("mongoose");

const objectIdValid = (id) => mongoose.Types.ObjectId.isValid(id);

exports.validateCreateMaterial = (body, file) => {
  const errors = [];
  const isFree = body.isFree === "true" || body.isFree === true || body.pricingMode === "free" || Number(body.price || 0) === 0;
  const isPaid = !isFree && body.pricingMode !== "free";

  if (!body.title || !body.title.trim()) {
    errors.push({ field: "title", message: "Title is required" });
  }

  if (!body.description || !body.description.trim()) {
    errors.push({ field: "description", message: "Description is required" });
  }

  const courseValue = body.course || body.courseTitle || body.courseName;
  if (!courseValue || !String(courseValue).trim()) {
    errors.push({ field: "course", message: "A valid course is required" });
  }

  if (!file) {
    errors.push({ field: "file", message: "Material file is required" });
  }

  if (body.price !== undefined) {
    const price = Number(body.price);
    if (Number.isNaN(price) || price < 0) {
      errors.push({ field: "price", message: "Price must be a non-negative number" });
    }
    if (isPaid && price <= 0) {
      errors.push({ field: "price", message: "Paid materials must have a price greater than 0" });
    }
  }

  if (body.visibility && !["public", "unlisted", "private"].includes(body.visibility)) {
    errors.push({ field: "visibility", message: "Visibility must be public, unlisted, or private" });
  }

  if (body.level && !["100 Level", "200 Level", "300 Level", "400 Level", "500 Level", "PGD", "Masters", "PhD", "ND1", "ND2", "HND1", "HND2", "Other"].includes(body.level)) {
    errors.push({ field: "level", message: "Invalid level" });
  }

  if (body.previewPages !== undefined) {
    const pages = Number(body.previewPages);
    if (Number.isNaN(pages) || pages < 0) {
      errors.push({ field: "previewPages", message: "Preview pages must be a positive number" });
    }
  }

  if (body.pageCount !== undefined) {
    const pages = Number(body.pageCount);
    if (Number.isNaN(pages) || pages < 0) {
      errors.push({ field: "pageCount", message: "Page count must be a positive number" });
    }
  }

  if (body.semester && !["First Semester", "Second Semester", "Rain Semester", "Harmattan Semester", "First", "Second"].includes(body.semester)) {
    errors.push({ field: "semester", message: "Invalid semester" });
  }

  if (body.materialType && !["Lecture Note", "Textbook", "Past Question", "Assignment", "Lab Manual", "Practical", "Research Paper", "Project Guide", "Presentation Slides", "PDF", "DOCX", "PPT", "ZIP", "Video", "Book", "Other"].includes(body.materialType)) {
    errors.push({ field: "materialType", message: "Material type is invalid" });
  }

  if (body.productStatus && !["draft", "published", "archived"].includes(body.productStatus)) {
    errors.push({ field: "productStatus", message: "Product status must be draft, published, or archived" });
  }

  return errors;
};

exports.validateUpdateMaterial = (body, file) => {
  const errors = [];
  const isFree = body.isFree === "true" || body.isFree === true || body.pricingMode === "free" || Number(body.price || 0) === 0;
  const isPaid = !isFree && body.pricingMode !== "free";

  if (body.title !== undefined && !String(body.title).trim()) {
    errors.push({ field: "title", message: "Title cannot be empty" });
  }

  if (body.price !== undefined) {
    const price = Number(body.price);
    if (Number.isNaN(price) || price < 0) {
      errors.push({ field: "price", message: "Price must be a non-negative number" });
    }
    if (isPaid && price <= 0) {
      errors.push({ field: "price", message: "Paid materials must have a price greater than 0" });
    }
  }

  if (body.visibility !== undefined && !["public", "unlisted", "private"].includes(body.visibility)) {
    errors.push({ field: "visibility", message: "Visibility must be public, unlisted, or private" });
  }

  if (body.level !== undefined && !["100 Level", "200 Level", "300 Level", "400 Level", "500 Level", "PGD", "Masters", "PhD", "ND1", "ND2", "HND1", "HND2", "Other"].includes(body.level)) {
    errors.push({ field: "level", message: "Invalid level" });
  }

  if (body.previewPages !== undefined) {
    const pages = Number(body.previewPages);
    if (Number.isNaN(pages) || pages < 0) {
      errors.push({ field: "previewPages", message: "Preview pages must be a positive number" });
    }
  }

  if (body.pageCount !== undefined) {
    const pages = Number(body.pageCount);
    if (Number.isNaN(pages) || pages < 0) {
      errors.push({ field: "pageCount", message: "Page count must be a positive number" });
    }
  }

  if (body.semester && !["First Semester", "Second Semester", "Rain Semester", "Harmattan Semester", "First", "Second"].includes(body.semester)) {
    errors.push({ field: "semester", message: "Invalid semester" });
  }

  if (body.materialType && !["Lecture Note", "Textbook", "Past Question", "Assignment", "Lab Manual", "Practical", "Research Paper", "Project Guide", "Presentation Slides", "PDF", "DOCX", "PPT", "ZIP", "Video", "Book", "Other"].includes(body.materialType)) {
    errors.push({ field: "materialType", message: "Material type is invalid" });
  }

  if (body.productStatus && !["draft", "published", "archived"].includes(body.productStatus)) {
    errors.push({ field: "productStatus", message: "Product status must be draft, published, or archived" });
  }

  if (file && !file.originalname) {
    errors.push({ field: "file", message: "Uploaded material is invalid" });
  }

  return errors;
};

exports.validateWithdrawalRequest = (body) => {
  const errors = [];

  const amount = Number(body.amount);
  if (Number.isNaN(amount) || amount <= 0) {
    errors.push({ field: "amount", message: "A valid withdrawal amount is required" });
  }

  if (!body.bankName || !String(body.bankName).trim()) {
    errors.push({ field: "bankName", message: "Bank name is required" });
  }

  if (!body.accountNumber || !String(body.accountNumber).trim()) {
    errors.push({ field: "accountNumber", message: "Account number is required" });
  }

  if (!body.accountName || !String(body.accountName).trim()) {
    errors.push({ field: "accountName", message: "Account name is required" });
  }

  return errors;
};
