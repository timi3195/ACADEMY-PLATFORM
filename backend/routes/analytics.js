const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

// Middleware
const protect = require("../config/middleware/authMiddleware");
const requirePremium = require("../config/middleware/planMiddleware");

// Models
const StudentPerformance = require("../models/StudentPerformance");
const AIConversation = require("../models/AIConversation");
const StudentNote = require("../models/StudentNote");
const LearningPath = require("../models/LearningPath");
const Course = require("../models/course");
const User = require("../models/User");
const studentAnalytics = require("../services/studentAnalyticsService");

router.get("/student", protect, async (req, res) => {
  try {
    const userId = req.user.id;
    if (!mongoose.Types.ObjectId.isValid(String(userId || ""))) {
      return res.status(401).json({ success: false, message: "Authenticated user ID is invalid." });
    }

    const user = await User.findById(userId).select("role");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    if (!["student", "admin"].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: "Student performance analytics are available only to students and administrators."
      });
    }

    const analytics = await studentAnalytics.getStudentAnalytics(userId);
    return res.json({ success: true, analytics });
  } catch (error) {
    console.error("Student performance analytics failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load student performance analytics."
    });
  }
});

/**
 * GET /api/analytics/performance/:courseId
 * Get comprehensive performance metrics for a course
 */
router.get("/performance/:courseId", protect, requirePremium, async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(courseId || ""))) {
      return res.status(400).json({ success: false, message: "Invalid course ID" });
    }

    const actingUserId = req.user?.id || req.user?._id;
    let performance = await StudentPerformance.findOne({
      user: actingUserId,
      course: courseId
    }).populate("course");

    if (!performance) {
      // Create default performance record
      performance = new StudentPerformance({
        user: req.user._id,
        course: courseId
      });
      await performance.save();
    }

    res.json({
      success: true,
      performance
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/analytics/dashboard
 * GET /api/analytics/dashboard/:userId
 * Get overall analytics dashboard
 */
const getDashboardHandler = async (req, res) => {
  try {
    const requestedUserId = req.params.userId || req.user.id;
    const actingUserId = req.user?.id || req.user?._id;

    if (req.params.userId && String(actingUserId) !== String(req.params.userId) && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const student = await User.findById(requestedUserId).populate("department", "name code");
    if (!student) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const performances = await StudentPerformance.find({
      user: requestedUserId
    }).populate("course");

    const totalAccuracy = performances.length > 0
      ? (performances.reduce((sum, p) => sum + (p.overallAccuracy || 0), 0) / performances.length)
      : 0;

    const allTopics = {};
    performances.forEach(p => {
      (p.topicMetrics || []).forEach(tm => {
        if (!allTopics[tm.topic]) {
          allTopics[tm.topic] = { correct: 0, total: 0 };
        }
        allTopics[tm.topic].correct += tm.correctAttempts;
        allTopics[tm.topic].total += tm.totalAttempts;
      });
    });

    const topicMetrics = Object.entries(allTopics)
      .map(([topic, data]) => ({
        topic,
        accuracy: data.total > 0 ? Number(((data.correct / data.total) * 100).toFixed(1)) : 0,
        attempts: data.total,
        mastery: data.total > 0
          ? (data.correct / data.total) >= 0.8 ? "Mastered"
          : (data.correct / data.total) >= 0.6 ? "Proficient"
          : "Developing"
          : "Beginner"
      }))
      .sort((a, b) => b.accuracy - a.accuracy);

    const topStrengths = topicMetrics.slice(0, 5).map(t => t.topic);
    const areasToImprove = topicMetrics
      .filter(t => t.attempts > 0)
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 5)
      .map(t => t.topic);

    const trendEntries = performances
      .flatMap(p => p.performanceTrend || [])
      .map((item) => ({
        date: new Date(item.date),
        accuracy: item.accuracy || 0,
        questionsAnswered: item.questionsAnswered || 0
      }))
      .sort((a, b) => a.date - b.date);

    const uniqueTrend = [];
    const trendDates = new Set();
    trendEntries.forEach((entry) => {
      const key = entry.date.toISOString().split('T')[0];
      if (!trendDates.has(key)) {
        trendDates.add(key);
        uniqueTrend.push(entry);
      }
    });

    const performanceTrend = uniqueTrend.slice(-8).map((entry, index) => ({
      ...entry,
      week: `Week ${index + 1}`
    }));

    const conversations = await AIConversation.countDocuments({ user: requestedUserId });
    const notes = await StudentNote.countDocuments({ user: requestedUserId });
    const paths = await LearningPath.countDocuments({ user: requestedUserId });

    let departmentalAvg = 0;
    if (student.department) {
      const avgResult = await StudentPerformance.aggregate([
        {
          $lookup: {
            from: 'users',
            localField: 'user',
            foreignField: '_id',
            as: 'user'
          }
        },
        { $unwind: '$user' },
        { $match: { 'user.department': student.department._id } },
        { $group: { _id: null, avgAccuracy: { $avg: '$overallAccuracy' } } }
      ]);
      departmentalAvg = avgResult[0]?.avgAccuracy || 0;
    }

    const estimatedExamScore = performances.length > 0
      ? performances.reduce((sum, p) => sum + (p.estimatedExamScore || 0), 0) / performances.length
      : 0;

    const dashboard = {
      performanceByCourse: performances,
      totalAccuracy,
      estimatedExamScore: Number(estimatedExamScore.toFixed(1)),
      topStrengths,
      areasToImprove,
      topicMetrics,
      performanceTrend,
      departmentalAvg: Number(departmentalAvg.toFixed(1)),
      engagement: {
        conversations,
        processedNotes: notes,
        learningPaths: paths
      }
    };

    return res.json({
      success: true,
      student: {
        id: student._id,
        name: student.name,
        email: student.email,
        program: student.department?.name || 'Unknown program',
        department: student.department?.name || 'Unknown department',
        semester: 'Current semester',
        yearOfStudy: student.yearOfStudy
      },
      dashboard
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

router.get("/dashboard", protect, getDashboardHandler);
router.get("/dashboard/:userId", protect, getDashboardHandler);

/**
 * GET /api/analytics/strengths/:courseId
 * Get top performing topics
 */
router.get("/strengths/:courseId", protect, async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ success: false, message: "Invalid course ID" });
    }

    const performance = await StudentPerformance.findOne({
      user: req.user._id,
      course: courseId
    });

    if (!performance) {
      return res.json({
        success: true,
        strengths: [],
        message: "No performance data yet"
      });
    }

    const strengths = performance.topicMetrics
      .filter(tm => tm.accuracy >= 70)
      .sort((a, b) => b.accuracy - a.accuracy);

    res.json({
      success: true,
      strengths,
      count: strengths.length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/analytics/weaknesses/:courseId
 * Get areas needing improvement
 */
router.get("/weaknesses/:courseId", protect, async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ success: false, message: "Invalid course ID" });
    }

    const performance = await StudentPerformance.findOne({
      user: req.user._id,
      course: courseId
    });

    if (!performance) {
      return res.json({
        success: true,
        weaknesses: [],
        message: "No performance data yet"
      });
    }

    const weaknesses = performance.topicMetrics
      .filter(tm => tm.accuracy < 70 && tm.totalAttempts > 0)
      .sort((a, b) => a.accuracy - b.accuracy);

    res.json({
      success: true,
      weaknesses,
      count: weaknesses.length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/analytics/trend/:courseId
 * Get performance trend over time
 */
router.get("/trend/:courseId", protect, async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ success: false, message: "Invalid course ID" });
    }

    const performance = await StudentPerformance.findOne({
      user: req.user._id,
      course: courseId
    });

    if (!performance || !performance.performanceTrend.length) {
      return res.json({
        success: true,
        trend: [],
        message: "No trend data yet"
      });
    }

    const trend = performance.performanceTrend
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({
      success: true,
      trend,
      improvementTrend: performance.improvementTrend
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/analytics/prediction/:courseId
 * Get predicted exam score
 */
router.get("/prediction/:courseId", protect, async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ success: false, message: "Invalid course ID" });
    }

    const performance = await StudentPerformance.findOne({
      user: req.user._id,
      course: courseId
    }).populate("course");

    if (!performance) {
      return res.json({
        success: true,
        prediction: null,
        message: "No performance data yet"
      });
    }

    res.json({
      success: true,
      prediction: {
        estimatedScore: performance.estimatedExamScore,
        accuracy: performance.overallAccuracy,
        readinessLevel: performance.estimatedExamScore > 80 ? "Excellent" :
                       performance.estimatedExamScore > 70 ? "Good" :
                       performance.estimatedExamScore > 60 ? "Fair" : "Needs Improvement",
        topicsMastered: performance.topicMetrics.filter(t => t.accuracy >= 80).length,
        topicsToFocus: performance.topicMetrics.filter(t => t.accuracy < 60).length,
        recommendations: [
          performance.topicMetrics.filter(t => t.accuracy < 60).length > 0
            ? `Focus on ${performance.areasToImprove[0] || "weak areas"}`
            : "Great work! Keep practicing to maintain your level",
          "Practice similar past questions",
          "Use the AI Study Assistant to clarify concepts"
        ]
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/record-attempt", protect, (req, res) => res.status(410).json({
  success: false,
  message: "Per-question analytics are no longer recorded. Complete a CBT attempt to update performance analytics."
}));

module.exports = router;
