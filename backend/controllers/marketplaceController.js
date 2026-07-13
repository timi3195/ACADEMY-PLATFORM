const marketplaceService = require("../services/marketplaceService");
const marketplaceValidator = require("../validators/marketplaceValidator");

exports.createMaterial = async (req, res) => {
  try {
    const validationErrors = marketplaceValidator.validateMaterialPayload(req.body, req.file);
    if (validationErrors.length) {
      return res.status(400).json({ success: false, errors: validationErrors });
    }

    const material = await marketplaceService.createMaterial({
      user: req.user,
      body: req.body,
      file: req.file
    });

    res.status(201).json({ success: true, material });
  } catch (error) {
    console.error("Marketplace create material error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listMaterials = async (req, res) => {
  try {
    const materials = await marketplaceService.listMaterials(req.query);
    res.json({ success: true, materials });
  } catch (error) {
    console.error("Marketplace list materials error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMaterial = async (req, res) => {
  try {
    const material = await marketplaceService.getMaterialById(req.params.id);
    if (!material) {
      return res.status(404).json({ success: false, message: "Material not found" });
    }
    res.json({ success: true, material });
  } catch (error) {
    console.error("Marketplace get material error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getLecturerMaterials = async (req, res) => {
  try {
    const materials = await marketplaceService.getLecturerMaterials(req.user.id);
    res.json({ success: true, materials });
  } catch (error) {
    console.error("Marketplace lecturer materials error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getLibrary = async (req, res) => {
  try {
    const library = await marketplaceService.getLibrary(req.user.id);
    res.json({ success: true, library });
  } catch (error) {
    console.error("Marketplace get library error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.initializePurchase = async (req, res) => {
  try {
    const materialId = req.params.id;
    const validationError = marketplaceValidator.validatePurchaseInitialize(materialId);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const payload = await marketplaceService.initializePurchase(materialId, req.user);
    res.json({ success: true, data: payload });
  } catch (error) {
    console.error("Marketplace initialize purchase error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.verifyPurchase = async (req, res) => {
  try {
    const materialId = req.params.id;
    const reference = req.params.reference;

    const result = await marketplaceService.verifyPurchase(materialId, reference, req.user);
    res.json({ success: true, transaction: result });
  } catch (error) {
    console.error("Marketplace verify purchase error:", error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPendingMaterials = async (req, res) => {
  try {
    const materials = await marketplaceService.listPendingMaterials();
    res.json({ success: true, materials });
  } catch (error) {
    console.error("Marketplace pending materials error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.approveMaterial = async (req, res) => {
  try {
    const validationError = marketplaceValidator.validateApprovalPayload(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const { approved } = req.body;
    const materialId = req.params.id;
    const material = await marketplaceService.setMaterialApproval(materialId, approved);
    if (!material) {
      return res.status(404).json({ success: false, message: "Material not found" });
    }
    res.json({ success: true, material });
  } catch (error) {
    console.error("Marketplace approve material error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
