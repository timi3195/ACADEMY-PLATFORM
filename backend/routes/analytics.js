const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

// Middleware
const protect = require("../config/middleware/authMiddleware");
const questionAccess = require("../services/questionAccessService");
const courseMembership = require("../services/courseMembershipService");

// Models
const AIConversation = require("../models/AIConversation");
const StudentNote = require("../models/StudentNote");
const LearningPath = require("../models/LearningPath");
const User = require("../models/User");
const studentAnalytics = require("../services/studentAnalyticsService");

const getCourseAnalytics = async (userId, courseId) => {
  const access = await questionAccess.getCourseAccess(userId, courseId);
  if (!access.allowed) return { access };
  const analytics = await studentAnalytics.getStudentAnalytics(userId, new Date(), {
    accessibleCourseIds: [courseId]
  });
  return {
    access,
    analytics,
    course: analytics.courses.find((item) => String(item.courseId) === String(courseId)) || null
  };
};

router.get("/student", protect, async (req, res) => {
  try {
    const userId = req.user.id;
    if (!mongoose.Types.ObjectId.isValid(String(userId || ""))) {
      return res.status(401).json({ success: false, message: "Authenticated user ID is invalid." });
    }

    const user = await User.findById(userId).select("role department");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    if (!["student", "admin"].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: "Student performance analytics are available only to students and administrators."
      });
    }

    const accessibleCourseIds = user.role === "student"
      ? await courseMembership.getValidAccessibleCourseIds(user)
      : undefined;
    const analytics = await studentAnalytics.getStudentAnalytics(userId, new Date(), {
      accessibleCourseIds
    });
    const recommendations = await studentAnalytics.getAiStudyRecommendations(userId, analytics);
    return res.json({
      success: true,
      analytics: {
        ...analytics,
        recommendations: recommendations.recommendations.map(({ evidenceId, ...item }) => item),
        recommendationsSource: recommendations.recommendationsSource,
        ...(recommendations.recommendationsNotice
          ? { recommendationsNotice: recommendations.recommendationsNotice }
          : {})
      }
    });
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
router.get("/performance/:courseId", protect, async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(courseId || ""))) {
      return res.status(400).json({ success: false, message: "Invalid course ID" });
    }

    const actingUserId = req.user?.id || req.user?._id;
    const { access, course } = await getCourseAnalytics(actingUserId, courseId);
    if (!access.allowed) {
      return res.status(access.statusCode || 403).json({
        success: false,
        message: access.message || "You are not authorized to access this course."
      });
    }

    return res.json({
      success: true,
      performance: course,
      dataSource: "quiz_sessions"
    });
  } catch (error) {
    console.error("Course performance analytics failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load course performance analytics."
    });
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

    if (!mongoose.Types.ObjectId.isValid(String(requestedUserId || ""))) {
      return res.status(400).json({ success: false, message: "Invalid user ID." });
    }
    if (req.params.userId && String(actingUserId) !== String(req.params.userId) && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const student = await User.findById(requestedUserId)
      .select("name email role department yearOfStudy")
      .populate("department", "name code");
    if (!student) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const accessibleCourseIds = await courseMembership.getValidAccessibleCourseIds(student);
    const analytics = await studentAnalytics.getStudentAnalytics(requestedUserId, new Date(), {
      accessibleCourseIds
    });
    const topicMetrics = analytics.topics;
    const topStrengths = topicMetrics
      .filter((topic) => topic.classification === "Strong")
      .slice(0, 5)
      .map((topic) => topic.topic);
    const areasToImprove = topicMetrics
      .filter((topic) => topic.classification === "Needs improvement")
      .slice(0, 5)
      .map((topic) => topic.topic);

    const conversations = await AIConversation.countDocuments({ user: requestedUserId });
    const notes = await StudentNote.countDocuments({ user: requestedUserId });
    const paths = await LearningPath.countDocuments({ user: requestedUserId });

    const dashboard = {
      dataSource: "quiz_sessions",
      performanceByCourse: analytics.courses,
      totalAccuracy: analytics.overview.overallAccuracy,
      estimatedExamScore: null,
      predictionAvailable: false,
      topStrengths,
      areasToImprove,
      topicMetrics,
      performanceTrend: analytics.performanceTrend,
      departmentalAvg: null,
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
    console.error("Analytics dashboard failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load the analytics dashboard."
    });
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

    const { access, course } = await getCourseAnalytics(
      req.user?.id || req.user?._id,
      courseId
    );
    if (!access.allowed) {
      return res.status(access.statusCode || 403).json({
        success: false,
        message: access.message || "You are not authorized to access this course."
      });
    }

    const strengths = course?.strongestTopics || [];

    return res.json({
      success: true,
      strengths,
      count: strengths.length
    });
  } catch (error) {
    console.error("Course strengths analytics failed:", error);
    return res.status(500).json({ success: false, message: "Unable to load course strengths." });
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

    const { access, course } = await getCourseAnalytics(
      req.user?.id || req.user?._id,
      courseId
    );
    if (!access.allowed) {
      return res.status(access.statusCode || 403).json({
        success: false,
        message: access.message || "You are not authorized to access this course."
      });
    }

    const weaknesses = course?.weakestTopics || [];

    return res.json({
      success: true,
      weaknesses,
      count: weaknesses.length
    });
  } catch (error) {
    console.error("Course weaknesses analytics failed:", error);
    return res.status(500).json({ success: false, message: "Unable to load course weaknesses." });
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

    const { access, course } = await getCourseAnalytics(
      req.user?.id || req.user?._id,
      courseId
    );
    if (!access.allowed) {
      return res.status(access.statusCode || 403).json({
        success: false,
        message: access.message || "You are not authorized to access this course."
      });
    }

    const trend = course?.performanceTrend || [];

    return res.json({
      success: true,
      trend,
      improvementTrend: course?.trend?.direction || "insufficient_data"
    });
  } catch (error) {
    console.error("Course performance trend failed:", error);
    return res.status(500).json({ success: false, message: "Unable to load course performance trend." });
  }
});

/**
 * GET /api/analytics/prediction/:courseId
 * Retained for compatibility; no validated exam-score prediction is available.
 */
router.get("/prediction/:courseId", protect, async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ success: false, message: "Invalid course ID" });
    }

    const { access } = await getCourseAnalytics(
      req.user?.id || req.user?._id,
      courseId
    );
    if (!access.allowed) {
      return res.status(access.statusCode || 403).json({
        success: false,
        message: access.message || "You are not authorized to access this course."
      });
    }

    return res.json({
      success: true,
      prediction: null,
      dataSource: "quiz_sessions",
      message: "No validated exam-score prediction is available from completed CBT attempts."
    });
  } catch (error) {
    console.error("Course score prediction failed:", error);
    return res.status(500).json({ success: false, message: "Unable to load course prediction." });
  }
});

router.post("/record-attempt", protect, (req, res) => res.status(410).json({
  success: false,
  message: "Per-question analytics are no longer recorded. Complete a CBT attempt to update performance analytics."
}));

module.exports = router;
