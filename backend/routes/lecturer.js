const express = require("express");
const multer = require("multer");
const protect = require("../config/middleware/authMiddleware");
const adminOnly = require("../config/middleware/adminOnly");
const lecturerController = require("../controllers/lecturerController");
const storageService = require("../services/storageService");

const router = express.Router();

const uploadDir = storageService.getUploadDir();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "-");
    cb(null, `${timestamp}-${sanitizedFilename}`);
  }
});

const upload = multer({ storage });
const uploadFields = upload.fields([
  { name: "file", maxCount: 1 },
  { name: "coverImage", maxCount: 1 }
]);

// Content management is administrator-only; this module retains its legacy filename.
router.get("/dashboard", protect, adminOnly, lecturerController.getDashboard);

// Course and material management is restricted to administrators.
router.get("/courses", protect, adminOnly, lecturerController.getCourses);
router.get("/materials", protect, adminOnly, lecturerController.getMaterials);

// Create new course material.
router.post(
  "/materials",
  protect,
  adminOnly,
  uploadFields,
  lecturerController.createMaterial
);

// Edit existing course material.
router.put(
  "/materials/:id",
  protect,
  adminOnly,
  uploadFields,
  lecturerController.updateMaterial
);

// Soft-delete course material.
router.delete("/materials/:id", protect, adminOnly, lecturerController.deleteMaterial);

// Material analytics for administrator-managed material.
router.get(
  "/materials/:id/analytics",
  protect,
  adminOnly,
  lecturerController.getMaterialAnalytics
);

router.use("/curricula", require("./curriculumImport"));

module.exports = router;
