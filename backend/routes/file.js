const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const File = require("../models/File");
const User = require("../models/User");
const protect = require("../config/middleware/authMiddleware");
const adminOnly = require("../config/middleware/adminOnly");
const materialAccessService = require("../services/materialAccessService");

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

const loadMaterial = async (identifier) => {
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    const material = await File.findById(identifier).populate('course');
    if (material) return material;
  }

  const fileByUrl = await File.findOne({ fileUrl: `/api/files/download/${identifier}` }).populate('course');
  if (fileByUrl) return fileByUrl;

  const allFiles = await File.find().populate('course');
  return allFiles.find((f) => f.fileUrl?.endsWith(identifier) || f.fileUrl?.endsWith(`-${identifier}`));
};

const resolveUser = async (req) => {
  if (!req.user || !req.user.id) return null;
  return await User.findById(req.user.id).populate('department');
};

// New view route - streams file inline after permission checks
router.get('/view/:id', protect, async (req, res) => {
  try {
    const identifier = req.params.id;
    const file = await loadMaterial(identifier);
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });

    const user = await resolveUser(req);
    const access = await materialAccessService.canViewMaterial({
      user,
      material: file,
      restrictByCourse: true
    });

    if (!access.allowed) {
      return res.status(403).json({ success: false, message: access.reason });
    }

    await materialAccessService.recordView({ material: file });

    const storageName = file.storageFilename;
    const filePath = path.join(uploadDir, storageName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: 'File missing on server' });

    const mimeType = getMimeType(storageName || file.originalName || file.title);
    res.setHeader('Content-Type', mimeType);
    if (mimeType === 'application/pdf' || mimeType.startsWith('image/') || mimeType.startsWith('video/')) {
      res.setHeader('Content-Disposition', `inline; filename="${file.originalName || file.title}"`);
    } else {
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

// Unified download route - validates user has access and records a download
router.get('/download/:id', protect, async (req, res) => {
  try {
    const identifier = req.params.id;
    const file = await loadMaterial(identifier);
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });

    const user = await resolveUser(req);
    const access = await materialAccessService.canDownloadMaterial({
      user,
      material: file,
      restrictByCourse: true
    });

    if (!access.allowed) {
      return res.status(403).json({ success: false, message: access.reason });
    }

    await materialAccessService.recordDownload({ material: file });

    const storageName = file.storageFilename;
    const filePath = path.join(uploadDir, storageName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: 'File missing on server' });

    const isPDF = (storageName || file.originalName || file.title).toLowerCase().endsWith('.pdf');
    if (isPDF) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${file.originalName || file.title}"`);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.sendFile(filePath);
    }

    return res.download(filePath, file.originalName || file.title);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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
      const courses = await Course.find({
        department: user.department._id,
        level: user.yearOfStudy
      }).select('_id');

      const allFiles = await File.find({ course: { $in: courses.map((c) => c._id) } }).populate('course');
      const accessibleFiles = await Promise.all(
        allFiles.map(async (f) => {
          const access = await materialAccessService.canViewMaterial({
            user,
            material: f,
            restrictByCourse: true
          });
          return access.allowed ? f : null;
        })
      );

      const mapped = accessibleFiles
        .filter(Boolean)
        .map((f) => ({
          _id: f._id,
          title: f.title,
          fileUrl: `/api/files/view/${f._id}`,
          isPremium: f.isPremium,
          createdAt: f.createdAt
        }));

      return res.json({ success: true, files: mapped, filterApplied: true });
    }

    // If no profile info or no matching course, return empty
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

    const processed = await Promise.all(
      files.map(async (f) => {
        const access = await materialAccessService.canViewMaterial({
          user,
          material: f,
          restrictByCourse: true
        });

        return {
          _id: f._id,
          title: f.title,
          fileUrl: `/api/files/view/${f._id}`,
          isPremium: f.isPremium,
          accessible: access.allowed,
          accessReason: access.reason,
          createdAt: f.createdAt
        };
      })
    );

    res.json({ success: true, files: processed });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Protected route - get files (requires authentication for premium content)
router.get("/", protect, getFilesHandler);

// Admin route - get all files without filtering
router.get("/admin/all", protect, adminOnly, async (req, res) => {
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