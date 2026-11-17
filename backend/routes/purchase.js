const express = require("express");
const protect = require("../config/middleware/authMiddleware");
const purchaseController = require("../controllers/purchaseController");
const commerceUnavailable = require("../middleware/commerceUnavailable");

const router = express.Router();

router.get("/history", protect, purchaseController.getPurchaseHistory);

router.post("/marketplace/materials/:id/purchase", protect, commerceUnavailable);
router.post("/marketplace/materials/:id/verify", protect, commerceUnavailable);
router.get("/marketplace/materials/:id/access", protect, purchaseController.getMaterialAccess);

module.exports = router;
