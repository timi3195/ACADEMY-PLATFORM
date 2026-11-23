const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const QuizSession = require("../models/QuizSession");
const gemini = require("../utils/gemini");
const {
  buildAnalyticsPipeline,
  buildCoursePerformanceContext,
  buildStudentAnalytics,
  calculateTrend,
  classifyTopic,
  getAiStudyRecommendations,
  getStudentAnalytics,
  validateAiRecommendations
} = require("../services/studentAnalyticsService");

const STUDENT_ID = "507f1f77bcf86cd799439011";

test("analytics aggregation selects completed or timestamped historical attempts owned by the student", () => {
  const pipeline = buildAnalyticsPipeline(STUDENT_ID);
  const facets = pipeline.find((stage) => stage.$facet).$facet;
  const match = pipeline[0].$match;
  assert.equal(String(match.user), STUDENT_ID);
  assert.equal(match.status, undefined);
  assert.deepEqual(match.$or[0], { status: "completed" });
  assert.equal(match.$or[1].status, null);
  assert.deepEqual(match.$or[1].$or, [
    { timeEnded: { $type: "date" } },
    { completedAt: { $type: "date" } }
  ]);
  assert.ok(pipeline.some((stage) => stage.$addFields?._analyticsLegacyScoreVerified));
  assert.ok(pipeline.some((stage) => stage.$addFields?._analyticsTypedGradingVerified));
  assert.ok(pipeline.some((stage) => stage.$addFields?._analyticsScorePercentage));
  assert.ok(pipeline.some((stage) => stage.$facet));
  const overviewStages = facets.overview;
  assert.ok(overviewStages.some((stage) => stage.$group?._id === "$_id"));
  const snapshotCorrectnessStage = pipeline.find((stage) =>
    stage.$addFields?._analyticsCorrect
  );
  assert.ok(snapshotCorrectnessStage.$addFields._analyticsCorrect.$cond);
  assert.ok(facets.questionTypes);
  assert.ok(facets.courseQuestionTypes);
  assert.ok(facets.courseTrend.some((stage) => stage.$setWindowFields));
  assert.ok(facets.attemptStates.some((stage) => stage.$group?.totalCompletedAttempts));
  assert.ok(facets.unfinalizedAttempts.some((stage) => stage.$lookup?.from === "courses"));
  assert.ok(facets.topicTrend.some((stage) => stage.$setWindowFields));

  const assertNoNestedFacet = (value, withinFacet = false) => {
    if (Array.isArray(value)) {
      value.forEach((item) => assertNoNestedFacet(item, withinFacet));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(key === "$facet" && withinFacet, false);
      assertNoNestedFacet(child, withinFacet || key === "$facet");
    }
  };
  assertNoNestedFacet(pipeline);
});

test("$documentNumber trend windows use one deterministic composite sort key", () => {
  const pipeline = buildAnalyticsPipeline(STUDENT_ID);
  const facets = pipeline.find((stage) => stage.$facet).$facet;
  const expectedAttemptIds = new Map([
    ["topicTrend", "$_id.attemptId"],
    ["courseTrend", "$_id"]
  ]);
  const documentNumberStages = [];
  const collectDocumentNumberStages = (value) => {
    if (Array.isArray(value)) {
      value.forEach(collectDocumentNumberStages);
      return;
    }
    if (!value || typeof value !== "object") return;
    const outputs = value.$setWindowFields?.output;
    if (outputs && Object.values(outputs).some((output) =>
      Object.prototype.hasOwnProperty.call(output, "$documentNumber")
    )) {
      documentNumberStages.push(value.$setWindowFields);
    }
    Object.values(value).forEach(collectDocumentNumberStages);
  };
  collectDocumentNumberStages(pipeline);

  assert.equal(documentNumberStages.length, expectedAttemptIds.size);
  for (const [facetName, attemptId] of expectedAttemptIds) {
    const stages = facets[facetName];
    const windowIndex = stages.findIndex((stage) =>
      stage.$setWindowFields?.output?.attemptRank?.$documentNumber
    );
    assert.notEqual(windowIndex, -1, `${facetName} should contain its attempt-rank window`);
    const window = stages[windowIndex].$setWindowFields;
    assert.deepEqual(window.sortBy, { _analyticsAttemptOrder: -1 });

    const orderStage = stages.slice(0, windowIndex).find((stage) =>
      stage.$addFields?._analyticsAttemptOrder
    );
    assert.deepEqual(orderStage?.$addFields?._analyticsAttemptOrder, {
      completedAt: "$completedAt",
      attemptId
    });
  }
  for (const window of documentNumberStages) {
    assert.equal(Object.keys(window.sortBy || {}).length, 1);
  }
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

test("analytics limits student performance to currently accessible course IDs", () => {
  const courseId = "507f1f77bcf86cd799439041";
  const pipeline = buildAnalyticsPipeline(STUDENT_ID, {
    accessibleCourseIds: [courseId],
    generatedAt: new Date("2025-03-01T00:00:00Z")
  });
  assert.deepEqual(pipeline[0].$match.course.$in.map(String), [courseId]);
  assert.equal(pipeline[0].$match.user.toString(), STUDENT_ID);
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

test("typed analytics separate final scores, provisional results, formats, and readiness evidence", () => {
    const analytics = buildStudentAnalytics({
      attemptStates: [{
        totalCompletedAttempts: 6,
        gradedAttempts: 3,
        pendingAttempts: 1,
        gradingAttempts: 0,
        failedAttempts: 1,
        reviewRequiredAttempts: 1,
        unscoredHistoricalAttempts: 1,
        unverifiedGradingAttempts: 1,
        totalQuestionsAttempted: 60,
        attemptsLast30Days: 4
      }],
      unfinalizedAttempts: [{
        attemptId: "review-attempt",
        course: "Networking",
        status: "needs_review",
        provisionalScore: 4,
        provisionalMaxMarks: 6
      }, {
        attemptId: "failed-attempt",
        course: "Networking",
        status: "failed"
      }, {
        attemptId: "unscored-attempt",
        course: "Networking",
        status: "unscored"
      }, {
        attemptId: "unverified-attempt",
        course: "Networking",
        status: "unverified"
      }],
      overview: [{
        gradedAttempts: 3,
        averageScorePercentage: 72,
        bestScorePercentage: 90,
        lowestScorePercentage: 55,
        totalQuestions: 30,
        questionsGraded: 30,
        totalQuestionsAnswered: 28,
        totalCorrectAnswers: 20,
        totalIncorrectAnswers: 8,
        mostRecentCompletedAt: new Date("2025-02-28T12:00:00Z")
      }],
      courses: [{
        courseId: "course-1",
        title: "Networking",
        completedAttempts: 3,
        averageScorePercentage: 72,
        bestScorePercentage: 90,
        lowestScorePercentage: 55,
        totalQuestions: 30,
        questionsGraded: 30,
        questionsAnswered: 28,
        correctAnswers: 20,
        incorrectAnswers: 8,
        marksAwarded: 72,
        maxMarks: 100
      }],
      courseAttemptStates: [{
        courseId: "course-1",
        title: "Networking",
        completedAttempts: 6,
        pendingAttempts: 1,
        failedAttempts: 1,
        reviewRequiredAttempts: 1,
        unscoredHistoricalAttempts: 1,
        unverifiedGradingAttempts: 1,
        totalQuestionsAttempted: 60
      }],
      questionTypes: [
        { _id: "objective", questionsAttempted: 20, questionsAnswered: 19, questionsGraded: 20, fullCreditQuestions: 14, marksAwarded: 42, maxMarks: 50 },
        { _id: "fill_in_gap", questionsAttempted: 5, questionsAnswered: 5, questionsGraded: 5, fullCreditQuestions: 3, marksAwarded: 15, maxMarks: 20 },
        { _id: "theory", questionsAttempted: 5, questionsAnswered: 4, questionsGraded: 5, fullCreditQuestions: 2, marksAwarded: 15, maxMarks: 30 }
      ],
      courseQuestionTypes: [{
        _id: { courseId: "course-1", questionType: "theory" },
        questionsAttempted: 5,
        questionsAnswered: 4,
        questionsGraded: 5,
        fullCreditQuestions: 2,
        marksAwarded: 15,
        maxMarks: 30
      }],
      topics: [{
        courseId: "course-1",
        courseTitle: "Networking",
        topic: "Subnetting",
        totalQuestions: 5,
        questionsAnswered: 5,
        correctAnswers: 2,
        incorrectAnswers: 3,
        marksAwarded: 4,
        maxMarks: 10,
        accuracy: 40
      }],
      topicTrend: [{
        _id: { courseId: "course-1", topic: "Subnetting" },
        attempts: [
          { accuracy: 70 },
          { accuracy: 60 },
          { accuracy: 50 },
          { accuracy: 40 }
        ]
      }],
      courseTrend: [
        { attemptId: "a1", courseId: "course-1", completedAt: new Date("2025-02-01"), accuracy: 60, scorePercentage: 60 },
        { attemptId: "a2", courseId: "course-1", completedAt: new Date("2025-02-10"), accuracy: 65, scorePercentage: 65 },
        { attemptId: "a3", courseId: "course-1", completedAt: new Date("2025-02-20"), accuracy: 75, scorePercentage: 75 },
        { attemptId: "a4", courseId: "course-1", completedAt: new Date("2025-02-28"), accuracy: 80, scorePercentage: 80 }
      ],
      trend: [
        { attemptId: "a1", courseId: "course-1", completedAt: new Date("2025-02-01"), accuracy: 60, scorePercentage: 60 },
        { attemptId: "a2", courseId: "course-1", completedAt: new Date("2025-02-10"), accuracy: 65, scorePercentage: 65 },
        { attemptId: "a3", courseId: "course-1", completedAt: new Date("2025-02-20"), accuracy: 75, scorePercentage: 75 },
        { attemptId: "a4", courseId: "course-1", completedAt: new Date("2025-02-28"), accuracy: 80, scorePercentage: 80 }
      ]
    });

    assert.equal(analytics.overview.totalCompletedAttempts, 6);
    assert.equal(analytics.overview.gradedAttemptCount, 3);
    assert.equal(analytics.overview.totalQuestionsAttempted, 60);
    assert.equal(analytics.overview.averageScorePercentage, 72);
    assert.equal(analytics.overview.bestScorePercentage, 90);
    assert.equal(analytics.overview.lowestScorePercentage, 55);
    assert.equal(analytics.courses[0].lowestScorePercentage, 55);
    assert.equal(analytics.practiceFrequency.attemptsLast30Days, 4);
    assert.equal(analytics.practiceFrequency.averageAttemptsPerWeek, 0.9);
    assert.deepEqual(analytics.questionTypeBreakdown.map((item) => item.questionType), [
      "objective", "fill_in_gap", "theory"
    ]);
    assert.equal(analytics.questionTypeBreakdown[2].accuracy, 50);
    assert.equal(analytics.courses[0].questionTypeBreakdown[2].questionsGraded, 5);
    assert.equal(analytics.courses[0].trend.direction, "improving");
    assert.equal(analytics.courses[0].performanceTrend.length, 4);
    assert.equal(analytics.courses[0].performanceTrend[0].attemptId, "a1");
    assert.equal(analytics.topics[0].trend.direction, "declining");
    assert.equal(analytics.readiness.status, "sufficient_evidence");
    assert.equal(analytics.readiness.percentage, 72);
    assert.match(analytics.readiness.explanation, /3 attempts, 30 graded questions, and 3 graded questions of each type/);
    assert.deepEqual(analytics.unfinalizedAttempts.map((attempt) => attempt.status), [
      "needs_review", "failed", "unscored", "unverified"
    ]);
    assert.equal(analytics.unfinalizedAttempts[0].provisionalScore, 4);
    assert.equal(analytics.overview.unscoredHistoricalAttempts, 1);
    assert.equal(analytics.overview.unverifiedGradingAttempts, 1);
    assert.equal(analytics.courses[0].completedAttempts, 6);
    assert.equal(analytics.courses[0].unscoredHistoricalAttempts, 1);
    assert.equal(analytics.courses[0].unverifiedGradingAttempts, 1);
    assert.equal(analytics.courses[0].trend.direction, "improving");
  });

test("pending, failed, and review-required sessions do not create a readiness percentage", () => {
    const analytics = buildStudentAnalytics({
      attemptStates: [{
        totalCompletedAttempts: 3,
        gradedAttempts: 0,
        pendingAttempts: 1,
        failedAttempts: 1,
        reviewRequiredAttempts: 1,
        totalQuestionsAttempted: 30
      }],
      unfinalizedAttempts: [],
      overview: [],
      questionTypes: []
    });
    assert.equal(analytics.overview.totalCompletedAttempts, 3);
    assert.equal(analytics.overview.gradedAttemptCount, 0);
    assert.equal(analytics.overview.averageScorePercentage, null);
    assert.equal(analytics.readiness.status, "insufficient_evidence");
    assert.equal(analytics.readiness.percentage, null);
    assert.equal(analytics.questionTypeBreakdown.every((item) => item.questionsGraded === 0), true);
  });

test("readiness withholds its percentage when any format lacks coverage", () => {
    const analytics = buildStudentAnalytics({
      overview: [{
        gradedAttempts: 4,
        averageScorePercentage: 80,
        totalQuestions: 30,
        questionsGraded: 30
      }],
      questionTypes: [
        { _id: "objective", questionsGraded: 24, marksAwarded: 20, maxMarks: 24 },
        { _id: "fill_in_gap", questionsGraded: 6, marksAwarded: 5, maxMarks: 6 }
      ]
    });
    assert.equal(analytics.readiness.percentage, null);
    assert.ok(analytics.readiness.missingEvidence.some((item) => item.includes("theory")));
  });

test("AI recommendations can only select evidence IDs and server-defined free study actions", () => {
    const evidence = [{ evidenceId: "evidence-1" }];
    const valid = validateAiRecommendations(JSON.stringify({
      recommendations: [{ evidenceId: "evidence-1", actionType: "review_missed" }]
    }), evidence);
    assert.deepEqual(valid, [{ evidenceId: "evidence-1", actionType: "review_missed" }]);
    assert.throws(() => validateAiRecommendations(JSON.stringify({
      recommendations: [{ evidenceId: "other-student", actionType: "review_missed" }]
    }), evidence), /invalid_recommendations/);
    assert.throws(() => validateAiRecommendations(JSON.stringify({
      recommendations: [{ evidenceId: "evidence-1", actionType: "buy_course" }]
    }), evidence), /invalid_recommendations/);
  });

test("Gemini recommendations use sanitized per-student evidence, cache safely, and fall back explicitly", async () => {
    const originalGenerate = gemini.generateStudyRecommendations;
    const analytics = buildStudentAnalytics({
      overview: [{
        gradedAttempts: 3,
        averageScorePercentage: 65,
        totalQuestions: 30,
        totalQuestionsAnswered: 30,
        totalCorrectAnswers: 18
      }],
      courses: [{
        courseId: "course-private-id",
        title: "Networking",
        completedAttempts: 3,
        averageScorePercentage: 65,
        totalQuestions: 30,
        questionsAnswered: 30,
        correctAnswers: 18,
        incorrectAnswers: 12
      }],
      topics: [{
        courseId: "course-private-id",
        courseTitle: "Networking",
        topic: "Routing",
        totalQuestions: 5,
        questionsAnswered: 5,
        correctAnswers: 1,
        incorrectAnswers: 4,
        accuracy: 20
      }]
    });
    let calls = 0;
    let suppliedEvidence;
    gemini.generateStudyRecommendations = async (evidence) => {
      calls += 1;
      suppliedEvidence = evidence;
      return {
        message: JSON.stringify({
          recommendations: evidence.map((item) => ({
            evidenceId: item.evidenceId,
            actionType: "review_missed"
          }))
        })
      };
    };
    try {
      const first = await getAiStudyRecommendations(STUDENT_ID, analytics);
      const second = await getAiStudyRecommendations(STUDENT_ID, analytics);
      const anotherStudent = await getAiStudyRecommendations("507f1f77bcf86cd799439012", analytics);
      analytics.recommendations[0].evidence.accuracy = 30;
      const changedEvidence = await getAiStudyRecommendations(STUDENT_ID, analytics);
      assert.equal(first.recommendationsSource, "gemini");
      assert.match(first.recommendations[0].suggestedAction, /Routing in Networking/);
      assert.equal(second.recommendationsSource, "gemini");
      assert.equal(anotherStudent.recommendationsSource, "gemini");
      assert.equal(changedEvidence.recommendationsSource, "gemini");
      assert.equal(calls, 3);
      assert.doesNotMatch(JSON.stringify(suppliedEvidence), /correctAnswer":|correctOptionId|course-private-id|studentId/);

      gemini.generateStudyRecommendations = async () => {
        throw new Error("provider unavailable");
      };
      const unavailable = await getAiStudyRecommendations("507f1f77bcf86cd799439013", analytics);
      assert.equal(unavailable.recommendationsSource, "evidence_rules");
      assert.match(unavailable.recommendationsNotice, /could not be generated or validated/);
      assert.ok(unavailable.recommendations.length > 0);
    } finally {
      gemini.generateStudyRecommendations = originalGenerate;
    }
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
