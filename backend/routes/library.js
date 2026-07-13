const express = require("express");
const protect = require("../config/middleware/authMiddleware");
const libraryController = require("../controllers/libraryController");

const router = express.Router();

router.get("/", protect, libraryController.getLibrary);
router.get("/:id", protect, libraryController.getLibraryItem);

module.exports = router;
