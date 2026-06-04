const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const protect = require("../config/middleware/authMiddleware");
const adminOnly = require("../config/middleware/adminOnly");
const Question = require("../models/Question");
const Course = require("../models/course");

console.log("🔥 QUESTION ROUTES LOADED");

// CREATE QUESTION
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const { course, topic, question, options, answer, subQuestions } = req.body;

    if (!course || !topic || !question) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: course, topic, question"
      });
    }

    const hasValidOptions = Array.isArray(options) && options.length >= 2;
    const hasSubQuestions = Array.isArray(subQuestions) && subQuestions.length > 0;

    if (!hasValidOptions && !hasSubQuestions) {
      return res.status(400).json({
        success: false,
        message: "Provide either at least 2 options for the main question or a list of sub-questions."
      });
    }

    if (hasSubQuestions) {
      const invalidSub = subQuestions.find((sub) => !sub.question || !Array.isArray(sub.options) || sub.options.length < 2 || !sub.answer);
      if (invalidSub) {
        return res.status(400).json({
          success: false,
          message: "Each sub-question must include question text, at least 2 options, and an answer."
        });
      }
    }

    const createdQuestion = await Question.create(req.body);

    res.json({
      success: true,
      question: createdQuestion
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// BULK QUESTION IMPORT / CBT SET UPLOAD
router.post("/bulk", protect, adminOnly, async (req, res) => {
  try {
    const { course, questions } = req.body;

    if (!course || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Course and questions array are required"
      });
    }

    const courseDoc = await Course.findById(course);
    if (!courseDoc) {
      return res.status(404).json({
        success: false,
        message: "Course not found"
      });
    }

    const payloads = questions.map((item) => {
      const options = Array.isArray(item.options) ? item.options : [];
      return {
        course,
        department: courseDoc.department,
        topic: item.topic || item.subject || '',
        question: item.question || item.prompt || '',
        options,
        answer: item.answer || item.correctAnswer || '',
        explanation: item.explanation || '',
        year: item.year || new Date().getFullYear().toString(),
        session: item.session || 'Rain',
        marks: item.marks != null ? Number(item.marks) : 2,
        difficulty: item.difficulty || 'medium',
        isPremium: !!item.isPremium
      };
    }).filter((item) => item.question && item.options.length >= 2 && item.answer);

    if (payloads.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid questions found in the provided payload. Make sure question, options and answer are included."
      });
    }

    const createdQuestions = await Question.insertMany(payloads);

    res.json({
      success: true,
      count: createdQuestions.length,
      questions: createdQuestions
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// GET ALL QUESTIONS
router.get("/", async (req, res) => {
  try {
    const currentYear = new Date().getFullYear()
    const years = Array.from({ length: 5 }, (_, i) => (currentYear - i).toString())

    const questions = await Question.find({ year: { $in: years } }).populate("course");

    res.json({
      success: true,
      questions
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// GET QUESTIONS BY COURSE
router.get("/course/:courseId", async (req, res) => {
  try {
    const courseId = req.params.courseId;
    const { year } = req.query;
    const query = { course: courseId };

    if (year) {
      query.year = year
    } else {
      const currentYear = new Date().getFullYear()
      const years = Array.from({ length: 5 }, (_, i) => (currentYear - i).toString())
      query.year = { $in: years }
    }

    const questions = await Question.find(query).populate('course');

    res.json({
      success: true,
      questions
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// RANDOM CBT QUIZ
router.get("/quiz/:courseId", async (req, res) => {
  try {
    const courseId = req.params.courseId;

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ success: false, message: "Invalid course ID" });
    }

    const matchQuery = {
      course: mongoose.Types.ObjectId(courseId),
      $expr: {
        $gte: [{ $size: "$options" }, 2]
      }
    };

    const questionCount = await Question.countDocuments(matchQuery);
    if (questionCount === 0) {
      return res.status(404).json({
        success: false,
        message: "No objective past questions available for this course yet."
      });
    }

    const sampleSize = Math.min(10, questionCount);
    const questions = await Question.aggregate([
      { $match: matchQuery },
      { $sample: { size: sampleSize } }
    ]);

    res.json({
      success: true,
      questions
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;