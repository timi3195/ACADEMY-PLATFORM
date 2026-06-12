const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Question = require("../models/Question");
const QuizSession = require("../models/QuizSession");
const protect = require("../config/middleware/authMiddleware");
const requirePremium = require("../config/middleware/planMiddleware");

console.log("🔥 QUIZ SESSION ROUTES LOADED");


// START QUIZ (Premium feature)
router.post("/start", protect, requirePremium, async (req, res) => {
  console.log('QUIZ START HIT');
  try {

    const { userId, courseId } = req.body;

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
      questions,
      startedAt: new Date()
    });

  } catch (err) {

    res.status(500).json({
      success: false,
      message: err.message
    });

  }

});

// QUIZ HEALTH CHECK
router.get("/health", (req, res) => {
  console.log('QUIZ HEALTH HIT');
  res.json({
    success: true,
    service: "quiz",
    status: "ok",
    timestamp: new Date().toISOString()
  });
});

// SUBMIT QUIZ (Premium feature - analytics)
router.post("/submit", protect, requirePremium, async (req, res) => {

  try {

    const {
      userId,
      courseId,
      answers,
      startTime
    } = req.body;

    let score = 0;

    let weakTopics = [];

    let processedQuestions = [];

    for (const item of answers) {

      const question = await Question.findById(item.questionId);

      if (!question) continue;

      const isCorrect =
        question.answer === item.selectedAnswer;

      if (isCorrect) {
        score++;
      } else {
        weakTopics.push(question.topic);
      }

      processedQuestions.push({
        questionId: question._id,
        selectedAnswer: item.selectedAnswer,
        correctAnswer: question.answer,
        isCorrect,
        topic: question.topic
      });

    }

    const totalQuestions = answers.length;

    const percentage =
      (score / totalQuestions) * 100;

    const timeEnded = new Date();

    const duration =
      Math.floor(
        (timeEnded - new Date(startTime)) / 1000
      );

    const session = await QuizSession.create({

      user: userId,

      course: courseId,

      questions: processedQuestions,

      score,

      totalQuestions,

      percentage,

      timeStarted: startTime,

      timeEnded,

      duration,

      weakTopics

    });

    res.json({
      success: true,
      session
    });

  } catch (err) {

    res.status(500).json({
      success: false,
      message: err.message
    });

  }

});


// GET USER RESULTS
router.get("/results/:userId", async (req, res) => {

  try {

    const results = await QuizSession.find({
      user: req.params.userId
    })
    .populate("course")
    .sort({ createdAt: -1 });

    res.json({
      success: true,
      results
    });

  } catch (err) {

    res.status(500).json({
      success: false,
      message: err.message
    });

  }

});

module.exports = router;