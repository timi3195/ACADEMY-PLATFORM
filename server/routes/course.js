const express = require("express");
const router = express.Router();
const Course = require("../models/course");
const protect = require("../config/middleware/authMiddleware");
const adminOnly = require("../config/middleware/adminOnly");

console.log("COURSE ROUTES LOADED");

// CREATE COURSE (admin only)
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const course = await Course.create(req.body);

    res.json({
      success: true,
      course
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// GET ALL COURSES
router.get("/", async (req, res) => {
  const courses = await Course.find().populate('department');

  res.json({
    success: true,
    courses
  });
});

// GET COURSE BY ID
router.get("/:id", async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).populate('department');
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }
    res.json({ success: true, course });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;