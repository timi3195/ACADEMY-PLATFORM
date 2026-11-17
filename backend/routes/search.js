const express = require("express");
const router = express.Router();
const protect = require("../config/middleware/authMiddleware");

const Course = require("../models/course");
const Question = require("../models/Question");
const Note = require("../models/note");
const User = require("../models/User");
const { getValidAccessibleCourseIds } = require("../services/courseMembershipService");

const getSearchContext = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return { user: null, courseIds: [] };

  return {
    user,
    courseIds: await getValidAccessibleCourseIds(user)
  };
};

const getSearchableQuestionFilter = ({ user, courseIds }) => {
  if (!user) return { approvalStatus: "approved", course: { $in: [] } };
  if (user.role === "admin") return { approvalStatus: "approved" };

  return {
    approvalStatus: "approved",
    course: { $in: courseIds || [] }
  };
};

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
    const searchContext = await getSearchContext(req.user.id);

    const results = {
      courses: [],
      questions: [],
      notes: [],
      total: 0
    };

    // Search courses by title, code, description
    if (type === "all" || type === "courses") {
      const courseFilter = { $text: { $search: searchQuery } };
      if (searchContext.courseIds !== null) {
        courseFilter._id = { $in: searchContext.courseIds || [] };
      }
      results.courses = await Course.find(
        courseFilter,
        { score: { $meta: "textScore" } }
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(resultsLimit)
        .populate("department", "name code")
        .select("-isPremium")
        .lean();
    }

    // Search questions by question text, topic
    if (type === "all" || type === "questions") {
      const questionScope = getSearchableQuestionFilter(searchContext);
      results.questions = await Question.find(
        { ...questionScope, $text: { $search: searchQuery } },
        { score: { $meta: "textScore" } }
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(resultsLimit)
        .select("question topic course year difficulty options")
        .populate("course", "title code")
        .lean();
    }

    // Search notes
    if (type === "all" || type === "notes") {
      const noteFilter = { $text: { $search: searchQuery } };
      if (searchContext.courseIds !== null) {
        noteFilter.course = { $in: searchContext.courseIds || [] };
      }
      results.notes = await Note.find(
        noteFilter,
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

    const searchContext = await getSearchContext(req.user.id);
    const courseFilter = { $text: { $search: q } };
    if (level) courseFilter.level = level;
    if (searchContext.user?.role === "admin" && department) {
      courseFilter.department = department;
    }
    if (searchContext.courseIds !== null) {
      courseFilter._id = { $in: searchContext.courseIds || [] };
    }

    const questionFilter = { $text: { $search: q } };
    if (year) questionFilter.year = year;
    if (session) questionFilter.session = session;
    if (searchContext.user?.role === "admin" && department) {
      questionFilter.department = department;
    }
    const questionScope = getSearchableQuestionFilter(searchContext);
    const results = {
      courses: await Course.find(courseFilter)
        .limit(20)
        .populate("department", "name code")
        .select("-isPremium")
        .lean(),
      questions: await Question.find({
        ...questionScope,
        ...questionFilter
      })
        .limit(20)
        .select("question topic course year session difficulty options")
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
