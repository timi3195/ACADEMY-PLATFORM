const mongoose = require("mongoose");

const objectIdValid = (id) => mongoose.Types.ObjectId.isValid(id);

exports.validateMaterialPayload = (body, file) => {
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
    errors.push({ field: "file", message: "Material file upload is required" });
  }
  if (!body.visibility || !["public", "unlisted", "private"].includes(body.visibility)) {
    errors.push({ field: "visibility", message: "Visibility must be one of public, unlisted, or private" });
  }
  if (body.isPaid === "true" || body.isPaid === true) {
    const price = Number(body.price);
    if (Number.isNaN(price) || price < 0) {
      errors.push({ field: "price", message: "A valid non-negative price is required for paid materials" });
    }
  }
  if (body.isFree === "true" || body.isFree === true) {
    if (body.isPaid === "true" || body.isPaid === true) {
      errors.push({ field: "isFree", message: "A material cannot be both free and paid" });
    }
  }
  if (body.semester && !["First", "Second"].includes(body.semester)) {
    errors.push({ field: "semester", message: "Semester must be First or Second" });
  }
  if (body.category && typeof body.category !== "string") {
    errors.push({ field: "category", message: "Category must be a string" });
  }
  if (body.materialType && typeof body.materialType !== "string") {
    errors.push({ field: "materialType", message: "Material type must be a string" });
  }

  return errors;
};

exports.validatePurchaseInitialize = (materialId) => {
  if (!materialId || !objectIdValid(materialId)) {
    return "A valid material ID is required";
  }
  return null;
};

exports.validateMaterialUpdate = (body, file) => {
  const errors = [];

  if (body.title !== undefined && !String(body.title).trim()) {
    errors.push({ field: "title", message: "If provided, title cannot be empty" });
  }

  if (body.price !== undefined) {
    const price = Number(body.price);
    if (Number.isNaN(price) || price < 0) {
      errors.push({ field: "price", message: "Price must be a non-negative number" });
    }
  }

  if (body.visibility !== undefined && !["public", "unlisted", "private"].includes(body.visibility)) {
    errors.push({ field: "visibility", message: "Visibility must be one of public, unlisted, or private" });
  }

  if (body.semester !== undefined && !["First", "Second"].includes(body.semester)) {
    errors.push({ field: "semester", message: "Semester must be First or Second" });
  }

  if (body.category !== undefined && typeof body.category !== "string") {
    errors.push({ field: "category", message: "Category must be a string" });
  }

  if (body.materialType !== undefined && typeof body.materialType !== "string") {
    errors.push({ field: "materialType", message: "Material type must be a string" });
  }

  return errors;
};

exports.validateApprovalPayload = (body) => {
  // Approval workflow removed; no validation needed.
  return null;
};
