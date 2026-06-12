const express = require("express");
const router = express.Router();
const protect = require("../config/middleware/authMiddleware");

const Course = require("../models/course");
const Question = require("../models/Question");
const Note = require("../models/note");

console.log("🔍 SEARCH ROUTES LOADED");

/**
 * GLOBAL SEARCH
 * Search across Courses, Questions, Notes
 * 
 * Query params:
 * - q: search query (required)
 * - type: "courses" | "questions" | "notes" | "all" (default: all)
 * - limit: results per category (default: 10)
 */
router.get("/", protect, async (req, res) => {
  try {
    const { q, type = "all", limit = 10 } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Search query required"
      });
    }

    const searchQuery = q.trim();
    const resultsLimit = Math.min(parseInt(limit) || 10, 50); // Max 50 per category

    const results = {
      courses: [],
      questions: [],
      notes: [],
      total: 0
    };

    // Search courses by title, code, description
    if (type === "all" || type === "courses") {
      results.courses = await Course.find(
        { $text: { $search: searchQuery } },
        { score: { $meta: "textScore" } }
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(resultsLimit)
        .populate("department", "name code")
        .lean();
    }

    // Search questions by question text, topic
    if (type === "all" || type === "questions") {
      results.questions = await Question.find(
        { $text: { $search: searchQuery } },
        { score: { $meta: "textScore" } }
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(resultsLimit)
        .select("question topic course year difficulty")
        .populate("course", "title code")
        .lean();
    }

    // Search notes
    if (type === "all" || type === "notes") {
      results.notes = await Note.find(
        { $text: { $search: searchQuery } },
        { score: { $meta: "textScore" } }
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(resultsLimit)
        .select("title content course")
        .populate("course", "title code")
        .lean();
    }

    results.total = results.courses.length + results.questions.length + results.notes.length;

    res.json({
      success: true,
      query: searchQuery,
      ...results
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * ADVANCED SEARCH
 * Filter by department, level, year, etc.
 */
router.get("/advanced", protect, async (req, res) => {
  try {
    const { q, department, level, year, session } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        message: "Search query required"
      });
    }

    // Build filter
    const filter = { $text: { $search: q } };

    if (department) filter.department = department;
    if (level) filter.level = level;

    const results = {
      courses: await Course.find(filter)
        .limit(20)
        .populate("department", "name code")
        .lean(),
      questions: await Question.find({
        ...filter,
        ...(year && { year }),
        ...(session && { session })
      })
        .limit(20)
        .populate("course", "title code")
        .lean()
    };

    res.json({
      success: true,
      ...results
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * TRENDING SEARCHES
 * Get popular search terms
 */
router.get("/trending", async (req, res) => {
  try {
    // For now, return popular courses
    const popularCourses = await Course.find()
      .sort({ enrollmentCount: -1 })
      .limit(10)
      .select("title code enrollmentCount")
      .populate("department", "name")
      .lean();

    res.json({
      success: true,
      trending: popularCourses
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;
