const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const protect = require("../config/middleware/authMiddleware");
const requirePremium = require("../config/middleware/planMiddleware");
const Question = require("../models/Question");
const Course = require("../models/course");

console.log("🔥 AI ROUTES LOADED");

function generateQuiz(topic) {
  return [
    {
      question: `What is ${topic}?`,
      options: [
        "A programming language",
        "A database",
        `${topic} is a computer science concept`,
        "An operating system"
      ],
      answer: `${topic} is a computer science concept`
    },
    {
      question: `Which of these relates to ${topic}?`,
      options: [
        "Networking",
        topic,
        "Hardware repair",
        "Graphic design"
      ],
      answer: topic
    },
    {
      question: `Why is ${topic} important?`,
      options: [
        "It improves cooking",
        "It is irrelevant",
        "It helps solve computing problems",
        "It is only for gaming"
      ],
      answer: "It helps solve computing problems"
    }
  ];
}

const generateQuizHandler = async (req, res) => {
  try {
    const { topic, courseId } = req.body;

    if (!topic) {
      return res.status(400).json({
        success: false,
        message: "Topic is required"
      });
    }

    const textSearch = new RegExp(topic, 'i');
    const filter = {
      $or: [
        { topic: textSearch },
        { question: textSearch },
        { explanation: textSearch },
        { options: { $elemMatch: { $regex: textSearch } } }
      ]
    };

    if (courseId) {
      if (!mongoose.Types.ObjectId.isValid(courseId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid course ID supplied"
        });
      }
      filter.course = mongoose.Types.ObjectId(courseId);
    }

    const historicalQuestions = await Question.find(filter).populate('course').lean();
    let analysis = '';
    let predictedQuestions = [];

    if (historicalQuestions.length > 0) {
      const frequency = {};
      const questionLookup = {};

      historicalQuestions.forEach((item) => {
        const text = (item.question || '').trim();
        if (!text) return;
        frequency[text] = (frequency[text] || 0) + 1;
        questionLookup[text] = item;
      });

      const sorted = Object.entries(frequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([text]) => questionLookup[text]);

      predictedQuestions = sorted.map((item) => ({
        question: item.question,
        options: item.options || [],
        answer: item.answer || '',
        explanation: item.explanation || '',
        course: item.course?.title || 'Unknown course',
        year: item.year,
        session: item.session,
        repeated: frequency[item.question?.trim() || ''] || 1
      }));

      const repeatCount = Object.values(frequency).filter((count) => count > 1).length;
      if (repeatCount > 0) {
        analysis = `Found ${historicalQuestions.length} historical question(s) for this topic. ${repeatCount} exact question${repeatCount === 1 ? '' : 's'} repeated across past exams. These are the most likely exam items.`;
      } else {
        analysis = `Found ${historicalQuestions.length} related historical question(s). Predictions are based on repeated exam patterns and similar question wording.`;
      }
    }

    if (predictedQuestions.length === 0) {
      predictedQuestions = generateQuiz(topic);
      analysis = `No direct historical past questions were found for "${topic}". Generated likely exam-style questions from the topic.`;
    }

    if (predictedQuestions.length < 4) {
      const filler = generateQuiz(topic).slice(0, 4 - predictedQuestions.length);
      predictedQuestions = [...predictedQuestions, ...filler];
    }

    res.json({
      success: true,
      topic,
      analysis,
      questions: predictedQuestions,
      historicalCount: historicalQuestions.length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Allow authenticated users (AI/chatbot) full access to search content
router.post("/generate-quiz", protect, generateQuizHandler);
router.post("/generate-questions", protect, generateQuizHandler);

// Search courses and past questions for AI usage. Returns both matching courses and questions.
router.post("/search-materials", protect, async (req, res) => {
  try {
    const { query, courseId, departmentId, limit = 20 } = req.body;
    if (!query) {
      return res.status(400).json({ success: false, message: "Query is required" });
    }

    const textSearch = new RegExp(query, 'i');

    const courseFilter = {
      $or: [
        { title: textSearch },
        { code: textSearch },
        { description: textSearch }
      ]
    };

    if (courseId) {
      courseFilter._id = courseId;
    }

    if (departmentId) {
      courseFilter.department = departmentId;
    }

    const courses = await Course.find(courseFilter).limit(parseInt(limit)).lean();

    const questionFilter = {
      $or: [
        { question: textSearch },
        { topic: textSearch },
        { explanation: textSearch },
        { options: { $elemMatch: { $regex: textSearch } } }
      ]
    };

    if (courseId) questionFilter.course = courseId;
    if (departmentId) questionFilter.department = departmentId;

    const questions = await Question.find(questionFilter).populate('course').limit(parseInt(limit)).lean();

    res.json({ success: true, query, courses, questions, totalCourses: courses.length, totalQuestions: questions.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Fetch single course and its questions (full access)
router.get("/course/:id", protect, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, message: 'Course id required' });

    const course = await Course.findById(id).lean();
    if (!course) return res.status(404).json({ success: false, message: 'Course not found' });

    const questions = await Question.find({ course: id }).lean();
    res.json({ success: true, course, questions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Fetch single question (full access)
router.get("/question/:id", protect, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, message: 'Question id required' });

    const question = await Question.findById(id).populate('course').lean();
    if (!question) return res.status(404).json({ success: false, message: 'Question not found' });

    res.json({ success: true, question });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/submit-quiz", protect, requirePremium, (req, res) => {
  const { answers, quiz } = req.body;

  if (!answers || !quiz) {
    return res.status(400).json({
      success: false,
      message: "Answers and quiz are required"
    });
  }

  let score = 0;

  quiz.forEach((q, index) => {
    if (answers[index] === q.answer) {
      score++;
    }
  });

  res.json({
    success: true,
    totalQuestions: quiz.length,
    score,
    percentage: (score / quiz.length) * 100
  });
});

module.exports = router;