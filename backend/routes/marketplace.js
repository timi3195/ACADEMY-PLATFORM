const express = require("express");
const protect = require("../config/middleware/authMiddleware");
const optionalAuth = require("../config/middleware/optionalAuth");
const lecturerOnly = require("../config/middleware/lecturerOnly");
const marketplaceController = require("../controllers/marketplaceController");
const commerceUnavailable = require("../middleware/commerceUnavailable");

const router = express.Router();

// Lecturer uploads a marketplace material
router.post(
  "/materials",
  protect,
  lecturerOnly,
  commerceUnavailable
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
  commerceUnavailable
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
  commerceUnavailable
);
router.get(
  "/materials/:id/purchase/verify/:reference",
  protect,
  commerceUnavailable
);

// Admin moderation removed: approval workflow deprecated.

module.exports = router;
