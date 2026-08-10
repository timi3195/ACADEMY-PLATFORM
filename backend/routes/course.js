const express = require("express");
const router = express.Router();
const Course = require("../models/course");
const protect = require("../config/middleware/authMiddleware");
const adminOnly = require("../config/middleware/adminOnly");

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

// GET ALL COURSES - with department/year filtering for students
router.get("/", protect, async (req, res) => {
  try {
    // If admin, return all courses
    if (req.user && req.user.role === 'admin') {
      const courses = await Course.find().populate('department');
      return res.json({
        success: true,
        courses
      });
    }

    // For students, filter by their department and year of study
    const User = require('../models/User');
    const user = await User.findById(req.user.id).populate('department');
    
    if (!user || !user.department || !user.yearOfStudy) {
      return res.json({
        success: true,
        courses: [],
        message: 'Please complete your profile with department and year of study'
      });
    }

    const { normalizeAcademicLevel } = require('../utils/academicLevels');
    const normalizedYear = normalizeAcademicLevel(user.yearOfStudy);
    const courses = await Course.find({
      department: user.department._id,
      level: normalizedYear,
      ...(user.semester ? { semester: user.semester } : {})
    }).populate('department');

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

// GET COURSE BY ID - with department/year validation for students
router.get("/:id", protect, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).populate('department');
    
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    // Admin can access any course
    if (req.user && req.user.role === 'admin') {
      return res.json({ success: true, course });
    }

    // For students, verify they have access to this course (department & year match)
    const User = require('../models/User');
    const user = await User.findById(req.user.id).populate('department');
    
    if (!user || !user.department || !user.yearOfStudy) {
      return res.status(403).json({
        success: false,
        message: 'Please complete your profile to access courses'
      });
    }

    // Check if student's department and year match the course
    if (user.department._id.toString() !== course.department._id.toString() ||
      user.yearOfStudy !== course.level ||
      (user.semester && user.semester !== course.semester)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this course. It is only available to students in the ' + 
                 course.department.name + ' department at ' + course.level + ' level.'
      });
    }

    res.json({ success: true, course });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;