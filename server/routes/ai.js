const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const router = express.Router();

// Middleware
const protect = require("../config/middleware/authMiddleware");
const requirePremium = require("../config/middleware/planMiddleware");

// Models
const AIConversation = require("../models/AIConversation");
const StudentNote = require("../models/StudentNote");
const PastQuestionExplanation = require("../models/PastQuestionExplanation");
const StudentPerformance = require("../models/StudentPerformance");
const LearningPath = require("../models/LearningPath");
const Question = require("../models/Question");
const Course = require("../models/Course");
const User = require("../models/User");

// Services
const openaiService = require("../utils/openai");

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../uploads"));
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

console.log("🚀 ACADEMIC SUCCESS SUITE - AI ROUTES LOADED");

// ============================================================================
// 1. AI STUDY ASSISTANT - CHAT ENDPOINTS
// ============================================================================

/**
 * POST /api/ai/chat
 * Send message to AI Study Assistant
 */
router.post("/chat", protect, requirePremium, async (req, res) => {
  try {
    const { courseId, message, conversationId } = req.body;

    // Debug: Check if user is authenticated
    if (!req.user || !req.user._id) {
      console.error("❌ Authentication failed - req.user:", req.user);
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    if (!courseId || !message) {
      return res.status(400).json({
        success: false,
        message: "courseId and message are required"
      });
    }

    // Validate course exists
    const course = await Course.findById(courseId).populate("department");
    if (!course) {
      return res.status(404).json({ success: false, message: "Course not found" });
    }

    // Get or create conversation
    let conversation = null;
    if (conversationId && mongoose.Types.ObjectId.isValid(conversationId)) {
      conversation = await AIConversation.findById(conversationId);
      // Verify conversation belongs to current user
      if (conversation && conversation.user && conversation.user.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: "Unauthorized access to conversation" });
      }
    }

    if (!conversation) {
      conversation = new AIConversation({
        user: req.user._id,
        course: courseId,
        department: course.department._id,
        messages: []
      });
    } else if (!conversation.user) {
      // Ensure user field is set (defensive check)
      console.warn("⚠️ Conversation missing user field, setting it now");
      conversation.user = req.user._id;
    }

    // Add user message
    conversation.messages.push({
      role: "student",
      content: message,
      timestamp: new Date()
    });

    // Build messages array for OpenAI
    const messagesForAI = conversation.messages.map(msg => ({
      role: msg.role === "student" ? "user" : "assistant",
      content: msg.content
    }));

    // Get user performance data for context
    const performance = await StudentPerformance.findOne({
      user: req.user._id,
      course: courseId
    });

    const courseContext = {
      courseName: course.title,
      courseCode: course.code,
      departmentName: course.department?.name || "Unknown",
      academicLevel: req.user.yearOfStudy || "Unknown",
      topicsMastery: performance ? performance.topicMetrics : []
    };

    // Call OpenAI
    const aiResponse = await openaiService.chatWithStudent(
      messagesForAI,
      courseContext,
      "gpt-3.5-turbo"
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

    // Debug before save
    console.log("📝 Saving conversation:", {
      _id: conversation._id,
      user: conversation.user,
      userId: req.user._id,
      course: conversation.course,
      messagesCount: conversation.messages.length
    });

    // Save conversation
    await conversation.save();

    // Track user AI usage
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { "aiUsage.messagesThisMonth": 1 }
    });

    res.json({
      success: true,
      conversationId: conversation._id,
      message: aiResponse.message,
      tokens: aiResponse.tokens,
      cost: aiResponse.cost
    });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ success: false, message: error.message });
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
      user: req.user._id,
      course: courseId
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      conversations,
      count: conversations.length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

    const conversation = await AIConversation.findOne({
      _id: conversationId,
      user: req.user._id
    }).populate("course");

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    res.json({ success: true, conversation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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
      user: req.user._id
    });

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    res.json({ success: true, message: "Conversation deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

    // Call OpenAI to enhance the content
    const enhancements = await openaiService.enhanceNoteContent(
      extractedContent,
      course.title,
      course.courseCharacteristics || {
        isMathHeavy: false,
        requiresCodeExamples: false,
        requiresDiagrams: false,
        examFormat: "multiple-choice"
      }
    );

    // Create StudentNote
    const note = new StudentNote({
      user: req.user._id,
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
    await User.findByIdAndUpdate(req.user._id, {
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
    res.status(500).json({ success: false, message: error.message });
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
      user: req.user._id,
      course: courseId
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      notes,
      count: notes.length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

    const note = await StudentNote.findOne({
      _id: noteId,
      user: req.user._id
    }).populate("course");

    if (!note) {
      return res.status(404).json({ success: false, message: "Note not found" });
    }

    // Update review count
    note.lastReviewedAt = new Date();
    note.reviewCount += 1;
    await note.save();

    res.json({ success: true, note });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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
      user: req.user._id
    });

    if (!note) {
      return res.status(404).json({ success: false, message: "Note not found" });
    }

    res.json({ success: true, message: "Note deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// 3. PAST QUESTION EXPLAINER ENDPOINTS
// ============================================================================

/**
 * POST /api/ai/explain-question
 * Get detailed explanation for a past question
 */
router.post("/explain-question", protect, requirePremium, async (req, res) => {
  try {
    const { questionId } = req.body;

    if (!questionId || !mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(400).json({
        success: false,
        message: "Valid questionId is required"
      });
    }

    // Check cache first
    const cachedExplanation = await PastQuestionExplanation.findOne({ question: questionId });
    if (cachedExplanation) {
      cachedExplanation.viewCount += 1;
      await cachedExplanation.save();

      await User.findByIdAndUpdate(req.user._id, {
        $inc: { "aiUsage.questionsExplainedThisMonth": 1 }
      });

      return res.json({
        success: true,
        explanation: cachedExplanation,
        cached: true
      });
    }

    // Get question
    const question = await Question.findById(questionId).populate("course");
    if (!question) {
      return res.status(404).json({ success: false, message: "Question not found" });
    }

    // Get course context
    const course = await Course.findById(question.course);
    const courseContext = {
      courseName: course.title,
      courseCode: course.code,
      examFormat: course.courseCharacteristics?.examFormat || "multiple-choice"
    };

    // Generate explanation using OpenAI
    const aiExplanation = await openaiService.explainQuestion(
      question,
      question.answer,
      courseContext
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
    await User.findByIdAndUpdate(req.user._id, {
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
    res.status(500).json({ success: false, message: error.message });
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

    explanation.viewCount += 1;
    await explanation.save();

    res.json({ success: true, explanation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

    res.json({ success: true, message: "Feedback recorded", explanation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

    const stats = openaiService.getUsageStats();

    res.json({
      success: true,
      stats,
      message: "Current session usage statistics"
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/ai/user/usage
 * Get user's AI usage for the month
 */
router.get("/user/usage", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    res.json({
      success: true,
      usage: user.aiUsage,
      limits: user.subscriptionFeatures
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "courseId is required"
      });
    }

    // Get course
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ success: false, message: "Course not found" });
    }

    // Get student performance
    let performance = await StudentPerformance.findOne({
      user: req.user._id,
      course: courseId
    });

    if (!performance) {
      performance = new StudentPerformance({
        user: req.user._id,
        course: courseId,
        topStrengths: [],
        areasToImprove: ["General practice needed"]
      });
    }

    // Generate learning path using OpenAI
    const pathData = await openaiService.generateLearningPath(
      performance,
      course.title,
      targetExamDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      studyHoursPerDay || 2
    );

    // Create LearningPath document
    const path = new LearningPath({
      user: req.user._id,
      course: courseId,
      title: pathData.path.title,
      targetExamDate: targetExamDate,
      schedule: pathData.path.schedule
    });

    await path.save();

    res.json({
      success: true,
      path,
      tokens: pathData.tokens,
      cost: pathData.cost
    });
  } catch (error) {
    console.error("Learning path error:", error);
    res.status(500).json({ success: false, message: error.message });
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
      user: req.user._id,
      course: courseId
    }).sort({ createdAt: -1 });

    if (!path) {
      return res.status(404).json({ success: false, message: "No learning path found for this course" });
    }

    res.json({ success: true, path });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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
      user: req.user._id
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