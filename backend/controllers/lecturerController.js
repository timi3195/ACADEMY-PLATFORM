const lecturerService = require("../services/lecturerService");
const lecturerValidator = require("../validators/lecturerValidator");

exports.getDashboard = async (req, res) => {
  try {
    const dashboard = await lecturerService.getLecturerDashboard(req.user.id);
    res.json({ success: true, dashboard });
  } catch (error) {
    console.error("Lecturer dashboard error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

exports.getMaterials = async (req, res) => {
  try {
    const result = await lecturerService.getLecturerMaterials(req.user.id, req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Lecturer materials error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const getUploadedFiles = (req) => {
  const files = req.files || {};
  return {
    file: files.file?.[0] || req.file || null,
    coverImage: files.coverImage?.[0] || null
  };
};

exports.createMaterial = async (req, res) => {
  try {
    const { file, coverImage } = getUploadedFiles(req);
    if (!['Book', 'Textbook'].includes(req.body.materialType)) {
      return res.status(403).json({ success: false, message: "Lecturers can publish books only. Admins upload course materials." });
    }
    const errors = lecturerValidator.validateCreateMaterial(req.body, file);
    if (errors.length) {
      return res.status(400).json({ success: false, errors });
    }

    const material = await lecturerService.createLecturerMaterial({
      user: req.user,
      body: req.body,
      file,
      coverImage
    });

    res.status(201).json({ success: true, material });
  } catch (error) {
    console.error("Lecturer create material error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

exports.updateMaterial = async (req, res) => {
  try {
    const materialId = req.params.id;
    const { file, coverImage } = getUploadedFiles(req);
    if (req.body.materialType && !['Book', 'Textbook'].includes(req.body.materialType)) {
      return res.status(403).json({ success: false, message: "Lecturers can publish books only. Admins upload course materials." });
    }
    const errors = lecturerValidator.validateUpdateMaterial(req.body, file);
    if (errors.length) {
      return res.status(400).json({ success: false, errors });
    }

    const material = await lecturerService.updateLecturerMaterial({
      user: req.user,
      materialId,
      body: req.body,
      file,
      coverImage
    });

    if (!material) {
      return res.status(404).json({ success: false, message: "Material not found" });
    }

    res.json({ success: true, material });
  } catch (error) {
    console.error("Lecturer update material error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

exports.deleteMaterial = async (req, res) => {
  try {
    const materialId = req.params.id;
    const material = await lecturerService.softDeleteMaterial(materialId, req.user);
    if (!material) {
      return res.status(404).json({ success: false, message: "Material not found or not authorized" });
    }

    res.json({ success: true, message: "Material deleted successfully" });
  } catch (error) {
    console.error("Lecturer delete material error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

exports.getMaterialAnalytics = async (req, res) => {
  try {
    const materialId = req.params.id;
    const analytics = await lecturerService.getMaterialAnalytics(req.user.id, materialId);
    res.json({ success: true, analytics });
  } catch (error) {
    console.error("Lecturer material analytics error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

exports.getEarnings = async (req, res) => {
  try {
    const earnings = await lecturerService.getLecturerEarnings(req.user.id);
    res.json({ success: true, earnings });
  } catch (error) {
    console.error("Lecturer earnings error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

exports.getWithdrawalHistory = async (req, res) => {
  try {
    const withdrawals = await lecturerService.getLecturerWithdrawals(req.user.id);
    res.json({ success: true, withdrawals });
  } catch (error) {
    console.error("Lecturer withdrawal history error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

exports.requestWithdrawal = async (req, res) => {
  try {
    const errors = lecturerValidator.validateWithdrawalRequest(req.body);
    if (errors.length) {
      return res.status(400).json({ success: false, errors });
    }

    const withdrawal = await lecturerService.requestLecturerWithdrawal(req.user.id, req.body);
    res.status(201).json({ success: true, withdrawal });
  } catch (error) {
    console.error("Lecturer withdrawal request error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

exports.getSales = async (req, res) => {
  try {
    const sales = await lecturerService.getLecturerSales(req.user.id, req.query);
    res.json({ success: true, sales });
  } catch (error) {
    console.error("Lecturer sales error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

exports.getSalesExport = async (req, res) => {
  try {
    const csvContent = await lecturerService.exportLecturerSalesAsCSV(req.user.id, req.query);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="sales.csv"');
    res.send(csvContent);
  } catch (error) {
    console.error("Lecturer sales export error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};
