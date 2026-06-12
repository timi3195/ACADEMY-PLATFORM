const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const File = require("../models/File");
const protect = require("../config/middleware/authMiddleware");
const adminOnly = require("../config/middleware/adminOnly");

console.log("🔥 FILE ROUTES LOADED");

const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },

  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// Upload file
router.post("/upload", protect, adminOnly, upload.single("file"), async (req, res) => {
  try {
    const isPremium = req.body.isPremium === 'true' || req.body.isPremium === 'on' || req.body.isPremium === true;

    const newFile = await File.create({
      title: req.body.title,
      course: req.body.course,
      isPremium,
      fileUrl: `/uploads/${req.file.filename}`
    });

    res.json({
      success: true,
      file: newFile
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// Get files handler - with department/year filtering for students
const getFilesHandler = async (req, res) => {
  try {
    const User = require('../models/User');
    const user = req.user && req.user.id ? await User.findById(req.user.id).populate('department') : null;

    // Admin sees all files
    if (user && user.role === 'admin') {
      const files = await File.find().populate("course");
      return res.json({
        success: true,
        files
      });
    }

    // Students only see files from their department and year
    if (user && user.department && user.yearOfStudy) {
      const Course = require('../models/course');
      
      // Get all courses matching the student's department and year
      const courseIds = await Course.find({
        department: user.department._id,
        level: user.yearOfStudy
      }).select('_id');
      
      const files = await File.find({
        course: { $in: courseIds.map(c => c._id) }
      }).populate("course");

      return res.json({
        success: true,
        files,
        filterApplied: true
      });
    }

    // If no profile info, return empty
    res.json({
      success: true,
      files: [],
      message: 'Please complete your profile'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

// Get files for a specific course - with department/year validation
router.get('/course/:courseId', protect, async (req, res) => {
  try {
    const courseId = req.params.courseId;
    const Course = require('../models/course');
    const User = require('../models/User');
    
    const course = await Course.findById(courseId).populate('department');
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    const user = req.user && req.user.id ? await User.findById(req.user.id).populate('department') : null;

    // Admin can access any course materials
    if (!(user && user.role === 'admin')) {
      // Students can only access materials from their own department and year
      if (!user || !user.department || user.department._id.toString() !== course.department._id.toString() || user.yearOfStudy !== course.level) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this course materials'
        });
      }
    }

    const files = await File.find({ course: courseId }).populate('course');
    const now = new Date();

    const processed = files.map(f => {
      let accessible = true;
      if (f.isPremium) {
        if (user && user.role === 'admin') {
          accessible = true;
        } else {
          const isPremium = user && ((user.plan && user.plan === 'premium') || (user.subscriptionType && user.subscriptionType === 'premium'));
          const notExpired = !user || !user.subscriptionExpiresAt ? true : (new Date(user.subscriptionExpiresAt) > now);
          accessible = !!(isPremium && notExpired);
        }
      }
      return {
        _id: f._id,
        title: f.title,
        fileUrl: f.fileUrl,
        isPremium: f.isPremium,
        accessible,
        createdAt: f.createdAt
      };
    });

    res.json({ success: true, files: processed });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Protected route - get files (requires authentication for premium content)
router.get("/", protect, getFilesHandler);
router.get("", protect, getFilesHandler);

// Admin route - get all files without filtering
router.get("/admin/all", protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can view all files'
      });
    }
    
    const files = await File.find().populate("course");
    res.json({
      success: true,
      files
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = {
  router,
  getFilesHandler
};