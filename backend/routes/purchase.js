const express = require("express");
const protect = require("../config/middleware/authMiddleware");
const purchaseController = require("../controllers/purchaseController");

const router = express.Router();

router.get("/history", protect, purchaseController.getPurchaseHistory);

router.post("/marketplace/materials/:id/purchase", protect, purchaseController.initializePurchase);
router.post("/marketplace/materials/:id/verify", protect, purchaseController.verifyPurchase);
router.get("/marketplace/materials/:id/access", protect, purchaseController.getMaterialAccess);

module.exports = router;
