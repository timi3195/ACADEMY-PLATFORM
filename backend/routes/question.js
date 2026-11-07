const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const crypto = require("crypto");
const protect = require("../config/middleware/authMiddleware");
const adminOnly = require("../config/middleware/adminOnly");
const Question = require("../models/Question");
const Course = require("../models/course");
const questionAccess = require("../services/questionAccessService");
const { toStudentQuestion } = questionAccess;

const createOptionIds = (options) => options.map(() => crypto.randomUUID());

const getCourseId = (course) => course?._id || course;

const sendAccessError = (res, access) =>
  res.status(access.statusCode).json({ success: false, message: access.message });

// Question-bank management listing. Legacy records remain visible to administrators.
router.get("/", protect, adminOnly, async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: 5 }, (_, index) => String(currentYear - index));
    const questions = await Question.find({ year: { $in: years } }).populate("course");
    return res.json({ success: true, questions });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// CREATE QUESTION - administrator-authored questions are explicitly approved.
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const { course, topic, question, options, answer, subQuestions } = req.body || {};
    if (!course || !mongoose.Types.ObjectId.isValid(String(course)) || !topic || !question) {
      return res.status(400).json({
        success: false,
        message: "A valid course, topic, and question are required."
      });
    }

    const courseDoc = await Course.findById(course);
    if (!courseDoc) return res.status(404).json({ success: false, message: "Course not found." });

    const normalizedOptions = Array.isArray(options)
      ? options.map((option) => String(option).trim()).filter(Boolean)
      : [];
    const hasValidOptions = normalizedOptions.length >= 2;
    const hasSubQuestions = Array.isArray(subQuestions) && subQuestions.length > 0;
    if (!hasValidOptions && !hasSubQuestions) {
      return res.status(400).json({
        success: false,
        message: "Provide at least 2 options or a list of sub-questions."
      });
    }

    if (hasSubQuestions && subQuestions.some((item) =>
      !item.question || !Array.isArray(item.options) || item.options.length < 2 || !item.answer
    )) {
      return res.status(400).json({
        success: false,
        message: "Each sub-question must include question text, at least 2 options, and an answer."
      });
    }

    if (hasValidOptions && (typeof answer !== "string" || !answer.trim())) {
      return res.status(400).json({ success: false, message: "A correct answer is required for objective questions." });
    }

    const createdQuestion = await Question.create({
      ...req.body,
      course: getCourseId(courseDoc),
      department: getCourseId(courseDoc.department),
      options: normalizedOptions,
      optionIds: createOptionIds(normalizedOptions),
      approvalStatus: "approved",
      approvedBy: req.user.id,
      approvedAt: new Date()
    });

    return res.json({ success: true, question: createdQuestion });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// BULK QUESTION IMPORT / CBT SET UPLOAD
router.post("/bulk", protect, adminOnly, async (req, res) => {
  try {
    const { course, questions } = req.body || {};
    if (!course || !mongoose.Types.ObjectId.isValid(String(course)) ||
        !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ success: false, message: "A valid course and questions array are required." });
    }

    const courseDoc = await Course.findById(course);
    if (!courseDoc) return res.status(404).json({ success: false, message: "Course not found." });

    const payloads = questions.map((item) => {
      const options = Array.isArray(item.options)
        ? item.options.map((option) => String(option).trim()).filter(Boolean)
        : [];
      return {
        course: getCourseId(courseDoc),
        department: getCourseId(courseDoc.department),
        topic: item.topic || item.subject || "",
        question: item.question || item.prompt || "",
        options,
        optionIds: createOptionIds(options),
        answer: item.answer || item.correctAnswer || "",
        explanation: item.explanation || "",
        year: item.year || String(new Date().getFullYear()),
        session: item.session || "Rain",
        marks: item.marks != null ? Number(item.marks) : 2,
        difficulty: item.difficulty || "medium",
        isPremium: Boolean(item.isPremium),
        approvalStatus: "approved",
        approvedBy: req.user.id,
        approvedAt: new Date()
      };
    }).filter((item) => item.question && item.options.length >= 2 && item.answer);
    payloads.forEach((item) => {
      item.answer = String(item.answer).trim();
    });

    if (payloads.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid questions found in the provided payload."
      });
    }

    const createdQuestions = await Question.insertMany(payloads);
    return res.json({
      success: true,
      count: createdQuestions.length,
      questions: createdQuestions
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Course question retrieval returns full records only to administrators and assigned approved lecturers.
router.get("/course/:courseId", protect, async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(courseId))) {
      return res.status(400).json({ success: false, message: "Invalid course ID." });
    }

    const access = await questionAccess.getCourseAccess(req.user.id, courseId);
    if (!access.allowed) return sendAccessError(res, access);

    const query = { course: courseId };
    if (!access.manager) query.approvalStatus = "approved";
    if (typeof req.query.year === "string" && req.query.year.trim()) query.year = req.query.year.trim();

    const questions = await Question.find(query).populate("course");
    return res.json({
      success: true,
      questions: access.manager ? questions : questions.map(toStudentQuestion)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Legacy random practice retrieval remains available only to eligible authenticated students and managers.
router.get("/quiz/:courseId", protect, async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(courseId))) {
      return res.status(400).json({ success: false, message: "Invalid course ID." });
    }

    const access = await questionAccess.getCourseAccess(req.user.id, courseId);
    if (!access.allowed) return sendAccessError(res, access);

    const matchQuery = {
      course: new mongoose.Types.ObjectId(courseId),
      approvalStatus: "approved",
      $expr: { $gte: [{ $size: "$options" }, 2] }
    };
    const sampled = await Question.aggregate([
      { $match: matchQuery },
      { $sample: { size: 10 } }
    ]);
    const questions = sampled
      .filter((question) => Array.isArray(question.options) && question.options.length >= 2)
      .map(toStudentQuestion);

    if (questions.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No approved objective questions are available for this course yet."
      });
    }

    return res.json({ success: true, questions });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
