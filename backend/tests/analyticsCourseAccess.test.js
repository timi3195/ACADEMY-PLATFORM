const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "analytics-course-access-test-secret";
const { generateAccessToken } = require("../utils/token");
const analyticsRouter = require("../routes/analytics");
const StudentPerformance = require("../models/StudentPerformance");
const questionAccess = require("../services/questionAccessService");
const studentAnalytics = require("../services/studentAnalyticsService");

const STUDENT_ID = "507f1f77bcf86cd799439011";
const COURSE_ID = "507f1f77bcf86cd799439021";

const buildApp = () => {
  const app = express();
  const token = generateAccessToken(STUDENT_ID, { role: "student" });
  app.use((req, res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    next();
  });
  app.use("/api/analytics", analyticsRouter);
  return app;
};

const withMocks = async (run) => {
  const originalGetCourseAccess = questionAccess.getCourseAccess;
  const originalFindOne = StudentPerformance.findOne;
  const originalSave = StudentPerformance.prototype.save;
  const originalGetAnalytics = studentAnalytics.getStudentAnalytics;
  const state = { legacyReads: 0, legacyWrites: 0, analyticsCalls: 0, allowed: true };

  questionAccess.getCourseAccess = async () => state.allowed
    ? { allowed: true }
    : { allowed: false, statusCode: 403, message: "Course access denied." };
  StudentPerformance.findOne = () => {
    state.legacyReads += 1;
    throw new Error("Legacy performance reads must not back current analytics.");
  };
  StudentPerformance.prototype.save = async function save() {
    state.legacyWrites += 1;
    return this;
  };
  studentAnalytics.getStudentAnalytics = async (userId, generatedAt, options) => {
    state.analyticsCalls += 1;
    state.analyticsRequest = { userId: String(userId), options };
    return {
      courses: [{
        courseId: COURSE_ID,
        title: "Current CBT performance",
        averageScorePercentage: 80
      }]
    };
  };

  try {
    await run(state);
  } finally {
    questionAccess.getCourseAccess = originalGetCourseAccess;
    StudentPerformance.findOne = originalFindOne;
    StudentPerformance.prototype.save = originalSave;
    studentAnalytics.getStudentAnalytics = originalGetAnalytics;
  }
};

test("course analytics use QuizSession results without creating legacy performance records", async () => {
  await withMocks(async (state) => {
    const response = await request(buildApp()).get(`/api/analytics/performance/${COURSE_ID}`);

    assert.equal(response.status, 200);
    assert.equal(response.body.dataSource, "quiz_sessions");
    assert.equal(response.body.performance.averageScorePercentage, 80);
    assert.equal(state.analyticsCalls, 1);
    assert.equal(state.analyticsRequest.userId, STUDENT_ID);
    assert.deepEqual(state.analyticsRequest.options.accessibleCourseIds, [COURSE_ID]);
    assert.equal(state.legacyReads, 0);
    assert.equal(state.legacyWrites, 0);

    state.allowed = false;
    const denied = await request(buildApp()).get(`/api/analytics/performance/${COURSE_ID}`);
    assert.equal(denied.status, 403);
    assert.equal(state.analyticsCalls, 1);
  });
});

test("legacy score predictions are explicitly unavailable and course scoped", async () => {
  await withMocks(async (state) => {
    const response = await request(buildApp()).get(`/api/analytics/prediction/${COURSE_ID}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.prediction, null);
    assert.equal(response.body.dataSource, "quiz_sessions");
    assert.match(response.body.message, /No validated exam-score prediction/);
    assert.equal(state.legacyReads, 0);
    assert.equal(state.legacyWrites, 0);
  });
});
