const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "phase-2-question-search-test-secret";
const { generateAccessToken } = require("../utils/token");
const searchRouter = require("../routes/search");
const Question = require("../models/Question");
const Course = require("../models/course");
const User = require("../models/User");

const STUDENT_ID = "507f1f77bcf86cd799439011";
const COURSE_ID = "507f1f77bcf86cd799439021";
const DEPARTMENT_ID = "507f1f77bcf86cd799439031";

const buildApp = () => {
  const app = express();
  const token = generateAccessToken(STUDENT_ID, { role: "student" });
  app.use((req, res, next) => {
    req.headers.authorization = "Bearer".concat(" ", token);
    next();
  });
  app.use("/api/search", searchRouter);
  return app;
};

const withSearchMocks = async (run) => {
  const originals = {
    questionFind: Question.find,
    courseFind: Course.find,
    userFindById: User.findById
  };
  const state = { filter: null, projection: null, courseFilter: null };
  User.findById = async () => ({
    _id: STUDENT_ID,
    role: "student",
    department: DEPARTMENT_ID,
    yearOfStudy: "ND1",
    semester: "First"
  });
  Course.find = (filter) => {
    state.courseFilter = filter;
    return {
      select: async () => [{ _id: COURSE_ID }],
      sort() { return this; },
      limit() { return this; },
      populate() { return this; },
      lean: async () => []
    };
  };
  Question.find = (filter, projection) => {
    state.filter = filter;
    state.projection = projection;
    const query = {
      sort() { return this; },
      limit() { return this; },
      select(fields) {
        state.projection = fields;
        return this;
      },
      populate() { return this; },
      lean: async () => [{
        _id: "507f1f77bcf86cd799439041",
        question: "Search-safe question",
        topic: "Algebra",
        course: COURSE_ID,
        options: ["A", "B"]
      }]
    };
    return query;
  };

  try {
    await run(state);
  } finally {
    Question.find = originals.questionFind;
    Course.find = originals.courseFind;
    User.findById = originals.userFindById;
  }
};

test("global question search is limited to approved questions in the student's courses", async () => {
  await withSearchMocks(async (state) => {
    const response = await request(buildApp())
      .get("/api/search?q=algebra&type=questions");
    assert.equal(response.status, 200);
    assert.equal(state.filter.approvalStatus, "approved");
    assert.deepEqual(state.filter.course.$in, [COURSE_ID]);
    assert.equal(response.body.questions.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(response.body.questions[0], "answer"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(response.body.questions[0], "explanation"), false);
  });
});

test("advanced question search applies the same approval, course, and safe-field restrictions", async () => {
  await withSearchMocks(async (state) => {
    const response = await request(buildApp())
      .get("/api/search/advanced?q=algebra&department=507f1f77bcf86cd799439099&level=HND2");
    assert.equal(response.status, 200);
    assert.equal(state.filter.approvalStatus, "approved");
    assert.deepEqual(state.filter.course.$in, [COURSE_ID]);
    assert.equal(state.filter.department, "507f1f77bcf86cd799439099");
    assert.equal(state.filter.level, "HND2");
    assert.match(state.projection, /question topic course year session difficulty options/);
    assert.equal(Object.prototype.hasOwnProperty.call(response.body.questions[0], "answer"), false);
  });
});
