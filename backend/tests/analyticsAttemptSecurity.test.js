const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "phase-4d-analytics-test-secret";
const { generateAccessToken } = require("../utils/token");
const analyticsRouter = require("../routes/analytics");
const studentAnalytics = require("../services/studentAnalyticsService");
const User = require("../models/User");
const courseMembership = require("../services/courseMembershipService");
const AIConversation = require("../models/AIConversation");
const StudentNote = require("../models/StudentNote");
const LearningPath = require("../models/LearningPath");

const STUDENT_ID = "507f1f77bcf86cd799439011";
const OTHER_STUDENT_ID = "507f1f77bcf86cd799439012";

const buildApp = (role = "student") => {
  const app = express();
  const token = generateAccessToken(STUDENT_ID, { role });
  app.use(express.json());
  app.use((req, res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    next();
  });
  app.use("/api/analytics", analyticsRouter);
  return app;
};

const withAnalyticsMocks = async (run, { role = "student" } = {}) => {
  const originalFindById = User.findById;
  const originalGetAnalytics = studentAnalytics.getStudentAnalytics;
  const originalGetAiRecommendations = studentAnalytics.getAiStudyRecommendations;
  const originalGetAccessibleCourseIds = courseMembership.getValidAccessibleCourseIds;
  const state = { requestedUserId: null, analyticsCalls: 0, accessibleCourseIds: null };
  User.findById = () => ({
    select: async () => ({
      _id: STUDENT_ID,
      role,
      department: "507f1f77bcf86cd799439031"
    })
  });
  courseMembership.getValidAccessibleCourseIds = async (user) => {
    state.accessibleUserId = String(user._id);
    return ["507f1f77bcf86cd799439041"];
  };
  studentAnalytics.getStudentAnalytics = async (userId, generatedAt, options) => {
    state.requestedUserId = String(userId);
    state.analyticsCalls += 1;
    state.accessibleCourseIds = options.accessibleCourseIds;
    return { overview: { totalCompletedAttempts: 2, overallAccuracy: 75 } };
  };
  studentAnalytics.getAiStudyRecommendations = async (userId) => ({
    recommendations: [{ evidenceId: "internal-evidence-id", reason: "Evidence-based result." }],
    recommendationsSource: "gemini"
  });
  try {
    await run(state);
  } finally {
    User.findById = originalFindById;
    studentAnalytics.getStudentAnalytics = originalGetAnalytics;
    studentAnalytics.getAiStudyRecommendations = originalGetAiRecommendations;
    courseMembership.getValidAccessibleCourseIds = originalGetAccessibleCourseIds;
  }
};

test("analytics is scoped to the authenticated user and ignores a requested user ID", async () => {
  await withAnalyticsMocks(async (state) => {
    const response = await request(buildApp()).get(`/api/analytics/student?userId=${OTHER_STUDENT_ID}`);
    assert.equal(response.status, 200);
    assert.equal(state.requestedUserId, STUDENT_ID);
    assert.equal(state.accessibleUserId, STUDENT_ID);
    assert.deepEqual(state.accessibleCourseIds, ["507f1f77bcf86cd799439041"]);
    assert.equal(response.body.analytics.overview.totalCompletedAttempts, 2);
    assert.equal(response.body.analytics.recommendations[0].reason, "Evidence-based result.");
    assert.equal(response.body.analytics.recommendations[0].evidenceId, undefined);
  });
});

test("lecturers cannot access student analytics", async () => {
  await withAnalyticsMocks(async (state) => {
    const response = await request(buildApp("lecturer")).get("/api/analytics/student");
    assert.equal(response.status, 403);
    assert.equal(state.analyticsCalls, 0);
  }, { role: "lecturer" });
});

test("the student analytics endpoint remains scoped to the authenticated administrator", async () => {
  await withAnalyticsMocks(async (state) => {
    const response = await request(buildApp("admin"))
      .get(`/api/analytics/student?userId=${OTHER_STUDENT_ID}`);
    assert.equal(response.status, 200);
    assert.equal(state.requestedUserId, STUDENT_ID);
    assert.equal(state.accessibleCourseIds, undefined);
  }, { role: "admin" });
});

test("non-administrators cannot access another user's compatibility dashboard", async () => {
  await withAnalyticsMocks(async (state) => {
    const response = await request(buildApp())
      .get(`/api/analytics/dashboard/${OTHER_STUDENT_ID}`);
    assert.equal(response.status, 403);
    assert.equal(state.analyticsCalls, 0);
  });
});

test("administrators can read another student's dashboard from that student's QuizSession analytics", async () => {
  const originals = {
    findById: User.findById,
    analytics: studentAnalytics.getStudentAnalytics,
    accessibleCourseIds: courseMembership.getValidAccessibleCourseIds,
    conversations: AIConversation.countDocuments,
    notes: StudentNote.countDocuments,
    paths: LearningPath.countDocuments
  };
  const targetStudent = {
    _id: OTHER_STUDENT_ID,
    name: "Target Student",
    email: "student@example.test",
    role: "student",
    department: { _id: "507f1f77bcf86cd799439031", name: "Science" },
    yearOfStudy: "ND1"
  };
  const state = {};
  User.findById = () => {
    const query = {
      select: () => query,
      populate: async () => targetStudent
    };
    return query;
  };
  studentAnalytics.getStudentAnalytics = async (userId, generatedAt, options) => {
    state.userId = String(userId);
    state.accessibleCourseIds = options.accessibleCourseIds;
    return {
      overview: { overallAccuracy: 65 },
      courses: [{ courseId: "course-1", averageScorePercentage: 65 }],
      topics: [],
      performanceTrend: []
    };
  };
  courseMembership.getValidAccessibleCourseIds = async (user) => {
    state.membershipUserId = String(user._id);
    return ["course-1"];
  };
  AIConversation.countDocuments = async () => 0;
  StudentNote.countDocuments = async () => 0;
  LearningPath.countDocuments = async () => 0;

  try {
    const response = await request(buildApp("admin"))
      .get(`/api/analytics/dashboard/${OTHER_STUDENT_ID}`);
    assert.equal(response.status, 200);
    assert.equal(state.userId, OTHER_STUDENT_ID);
    assert.equal(state.membershipUserId, OTHER_STUDENT_ID);
    assert.deepEqual(state.accessibleCourseIds, ["course-1"]);
    assert.equal(response.body.dashboard.dataSource, "quiz_sessions");
    assert.equal(response.body.dashboard.totalAccuracy, 65);
    assert.equal(response.body.dashboard.estimatedExamScore, null);
    assert.equal(response.body.dashboard.departmentalAvg, null);
  } finally {
    User.findById = originals.findById;
    studentAnalytics.getStudentAnalytics = originals.analytics;
    courseMembership.getValidAccessibleCourseIds = originals.accessibleCourseIds;
    AIConversation.countDocuments = originals.conversations;
    StudentNote.countDocuments = originals.notes;
    LearningPath.countDocuments = originals.paths;
  }
});

test("per-question replay endpoint no longer changes student performance", async () => {
  const response = await request(buildApp()).post("/api/analytics/record-attempt").send({
    userId: OTHER_STUDENT_ID,
    isCorrect: true,
    topic: "Forged topic"
  });
  assert.equal(response.status, 410);
});
