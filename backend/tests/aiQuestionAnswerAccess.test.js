const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "phase-2-ai-question-test-secret";
const { generateAccessToken } = require("../utils/token");
const aiRouter = require("../routes/ai");
const Question = require("../models/Question");
const Course = require("../models/course");
const User = require("../models/User");
const QuizSession = require("../models/QuizSession");
const PastQuestionExplanation = require("../models/PastQuestionExplanation");

const STUDENT_ID = "507f1f77bcf86cd799439011";
const COURSE_ID = "507f1f77bcf86cd799439021";
const QUESTION_ID = "507f1f77bcf86cd799439041";
const DEPARTMENT_ID = "507f1f77bcf86cd799439031";

const buildApp = () => {
  const app = express();
  const token = generateAccessToken(STUDENT_ID, { role: "student" });
  app.use(express.json());
  app.use((req, res, next) => {
    req.headers.authorization = "Bearer".concat(" ", token);
    next();
  });
  app.use("/api/ai", aiRouter);
  return app;
};

const withAiQuestionMocks = async (run) => {
  const originals = {
    questionFindById: Question.findById,
    courseFindById: Course.findById,
    userFindById: User.findById,
    userFindByIdAndUpdate: User.findByIdAndUpdate,
    sessionExists: QuizSession.exists,
    explanationFindOne: PastQuestionExplanation.findOne
  };
  const state = { cachedLookupCount: 0, viewCount: 0 };
  const question = {
    _id: QUESTION_ID,
    course: COURSE_ID,
    approvalStatus: "approved",
    question: "Question with answer",
    options: ["A", "B"],
    answer: "A"
  };
  const explanation = {
    question,
    viewCount: 0,
    async save() { state.viewCount = this.viewCount; }
  };

  User.findById = async () => ({
    _id: STUDENT_ID,
    role: "student",
    department: DEPARTMENT_ID,
    yearOfStudy: "ND1",
    semester: "First"
  });
  Course.findById = async () => ({
    _id: COURSE_ID,
    department: DEPARTMENT_ID,
    level: "ND1",
    semester: "First",
    lecturers: []
  });
  Question.findById = () => ({ populate: async () => question });
  User.findByIdAndUpdate = async () => ({});
  QuizSession.exists = async () => ({ _id: "active-attempt" });
  PastQuestionExplanation.findOne = (query) => {
    state.cachedLookupCount += 1;
    const result = Promise.resolve(explanation);
    result.populate = async () => explanation;
    return result;
  };

  try {
    await run(state);
  } finally {
    Question.findById = originals.questionFindById;
    Course.findById = originals.courseFindById;
    User.findById = originals.userFindById;
    User.findByIdAndUpdate = originals.userFindByIdAndUpdate;
    QuizSession.exists = originals.sessionExists;
    PastQuestionExplanation.findOne = originals.explanationFindOne;
  }
};

test("AI explainer cannot expose cached answer explanations during an active exam", async () => {
  await withAiQuestionMocks(async (state) => {
    const response = await request(buildApp())
      .post("/api/ai/explain-question")
      .send({ questionId: QUESTION_ID });
    assert.equal(response.status, 403);
    assert.equal(state.cachedLookupCount, 0);
  });
});

test("cached explanation retrieval is blocked for a question in an active exam", async () => {
  await withAiQuestionMocks(async (state) => {
    const response = await request(buildApp())
      .get(`/api/ai/question/${QUESTION_ID}/explanation`);
    assert.equal(response.status, 403);
    assert.equal(state.viewCount, 0);
  });
});
