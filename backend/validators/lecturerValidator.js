const mongoose = require("mongoose");

const objectIdValid = (id) => mongoose.Types.ObjectId.isValid(id);

exports.validateCreateMaterial = (body, file) => {
  const errors = [];

  if (!body.title || !body.title.trim()) {
    errors.push({ field: "title", message: "Title is required" });
  }

  if (!body.description || !body.description.trim()) {
    errors.push({ field: "description", message: "Description is required" });
  }

  if (!body.course || !objectIdValid(body.course)) {
    errors.push({ field: "course", message: "Valid course ID is required" });
  }

  if (!file) {
    errors.push({ field: "file", message: "Material PDF upload is required" });
  }

  if (body.price !== undefined) {
    const price = Number(body.price);
    if (Number.isNaN(price) || price < 0) {
      errors.push({ field: "price", message: "Price must be a non-negative number" });
    }
  }

  if (body.visibility && !["public", "unlisted", "private"].includes(body.visibility)) {
    errors.push({ field: "visibility", message: "Visibility must be public, unlisted, or private" });
  }

  if (body.level && !["ND1", "ND2", "HND1", "HND2", "Other"].includes(body.level)) {
    errors.push({ field: "level", message: "Level must be ND1, ND2, HND1, HND2, or Other" });
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

  if (body.semester && !["First", "Second"].includes(body.semester)) {
    errors.push({ field: "semester", message: "Semester must be First or Second" });
  }

  if (body.materialType && !["PDF", "DOCX", "PPT", "ZIP", "Video", "Book", "Lab Manual", "Assignment", "Past Question", "Other"].includes(body.materialType)) {
    errors.push({ field: "materialType", message: "Material type is invalid" });
  }

  if (body.productStatus && !["draft", "published", "archived"].includes(body.productStatus)) {
    errors.push({ field: "productStatus", message: "Product status must be draft, published, or archived" });
  }

  return errors;
};

exports.validateUpdateMaterial = (body, file) => {
  const errors = [];

  if (body.title !== undefined && !String(body.title).trim()) {
    errors.push({ field: "title", message: "Title cannot be empty" });
  }

  if (body.price !== undefined) {
    const price = Number(body.price);
    if (Number.isNaN(price) || price < 0) {
      errors.push({ field: "price", message: "Price must be a non-negative number" });
    }
  }

  if (body.visibility !== undefined && !["public", "unlisted", "private"].includes(body.visibility)) {
    errors.push({ field: "visibility", message: "Visibility must be public, unlisted, or private" });
  }

  if (body.level !== undefined && !["ND1", "ND2", "HND1", "HND2", "Other"].includes(body.level)) {
    errors.push({ field: "level", message: "Level must be ND1, ND2, HND1, HND2, or Other" });
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

  if (body.semester && !["First", "Second"].includes(body.semester)) {
    errors.push({ field: "semester", message: "Semester must be First or Second" });
  }

  if (body.materialType && !["PDF", "DOCX", "PPT", "ZIP", "Video", "Book", "Lab Manual", "Assignment", "Past Question", "Other"].includes(body.materialType)) {
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
