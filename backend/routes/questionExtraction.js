const crypto = require("crypto");
const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const QuestionExtraction = require("../models/QuestionExtraction");
const Course = require("../models/course");
const PastQuestionPaper = require("../models/PastQuestionPaper");
const User = require("../models/User");
const protect = require("../config/middleware/authMiddleware");
const { getCourseAccess } = require("../services/questionAccessService");
const { isNonAiModeEnabled } = require("../services/cbtMode");
const storageService = require("../services/storageService");
const imageValidation = require("../services/questionImageValidationService");
const { getOcrPages } = require("../services/questionExtractionProcessingService");
const questionExtractionReviewService = require("../services/questionExtractionReviewService");
const questionMarkingService = require("../services/questionMarkingService");

const router = express.Router();
const MAX_RETRIES = 5;
const MAX_ACTIVE_UPLOADS = 2;
const ACTIVE_UPLOADS = { count: 0 };
const configuredDailyLimit = Number(process.env.QUESTION_EXTRACTION_DAILY_BATCH_LIMIT);
const MAX_DAILY_BATCHES = Number.isInteger(configuredDailyLimit) && configuredDailyLimit > 0 && configuredDailyLimit <= 100
  ? configuredDailyLimit
  : 10;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: imageValidation.MAX_IMAGE_BYTES,
    files: imageValidation.MAX_IMAGE_COUNT,
    fields: 8,
    fieldSize: 1024
  }
});

const replyError = (res, error, fallback = "Unable to process question extraction request.") => {
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  if (status >= 500) console.error("Question extraction API error:", error?.message || "Unexpected failure");
  return res.status(status).json({
    success: false,
    message: status >= 500 ? fallback : error.message
  });
};

const getApprovedQuestionMarking = (questionId, userId) =>
  isNonAiModeEnabled()
    ? questionMarkingService.createAdminAuthoredVersion(questionId)
    : questionMarkingService.generateForQuestion(questionId, userId);

const requireUploader = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select("role").lean();
    if (!user || user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Administrator access is required." });
    }
    req.extractionUser = user;
    return next();
  } catch (error) {
    console.error("Question extraction authorization lookup failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to verify extraction permissions." });
  }
};

const uploadImages = (req, res, next) => {
  if (ACTIVE_UPLOADS.count >= MAX_ACTIVE_UPLOADS) {
    return res.status(429).json({ success: false, message: "Image upload capacity is busy. Please retry shortly." });
  }
  ACTIVE_UPLOADS.count += 1;
  upload.array("images", imageValidation.MAX_IMAGE_COUNT)(req, res, (error) => {
    ACTIVE_UPLOADS.count -= 1;
    if (!error) return next();
    const statusCode = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(statusCode).json({
      success: false,
      message: statusCode === 413 ? "An image exceeds the upload size limit." : "Invalid image upload request."
    });
  });
};

const checkDailyUploadLimit = async (req, res, next) => {
  try {
    const dailyStart = new Date();
    dailyStart.setUTCHours(0, 0, 0, 0);
    const dailyCount = await QuestionExtraction.countDocuments({
      uploadedBy: req.user.id,
      createdAt: { $gte: dailyStart }
    });
    if (dailyCount >= MAX_DAILY_BATCHES) {
      return res.status(429).json({ success: false, message: "Daily image extraction upload limit reached." });
    }
    return next();
  } catch (error) {
    console.error("Question extraction daily limit lookup failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to verify the daily upload limit." });
  }
};

const safeId = (value) => mongoose.Types.ObjectId.isValid(value);
const idOf = (value) => String(value?._id || value || "");

const toImageView = (batch, image) => ({
  id: idOf(image._id),
  originalName: image.originalName,
  mimeType: image.mimeType,
  size: image.size,
  width: image.width,
  height: image.height,
  ocrStatus: image.ocrStatus,
  ocrConfidence: image.ocrConfidence,
  previewUrl: `/api/question-extractions/${batch.batchId}/images/${idOf(image._id)}`
});

const toSummary = (batch) => ({
  batchId: batch.batchId,
  course: batch.course,
  department: batch.department,
  academicLevel: batch.academicLevel,
  semester: batch.semester,
  academicSession: batch.academicSession,
  sourceExamYear: batch.sourceExamYear,
  sourcePaper: idOf(batch.sourcePaper) || null,
  sourcePaperMetadata: batch.sourcePaperMetadata || null,
  status: batch.status,
  processingStage: batch.processingStage,
  imageCount: batch.images?.length || 0,
  questionCount: batch.drafts?.length || 0,
  retryCount: batch.retryCount,
  processingAttemptCount: batch.processingAttemptCount || 0,
  nextAttemptAt: batch.nextAttemptAt || null,
  processingRetryAfter: batch.processingLockUntil || null,
  processingErrors: batch.processingErrors || [],
  reviewStatus: batch.reviewStatus || "pending",
  approvedDraftCount: (batch.drafts || []).filter((draft) => draft.reviewStatus === "approved").length,
  rejectedDraftCount: (batch.drafts || []).filter((draft) => draft.reviewStatus === "rejected").length,
  createdAt: batch.createdAt,
  updatedAt: batch.updatedAt
});

const toBatchView = (batch) => ({
  ...toSummary(batch),
  images: (batch.images || []).map((image) => toImageView(batch, image)),
  ocrText: batch.ocrText || "",
  drafts: batch.drafts || [],
  ocrProvider: batch.ocrProvider,
  ocrVersion: batch.ocrVersion,
  aiProvider: batch.aiProvider,
  aiModel: batch.aiModel,
  structuringWarnings: batch.structuringWarnings || [],
  reviewStatus: batch.reviewStatus
});

const authorizeBatch = async (req, res, batchId) => {
  if (typeof batchId !== "string" || batchId.length > 64) {
    res.status(404).json({ success: false, message: "Extraction batch not found." });
    return null;
  }
  const batch = await QuestionExtraction.findOne({ batchId });
  if (!batch) {
    res.status(404).json({ success: false, message: "Extraction batch not found." });
    return null;
  }
  const access = await getCourseAccess(req.user.id, batch.course);
  if (!access.allowed || !access.manager) {
    res.status(403).json({ success: false, message: "You are no longer authorized for this extraction course." });
    return null;
  }
  return batch;
};

const persistDraftMarkingStatus = async (batchId, draftId, marking) => {
  const result = await QuestionExtraction.updateOne({
    batchId,
    drafts: { $elemMatch: { _id: draftId, reviewStatus: "approved" } }
  }, {
    $set: {
      "drafts.$.markingStatus": marking.status,
      "drafts.$.markingVersion": marking.version?._id || null
    }
  }, { runValidators: true });
  if (result.matchedCount !== 1) {
    throw new Error("The approved question's marking status could not be saved.");
  }
};

router.use(protect, requireUploader);

router.get("/limits", (req, res) => res.json({
  success: true,
  limits: {
    maxImages: imageValidation.MAX_IMAGE_COUNT,
    maxImageBytes: imageValidation.MAX_IMAGE_BYTES,
    maxBatchBytes: imageValidation.MAX_BATCH_BYTES,
    maxImagePixels: imageValidation.MAX_IMAGE_PIXELS,
    maxBatchPixels: imageValidation.MAX_BATCH_PIXELS
  }
}));

router.get("/courses", async (req, res) => {
  try {
    const courses = await Course.find({})
      .select("_id title code department level semester")
      .sort({ title: 1 })
      .lean();
    return res.json({ success: true, courses });
  } catch (error) {
    console.error("Authorized extraction course lookup failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load authorized courses." });
  }
});

router.get("/source-papers", async (req, res) => {
  try {
    const courseId = typeof req.query.courseId === "string" ? req.query.courseId : "";
    if (!safeId(courseId)) {
      return res.status(400).json({ success: false, message: "A valid course ID is required." });
    }

    const access = await getCourseAccess(req.user.id, courseId);
    if (!access.allowed || !access.manager) {
      return res.status(access.statusCode || 403).json({
        success: false,
        message: access.message || "Course upload access is required."
      });
    }

    const papers = await PastQuestionPaper.find({
      course: access.course._id,
      department: access.course.department,
      level: access.course.level,
      semester: access.course.semester
    })
      .select("_id title examinationYear level semester")
      .sort({ examinationYear: -1, title: 1 })
      .lean();

    return res.json({
      success: true,
      papers: papers.map((paper) => ({
        _id: paper._id,
        title: paper.title,
        examinationYear: paper.examinationYear,
        level: paper.level,
        semester: paper.semester
      }))
    });
  } catch (error) {
    console.error("Authorized extraction source-paper lookup failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load source papers." });
  }
});

router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));
    const filter = {};
    if (req.query.status && ["uploaded", "queued", "processing", "extracted", "needs_review", "partially_failed", "failed", "approved"].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const batches = await QuestionExtraction.find(filter)
      .select("batchId course department academicLevel semester academicSession sourceExamYear sourcePaper sourcePaperMetadata status processingStage images drafts retryCount processingAttemptCount nextAttemptAt processingLockUntil processingErrors createdAt updatedAt")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    return res.json({ success: true, batches: batches.map(toSummary), page, limit });
  } catch (error) {
    console.error("Extraction batch list lookup failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load extraction batches." });
  }
});

router.post("/", checkDailyUploadLimit, uploadImages, async (req, res) => {
  let storedImages = [];
  let batchPersisted = false;
  try {
    const files = req.files || [];
    imageValidation.validateBatch(files);
    const courseId = typeof req.body.courseId === "string" ? req.body.courseId.trim() : "";
    if (!safeId(courseId)) return res.status(400).json({ success: false, message: "A valid course is required." });

    const academicSession = typeof req.body.academicSession === "string" ? req.body.academicSession.trim() : "";
    if (!/^\d{4}(?:[/-]\d{4})?$/.test(academicSession)) {
      return res.status(400).json({ success: false, message: "Academic session must be a year or year range, such as 2025/2026." });
    }
    const sourceExamYear = typeof req.body.sourceExamYear === "string" ? req.body.sourceExamYear.trim() : "";
    if (sourceExamYear && !/^\d{4}$/.test(sourceExamYear)) {
      return res.status(400).json({ success: false, message: "Source examination year must be a four-digit year." });
    }
    if (req.body.sourcePaperId !== undefined &&
        typeof req.body.sourcePaperId !== "string") {
      return res.status(400).json({ success: false, message: "Source paper ID must be a string." });
    }
    const sourcePaperId = typeof req.body.sourcePaperId === "string"
      ? req.body.sourcePaperId.trim()
      : "";
    if (sourcePaperId && !safeId(sourcePaperId)) {
      return res.status(400).json({ success: false, message: "Invalid source paper ID." });
    }

    const access = await getCourseAccess(req.user.id, courseId);
    if (!access.allowed || !access.manager) {
      return res.status(access.statusCode || 403).json({ success: false, message: access.message || "Course upload access is required." });
    }

    let sourcePaper = null;
    let sourcePaperMetadata;
    let resolvedSourceExamYear = sourceExamYear;
    if (sourcePaperId) {
      sourcePaper = await PastQuestionPaper.findById(sourcePaperId);
      if (!sourcePaper) {
        return res.status(404).json({ success: false, message: "Source past-question paper not found." });
      }
      if (idOf(sourcePaper.course) !== idOf(access.course._id) ||
          idOf(sourcePaper.department) !== idOf(access.course.department) ||
          sourcePaper.level !== access.course.level ||
          sourcePaper.semester !== access.course.semester) {
        return res.status(400).json({
          success: false,
          message: "The source paper must belong to the selected course, department, level, and semester."
        });
      }
      if (sourceExamYear && sourceExamYear !== String(sourcePaper.examinationYear)) {
        return res.status(400).json({
          success: false,
          message: "Source examination year must match the selected past-question paper."
        });
      }
      resolvedSourceExamYear = String(sourcePaper.examinationYear);
      sourcePaperMetadata = {
        title: sourcePaper.title,
        examinationYear: String(sourcePaper.examinationYear),
        level: sourcePaper.level,
        semester: sourcePaper.semester
      };
    }

    const validatedImages = [];
    for (const file of files) {
      const validated = await imageValidation.validateImage(file);
      validatedImages.push({ file, validated });
    }
    imageValidation.validateBatchPixels(validatedImages.map(({ validated }) => validated));

    const batchObjectId = new mongoose.Types.ObjectId();
    const batchId = crypto.randomUUID();
    const imageRecords = [];
    for (const { file, validated } of validatedImages) {
      const imageId = new mongoose.Types.ObjectId();
      const storageData = await storageService.storePrivateQuestionImage({
        buffer: file.buffer,
        batchId: batchObjectId.toString(),
        imageId: imageId.toString(),
        extension: validated.extension,
        mimeType: validated.mimeType,
        originalName: file.originalname
      });
      storedImages.push(storageData);
      imageRecords.push({
        _id: imageId,
        extension: validated.extension,
        mimeType: validated.mimeType,
        size: validated.size,
        width: validated.width,
        height: validated.height,
        ...storageData,
        originalName: file.originalname
      });
    }

    const batch = await QuestionExtraction.create({
      _id: batchObjectId,
      batchId,
      uploadedBy: req.user.id,
      course: access.course._id,
      department: access.course.department,
      academicLevel: access.course.level,
      semester: access.course.semester,
      academicSession,
      sourceExamYear: resolvedSourceExamYear,
      sourcePaper: sourcePaper?._id || null,
      sourcePaperMetadata,
      images: imageRecords,
      status: "queued",
      processingStage: "ocr",
      processingAttemptCount: 0,
      nextAttemptAt: new Date(),
      reviewStatus: "pending"
    });
    batchPersisted = true;
    console.log(JSON.stringify({
      event: "question_extraction_job_enqueued",
      batchId,
      stage: "ocr",
      timestamp: new Date().toISOString()
    }));

    return res.status(202).json({
      success: true,
      batch: toBatchView(batch),
      message: "Batch saved and queued for OCR processing."
    });
  } catch (error) {
    if (!batchPersisted) {
      await Promise.all(storedImages.map(async (image) => {
        try {
          await storageService.deleteObject(image);
        } catch (cleanupError) {
          console.error("Failed to clean up an incomplete question image upload:", cleanupError.message);
        }
      }));
    }
    return replyError(res, error, "Unable to upload question images.");
  }
});

router.get("/:batchId", async (req, res) => {
  try {
    const batch = await authorizeBatch(req, res, req.params.batchId);
    if (!batch) return;
    return res.json({ success: true, batch: toBatchView(batch) });
  } catch (error) {
    return replyError(res, error);
  }
});

router.patch("/:batchId/drafts/:draftId", async (req, res) => {
  try {
    const batch = await authorizeBatch(req, res, req.params.batchId);
    if (!batch) return;
    if (!safeId(req.params.draftId)) {
      return res.status(404).json({ success: false, message: "Extraction draft not found." });
    }
    await questionExtractionReviewService.editDraft({
      batchId: req.params.batchId,
      draftId: req.params.draftId,
      userId: req.user.id,
      payload: req.body
    });
    const updated = await QuestionExtraction.findOne({ batchId: req.params.batchId });
    return res.json({ success: true, batch: toBatchView(updated) });
  } catch (error) {
    return replyError(res, error, "Unable to update extraction draft.");
  }
});

router.post("/:batchId/drafts/:draftId/approve", async (req, res) => {
  try {
    const batch = await authorizeBatch(req, res, req.params.batchId);
    if (!batch) return;
    if (!safeId(req.params.draftId)) {
      return res.status(404).json({ success: false, message: "Extraction draft not found." });
    }
    const result = await questionExtractionReviewService.approveDraft({
      batchId: req.params.batchId,
      draftId: req.params.draftId,
      userId: req.user.id
    });
    const marking = await getApprovedQuestionMarking(result.question._id, req.user.id);
    await persistDraftMarkingStatus(req.params.batchId, req.params.draftId, marking);
    const updated = await QuestionExtraction.findOne({ batchId: req.params.batchId });
    return res.json({
      success: true,
      alreadyApproved: result.alreadyApproved,
      questionId: result.question?._id || null,
      markingStatus: marking.status,
      markingVersion: marking.version?._id || null,
      batch: toBatchView(updated)
    });
  } catch (error) {
    return replyError(res, error, "Unable to approve extraction draft.");
  }
});

router.post("/:batchId/drafts/:draftId/reject", async (req, res) => {
  try {
    const batch = await authorizeBatch(req, res, req.params.batchId);
    if (!batch) return;
    if (!safeId(req.params.draftId)) {
      return res.status(404).json({ success: false, message: "Extraction draft not found." });
    }
    const result = await questionExtractionReviewService.rejectDraft({
      batchId: req.params.batchId,
      draftId: req.params.draftId,
      userId: req.user.id,
      reason: req.body?.reason
    });
    return res.json({
      success: true,
      alreadyRejected: result.alreadyRejected,
      batch: toBatchView(result.batch)
    });
  } catch (error) {
    return replyError(res, error, "Unable to reject extraction draft.");
  }
});

router.post("/:batchId/review-selected", async (req, res) => {
  try {
    const batch = await authorizeBatch(req, res, req.params.batchId);
    if (!batch) return;
    const { action, draftIds, reason } = req.body || {};
    if (!["approve", "reject"].includes(action) || !Array.isArray(draftIds) ||
        draftIds.length === 0 || draftIds.length > 100 ||
        draftIds.some((draftId) => !safeId(draftId)) ||
        new Set(draftIds.map(String)).size !== draftIds.length) {
      return res.status(400).json({
        success: false,
        message: "Provide a unique selection of 1 to 100 draft IDs and an approve or reject action."
      });
    }
    const results = await Promise.all(draftIds.map(async (draftId) => {
      try {
        const result = action === "approve"
          ? await questionExtractionReviewService.approveDraft({
            batchId: req.params.batchId,
            draftId,
            userId: req.user.id
          })
          : await questionExtractionReviewService.rejectDraft({
            batchId: req.params.batchId,
            draftId,
            userId: req.user.id,
            reason
          });
        return {
          draftId,
          success: true,
          alreadyReviewed: Boolean(result.alreadyApproved || result.alreadyRejected),
          questionId: result.question?._id || null
        };
      } catch (error) {
        return { draftId, success: false, message: error.message, statusCode: error.statusCode || 500 };
      }
    }));
    if (action === "approve") {
      for (const result of results) {
        if (!result.success || !result.questionId) continue;
        try {
          const marking = await getApprovedQuestionMarking(result.questionId, req.user.id);
          await persistDraftMarkingStatus(req.params.batchId, result.draftId, marking);
          result.markingStatus = marking.status;
          result.markingVersion = marking.version?._id || null;
        } catch (error) {
          result.success = false;
          result.message = "Question content was approved, but its AI marking status could not be saved.";
          result.statusCode = error.statusCode || 500;
        }
      }
    }
    const updated = await QuestionExtraction.findOne({ batchId: req.params.batchId });
    return res.json({
      success: results.every((result) => result.success),
      results,
      batch: toBatchView(updated)
    });
  } catch (error) {
    return replyError(res, error, "Unable to review selected extraction drafts.");
  }
});

router.post("/:batchId/retry", async (req, res) => {
  try {
    const batch = await authorizeBatch(req, res, req.params.batchId);
    if (!batch) return;
    if ((batch.drafts || []).some((draft) =>
      draft.reviewStatus !== "pending" || draft.originalContent || (draft.reviewHistory || []).length
    )) {
      return res.status(409).json({
        success: false,
        message: "Extraction cannot be retried after draft review or corrections have started."
      });
    }
    if (batch.status === "needs_review" || batch.status === "approved") {
      return res.status(409).json({ success: false, message: "This batch has completed extraction and does not need retry." });
    }
    if (batch.status === "queued") {
      return res.status(409).json({ success: false, message: "This extraction batch is already queued." });
    }
    if (batch.retryCount >= MAX_RETRIES) {
      return res.status(429).json({ success: false, message: "Maximum extraction retries reached." });
    }
    const hasIncompleteOcr = batch.images.some((image) => image.ocrStatus !== "succeeded");
    const stage = req.body?.stage || (hasIncompleteOcr ? "ocr" : "structuring");
    if (!["ocr", "structuring"].includes(stage)) {
      return res.status(400).json({ success: false, message: "Retry stage must be OCR or structuring." });
    }
    if (stage === "structuring" && !getOcrPages(batch).length) {
      return res.status(409).json({ success: false, message: "OCR text is unavailable. Retry OCR first." });
    }
    const now = new Date();
    const queued = await QuestionExtraction.findOneAndUpdate({
      _id: batch._id,
      retryCount: { $lt: MAX_RETRIES },
      $or: [
        { status: { $in: ["uploaded", "extracted", "failed", "partially_failed"] } },
        { status: { $in: ["processing", "extracted"] }, processingLockUntil: { $lte: now } }
      ]
    }, {
      $set: {
        status: "queued",
        processingStage: stage,
        processingLockToken: "",
        processingLockUntil: null,
        processingLeaseHeartbeatAt: null,
        processingAttemptCount: 0,
        nextAttemptAt: now
      },
      $inc: { retryCount: 1 }
    }, { new: true });
    if (!queued) {
      return res.status(409).json({ success: false, message: "This extraction batch is already processing or queued." });
    }
    console.log(JSON.stringify({
      event: "question_extraction_retry_enqueued",
      batchId: batch.batchId,
      stage,
      timestamp: new Date().toISOString()
    }));
    return res.status(202).json({
      success: true,
      batch: toBatchView(queued),
      message: "Retry scheduled for background processing."
    });
  } catch (error) {
    return replyError(res, error);
  }
});

router.get("/:batchId/images/:imageId", async (req, res) => {
  try {
    const batch = await authorizeBatch(req, res, req.params.batchId);
    if (!batch) return;
    if (!safeId(req.params.imageId)) return res.status(404).json({ success: false, message: "Image not found." });
    const image = batch.images.find((entry) => idOf(entry._id) === req.params.imageId);
    if (!image) return res.status(404).json({ success: false, message: "Image not found." });

    const stream = await storageService.getObjectReadStream(image);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", image.mimeType);
    stream.on("error", () => {
      if (!res.headersSent) res.status(404).json({ success: false, message: "Original image is unavailable." });
      else res.destroy();
    });
    return stream.pipe(res);
  } catch (error) {
    return replyError(res, error, "Original image is unavailable.");
  }
});

module.exports = router;
