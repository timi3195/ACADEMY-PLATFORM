const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const storageService = require("../services/storageService");
const router = express.Router();

// Middleware
const protect = require("../config/middleware/authMiddleware");
const requirePremium = require("../config/middleware/planMiddleware");

// Models
const AIConversation = require("../models/AIConversation");
const StudentNote = require("../models/StudentNote");
const PastQuestionExplanation = require("../models/PastQuestionExplanation");
const LearningPath = require("../models/LearningPath");
const Question = require("../models/Question");
const Course = require("../models/course");
const File = require("../models/File");
const PastQuestionPaper = require("../models/PastQuestionPaper");
const User = require("../models/User");
const QuizSession = require("../models/QuizSession");

// Services
const geminiService = require("../utils/gemini");
const questionAccess = require("../services/questionAccessService");
const studentAnalytics = require("../services/studentAnalyticsService");

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, storageService.getUploadDir());
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "text/plain"
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only PDF, images, and text files allowed."));
    }
  }
});

const parseTargetExamDate = (value) => {
  if (typeof value !== "string") return null;

  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timestamp = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|([+-])(\d{2}):(\d{2}))$/
  );
  const match = dateOnly || timestamp;
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ][month - 1];
  if (!daysInMonth || day < 1 || day > daysInMonth) return null;

  if (timestamp) {
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6] || 0);
    if (hour > 23 || minute > 59 || second > 59) return null;

    if (match[7] !== "Z") {
      const offsetHour = Number(match[9]);
      const offsetMinute = Number(match[10]);
      if (offsetHour > 14 || offsetMinute > 59 ||
          (offsetHour === 14 && offsetMinute !== 0)) return null;
    }
  }

  const parsedDate = dateOnly
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(value);
  return Number.isFinite(parsedDate.getTime()) ? parsedDate : null;
};

// ============================================================================
// 1. AI STUDY ASSISTANT - CHAT ENDPOINTS
// ============================================================================

/**
 * POST /api/ai/chat
 * Send message to AI Study Assistant
 */
router.post("/chat", protect, async (req, res) => {
  try {
    const { courseId, message, conversationId } = req.body;

    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    if (!courseId || !message) {
      return res.status(400).json({
        success: false,
        message: "courseId and message are required"
      });
    }

    const access = await questionAccess.getCourseAccess(req.user.id, courseId);
    if (!access.allowed) {
      if (access.statusCode === 404) {
        return res.status(404).json({ success: false, message: "Course not found" });
      }
      return res.status(403).json({
        success: false,
        message: "You are not authorized to access this course."
      });
    }

    const courseRecord = access.course;
    const course = courseRecord && typeof courseRecord.populate === "function"
      ? await courseRecord.populate("department")
      : courseRecord;

    // Get or create conversation
    let conversation = null;
    if (conversationId && mongoose.Types.ObjectId.isValid(conversationId)) {
      conversation = await AIConversation.findById(conversationId);
      // Verify conversation belongs to current user
      if (conversation && conversation.user && conversation.user.toString() !== req.user.id.toString()) {
        return res.status(403).json({ success: false, message: "Unauthorized access to conversation" });
      }
    }

    if (!conversation) {
      conversation = new AIConversation({
        user: req.user.id,
        course: courseId,
        department: course.department._id,
        messages: []
      });
    } else if (!conversation.user) {
      // Ensure user field is set (defensive check)
      conversation.user = req.user.id;
    }

    // Add user message
    conversation.messages.push({
      role: "student",
      content: message,
      timestamp: new Date()
    });

    // Build messages array for Gemini
    const messagesForAI = conversation.messages.map(msg => ({
      role: msg.role === "student" ? "user" : "assistant",
      content: msg.content
    }));

    const analytics = await studentAnalytics.getStudentAnalytics(req.user.id);
    const cbtPerformance = studentAnalytics.buildCoursePerformanceContext(analytics, courseId);

    const fileQuery = File.find({ course: course.title, productStatus: "published", hidden: false, isDeleted: false });
    const paperQuery = PastQuestionPaper.find({ course: courseId });
    const [materialsResult, papersResult] = await Promise.all([
      typeof fileQuery?.select === "function" ? fileQuery.select("title description materialType").lean() : (Array.isArray(fileQuery) ? fileQuery : []),
      typeof paperQuery?.select === "function" ? paperQuery.select("title examinationYear level semester").lean() : (Array.isArray(paperQuery) ? paperQuery : [])
    ]);
    const materials = Array.isArray(materialsResult) ? materialsResult : [];
    const papers = Array.isArray(papersResult) ? papersResult : [];

    const courseContext = {
      courseName: course.title,
      courseCode: course.code,
      departmentName: course.department?.name || "Unknown",
      academicLevel: req.user.yearOfStudy || "Unknown",
      cbtPerformance,
      sources: [
        ...materials.map((item) => ({ type: item.materialType || "course material", title: item.title, description: item.description })),
        ...papers.map((item) => ({ type: "past-question paper", title: item.title, description: `${item.examinationYear}, ${item.level}, ${item.semester}` }))
      ]
    };

    const aiResponse = await geminiService.chatWithStudent(
      messagesForAI,
      courseContext,
      req.user.id
    );

    // Add assistant message
    conversation.messages.push({
      role: "assistant",
      content: aiResponse.message,
      timestamp: new Date(),
      tokens: aiResponse.tokens.total
    });

    // Update conversation metadata
    conversation.totalMessages = conversation.messages.length;
    conversation.totalTokens += aiResponse.tokens.total;
    conversation.lastMessageAt = new Date();
    if (!conversation.title || conversation.title === "New Chat") {
      conversation.title = message.substring(0, 50) + "...";
    }

    // Save conversation
    await conversation.save();

    res.json({
      success: true,
      conversationId: conversation._id,
      message: aiResponse.message,
      tokens: aiResponse.tokens,
      cost: aiResponse.cost
    });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/ai/chat/:courseId
 * Get chat history for a course
 */
router.get("/chat/:courseId", protect, async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ success: false, message: "Invalid course ID" });
    }

    const conversations = await AIConversation.find({
      user: req.user.id,
      course: courseId
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      conversations,
      count: conversations.length
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/ai/chat/conversation/:conversationId
 * Get full conversation details
 */
router.get("/chat/conversation/:conversationId", protect, async (req, res) => {
  try {
    const { conversationId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ success: false, message: "Invalid conversation ID" });
    }

    const conversationRecord = await AIConversation.findOne({
      _id: conversationId,
      user: req.user.id
    });
    const conversation = conversationRecord && typeof conversationRecord.populate === "function"
      ? await conversationRecord.populate("course")
      : conversationRecord;

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    res.json({ success: true, conversation });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /api/ai/chat/:conversationId
 * Delete conversation
 */
router.delete("/chat/:conversationId", protect, async (req, res) => {
  try {
    const { conversationId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ success: false, message: "Invalid conversation ID" });
    }

    const conversation = await AIConversation.findOneAndDelete({
      _id: conversationId,
      user: req.user.id
    });

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    res.json({ success: true, message: "Conversation deleted" });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// 2. NOTE ENHANCER ENDPOINTS
// ============================================================================

/**
 * POST /api/ai/notes/upload
 * Upload and process lecture notes
 */
router.post("/notes/upload", protect, requirePremium, upload.single("file"), async (req, res) => {
  try {
    const { courseId, title } = req.body;

    if (!courseId || !title || !req.file) {
      return res.status(400).json({
        success: false,
        message: "courseId, title, and file are required"
      });
    }

    // Validate course
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ success: false, message: "Course not found" });
    }

    // In production, extract text from PDF/image using OCR library
    let extractedContent = `[File uploaded: ${req.file.originalname}]\n`;
    if (req.body.manualContent) {
      extractedContent += req.body.manualContent;
    }

    // Call Gemini to enhance the content
    const enhancements = await geminiService.enhanceNoteContent(
      extractedContent,
      course.title,
      course.courseCharacteristics || {
        isMathHeavy: false,
        requiresCodeExamples: false,
        requiresDiagrams: false,
        examFormat: "multiple-choice"
      },
      req.user.id
    );

    // Create StudentNote
    const note = new StudentNote({
      user: req.user.id,
      course: courseId,
      title,
      fileName: req.file.filename,
      fileUrl: `/uploads/${req.file.filename}`,
      fileType: req.file.mimetype.includes("image") ? "image" :
               req.file.mimetype === "application/pdf" ? "pdf" : "text",
      rawContent: extractedContent,
      enhancements: enhancements.enhancements
    });

    await note.save();

    // Track usage
    await User.findByIdAndUpdate(req.user.id, {
      $inc: { "aiUsage.notesProcessedThisMonth": 1 }
    });

    res.json({
      success: true,
      noteId: note._id,
      enhancements: enhancements.enhancements,
      tokens: enhancements.tokens,
      cost: enhancements.cost
    });
  } catch (error) {
    console.error("Note upload error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/ai/notes/:courseId
 * Get all processed notes for a course
 */
router.get("/notes/:courseId", protect, async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ success: false, message: "Invalid course ID" });
    }

    const notes = await StudentNote.find({
      user: req.user.id,
      course: courseId
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      notes,
      count: notes.length
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/ai/notes/detail/:noteId
 * Get full note details with enhancements
 */
router.get("/notes/detail/:noteId", protect, async (req, res) => {
  try {
    const { noteId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(noteId)) {
      return res.status(400).json({ success: false, message: "Invalid note ID" });
    }

    const noteRecord = await StudentNote.findOne({
      _id: noteId,
      user: req.user.id
    });
    const note = noteRecord && typeof noteRecord.populate === "function"
      ? await noteRecord.populate("course")
      : noteRecord;

    if (!note) {
      return res.status(404).json({ success: false, message: "Note not found" });
    }

    // Update review count
    note.lastReviewedAt = new Date();
    note.reviewCount += 1;
    await note.save();

    res.json({ success: true, note });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /api/ai/notes/:noteId
 * Delete note
 */
router.delete("/notes/:noteId", protect, async (req, res) => {
  try {
    const { noteId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(noteId)) {
      return res.status(400).json({ success: false, message: "Invalid note ID" });
    }

    const note = await StudentNote.findOneAndDelete({
      _id: noteId,
      user: req.user.id
    });

    if (!note) {
      return res.status(404).json({ success: false, message: "Note not found" });
    }

    res.json({ success: true, message: "Note deleted" });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// 3. PAST QUESTION EXPLAINER ENDPOINTS
// ============================================================================

/**
 * POST /api/ai/explain-question
 * Get detailed explanation for a past question
 */
router.post("/explain-question", protect, async (req, res) => {
  try {
    const { questionId } = req.body;

    if (!questionId || !mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(400).json({
        success: false,
        message: "Valid questionId is required"
      });
    }

    // Load and authorize the question before looking up cached answer-bearing explanations.
    const question = await Question.findById(questionId).populate("course");
    if (!question) {
      return res.status(404).json({ success: false, message: "Question not found" });
    }

    const access = await questionAccess.getCourseAccess(
      req.user.id,
      question.course?._id || question.course
    );
    if (!access.allowed || (access.user.role === "student" && question.approvalStatus !== "approved")) {
      return res.status(access.allowed ? 404 : access.statusCode).json({
        success: false,
        message: access.allowed ? "Question not found" : access.message
      });
    }

    if (access.user.role === "student") {
      const activeAttempt = await QuizSession.exists({
        user: req.user.id,
        status: "in_progress",
        "questions.questionId": questionId
      });
      if (activeAttempt) {
        return res.status(403).json({
          success: false,
          message: "Question explanations are unavailable while an examination attempt is in progress."
        });
      }
    }

    // Check cache only after the question's access and examination status are verified.
    const cachedExplanation = await PastQuestionExplanation.findOne({ question: questionId });
    if (cachedExplanation) {
      cachedExplanation.viewCount += 1;
      await cachedExplanation.save();

      await User.findByIdAndUpdate(req.user.id, {
        $inc: { "aiUsage.questionsExplainedThisMonth": 1 }
      });

      return res.json({
        success: true,
        explanation: cachedExplanation,
        cached: true
      });
    }

    // Get course context
    const course = await Course.findById(question.course?._id || question.course);
    const courseContext = {
      courseName: course.title,
      courseCode: course.code,
      examFormat: course.courseCharacteristics?.examFormat || "multiple-choice"
    };

    // Generate explanation using Gemini
    const aiExplanation = await geminiService.explainQuestion(
      question,
      question.answer,
      courseContext,
      req.user.id
    );

    // Cache the explanation
    const explanation = new PastQuestionExplanation({
      question: questionId,
      ...aiExplanation.explanation,
      generatedAt: new Date(),
      viewCount: 1
    });

    await explanation.save();

    // Track usage
    await User.findByIdAndUpdate(req.user.id, {
      $inc: { "aiUsage.questionsExplainedThisMonth": 1 }
    });

    res.json({
      success: true,
      explanation,
      tokens: aiExplanation.tokens,
      cost: aiExplanation.cost,
      cached: false
    });
  } catch (error) {
    console.error("Explanation error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/ai/question/:questionId/explanation
 * Get cached explanation
 */
router.get("/question/:questionId/explanation", protect, async (req, res) => {
  try {
    const { questionId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(400).json({ success: false, message: "Invalid question ID" });
    }

    const explanation = await PastQuestionExplanation.findOne({
      question: questionId
    }).populate({
      path: "question",
      populate: { path: "course" }
    });

    if (!explanation) {
      return res.status(404).json({ success: false, message: "Explanation not found" });
    }

    const question = explanation.question;
    const access = await questionAccess.getCourseAccess(
      req.user.id,
      question?.course?._id || question?.course
    );
    if (!question || !access.allowed ||
        (access.user.role === "student" && question.approvalStatus !== "approved")) {
      return res.status(!question || access.allowed ? 404 : access.statusCode).json({
        success: false,
        message: !question || access.allowed ? "Explanation not found" : access.message
      });
    }
    if (access.user.role === "student") {
      const activeAttempt = await QuizSession.exists({
        user: req.user.id,
        status: "in_progress",
        "questions.questionId": questionId
      });
      if (activeAttempt) {
        return res.status(403).json({
          success: false,
          message: "Question explanations are unavailable while an examination attempt is in progress."
        });
      }
    }

    explanation.viewCount += 1;
    await explanation.save();

    res.json({ success: true, explanation });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/ai/question/:questionId/feedback
 * Submit feedback on explanation
 */
router.post("/question/:questionId/feedback", protect, async (req, res) => {
  try {
    const { questionId } = req.params;
    const { helpful } = req.body;

    if (!mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(400).json({ success: false, message: "Invalid question ID" });
    }

    if (typeof helpful !== "boolean") {
      return res.status(400).json({ success: false, message: "helpful must be boolean" });
    }

    const explanation = await PastQuestionExplanation.findOneAndUpdate(
      { question: questionId },
      {
        $inc: helpful ? { helpfulCount: 1 } : { unhelpfulCount: 1 }
      },
      { new: true }
    );

    if (!explanation) {
      return res.status(404).json({ success: false, message: "Explanation not found" });
    }

    res.json({ success: true, message: "Feedback recorded" });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// 4. ADMIN ANALYTICS ENDPOINTS
// ============================================================================

/**
 * GET /api/ai/usage/stats
 * Get AI API usage statistics
 */
router.get("/usage/stats", protect, async (req, res) => {
  try {
    // Admin only check (if needed)
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin only" });
    }

    const stats = geminiService.getUsageStats();

    res.json({
      success: true,
      stats,
      message: "Current session usage statistics"
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/ai/user/usage
 * Get user's AI usage for the month
 */
router.get("/user/usage", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    res.json({
      success: true,
      usage: user.aiUsage,
      limits: user.subscriptionFeatures
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// LEARNING PATH ROUTES
// ============================================================================

/**
 * POST /api/ai/learning-path/generate
 * Generate personalized learning path
 */
router.post("/learning-path/generate", protect, requirePremium, async (req, res) => {
  try {
    const { courseId, targetExamDate, studyHoursPerDay } = req.body;

    if (!courseId || !mongoose.Types.ObjectId.isValid(String(courseId))) {
      return res.status(400).json({ success: false, message: "A valid courseId is required." });
    }

    let parsedTargetDate;
    if (targetExamDate !== undefined && targetExamDate !== null) {
      parsedTargetDate = parseTargetExamDate(targetExamDate);
      if (!parsedTargetDate) {
        return res.status(400).json({ success: false, message: "targetExamDate must be a valid date." });
      }
      const today = new Date();
      const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
      const targetUtc = Date.UTC(
        parsedTargetDate.getUTCFullYear(),
        parsedTargetDate.getUTCMonth(),
        parsedTargetDate.getUTCDate()
      );
      if (targetUtc < todayUtc) {
        return res.status(400).json({ success: false, message: "targetExamDate cannot be in the past." });
      }
    }

    if (studyHoursPerDay !== undefined &&
        (typeof studyHoursPerDay !== "number" || !Number.isFinite(studyHoursPerDay) ||
          studyHoursPerDay < 0.25 || studyHoursPerDay > 12)) {
      return res.status(400).json({
        success: false,
        message: "studyHoursPerDay must be between 0.25 and 12."
      });
    }

    const access = await questionAccess.getCourseAccess(req.user.id, courseId);
    if (!access.allowed) {
      return res.status(access.statusCode || 403).json({
        success: false,
        message: access.message || "You are not authorized to access this course."
      });
    }

    const courseRecord = access.course;
    const course = courseRecord && typeof courseRecord.populate === "function"
      ? await courseRecord.populate("department")
      : courseRecord;
    const startDate = new Date();
    const startDay = new Date(Date.UTC(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth(),
      startDate.getUTCDate()
    ));
    const targetDay = parsedTargetDate
      ? new Date(Date.UTC(
        parsedTargetDate.getUTCFullYear(),
        parsedTargetDate.getUTCMonth(),
        parsedTargetDate.getUTCDate()
      ))
      : null;
    const daysRemaining = targetDay
      ? Math.floor((targetDay.getTime() - startDay.getTime()) / 86400000) + 1
      : 7;
    const scheduleCount = Math.min(daysRemaining, 14);
    const studyHours = studyHoursPerDay === undefined ? 2 : studyHoursPerDay;
    const scheduleDays = Array.from({ length: scheduleCount }, (_, index) => {
      const elapsedDay = scheduleCount === 1
        ? 0
        : Math.round(index * (daysRemaining - 1) / (scheduleCount - 1));
      const date = new Date(startDay.getTime() + elapsedDay * 86400000);
      return { day: elapsedDay + 1, date: date.toISOString().slice(0, 10) };
    });

    const pathData = await geminiService.generateLearningPath(
      {
        courseName: course.title,
        courseCode: course.code,
        departmentName: course.department?.name || "Unknown",
        academicLevel: access.user.yearOfStudy || "Unknown",
        planning: {
          startDate: startDay.toISOString().slice(0, 10),
          targetExamDate: targetDay ? targetDay.toISOString().slice(0, 10) : null,
          daysRemaining,
          studyHoursPerDay: studyHours,
          scheduleDays
        }
      },
      req.user.id
    );

    const validatedPath = geminiService.validateLearningPathOutput(pathData?.path, {
      scheduleDays,
      maxStudyMinutes: studyHours * 60
    });
    const path = new LearningPath({
      user: req.user.id,
      course: course._id,
      title: validatedPath.title,
      startDate,
      targetExamDate: parsedTargetDate,
      daysRemaining,
      schedule: validatedPath.schedule
    });

    await path.save();

    res.json({
      success: true,
      path,
      tokens: pathData.tokens,
      cost: pathData.cost
    });
  } catch (error) {
    if (error.isSafeLearningPathError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error("Learning path generation failed.");
    return res.status(500).json({
      success: false,
      message: "Unable to generate a learning path. Please try again."
    });
  }
});

/**
 * GET /api/ai/learning-path/:courseId
 * Get learning path for course
 */
router.get("/learning-path/:courseId", protect, async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ success: false, message: "Invalid course ID" });
    }

    const path = await LearningPath.findOne({
      user: req.user.id,
      course: courseId
    }).sort({ createdAt: -1 });

    if (!path) {
      return res.status(404).json({ success: false, message: "No learning path found for this course" });
    }

    res.json({ success: true, path });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /api/ai/learning-path/:pathId/update-progress
 * Update learning path progress
 */
router.put("/learning-path/:pathId/update-progress", protect, async (req, res) => {
  try {
    const { pathId } = req.params;
    const { dayIndex, activityIndex, completed, score } = req.body;

    if (!mongoose.Types.ObjectId.isValid(pathId)) {
      return res.status(400).json({ success: false, message: "Invalid path ID" });
    }

    const path = await LearningPath.findOne({
      _id: pathId,
      user: req.user.id
    });

    if (!path) {
      return res.status(404).json({ success: false, message: "Path not found" });
    }

    if (dayIndex >= 0 && dayIndex < path.schedule.length) {
      const day = path.schedule[dayIndex];
      if (activityIndex >= 0 && activityIndex < day.activities.length) {
        day.activities[activityIndex].completed = completed;
        if (score !== undefined) {
          day.activities[activityIndex].score = score;
        }
        day.activities[activityIndex].completedAt = new Date();
      }
    }

    await path.save();

    res.json({ success: true, message: "Progress updated", path });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
