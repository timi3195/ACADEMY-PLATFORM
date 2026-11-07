const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const File = require("../models/File");
const PastQuestionPaper = require("../models/PastQuestionPaper");
const StudentNote = require("../models/StudentNote");
const User = require("../models/User");
const protect = require("../config/middleware/authMiddleware");
const adminOnly = require("../config/middleware/adminOnly");
const materialAccessService = require("../services/materialAccessService");
const storageService = require("../services/storageService");

const uploadDir = storageService.getUploadDir();
const legacyUploadsRouter = express.Router();

const isSafeUploadFilename = (filename) =>
  typeof filename === "string" &&
  filename.length > 0 &&
  filename.length <= 255 &&
  filename !== "." &&
  filename !== ".." &&
  !filename.includes("..") &&
  !/[\0-\x1f<>:"|?*]/.test(filename) &&
  !filename.includes("/") &&
  !filename.includes("\\") &&
  path.basename(filename) === filename &&
  path.win32.basename(filename) === filename;

const getUploadMimeType = (filename) => {
  const extension = path.extname(filename).toLowerCase();
  return ({
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".txt": "text/plain"
  })[extension] || "application/octet-stream";
};

const streamLegacyUpload = (req, res, filename, isPublic) => {
  const localPath = storageService.resolveStoragePath(filename);
  if (!localPath) return res.status(404).json({ success: false, message: "File not found" });

  try {
    if (!fs.statSync(localPath).isFile()) {
      return res.status(404).json({ success: false, message: "File not found" });
    }
  } catch {
    return res.status(404).json({ success: false, message: "File not found" });
  }

  const safeDownloadName = filename.replace(/["\r\n]/g, "_");
  res.setHeader("Content-Type", getUploadMimeType(filename));
  res.setHeader("Content-Disposition", `inline; filename="${safeDownloadName}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", isPublic ? "public, max-age=3600" : "private, no-store");

  const stream = fs.createReadStream(localPath);
  stream.on("error", () => {
    if (res.headersSent) return res.destroy();
    return res.status(404).json({ success: false, message: "File not found" });
  });
  return stream.pipe(res);
};

legacyUploadsRouter.get("/:filename", async (req, res) => {
  const { filename } = req.params;
  if (!isSafeUploadFilename(filename)) {
    return res.status(404).json({ success: false, message: "File not found" });
  }

  try {
    const [materialReference, legacyMaterialReference, pastQuestionReference, noteReference] = await Promise.all([
      File.exists({ storageFilename: filename }),
      File.exists({ fileUrl: `/uploads/${filename}` }),
      PastQuestionPaper.exists({ storageFilename: filename }),
      StudentNote.exists({ fileName: filename })
    ]);

    const extension = path.extname(filename).toLowerCase();
    const isImage = [".gif", ".jpeg", ".jpg", ".png"].includes(extension);
    if (!materialReference && !legacyMaterialReference && !pastQuestionReference && !noteReference && isImage) {
      const publicCover = await File.findOne({
        coverImageFilename: filename,
        visibility: "public",
        productStatus: "published",
        status: "published",
        approved: true,
        hidden: { $ne: true },
        isDeleted: { $ne: true }
      });
      if (publicCover) return streamLegacyUpload(req, res, filename, true);
    }

    return protect(req, res, async () => {
      try {
        const note = await StudentNote.findOne({ fileName: filename, user: req.user.id });
        if (!note) return res.status(404).json({ success: false, message: "File not found" });
        return streamLegacyUpload(req, res, filename, false);
      } catch (error) {
        console.error("Legacy upload access failed:", error.message);
        return res.status(500).json({ success: false, message: "Unable to access file" });
      }
    });
  } catch (error) {
    console.error("Legacy upload lookup failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to access file" });
  }
});

legacyUploadsRouter.use((req, res) =>
  res.status(404).json({ success: false, message: "File not found" })
);

// Storage config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },

  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt', '.png', '.jpg', '.jpeg', '.gif'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error('Unsupported file type'));
  }
});

// Upload file - admin only
router.post("/upload", protect, adminOnly, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please select a file to upload.' });
    }

    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const courseId = typeof req.body.course === 'string' ? req.body.course.trim() : '';

    if (!title || !courseId) {
      return res.status(400).json({ success: false, message: 'Title and course are required.' });
    }

    // Validate course exists
    const Course = require("../models/course");
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found. Please select a valid course.'
      });
    }

    const fileId = new mongoose.Types.ObjectId();
    const storageData = await storageService.uploadUploadedFile({ file: req.file, materialId: fileId });
    // Persist metadata only after persistent storage confirms the upload.
    const created = await File.create({
      _id: fileId,
      title,
      description: req.body.description || "",
      course: course.title,
      department: course.department?.toString?.() || course.department,
      semester: req.body.semester || course.semester,
      level: req.body.level || course.level,
      materialType: "Lecture Note",
      category: "Lecture Notes",
      visibility: "public",
      productStatus: "published",
      status: "published",
      approved: true,
      hidden: false,
      isDeleted: false,
      isPremium: false,
      fileUrl: '',
      ...storageData,
      originalFilename: req.file.originalname,
      originalName: req.file.originalname,
      uploadedAt: new Date()
    });

      if (created.department) {
        const department = await require("../models/Department").findById(created.department).select("name").lean();
        if (department) created.department = department.name;
      }

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
      message: 'Unable to upload file.'
    });
  }
});

// Upload an image/PDF past-question paper - admin only
router.post("/past-questions/upload", protect, adminOnly, upload.single("file"), async (req, res) => {
  try {
    const { title, course, level, semester, examinationYear } = req.body;
    if (!title || !course || !level || !semester || !examinationYear || !req.file) {
      return res.status(400).json({ success: false, message: "Title, course, level, semester, examination year, and file are required." });
    }

    const courseDoc = await require("../models/course").findById(course).lean();
    if (!courseDoc) return res.status(404).json({ success: false, message: "Course not found." });

    const paperId = new mongoose.Types.ObjectId();
    const storageData = await storageService.uploadUploadedFile({ file: req.file, materialId: paperId, kind: 'past-questions' });
    const paper = await PastQuestionPaper.create({
      _id: paperId,
      title: title.trim(),
      course: courseDoc._id,
      department: courseDoc.department,
      level,
      semester,
      examinationYear: String(examinationYear),
      fileUrl: `/api/files/past-questions/${Date.now()}`,
      ...storageData,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      uploadedBy: req.user.id
    });

    paper.fileUrl = `/api/files/past-questions/${paper._id}`;
    await paper.save();
    res.status(201).json({ success: true, paper });
  } catch (error) {
    console.error("Past question paper upload error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: "Unable to upload past question paper." });
  }
});

router.get("/past-questions", protect, async (req, res) => {
  const User = require("../models/User");
  const Course = require("../models/course");
  const user = await User.findById(req.user.id).lean();
  const filters = {};
  if (req.query.course) filters.course = req.query.course;
  if (req.query.level) filters.level = req.query.level;
  if (req.query.semester) filters.semester = req.query.semester;
  if (user?.role !== "admin") {
    if (!user?.department || !user?.yearOfStudy || !user?.semester) {
      return res.json({ success: true, papers: [], message: "Complete your department, academic level, and semester profile first." });
    }
    const courses = await Course.find({ department: user.department, level: user.yearOfStudy, semester: user.semester }).select("_id");
    filters.course = { $in: courses.map((course) => course._id) };
    filters.level = user.yearOfStudy;
    filters.semester = user.semester;
  }
  const papers = await PastQuestionPaper.find(filters).populate("course", "title code").sort({ examinationYear: -1 }).lean();
  res.json({ success: true, papers });
});

router.get("/past-questions/:id", protect, async (req, res) => {
  try {
    const paper = await PastQuestionPaper.findById(req.params.id);
    if (!paper) return res.status(404).json({ success: false, message: "Past question paper not found." });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ success: false, message: "Not authorized." });

    if (user.role !== "admin") {
      const { normalizeAcademicLevel } = require("../utils/academicLevels");
      const normalizeSemester = (semester) => String(semester || "").toLowerCase().replace(/\s*semester\s*/g, "").trim();
      const userDepartment = user.department?._id || user.department;
      if (!userDepartment ||
          String(userDepartment) !== String(paper.department) ||
          normalizeAcademicLevel(user.yearOfStudy) !== normalizeAcademicLevel(paper.level) ||
          normalizeSemester(user.semester) !== normalizeSemester(paper.semester)) {
        return res.status(403).json({ success: false, message: "You do not have access to this past question paper." });
      }
    }

    const stream = await storageService.getObjectReadStream(paper);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type(paper.mimeType);
    stream.pipe(res);
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.statusCode === 404 ? "Past question file is unavailable." : "Storage unavailable." });
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
    const material = await File.findById(identifier);
    if (material) {
      if (typeof material.populate === 'function') {
        await material.populate('course');
      }
      return material;
    }
  }

  const fileByUrlRecord = await File.findOne({ fileUrl: `/api/files/download/${identifier}` });
  if (fileByUrlRecord) {
    if (typeof fileByUrlRecord.populate === 'function') {
      await fileByUrlRecord.populate('course');
    }
    return fileByUrlRecord;
  }

  const allFiles = await File.find();
  await Promise.all(allFiles.map(async (file) => {
    if (file && typeof file.populate === 'function' && file.course) {
      await file.populate('course').catch(() => {});
    }
  }));
  return allFiles.find((f) => f.fileUrl?.endsWith(identifier) || f.fileUrl?.endsWith(`-${identifier}`));
};

const resolveUser = async (req) => {
  if (!req.user || !req.user.id) return null;
  const rawUserId = String(req.user.id);
  if (!mongoose.Types.ObjectId.isValid(rawUserId)) return null;
  const userRecord = await User.findById(rawUserId);
  if (!userRecord) return null;
  if (typeof userRecord.populate === 'function') {
    return await userRecord.populate('department');
  }
  return userRecord;
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

    const mimeType = getMimeType(storageName || file.originalName || file.title);
    res.setHeader('Content-Type', mimeType);
    if (mimeType === 'application/pdf' || mimeType.startsWith('image/') || mimeType.startsWith('video/')) {
      res.setHeader('Content-Disposition', `inline; filename="${file.originalName || file.title}"`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${file.originalName || file.title}"`);
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const stream = await storageService.getObjectReadStream(file);
    stream.on('error', (err) => {
      console.error('Stream error', err);
      if (res.headersSent) return res.destroy();
      return res.status(500).json({ success: false, message: 'Unable to stream file.' });
    });
    stream.pipe(res);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.statusCode === 404 ? 'File not found' : 'Unable to access file'
    });
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

    const isPDF = (storageName || file.originalName || file.title).toLowerCase().endsWith('.pdf');
    if (isPDF) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${file.originalName || file.title}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const stream = await storageService.getObjectReadStream(file); return stream.pipe(res);
    }

    res.setHeader('Content-Type', file.mimeType || getMimeType(storageName || file.originalName || file.title));
    res.setHeader('Content-Disposition', `attachment; filename="${file.originalName || file.originalFilename || file.title}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return (await storageService.getObjectReadStream(file)).pipe(res);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.statusCode === 404 ? 'File not found' : 'Unable to access file'
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
      const files = await File.find();
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
      const { normalizeAcademicLevel } = require('../utils/academicLevels');
      const normalizedYear = normalizeAcademicLevel(user.yearOfStudy);
      const courses = await Course.find({
        department: user.department._id,
        level: normalizedYear
      }).select('_id');

      const courseRecords = await Course.find({
        department: user.department._id,
        level: normalizedYear
      }).select('_id title code');
      const courseValues = courseRecords.flatMap((course) => [course._id.toString(), course.title, course.code]);
      const allFiles = await File.find({ course: { $in: courseValues } });
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
      const { normalizeAcademicLevel } = require('../utils/academicLevels');
      const userLevel = normalizeAcademicLevel(user.yearOfStudy);
      const courseLevel = normalizeAcademicLevel(course.level);
      if (!user || !user.department || user.department._id.toString() !== course.department._id.toString() || userLevel !== courseLevel) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this course materials'
        });
      }
    }

    const files = await File.find({ course: { $in: [courseId, course.title, course.code] } });

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

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, message: 'File exceeds the maximum allowed size.' });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ success: false, message: 'Unexpected file field.' });
    }
    return res.status(400).json({ success: false, message: error.message || 'Upload failed.' });
  }

  if (error && error.message) {
    return res.status(400).json({ success: false, message: error.message });
  }

  return next(error);
});

module.exports = router;
module.exports.router = router;
module.exports.legacyUploadsRouter = legacyUploadsRouter;
module.exports.getFilesHandler = getFilesHandler;
