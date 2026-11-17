const express = require("express");
const multer = require("multer");
const protect = require("../config/middleware/authMiddleware");
const lecturerOnly = require("../config/middleware/lecturerOnly");
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

// Lecturer dashboard summary
router.get("/dashboard", protect, lecturerOnly, lecturerController.getDashboard);

// Academic materials are restricted to courses assigned to the approved lecturer.
router.get("/courses", protect, lecturerOnly, lecturerController.getCourses);
router.get("/materials", protect, lecturerOnly, lecturerController.getMaterials);

// Create new material
router.post(
  "/materials",
  protect,
  lecturerOnly,
  uploadFields,
  lecturerController.createMaterial
);

// Edit existing lecturer material
router.put(
  "/materials/:id",
  protect,
  lecturerOnly,
  uploadFields,
  lecturerController.updateMaterial
);

// Soft delete lecturer material
router.delete("/materials/:id", protect, lecturerOnly, lecturerController.deleteMaterial);

// Material analytics for lecturer-owned material
router.get(
  "/materials/:id/analytics",
  protect,
  lecturerOnly,
  lecturerController.getMaterialAnalytics
);

module.exports = router;
