const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const multer = require("multer");
const protect = require("../config/middleware/authMiddleware");
const adminOnly = require("../config/middleware/adminOnly");
const extractionLimits = require("../config/curriculumExtractionLimits");
const controller = require("../controllers/curriculumImportController");

const router = express.Router();
const MIME_BY_EXTENSION = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};

const isSafeFilename = (name) =>
  typeof name === "string" &&
  name.length > 0 &&
  name.length <= 255 &&
  !/[\u0000-\u001f\u007f/\\]/.test(name) &&
  name !== "." &&
  name !== ".." &&
  path.basename(name) === name &&
  path.win32.basename(name) === name;

const prepareTempDirectory = async (req, res, next) => {
  let directory;
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "academy-curriculum-"));
    await fs.chmod(directory, 0o700);
    req.curriculumTempDirectory = directory;
    next();
  } catch {
    if (directory) {
      try {
        await fs.rm(directory, { recursive: true, force: true });
      } catch {
        return res.status(500).json({ success: false, message: "Private upload cleanup failed." });
      }
    }
    res.status(500).json({ success: false, message: "Unable to prepare a private upload location." });
  }
};

const storage = multer.diskStorage({
  destination: (req, _file, callback) => callback(null, req.curriculumTempDirectory),
  filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.upload`)
});

const upload = multer({
  storage,
  limits: {
    fileSize: extractionLimits.maxUploadBytes,
    files: 1,
    fields: 8,
    fieldSize: 2048,
    parts: 10
  },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    if (!isSafeFilename(file.originalname) || !MIME_BY_EXTENSION[extension] ||
        file.mimetype !== MIME_BY_EXTENSION[extension]) {
      const error = new Error("Invalid curriculum upload.");
      error.code = "INVALID_CURRICULUM_UPLOAD";
      return callback(error);
    }
    return callback(null, true);
  }
});

const cleanupAfterMulterError = async (req) => {
  try {
    await controller.removeTempDirectory(req);
    return true;
  } catch {
    return false;
  }
};

const handleUpload = (req, res, next) => {
  upload.single("document")(req, res, async (error) => {
    if (!error) {
      try {
        if (req.file?.path) await fs.chmod(req.file.path, 0o600);
        return next();
      } catch {
        const cleaned = await cleanupAfterMulterError(req);
        return res.status(500).json({
          success: false,
          message: cleaned ? "Private upload preparation failed." : "Private upload cleanup failed."
        });
      }
    }
    const cleaned = await cleanupAfterMulterError(req);
    if (!cleaned) {
      return res.status(500).json({ success: false, message: "Private upload cleanup failed." });
    }
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({
      success: false,
      message: status === 413 ? "The curriculum document exceeds the upload limit." : "Invalid curriculum upload."
    });
  });
};

router.use(protect, adminOnly);
router.post("/", prepareTempDirectory, handleUpload, controller.create);
router.get("/", controller.list);
router.get("/:id/document", controller.getDocument);
router.get("/:id", controller.get);
router.post("/:id/extract", controller.extract);
router.get("/:id/entries/:entryId/evidence", controller.getEntryEvidence);
router.patch("/:id/entries/:entryId", controller.updateEntry);
router.post("/:id/entries/:entryId/review", controller.reviewEntry);

module.exports = router;
