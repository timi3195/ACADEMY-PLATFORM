const marketplaceService = require("../services/marketplaceService");
const purchaseValidator = require("../validators/purchaseValidator");

exports.getPurchaseHistory = async (req, res) => {
  try {
    const history = await marketplaceService.getPurchaseHistory(req.user.id, req.query);
    res.json({ success: true, history });
  } catch (error) {
    console.error("Purchase history error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.initializePurchase = async (req, res) => {
  try {
    const materialId = req.params.id;
    const validationError = purchaseValidator.validateMaterialId(materialId);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const payload = await marketplaceService.initializeMarketplacePurchase(materialId, req.user);
    res.json({ success: true, data: payload });
  } catch (error) {
    console.error("Purchase initialization error:", error);
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

exports.verifyPurchase = async (req, res) => {
  try {
    const materialId = req.params.id;
    const reference = req.body.reference;
    const validationError = purchaseValidator.validatePaymentVerification(materialId, reference);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const transaction = await marketplaceService.verifyMarketplacePurchase(materialId, reference, req.user);
    res.json({ success: true, transaction });
  } catch (error) {
    console.error("Purchase verification error:", error);
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

exports.getMaterialAccess = async (req, res) => {
  try {
    const materialId = req.params.id;
    const validationError = purchaseValidator.validateMaterialId(materialId);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const access = await marketplaceService.getMaterialAccess(req.user.id, materialId);
    res.json({ success: true, access });
  } catch (error) {
    console.error("Material access error:", error);
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: error.message });
  }
};
