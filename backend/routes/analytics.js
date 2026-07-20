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
const Question = require("../models/Question");
const Course = require("../models/course");
const User = require("../models/User");

/**
 * GET /api/analytics/performance/:courseId
 * Get comprehensive performance metrics for a course
 */
router.get("/performance/:courseId", protect, requirePremium, async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ success: false, message: "Invalid course ID" });
    }

    let performance = await StudentPerformance.findOne({
      user: req.user._id,
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

    // Can only view own dashboard unless admin
    if (req.params.userId && req.user._id.toString() !== req.params.userId && req.user.role !== "admin") {
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

/**
 * POST /api/analytics/record-attempt
 * Record a question attempt and update performance
 */
router.post("/record-attempt", protect, async (req, res) => {
  try {
    const { courseId, questionId, topic, isCorrect } = req.body;

    if (!courseId || !questionId || !topic === undefined || isCorrect === undefined) {
      return res.status(400).json({
        success: false,
        message: "courseId, questionId, topic, and isCorrect are required"
      });
    }

    // Get or create performance record
    let performance = await StudentPerformance.findOne({
      user: req.user._id,
      course: courseId
    });

    if (!performance) {
      performance = new StudentPerformance({
        user: req.user._id,
        course: courseId
      });
    }

    // Find or create topic metric
    let topicMetric = performance.topicMetrics.find(tm => tm.topic === topic);
    if (!topicMetric) {
      topicMetric = {
        topic,
        correctAttempts: 0,
        totalAttempts: 0,
        accuracy: 0,
        masteryLevel: "beginner",
        estimatedReadiness: 0
      };
      performance.topicMetrics.push(topicMetric);
    }

    // Update metrics
    topicMetric.totalAttempts += 1;
    if (isCorrect) {
      topicMetric.correctAttempts += 1;
    }
    topicMetric.accuracy = (topicMetric.correctAttempts / topicMetric.totalAttempts) * 100;
    topicMetric.lastAttemptDate = new Date();

    // Determine mastery level
    if (topicMetric.accuracy >= 80) {
      topicMetric.masteryLevel = "advanced";
      topicMetric.estimatedReadiness = 85;
    } else if (topicMetric.accuracy >= 60) {
      topicMetric.masteryLevel = "intermediate";
      topicMetric.estimatedReadiness = 65;
    } else if (topicMetric.accuracy >= 40) {
      topicMetric.masteryLevel = "beginner";
      topicMetric.estimatedReadiness = 40;
    } else {
      topicMetric.masteryLevel = "beginner";
      topicMetric.estimatedReadiness = 20;
    }

    // Add to performance trend
    const today = new Date().toDateString();
    let trendEntry = performance.performanceTrend.find(
      t => new Date(t.date).toDateString() === today
    );
    if (!trendEntry) {
      trendEntry = {
        date: new Date(),
        accuracy: 0,
        questionsAnswered: 0
      };
      performance.performanceTrend.push(trendEntry);
    }
    trendEntry.questionsAnswered += 1;
    trendEntry.accuracy = (performance.topicMetrics.reduce((sum, t) => sum + (t.correctAttempts / t.totalAttempts) * 100, 0) / performance.topicMetrics.length) || 0;

    // Update overall metrics
    const totalCorrect = performance.topicMetrics.reduce((sum, t) => sum + t.correctAttempts, 0);
    const totalAttempts = performance.topicMetrics.reduce((sum, t) => sum + t.totalAttempts, 0);
    performance.overallAccuracy = (totalCorrect / totalAttempts) * 100;
    performance.estimatedExamScore = performance.overallAccuracy * 0.9; // Slightly conservative estimate

    performance.topStrengths = performance.topicMetrics
      .filter(t => t.accuracy >= 70)
      .sort((a, b) => b.accuracy - a.accuracy)
      .slice(0, 3)
      .map(t => t.topic);

    performance.areasToImprove = performance.topicMetrics
      .filter(t => t.accuracy < 60 && t.totalAttempts > 0)
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 3)
      .map(t => t.topic);

    // Determine improvement trend
    if (performance.performanceTrend.length > 1) {
      const recent = performance.performanceTrend.slice(-3);
      const averageRecent = recent.reduce((sum, t) => sum + t.accuracy, 0) / recent.length;
      const previous = performance.performanceTrend.slice(-6, -3);
      const averagePrevious = previous.length > 0
        ? previous.reduce((sum, t) => sum + t.accuracy, 0) / previous.length
        : averageRecent;

      if (averageRecent > averagePrevious + 5) {
        performance.improvementTrend = "improving";
      } else if (averageRecent < averagePrevious - 5) {
        performance.improvementTrend = "declining";
      } else {
        performance.improvementTrend = "stable";
      }
    }

    performance.lastUpdatedAt = new Date();
    await performance.save();

    res.json({
      success: true,
      message: "Performance updated",
      performance
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
