const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const QuizSession = require("../models/QuizSession");
const {
  buildAnalyticsPipeline,
  buildCoursePerformanceContext,
  buildStudentAnalytics,
  calculateTrend,
  classifyTopic,
  getStudentAnalytics
} = require("../services/studentAnalyticsService");

const STUDENT_ID = "507f1f77bcf86cd799439011";

test("analytics aggregation includes only completed, finalized attempts owned by the student", () => {
  const pipeline = buildAnalyticsPipeline(STUDENT_ID);
  const match = pipeline[0].$match;
  assert.equal(String(match.user), STUDENT_ID);
  assert.equal(match.status, "completed");
  assert.deepEqual(match.$or, [
    { timeEnded: { $type: "date" } },
    { completedAt: { $type: "date" } }
  ]);
  assert.ok(pipeline.some((stage) => stage.$facet));
  const overviewStages = pipeline.find((stage) => stage.$facet).$facet.overview;
  assert.ok(overviewStages.some((stage) => stage.$group?._id === "$_id"));
  const snapshotCorrectnessStage = pipeline.find((stage) =>
    stage.$addFields?._analyticsCorrect
  );
  assert.ok(snapshotCorrectnessStage.$addFields._analyticsCorrect.$and[1].$cond);
});

test("analytics query passes authenticated ownership to Mongo aggregation", async () => {
  const originalAggregate = QuizSession.aggregate;
  let pipeline;
  QuizSession.aggregate = (value) => {
    pipeline = value;
    return { allowDiskUse: async () => [{}] };
  };
  try {
    const result = await getStudentAnalytics(STUDENT_ID, new Date("2025-01-01T00:00:00Z"));
    assert.equal(String(pipeline[0].$match.user), STUDENT_ID);
    assert.ok(pipeline[0].$match.user instanceof mongoose.Types.ObjectId);
    assert.equal(result.overview.totalCompletedAttempts, 0);
    assert.equal(result.overview.overallAccuracy, null);
  } finally {
    QuizSession.aggregate = originalAggregate;
  }
});

test("overall and course statistics use answered questions and persisted scores", () => {
  const analytics = buildStudentAnalytics({
    overview: [{
      totalCompletedAttempts: 1,
      totalQuestions: 5,
      totalQuestionsAnswered: 4,
      totalCorrectAnswers: 2,
      totalIncorrectAnswers: 2,
      averageScorePercentage: 40,
      mostRecentCompletedAt: new Date("2025-02-01T12:00:00Z")
    }],
    courses: [{
      courseId: "course-1",
      title: "Networking",
      code: "NET101",
      completedAttempts: 1,
      averageScorePercentage: 40,
      totalQuestions: 5,
      questionsAnswered: 4,
      correctAnswers: 2,
      incorrectAnswers: 2,
      mostRecentCompletedAt: new Date("2025-02-01T12:00:00Z")
    }],
    topics: [{
      courseId: "course-1",
      courseTitle: "Networking",
      courseCode: "NET101",
      topic: "Subnetting",
      totalQuestions: 4,
      questionsAnswered: 4,
      correctAnswers: 1,
      incorrectAnswers: 3,
      accuracy: 25
    }],
    trend: [],
    unclassified: [{ answeredQuestions: 1 }]
  });
  assert.equal(analytics.overview.totalCompletedAttempts, 1);
  assert.equal(analytics.overview.totalQuestions, 5);
  assert.equal(analytics.overview.totalQuestionsAnswered, 4);
  assert.equal(analytics.overview.totalCorrectAnswers, 2);
  assert.equal(analytics.overview.totalIncorrectAnswers, 2);
  assert.equal(analytics.overview.overallAccuracy, 50);
  assert.equal(analytics.courses[0].accuracy, 50);
  assert.equal(analytics.courses[0].averageScorePercentage, 40);
  assert.equal(analytics.topics[0].classification, "Needs improvement");
  assert.equal(analytics.overview.unclassifiedAnsweredQuestions, 1);
});

test("topic classification requires enough actual answered questions", () => {
  assert.equal(classifyTopic({ accuracy: 100, questionsAnswered: 2 }), "Insufficient data");
  assert.equal(classifyTopic({ accuracy: 80, questionsAnswered: 3 }), "Strong");
  assert.equal(classifyTopic({ accuracy: 60, questionsAnswered: 3 }), "Developing");
  assert.equal(classifyTopic({ accuracy: 59.9, questionsAnswered: 3 }), "Needs improvement");
});

test("missing topic metadata creates no inferred topic or topic recommendation", () => {
  const analytics = buildStudentAnalytics({
    overview: [{
      totalCompletedAttempts: 1,
      totalQuestions: 2,
      totalQuestionsAnswered: 2,
      totalCorrectAnswers: 1,
      totalIncorrectAnswers: 1
    }],
    courses: [{
      courseId: "course-1",
      title: "Operating Systems",
      completedAttempts: 1,
      questionsAnswered: 2,
      correctAnswers: 1,
      incorrectAnswers: 1
    }],
    topics: [],
    trend: [],
    unclassified: [{ answeredQuestions: 2 }]
  });
  assert.deepEqual(analytics.topics, []);
  assert.equal(analytics.overview.unclassifiedAnsweredQuestions, 2);
  assert.ok(analytics.recommendations.every((recommendation) => recommendation.topic === null));
});

test("trend requires four attempts and compares the two latest against the preceding two", () => {
  const tooFew = calculateTrend([{ accuracy: 30 }, { accuracy: 60 }, { accuracy: 90 }]);
  assert.equal(tooFew.direction, "insufficient_data");
  const improving = calculateTrend([
    { accuracy: 30 },
    { accuracy: 40 },
    { accuracy: 70 },
    { accuracy: 80 }
  ]);
  assert.equal(improving.direction, "improving");
  assert.equal(improving.changePercentagePoints, 40);
});

test("recommendations contain only evidence-backed topic results", () => {
  const analytics = buildStudentAnalytics({
    overview: [{
      totalCompletedAttempts: 1,
      totalQuestions: 4,
      totalQuestionsAnswered: 4,
      totalCorrectAnswers: 1,
      totalIncorrectAnswers: 3
    }],
    courses: [{
      courseId: "course-1",
      title: "Networking",
      completedAttempts: 1,
      questionsAnswered: 4,
      correctAnswers: 1,
      incorrectAnswers: 3
    }],
    topics: [{
      courseId: "course-1",
      courseTitle: "Networking",
      topic: "Subnetting",
      totalQuestions: 4,
      questionsAnswered: 4,
      correctAnswers: 1,
      incorrectAnswers: 3,
      accuracy: 25
    }]
  });
  const recommendation = analytics.recommendations.find((item) => item.topic === "Subnetting");
  assert.ok(recommendation);
  assert.equal(recommendation.evidence.accuracy, 25);
  assert.equal(recommendation.evidence.questionsAnswered, 4);
  assert.equal(recommendation.priority, "high");
});

test("course performance context is selected-course scoped and contains aggregate fields only", () => {
  const context = buildCoursePerformanceContext(analyticsWithMultipleCourses(), "course-1");

  assert.equal(context.hasCompletedAttempts, true);
  assert.equal(context.completedAttempts, 2);
  assert.equal(context.averageScorePercentage, 65);
  assert.equal(context.accuracy, 60);
  assert.deepEqual(context.strongTopics, [{ topic: "Networks", questionsAnswered: 5, accuracy: 90 }]);
  assert.deepEqual(context.weakTopics, [{ topic: "Routing", questionsAnswered: 5, accuracy: 30 }]);
  assert.deepEqual(context.topicsWithInsufficientEvidence, [{ topic: "Security", questionsAnswered: 2 }]);
  assert.equal(context.overallTrend.scope, "all_courses");
  assert.doesNotMatch(JSON.stringify(context), /Second course|correctAnswer|correctOptionId|selectedAnswer/);
});

test("course context does not label topics with insufficient evidence as weaknesses", () => {
  const analytics = buildStudentAnalytics({
    courses: [{
      courseId: "course-1",
      title: "Networking",
      completedAttempts: 1,
      averageScorePercentage: 50,
      questionsAnswered: 2,
      correctAnswers: 1,
      incorrectAnswers: 1
    }],
    topics: [{
      courseId: "course-1",
      courseTitle: "Networking",
      topic: "Routing",
      totalQuestions: 2,
      questionsAnswered: 2,
      correctAnswers: 0,
      incorrectAnswers: 2,
      accuracy: 0
    }],
    trend: []
  });
  const context = buildCoursePerformanceContext(analytics, "course-1");

  assert.deepEqual(context.weakTopics, []);
  assert.deepEqual(context.topicsWithInsufficientEvidence, [
    { topic: "Routing", questionsAnswered: 2 }
  ]);
});

test("course context clearly reports when no completed attempts are available", () => {
  assert.deepEqual(buildCoursePerformanceContext({ courses: [] }, "course-1"), {
    hasCompletedAttempts: false,
    scope: "selected_course",
    completedAttempts: 0
  });
});

function analyticsWithMultipleCourses() {
  return {
    courses: [
      {
        courseId: "course-1",
        title: "Networking",
        completedAttempts: 2,
        averageScorePercentage: 65,
        accuracy: 60,
        questionsAnswered: 10,
        strongestTopics: [{ topic: "Networks", questionsAnswered: 5, accuracy: 90 }],
        weakestTopics: [{ topic: "Routing", questionsAnswered: 5, accuracy: 30 }],
        insufficientTopics: [{ topic: "Security", questionsAnswered: 2, accuracy: 50 }]
      },
      {
        courseId: "course-2",
        title: "Second course",
        completedAttempts: 8,
        averageScorePercentage: 99,
        accuracy: 99,
        questionsAnswered: 40,
        strongestTopics: [],
        weakestTopics: [],
        insufficientTopics: []
      }
    ],
    trend: {
      direction: "declining",
      comparedAttempts: 4,
      changePercentagePoints: -10
    }
  };
}
