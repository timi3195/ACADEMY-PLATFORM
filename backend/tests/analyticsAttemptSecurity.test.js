const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "phase-4d-analytics-test-secret";
const { generateAccessToken } = require("../utils/token");
const analyticsRouter = require("../routes/analytics");
const studentAnalytics = require("../services/studentAnalyticsService");
const User = require("../models/User");

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
  const state = { requestedUserId: null, analyticsCalls: 0 };
  User.findById = () => ({ select: async () => ({ _id: STUDENT_ID, role }) });
  studentAnalytics.getStudentAnalytics = async (userId) => {
    state.requestedUserId = String(userId);
    state.analyticsCalls += 1;
    return { overview: { totalCompletedAttempts: 2, overallAccuracy: 75 } };
  };
  try {
    await run(state);
  } finally {
    User.findById = originalFindById;
    studentAnalytics.getStudentAnalytics = originalGetAnalytics;
  }
};

test("analytics is scoped to the authenticated user and ignores a requested user ID", async () => {
  await withAnalyticsMocks(async (state) => {
    const response = await request(buildApp()).get(`/api/analytics/student?userId=${OTHER_STUDENT_ID}`);
    assert.equal(response.status, 200);
    assert.equal(state.requestedUserId, STUDENT_ID);
    assert.equal(response.body.analytics.overview.totalCompletedAttempts, 2);
  });
});

test("lecturers cannot access student analytics", async () => {
  await withAnalyticsMocks(async (state) => {
    const response = await request(buildApp("lecturer")).get("/api/analytics/student");
    assert.equal(response.status, 403);
    assert.equal(state.analyticsCalls, 0);
  }, { role: "lecturer" });
});

test("per-question replay endpoint no longer changes student performance", async () => {
  const response = await request(buildApp()).post("/api/analytics/record-attempt").send({
    userId: OTHER_STUDENT_ID,
    isCorrect: true,
    topic: "Forged topic"
  });
  assert.equal(response.status, 410);
});
