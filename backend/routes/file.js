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

// Upload file - admin only
router.post("/upload", protect, adminOnly, upload.single("file"), async (req, res) => {
  try {
    const isPremium = req.body.isPremium === 'true' || req.body.isPremium === 'on' || req.body.isPremium === true;

    // Validate course exists
    const Course = require("../models/course");
    const course = await Course.findById(req.body.course);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found. Please select a valid course.'
      });
    }

    console.log(`📤 Uploading file "${req.body.title}" to course "${course.title}" (Dept: ${course.department})`);

    // Persist metadata (store server-side filename separately)
    const created = await File.create({
      title: req.body.title,
      course: req.body.course,
      isPremium,
      fileUrl: '',
      storageFilename: req.file.filename,
      originalName: req.file.originalname,
      uploadedAt: new Date()
    });

    // Expose a safe view URL that streams through the backend by file id
    created.fileUrl = `/api/files/view/${created._id}`;
    await created.save();

    console.log(`✅ File uploaded successfully (id=${created._id}). Will be visible to students in ${course.title}`);

    res.json({
      success: true,
      file: created,
      message: `Material uploaded successfully and is now available to students in ${course.title}`
    });
  } catch (err) {
    console.error('❌ File upload error:', err.message);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// Helper: simple mime lookup for common types
const getMimeType = (filename) => {
  const ext = path.extname(filename || '').toLowerCase();
  switch (ext) {
    case '.pdf': return 'application/pdf';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.mp4': return 'video/mp4';
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.pptx': return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    default: return 'application/octet-stream';
  }
}

// New view route - streams file inline after permission checks
// Allows: Free users can view free materials, premium users can view all materials
router.get('/view/:id', protect, async (req, res) => {
  try {
    const id = req.params.id;
    const file = await File.findById(id).populate('course');
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });

    const User = require('../models/User');
    const user = req.user && req.user.id ? await User.findById(req.user.id).populate('department') : null;

    console.log(`📖 View file ${id}: isPremium=${file.isPremium}, userId=${user?._id}`);

    // Admin can view any file
    if (user && user.role === 'admin') {
      console.log(`✅ Admin viewing file ${id}`);
    } else {
      // Non-admin: check profile, department, and premium status
      if (!user || !user.department || !user.yearOfStudy) {
        return res.status(403).json({ success: false, message: 'Please complete your profile to access files' });
      }

      const course = file.course;
      if (user.department._id.toString() !== course.department._id.toString() || user.yearOfStudy !== course.level) {
        return res.status(403).json({ success: false, message: 'You do not have access to this course' });
      }

      // If file is premium, user must have active premium subscription
      if (file.isPremium) {
        const isPremium = user && ((user.plan && user.plan === 'premium') || (user.subscriptionType && user.subscriptionType === 'premium'));
        const now = new Date();
        const notExpired = !user.subscriptionExpiresAt ? false : (new Date(user.subscriptionExpiresAt) > now);
        
        if (!isPremium || !notExpired) {
          console.log(`❌ Premium file access denied: isPremium=${isPremium}, notExpired=${notExpired}`);
          return res.status(403).json({ success: false, message: 'This material requires an active premium subscription to access' });
        }
      }
      console.log(`✅ User viewing file ${id}`);
    }

    // Stream the file from storage
    const storageName = file.storageFilename;
    const filePath = path.join(uploadDir, storageName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: 'File missing on server' });

    const mimeType = getMimeType(storageName || file.originalName || file.title);
    res.setHeader('Content-Type', mimeType);
    // Inline display for PDFs and common web types
    if (mimeType === 'application/pdf' || mimeType.startsWith('image/') || mimeType.startsWith('video/')) {
      res.setHeader('Content-Disposition', `inline; filename="${file.originalName || file.title}"`);
    } else {
      // For other types allow inline viewing where supported
      res.setHeader('Content-Disposition', `inline; filename="${file.originalName || file.title}"`);
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      console.error('Stream error', err);
      res.status(500).end('Server error streaming file');
    });
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Download route by file id - only premium users or admin can download
router.get('/download/:id', protect, async (req, res) => {
  try {
    const id = req.params.id;
    const file = await File.findById(id).populate('course');
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });

    const User = require('../models/User');
    const user = req.user && req.user.id ? await User.findById(req.user.id).populate('department') : null;

    console.log(`📥 Download request for file ${id}, user ${user?._id}`);

    // Admin may always download
    if (user && user.role === 'admin') {
      console.log(`✅ Admin download approved for file ${id}`);
    } else {
      // Non-admin: require profile
      if (!user || !user.department || !user.yearOfStudy) {
        return res.status(403).json({ success: false, message: 'Please complete your profile to download files' });
      }

      // Non-admin: require course access
      const course = file.course;
      if (user.department._id.toString() !== course.department._id.toString() || user.yearOfStudy !== course.level) {
        return res.status(403).json({ success: false, message: 'You do not have access to this course' });
      }

      // Non-admin: MUST be premium to download (any file)
      const isPremium = user && ((user.plan && user.plan === 'premium') || (user.subscriptionType && user.subscriptionType === 'premium'));
      const now = new Date();
      const notExpired = !user.subscriptionExpiresAt ? false : (new Date(user.subscriptionExpiresAt) > now);
      
      if (!isPremium || !notExpired) {
        console.log(`❌ Download denied for file ${id}: isPremium=${isPremium}, notExpired=${notExpired}`);
        return res.status(403).json({ success: false, message: 'Only premium members can download materials. Upgrade your plan to download.' });
      }
      console.log(`✅ Premium user download approved for file ${id}`);
    }

    const storageName = file.storageFilename;
    const filePath = path.join(uploadDir, storageName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: 'File missing on server' });

    return res.download(filePath, file.originalName || file.title);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Protected download route - validates user has access
router.get('/download/:filename', protect, async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(uploadDir, filename);
    
    // Check if file exists on server first
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found on server'
      });
    }

    // Find the file in database
    // Try exact match first, then try fallback for files with double timestamps
    let file = await File.findOne({ fileUrl: `/api/files/download/${filename}` }).populate('course');
    
    // Fallback: if not found, try looking for files with double timestamp format
    if (!file) {
      // Try to find any file that ends with this filename (handles double timestamp case)
      const allFiles = await File.find().populate('course');
      file = allFiles.find(f => f.fileUrl?.endsWith(filename) || f.fileUrl?.endsWith(`-${filename}`));
    }
    
    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    const User = require('../models/User');
    const user = req.user && req.user.id ? await User.findById(req.user.id).populate('department') : null;
    const isPDF = filename.toLowerCase().endsWith('.pdf');

    // Admin can access any file
    if (user && user.role === 'admin') {
      // For PDFs, serve inline; for other files, force download
      if (isPDF) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="' + file.title + '"');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.sendFile(filePath);
      } else {
        return res.download(filePath, file.title);
      }
    }

    // Check if user has course access
    if (!user || !user.department || !user.yearOfStudy) {
      return res.status(403).json({
        success: false,
        message: 'Please complete your profile to access files'
      });
    }

    const course = file.course;
    if (user.department._id.toString() !== course.department._id.toString() || user.yearOfStudy !== course.level) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this course'
      });
    }

    // Check if file is premium
    if (file.isPremium) {
      const isPremium = user && ((user.plan && user.plan === 'premium') || (user.subscriptionType && user.subscriptionType === 'premium'));
      const now = new Date();
      const notExpired = !user.subscriptionExpiresAt ? false : (new Date(user.subscriptionExpiresAt) > now);
      
      if (!isPremium || !notExpired) {
        return res.status(403).json({
          success: false,
          message: 'This file requires an active premium subscription to access'
        });
      }
    }

    // For PDFs, serve inline for viewing; for other files, force download
    if (isPDF) {
      // Serve PDF inline for browser viewing
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="' + file.title + '"');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.sendFile(filePath);
    } else {
      // Force download for non-PDF files
      res.download(filePath, file.title);
    }
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
      const mapped = files.map(f => ({
        _id: f._id,
        title: f.title,
        fileUrl: `/api/files/view/${f._id}`,
        isPremium: f.isPremium,
        createdAt: f.createdAt
      }));
      return res.json({ success: true, files: mapped });
    }

    // Students only see files from their department and year
    if (user && user.department && user.yearOfStudy) {
      const Course = require('../models/course');
      
      // Get all courses matching the student's department and year
      const courseIds = await Course.find({
        department: user.department._id,
        level: user.yearOfStudy
      }).select('_id');
      
      const files = await File.find({ course: { $in: courseIds.map(c => c._id) } }).populate("course");
      const mapped = files.map(f => ({
        _id: f._id,
        title: f.title,
        fileUrl: `/api/files/view/${f._id}`,
        isPremium: f.isPremium,
        createdAt: f.createdAt
      }));
      return res.json({ success: true, files: mapped, filterApplied: true });
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
        fileUrl: `/api/files/view/${f._id}`,
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
    const mapped = files.map(f => ({
      _id: f._id,
      title: f.title,
      fileUrl: `/api/files/view/${f._id}`,
      isPremium: f.isPremium,
      createdAt: f.createdAt
    }));
    res.json({ success: true, files: mapped });
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