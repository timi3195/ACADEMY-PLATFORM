const mongoose = require("mongoose");
const QuizSession = require("../models/QuizSession");
const Course = require("../models/course");

const TOPIC_THRESHOLDS = Object.freeze({
  strong: 80,
  developing: 60,
  minimumAnsweredQuestions: 3
});
const TREND_MINIMUM_ATTEMPTS = 4;
const TREND_CHANGE_THRESHOLD = 5;
const MAX_TREND_ATTEMPTS = 50;

const createAttemptSummaryStages = () => [
  {
    $group: {
      _id: "$_id",
      courseId: { $first: "$course" },
      completedAt: { $first: "$_analyticsCompletedAt" },
      score: { $first: "$score" },
      percentage: { $first: "$percentage" },
      totalQuestions: {
        $sum: { $cond: [{ $ne: ["$questions.questionId", null] }, 1, 0] }
      },
      questionsAnswered: { $sum: { $cond: ["$_analyticsAnswered", 1, 0] } },
      correctAnswers: { $sum: { $cond: ["$_analyticsCorrect", 1, 0] } }
    }
  },
  {
    $addFields: {
      incorrectAnswers: { $subtract: ["$questionsAnswered", "$correctAnswers"] },
      scorePercentage: {
        $cond: [
          { $isNumber: "$percentage" },
          "$percentage",
          {
            $cond: [
              { $gt: ["$totalQuestions", 0] },
              { $multiply: [{ $divide: ["$score", "$totalQuestions"] }, 100] },
              null
            ]
          }
        ]
      }
    }
  }
];

const buildAnalyticsPipeline = (userId) => {
  const completedAttempts = [
    {
      $match: {
        user: new mongoose.Types.ObjectId(String(userId)),
        status: "completed",
        $or: [
          { timeEnded: { $type: "date" } },
          { completedAt: { $type: "date" } }
        ]
      }
    },
    {
      $project: {
        course: 1,
        score: 1,
        percentage: 1,
        timeEnded: 1,
        completedAt: 1,
        questions: {
          $cond: [{ $isArray: "$questions" }, "$questions", []]
        }
      }
    },
    {
      $addFields: {
        _analyticsCompletedAt: { $ifNull: ["$completedAt", "$timeEnded"] }
      }
    },
    {
      $unwind: {
        path: "$questions",
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $addFields: {
        _analyticsAnswered: {
          $and: [
            { $eq: [{ $type: "$questions.selectedOptionId" }, "string"] },
            {
              $in: [
                "$questions.selectedOptionId",
                {
                  $map: {
                    input: { $ifNull: ["$questions.presentedOptions", []] },
                    as: "option",
                    in: "$$option.optionId"
                  }
                }
              ]
            }
          ]
        },
        _analyticsTopic: {
          $cond: [
            { $eq: [{ $type: "$questions.topic" }, "string"] },
            { $trim: { input: "$questions.topic" } },
            ""
          ]
        }
      }
    },
    {
      $addFields: {
        _analyticsCorrect: {
          $and: [
            "$_analyticsAnswered",
            {
              $cond: [
                { $eq: [{ $type: "$questions.isCorrect" }, "bool"] },
                { $eq: ["$questions.isCorrect", true] },
                { $eq: ["$questions.selectedOptionId", "$questions.correctOptionId"] }
              ]
            }
          ]
        }
      }
    }
  ];

  return [
    ...completedAttempts,
    {
      $facet: {
        overview: [
          ...createAttemptSummaryStages(),
          {
            $group: {
              _id: null,
              totalCompletedAttempts: { $sum: 1 },
              averageScorePercentage: { $avg: "$scorePercentage" },
              totalQuestions: { $sum: "$totalQuestions" },
              totalQuestionsAnswered: { $sum: "$questionsAnswered" },
              totalCorrectAnswers: { $sum: "$correctAnswers" },
              totalIncorrectAnswers: { $sum: "$incorrectAnswers" },
              mostRecentCompletedAt: { $max: "$completedAt" }
            }
          }
        ],
        courses: [
          ...createAttemptSummaryStages(),
          {
            $group: {
              _id: "$courseId",
              completedAttempts: { $sum: 1 },
              averageScorePercentage: { $avg: "$scorePercentage" },
              totalQuestions: { $sum: "$totalQuestions" },
              questionsAnswered: { $sum: "$questionsAnswered" },
              correctAnswers: { $sum: "$correctAnswers" },
              incorrectAnswers: { $sum: "$incorrectAnswers" },
              mostRecentCompletedAt: { $max: "$completedAt" }
            }
          },
          {
            $lookup: {
              from: Course.collection.name,
              localField: "_id",
              foreignField: "_id",
              as: "course"
            }
          },
          { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              courseId: "$_id",
              title: "$course.title",
              code: "$course.code",
              completedAttempts: 1,
              averageScorePercentage: 1,
              totalQuestions: 1,
              questionsAnswered: 1,
              correctAnswers: 1,
              incorrectAnswers: 1,
              mostRecentCompletedAt: 1
            }
          },
          { $sort: { mostRecentCompletedAt: -1 } }
        ],
        topics: [
          { $match: { _analyticsTopic: { $ne: "" } } },
          {
            $group: {
              _id: { courseId: "$course", topic: "$_analyticsTopic" },
              totalQuestions: {
                $sum: { $cond: [{ $ne: ["$questions.questionId", null] }, 1, 0] }
              },
              questionsAnswered: { $sum: { $cond: ["$_analyticsAnswered", 1, 0] } },
              correctAnswers: { $sum: { $cond: ["$_analyticsCorrect", 1, 0] } }
            }
          },
          {
            $addFields: {
              incorrectAnswers: { $subtract: ["$questionsAnswered", "$correctAnswers"] },
              accuracy: {
                $cond: [
                  { $gt: ["$questionsAnswered", 0] },
                  {
                    $multiply: [
                      { $divide: ["$correctAnswers", "$questionsAnswered"] },
                      100
                    ]
                  },
                  null
                ]
              }
            }
          },
          {
            $lookup: {
              from: Course.collection.name,
              localField: "_id.courseId",
              foreignField: "_id",
              as: "course"
            }
          },
          { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              courseId: "$_id.courseId",
              courseTitle: "$course.title",
              courseCode: "$course.code",
              topic: "$_id.topic",
              totalQuestions: 1,
              questionsAnswered: 1,
              correctAnswers: 1,
              incorrectAnswers: 1,
              accuracy: 1
            }
          },
          { $sort: { courseTitle: 1, topic: 1 } }
        ],
        trend: [
          ...createAttemptSummaryStages(),
          { $sort: { completedAt: -1, _id: -1 } },
          { $limit: MAX_TREND_ATTEMPTS },
          { $sort: { completedAt: 1, _id: 1 } },
          {
            $project: {
              attemptId: "$_id",
              completedAt: 1,
              scorePercentage: 1,
              questionsAnswered: 1,
              correctAnswers: 1,
              accuracy: {
                $cond: [
                  { $gt: ["$questionsAnswered", 0] },
                  {
                    $multiply: [
                      { $divide: ["$correctAnswers", "$questionsAnswered"] },
                      100
                    ]
                  },
                  null
                ]
              }
            }
          }
        ],
        unclassified: [
          { $match: { _analyticsTopic: "", _analyticsAnswered: true } },
          { $count: "answeredQuestions" }
        ]
      }
    }
  ];
};

const roundOneDecimal = (value) =>
  Number.isFinite(value) ? Number(value.toFixed(1)) : null;

const classifyTopic = ({ accuracy, questionsAnswered }) => {
  if (questionsAnswered < TOPIC_THRESHOLDS.minimumAnsweredQuestions || !Number.isFinite(accuracy)) {
    return "Insufficient data";
  }
  if (accuracy >= TOPIC_THRESHOLDS.strong) return "Strong";
  if (accuracy >= TOPIC_THRESHOLDS.developing) return "Developing";
  return "Needs improvement";
};

const normalizeTopics = (topicRows = []) => topicRows
  .filter((topic) => typeof topic.topic === "string" && topic.topic.trim())
  .map((topic) => ({
    courseId: topic.courseId,
    courseTitle: topic.courseTitle || "Course",
    courseCode: topic.courseCode || "",
    topic: topic.topic.trim(),
    totalQuestions: topic.totalQuestions || 0,
    questionsAnswered: topic.questionsAnswered || 0,
    correctAnswers: topic.correctAnswers || 0,
    incorrectAnswers: topic.incorrectAnswers || 0,
    accuracy: roundOneDecimal(topic.accuracy),
    classification: classifyTopic(topic)
  }));

const calculateTrend = (attempts = []) => {
  const usable = attempts.filter((attempt) => Number.isFinite(attempt.accuracy));
  if (usable.length < TREND_MINIMUM_ATTEMPTS) {
    return { direction: "insufficient_data", comparedAttempts: usable.length, changePercentagePoints: null };
  }
  const previous = usable.slice(-4, -2);
  const recent = usable.slice(-2);
  const mean = (items) => items.reduce((sum, item) => sum + item.accuracy, 0) / items.length;
  const change = mean(recent) - mean(previous);
  return {
    direction: change > TREND_CHANGE_THRESHOLD
      ? "improving"
      : change < -TREND_CHANGE_THRESHOLD
        ? "declining"
        : "stable",
    comparedAttempts: usable.length,
    changePercentagePoints: roundOneDecimal(change)
  };
};

const buildRecommendations = ({ courses, topics, trend, generatedAt }) => {
  const recommendations = [];
  for (const topic of topics) {
    const support = `${topic.accuracy ?? "Not enough"}% accuracy across ${topic.questionsAnswered} answered question(s)`;
    if (topic.classification === "Needs improvement") {
      recommendations.push({
        courseId: topic.courseId,
        course: topic.courseTitle,
        topic: topic.topic,
        reason: `Your results show ${support}.`,
        evidence: {
          questionsAnswered: topic.questionsAnswered,
          correctAnswers: topic.correctAnswers,
          accuracy: topic.accuracy
        },
        suggestedAction: `Review the core ideas in ${topic.topic}, then practise related questions.`,
        priority: topic.accuracy < 40 ? "high" : "medium",
        generatedAt
      });
    } else if (topic.classification === "Developing") {
      recommendations.push({
        courseId: topic.courseId,
        course: topic.courseTitle,
        topic: topic.topic,
        reason: `Your results show ${support}; more practice may help consolidate this topic.`,
        evidence: {
          questionsAnswered: topic.questionsAnswered,
          correctAnswers: topic.correctAnswers,
          accuracy: topic.accuracy
        },
        suggestedAction: `Practise a short set of ${topic.topic} questions and review any missed concepts.`,
        priority: "medium",
        generatedAt
      });
    } else if (topic.classification === "Insufficient data") {
      recommendations.push({
        courseId: topic.courseId,
        course: topic.courseTitle,
        topic: topic.topic,
        reason: `Only ${topic.questionsAnswered} question(s) have been answered for this topic; there is not enough evidence to classify performance.`,
        evidence: {
          questionsAnswered: topic.questionsAnswered,
          correctAnswers: topic.correctAnswers,
          accuracy: topic.accuracy
        },
        suggestedAction: `Attempt more ${topic.topic} questions before drawing conclusions about your performance.`,
        priority: "low",
        generatedAt
      });
    }
  }

  for (const course of courses) {
    if (course.questionsAnswered > 0 && course.questionsAnswered < TOPIC_THRESHOLDS.minimumAnsweredQuestions) {
      recommendations.push({
        courseId: course.courseId,
        course: course.title,
        topic: null,
        reason: `You have answered ${course.questionsAnswered} question(s) in this course, which is not enough to establish a reliable course-level pattern.`,
        evidence: {
          completedAttempts: course.completedAttempts,
          questionsAnswered: course.questionsAnswered,
          accuracy: course.accuracy
        },
        suggestedAction: `Complete another practice attempt in ${course.title}.`,
        priority: "low",
        generatedAt
      });
    }
  }

  if (trend.direction === "declining") {
    recommendations.push({
      courseId: null,
      course: null,
      topic: null,
      reason: `Accuracy across the latest two completed attempts is ${Math.abs(trend.changePercentagePoints)} percentage points lower than the preceding two.`,
      evidence: {
        comparedAttempts: trend.comparedAttempts,
        changePercentagePoints: trend.changePercentagePoints
      },
      suggestedAction: "Review recent missed questions and schedule a focused practice session.",
      priority: "medium",
      generatedAt
    });
  }

  return recommendations
    .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]))
    .slice(0, 12);
};

const buildStudentAnalytics = (aggregation = {}, generatedAt = new Date()) => {
  const overview = aggregation.overview?.[0] || {};
  const attempts = aggregation.trend || [];
  const topics = normalizeTopics(aggregation.topics);
  const courseRows = aggregation.courses || [];
  const courses = courseRows.map((course) => {
    const courseTopics = topics.filter((topic) => String(topic.courseId) === String(course.courseId));
    const accuracy = course.questionsAnswered > 0
      ? (course.correctAnswers / course.questionsAnswered) * 100
      : null;
    return {
      courseId: course.courseId,
      title: course.title || "Course",
      code: course.code || "",
      completedAttempts: course.completedAttempts || 0,
      averageScorePercentage: roundOneDecimal(course.averageScorePercentage),
      accuracy: roundOneDecimal(accuracy),
      totalQuestions: course.totalQuestions || 0,
      questionsAnswered: course.questionsAnswered || 0,
      correctAnswers: course.correctAnswers || 0,
      incorrectAnswers: course.incorrectAnswers || 0,
      strongestTopics: courseTopics
        .filter((topic) => topic.classification === "Strong")
        .sort((a, b) => b.accuracy - a.accuracy)
        .slice(0, 5),
      weakestTopics: courseTopics
        .filter((topic) => topic.classification === "Needs improvement")
        .sort((a, b) => a.accuracy - b.accuracy)
        .slice(0, 5),
      insufficientTopics: courseTopics
        .filter((topic) => topic.classification === "Insufficient data"),
      mostRecentCompletedAt: course.mostRecentCompletedAt || null
    };
  });
  const performanceTrend = attempts.map((attempt) => ({
    attemptId: attempt.attemptId,
    completedAt: attempt.completedAt,
    accuracy: roundOneDecimal(attempt.accuracy),
    scorePercentage: roundOneDecimal(attempt.scorePercentage),
    questionsAnswered: attempt.questionsAnswered || 0,
    correctAnswers: attempt.correctAnswers || 0
  }));
  const trend = calculateTrend(performanceTrend);
  const normalizedOverview = {
    totalCompletedAttempts: overview.totalCompletedAttempts || 0,
    totalQuestions: overview.totalQuestions || 0,
    totalQuestionsAnswered: overview.totalQuestionsAnswered || 0,
    totalCorrectAnswers: overview.totalCorrectAnswers || 0,
    totalIncorrectAnswers: overview.totalIncorrectAnswers || 0,
    overallAccuracy: overview.totalQuestionsAnswered > 0
      ? roundOneDecimal((overview.totalCorrectAnswers / overview.totalQuestionsAnswered) * 100)
      : null,
    averageScorePercentage: roundOneDecimal(overview.averageScorePercentage),
    mostRecentCompletedAt: overview.mostRecentCompletedAt || null,
    unclassifiedAnsweredQuestions: aggregation.unclassified?.[0]?.answeredQuestions || 0
  };

  const recommendations = buildRecommendations({
    courses,
    topics,
    trend,
    generatedAt
  });

  return {
    generatedAt,
    overview: normalizedOverview,
    courses,
    topics,
    performanceTrend,
    trend,
    recommendations,
    topicThresholds: {
      strong: TOPIC_THRESHOLDS.strong,
      developing: TOPIC_THRESHOLDS.developing,
      minimumAnsweredQuestions: TOPIC_THRESHOLDS.minimumAnsweredQuestions
    }
  };
};

const getStudentAnalytics = async (userId, generatedAt = new Date()) => {
  const aggregation = await QuizSession.aggregate(buildAnalyticsPipeline(userId)).allowDiskUse(true);
  return buildStudentAnalytics(aggregation[0] || {}, generatedAt);
};

const buildCoursePerformanceContext = (analytics = {}, courseId) => {
  const course = (analytics.courses || []).find(
    (item) => String(item.courseId) === String(courseId)
  );
  if (!course || course.completedAttempts < 1) {
    return {
      hasCompletedAttempts: false,
      scope: "selected_course",
      completedAttempts: 0
    };
  }

  const summarizeTopics = (topics = [], includeAccuracy) => topics.slice(0, 5).map((topic) => ({
    topic: topic.topic,
    questionsAnswered: topic.questionsAnswered,
    ...(includeAccuracy ? { accuracy: topic.accuracy } : {})
  }));
  const trend = analytics.trend || {};

  return {
    hasCompletedAttempts: true,
    scope: "selected_course",
    completedAttempts: course.completedAttempts,
    averageScorePercentage: course.averageScorePercentage,
    accuracy: course.accuracy,
    questionsAnswered: course.questionsAnswered,
    strongTopics: summarizeTopics(course.strongestTopics, true),
    weakTopics: summarizeTopics(course.weakestTopics, true),
    topicsWithInsufficientEvidence: summarizeTopics(course.insufficientTopics),
    overallTrend: {
      scope: "all_courses",
      direction: trend.direction || "insufficient_data",
      comparedAttempts: trend.comparedAttempts || 0,
      changePercentagePoints: trend.changePercentagePoints ?? null
    }
  };
};

module.exports = {
  TOPIC_THRESHOLDS,
  TREND_MINIMUM_ATTEMPTS,
  TREND_CHANGE_THRESHOLD,
  MAX_TREND_ATTEMPTS,
  buildAnalyticsPipeline,
  classifyTopic,
  calculateTrend,
  buildStudentAnalytics,
  getStudentAnalytics,
  buildCoursePerformanceContext
};
