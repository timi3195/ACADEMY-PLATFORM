const express = require("express");
const router = express.Router();
const Course = require("../models/course");
const User = require("../models/User");
const protect = require("../config/middleware/authMiddleware");
const adminOnly = require("../config/middleware/adminOnly");
const {
  canAccessCourse,
  getAccessibleCourseFilter
} = require("../services/courseMembershipService");

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

// GET courses the authenticated user is authorized to access.
router.get("/", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({ success: false, message: "Authenticated user not found." });
    }

    const courses = await Course.find(getAccessibleCourseFilter(user)).populate('department');

    res.json({
      success: true,
      courses
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// GET ALL COURSES (without filtering - for public/admin use)
router.get("/all", async (req, res) => {
  const courses = await Course.find().populate('department');

  res.json({
    success: true,
    courses
  });
});

// GET COURSE BY ID - requires explicit course access.
router.get("/:id", protect, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).populate('department');
    
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const user = await User.findById(req.user.id);
    if (!canAccessCourse(user, course)) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this course."
      });
    }

    res.json({ success: true, course });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;