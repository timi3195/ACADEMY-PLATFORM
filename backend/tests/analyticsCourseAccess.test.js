const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "analytics-course-access-test-secret";
const { generateAccessToken } = require("../utils/token");
const analyticsRouter = require("../routes/analytics");
const StudentPerformance = require("../models/StudentPerformance");
const questionAccess = require("../services/questionAccessService");

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
  const state = { query: null, savedRecord: null, allowed: true };

  questionAccess.getCourseAccess = async () => state.allowed
    ? { allowed: true }
    : { allowed: false, statusCode: 403, message: "Course access denied." };
  StudentPerformance.findOne = (query) => {
    state.query = query;
    return { populate: async () => null };
  };
  StudentPerformance.prototype.save = async function save() {
    state.savedRecord = this;
    return this;
  };

  try {
    await run(state);
  } finally {
    questionAccess.getCourseAccess = originalGetCourseAccess;
    StudentPerformance.findOne = originalFindOne;
    StudentPerformance.prototype.save = originalSave;
  }
};

test("free students can access analytics only for an authorized course", async () => {
  await withMocks(async (state) => {
    const response = await request(buildApp()).get(`/api/analytics/performance/${COURSE_ID}`);

    assert.equal(response.status, 200);
    assert.equal(String(state.query.user), STUDENT_ID);
    assert.equal(String(state.savedRecord.user), STUDENT_ID);
    assert.equal(String(state.savedRecord.course), COURSE_ID);

    state.allowed = false;
    const denied = await request(buildApp()).get(`/api/analytics/performance/${COURSE_ID}`);
    assert.equal(denied.status, 403);
  });
});
