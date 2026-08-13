const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const protect = require("../config/middleware/authMiddleware");
const lecturerOnly = require("../config/middleware/lecturerOnly");
const lecturerController = require("../controllers/lecturerController");

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
const uploadFields = upload.fields([
  { name: "file", maxCount: 1 },
  { name: "coverImage", maxCount: 1 }
]);

// Lecturer dashboard summary
router.get("/dashboard", protect, lecturerOnly, lecturerController.getDashboard);

// Lecturer-owned library of marketplace materials
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

// Lecturer earnings summary
router.get("/earnings", protect, lecturerOnly, lecturerController.getEarnings);

// Lecturer sales list
router.get("/sales", protect, lecturerOnly, lecturerController.getSales);

// Lecturer sales export (CSV)
router.get("/sales/export/csv", protect, lecturerOnly, lecturerController.getSalesExport);

// Lecturer withdrawal history
router.get("/withdrawals", protect, lecturerOnly, lecturerController.getWithdrawalHistory);

// Create withdrawal request
router.post("/withdraw", protect, lecturerOnly, lecturerController.requestWithdrawal);

// Lecturer payment settings
router.get("/payment/settings", protect, lecturerOnly, lecturerController.getPaymentSettings);
router.post("/payment/settings", protect, lecturerOnly, lecturerController.updatePaymentSettings);
router.get("/payment/banks", protect, lecturerOnly, lecturerController.getAvailableBanks);

module.exports = router;
