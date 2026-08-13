const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const protect = require("../config/middleware/authMiddleware");
const optionalAuth = require("../config/middleware/optionalAuth");
const lecturerOnly = require("../config/middleware/lecturerOnly");
const adminOnly = require("../config/middleware/adminOnly");
const marketplaceController = require("../controllers/marketplaceController");

const router = express.Router();

const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "-");
    cb(null, `${timestamp}-${sanitizedFilename}`);
  }
});

const upload = multer({ storage });

// Lecturer uploads a marketplace material
router.post(
  "/materials",
  protect,
  lecturerOnly,
  upload.single("file"),
  marketplaceController.createMaterial
);

// Public marketplace listing
router.get("/materials", marketplaceController.listMaterials);
router.get("/materials/featured", marketplaceController.getFeaturedMaterials);
router.get("/materials/new", marketplaceController.getNewMaterials);
router.get("/materials/:id", optionalAuth, marketplaceController.getMaterial);

// Course / Department filters
router.get("/course/:courseId/materials", marketplaceController.getCourseMaterials);
router.get("/department/:departmentId/materials", marketplaceController.getDepartmentMaterials);

// Lecturer material management
router.put(
  "/materials/:id",
  protect,
  lecturerOnly,
  upload.single("file"),
  marketplaceController.updateMaterial
);
router.delete(
  "/materials/:id",
  protect,
  lecturerOnly,
  marketplaceController.deleteMaterial
);

router.get(
  "/lecturer/materials",
  protect,
  lecturerOnly,
  marketplaceController.getLecturerMaterials
);

// Student library
router.get("/library", protect, marketplaceController.getLibrary);

// Material purchase flow
router.post(
  "/materials/:id/purchase/initialize",
  protect,
  marketplaceController.initializePurchase
);
router.get(
  "/materials/:id/purchase/verify/:reference",
  protect,
  marketplaceController.verifyPurchase
);

// Admin moderation removed: approval workflow deprecated.

module.exports = router;
