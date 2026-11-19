const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "student-learning-route-test-secret";
const { generateAccessToken } = require("../utils/token");
const evidenceService = require("../services/studentLearningEvidenceService");
const route = require("../routes/studentLearning");
const STUDENT_ID = "507f1f77bcf86cd799439011";
const OTHER_STUDENT_ID = "507f1f77bcf86cd799439012";

const buildApp = (identity) => {
  const app = express();
  app.use((req, _res, next) => {
    if (identity) req.headers.authorization = `Bearer ${generateAccessToken(identity, { role: "student" })}`;
    next();
  });
  app.use("/api/student-learning", route);
  return app;
};

test("recommendation API requires authentication and uses only the authenticated identity", async () => {
  const original = evidenceService.getStudentLearningRecommendations;
  const requestedIds = [];
  evidenceService.getStudentLearningRecommendations = async (userId) => {
    requestedIds.push(userId);
    return {
      generatedAt: new Date("2025-01-01T00:00:00Z"),
      evidenceFingerprint: "internal-fingerprint",
      prioritizationStatus: "ai_prioritized",
      candidates: [{
        candidateId: "practice:course:10",
        kind: "practice_test",
        course: { courseId: "507f1f77bcf86cd799439021", title: "Networking", code: "NET101" },
        action: { type: "start_practice_test", questionCount: 10 },
        reason: "Eligible practice coverage exists.",
        evidence: { category: "practice_coverage", sufficiency: "sufficient" }
      }]
    };
  };
  try {
    assert.equal((await request(buildApp(null)).get("/api/student-learning/recommendations")).status, 401);
    const response = await request(buildApp(STUDENT_ID))
      .get(`/api/student-learning/recommendations?studentId=${OTHER_STUDENT_ID}`);
    assert.equal(response.status, 200);
    assert.deepEqual(requestedIds, [STUDENT_ID]);
    assert.equal(JSON.stringify(response.body).includes(STUDENT_ID), false);
    assert.equal(JSON.stringify(response.body).includes(OTHER_STUDENT_ID), false);
    assert.equal(Object.prototype.hasOwnProperty.call(response.body, "evidenceFingerprint"), false);
    assert.equal(response.body.prioritizationStatus, "ai_prioritized");
    assert.equal(response.body.candidates[0].action.questionCount, 10);
  } finally {
    evidenceService.getStudentLearningRecommendations = original;
  }
});

test("recommendation API reports safe service errors and logs unexpected failures", async () => {
  const original = evidenceService.getStudentLearningRecommendations;
  const originalError = console.error;
  let logCount = 0;
  console.error = () => { logCount += 1; };
  try {
    evidenceService.getStudentLearningRecommendations = async () => {
      const error = new Error("Student role required.");
      error.statusCode = 403;
      throw error;
    };
    const denied = await request(buildApp(STUDENT_ID)).get("/api/student-learning/recommendations");
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Student role required.");

    evidenceService.getStudentLearningRecommendations = async () => {
      throw new Error("private provider details");
    };
    const failed = await request(buildApp(STUDENT_ID)).get("/api/student-learning/recommendations");
    assert.equal(failed.status, 500);
    assert.equal(failed.body.message, "Unable to load learning recommendations.");
    assert.equal(logCount, 1);
  } finally {
    evidenceService.getStudentLearningRecommendations = original;
    console.error = originalError;
  }
});
