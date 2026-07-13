const mongoose = require("mongoose");

const objectIdValid = (id) => mongoose.Types.ObjectId.isValid(id);

exports.validateMaterialId = (materialId) => {
  if (!materialId || !objectIdValid(materialId)) {
    return "A valid material ID is required";
  }
  return null;
};

exports.validatePaymentVerification = (materialId, reference) => {
  if (!materialId || !objectIdValid(materialId)) {
    return "A valid material ID is required";
  }
  if (!reference || typeof reference !== "string") {
    return "A valid payment reference is required";
  }
  return null;
};
