const lecturerService = require("../services/lecturerService");
const lecturerValidator = require("../validators/lecturerValidator");
const serializeAcademicMaterial = require("../utils/academicMaterialSerializer");
const { unlink } = require("node:fs/promises");

const cleanupUploadedFiles = async (req) => {
  const files = Object.values(req.files || {}).flat();
  await Promise.all(files.map((file) => unlink(file.path).catch(() => {})));
};

exports.getDashboard = async (req, res) => {
  try {
    const dashboard = await lecturerService.getLecturerDashboard(req.user.id);
    res.json({ success: true, dashboard });
  } catch (error) {
    console.error("Lecturer dashboard error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

exports.getCourses = async (req, res) => {
  try {
    const courses = await lecturerService.getLecturerCourses(req.user.id);
    res.json({ success: true, courses });
  } catch (error) {
    console.error("Lecturer courses error:", error);
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
    const errors = lecturerValidator.validateCreateMaterial(req.body, file);
    if (errors.length) {
      await cleanupUploadedFiles(req);
      return res.status(400).json({ success: false, errors });
    }

    const material = await lecturerService.createLecturerMaterial({
      user: req.user,
      body: req.body,
      file,
      coverImage
    });
    res.status(201).json({ success: true, material: serializeAcademicMaterial(material) });
  } catch (error) {
    await cleanupUploadedFiles(req);
    console.error("Lecturer create material error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

exports.updateMaterial = async (req, res) => {
  try {
    const { file, coverImage } = getUploadedFiles(req);
    const errors = lecturerValidator.validateUpdateMaterial(req.body, file);
    if (errors.length) {
      await cleanupUploadedFiles(req);
      return res.status(400).json({ success: false, errors });
    }

    const material = await lecturerService.updateLecturerMaterial({
      user: req.user,
      materialId: req.params.id,
      body: req.body,
      file,
      coverImage
    });
    if (!material) return res.status(404).json({ success: false, message: "Material not found" });
    res.json({ success: true, material: serializeAcademicMaterial(material) });
  } catch (error) {
    await cleanupUploadedFiles(req);
    console.error("Lecturer update material error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

exports.deleteMaterial = async (req, res) => {
  try {
    const material = await lecturerService.softDeleteMaterial(req.params.id, req.user);
    if (!material) return res.status(404).json({ success: false, message: "Material not found or not authorized" });
    res.json({ success: true, message: "Material deleted successfully" });
  } catch (error) {
    console.error("Lecturer material delete error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

exports.getMaterialAnalytics = async (req, res) => {
  try {
    const analytics = await lecturerService.getMaterialAnalytics(req.user.id, req.params.id);
    res.json({ success: true, analytics });
  } catch (error) {
    console.error("Lecturer material analytics error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};
