const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "phase-2-question-access-test-secret";
const { generateAccessToken } = require("../utils/token");
const questionRouter = require("../routes/question");
const Question = require("../models/Question");
const Course = require("../models/course");
const User = require("../models/User");

const STUDENT_A = "507f1f77bcf86cd799439011";
const STUDENT_B = "507f1f77bcf86cd799439012";
const ADMIN = "507f1f77bcf86cd799439013";
const LECTURER = "507f1f77bcf86cd799439014";
const COURSE_ID = "507f1f77bcf86cd799439021";
const DEPARTMENT_A = "507f1f77bcf86cd799439031";
const DEPARTMENT_B = "507f1f77bcf86cd799439032";

const users = {
  [STUDENT_A]: { _id: STUDENT_A, id: STUDENT_A, role: "student", department: DEPARTMENT_A, yearOfStudy: "ND1", semester: "First" },
  [STUDENT_B]: { _id: STUDENT_B, id: STUDENT_B, role: "student", department: DEPARTMENT_B, yearOfStudy: "ND1", semester: "First" },
  [ADMIN]: { _id: ADMIN, id: ADMIN, role: "admin" },
  [LECTURER]: { _id: LECTURER, id: LECTURER, role: "lecturer", lecturerStatus: "approved" }
};

const course = {
  _id: COURSE_ID,
  department: DEPARTMENT_A,
  level: "ND1",
  semester: "First",
  lecturers: [LECTURER]
};

const questionRecords = [
  {
    _id: "507f1f77bcf86cd799439041",
    course: COURSE_ID,
    department: DEPARTMENT_A,
    topic: "Algebra",
    question: "Legacy question",
    options: ["A", "B"],
    answer: "A",
    year: "2026",
    explanation: "Answer key",
    timesAnswered: 7,
    correctAttempts: 4
  },
  {
    _id: "507f1f77bcf86cd799439042",
    course: COURSE_ID,
    department: DEPARTMENT_A,
    topic: "Algebra",
    question: "Approved question",
    options: ["A", "B"],
    optionIds: ["stable-a", "stable-b"],
    answer: "A",
    year: "2026",
    explanation: "Answer key",
    approvalStatus: "approved",
    timesAnswered: 7,
    correctAttempts: 4,
    subQuestions: [{
      label: "a",
      question: "Part question",
      options: ["C", "D"],
      answer: "C",
      explanation: "Part answer"
    }]
  }
];

const buildApp = (userId, role) => {
  const app = express();
  app.use(express.json());
  if (userId) {
    const token = generateAccessToken(userId, { role });
    app.use((req, res, next) => {
      req.headers.authorization = "Bearer".concat(" ", token);
      next();
    });
  }
  app.use("/api/questions", questionRouter);
  return app;
};

const withQuestionMocks = async (run) => {
  const originals = {
    find: Question.find,
    aggregate: Question.aggregate,
    create: Question.create,
    insertMany: Question.insertMany,
    courseFindById: Course.findById,
    userFindById: User.findById
  };
  const state = { query: null, pipeline: null, created: null, inserted: null };
  User.findById = async (id) => users[String(id)] || null;
  Course.findById = async (id) => String(id) === COURSE_ID ? course : null;
  Question.find = (query) => {
    state.query = query;
    const records = questionRecords.filter((item) =>
      (!query.course || String(item.course) === String(query.course)) &&
      (!query.approvalStatus || item.approvalStatus === query.approvalStatus) &&
      (!query.year || (Array.isArray(query.year.$in)
        ? query.year.$in.includes(item.year)
        : item.year === query.year))
    );
    return { populate: async () => records };
  };
  Question.aggregate = async (pipeline) => {
    state.pipeline = pipeline;
    return questionRecords.filter((item) =>
      item.approvalStatus === pipeline[0].$match.approvalStatus &&
      Array.isArray(item.options) && item.options.length >= 2
    );
  };
  Question.create = async (payload) => {
    state.created = payload;
    return { _id: "507f1f77bcf86cd799439051", ...payload };
  };
  Question.insertMany = async (payload) => {
    state.inserted = payload;
    return payload;
  };

  try {
    await run(state);
  } finally {
    Question.find = originals.find;
    Question.aggregate = originals.aggregate;
    Question.create = originals.create;
    Question.insertMany = originals.insertMany;
    Course.findById = originals.courseFindById;
    User.findById = originals.userFindById;
  }
};

test("question retrieval endpoints require verified authentication", async () => {
  await withQuestionMocks(async (state) => {
    const app = buildApp();
    const courseResponse = await request(app).get(`/api/questions/course/${COURSE_ID}`);
    const randomResponse = await request(app).get(`/api/questions/quiz/${COURSE_ID}`);
    const listResponse = await request(app).get("/api/questions");

    assert.equal(courseResponse.status, 401);
    assert.equal(randomResponse.status, 401);
    assert.equal(listResponse.status, 401);
    assert.equal(state.query, null);
    assert.equal(state.pipeline, null);
  });
});

test("students receive only explicitly approved questions without answer or grading fields", async () => {
  await withQuestionMocks(async (state) => {
    const response = await request(buildApp(STUDENT_A, "student"))
      .get(`/api/questions/course/${COURSE_ID}?year=2026`);

    assert.equal(response.status, 200);
    assert.deepEqual(state.query, {
      course: COURSE_ID,
      approvalStatus: "approved",
      year: "2026"
    });
    assert.equal(response.body.questions.length, 1);
    const question = response.body.questions[0];
    assert.deepEqual(question.options, [
      { id: "stable-a", text: "A" },
      { id: "stable-b", text: "B" }
    ]);
    for (const hiddenField of ["answer", "explanation", "correctAttempts", "timesAnswered", "approvalStatus", "approvedBy"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(question, hiddenField), false);
    }
    assert.equal(Object.prototype.hasOwnProperty.call(question.subQuestions[0], "answer"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(question.subQuestions[0], "explanation"), false);
  });
});

test("legacy questions are excluded from student results but retain deterministic option identifiers", async () => {
  await withQuestionMocks(async (state) => {
    const legacy = { ...questionRecords[0], _id: questionRecords[0]._id };
    const { stableOptionIds } = require("../services/questionAccessService");
    const first = stableOptionIds(legacy);
    const second = stableOptionIds(legacy);
    assert.deepEqual(first, second);

    const response = await request(buildApp(STUDENT_A, "student"))
      .get(`/api/questions/course/${COURSE_ID}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.questions.some((item) => String(item._id) === legacy._id), false);
    assert.equal(state.query.approvalStatus, "approved");
  });
});

test("students cannot access question banks for a different academic department", async () => {
  await withQuestionMocks(async (state) => {
    const response = await request(buildApp(STUDENT_B, "student"))
      .get(`/api/questions/course/${COURSE_ID}`);
    assert.equal(response.status, 403);
    assert.equal(state.query, null);
  });
});

test("approved assigned lecturers receive question-management records for their course", async () => {
  await withQuestionMocks(async (state) => {
    const response = await request(buildApp(LECTURER, "lecturer"))
      .get(`/api/questions/course/${COURSE_ID}`);
    assert.equal(response.status, 200);
    assert.equal(state.query.approvalStatus, undefined);
    assert.equal(response.body.questions.some((item) => item.answer === "A"), true);
  });
});

test("random question retrieval is protected, approval-filtered, and answer-free", async () => {
  await withQuestionMocks(async (state) => {
    const response = await request(buildApp(STUDENT_A, "student"))
      .get(`/api/questions/quiz/${COURSE_ID}`);
    assert.equal(response.status, 200);
    assert.equal(state.pipeline[0].$match.approvalStatus, "approved");
    assert.equal(response.body.questions.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(response.body.questions[0], "answer"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(response.body.questions[0], "explanation"), false);
  });
});

test("students cannot create or bulk-manage questions", async () => {
  await withQuestionMocks(async (state) => {
    const app = buildApp(STUDENT_A, "student");
    const single = await request(app).post("/api/questions").send({
      course: COURSE_ID, topic: "Algebra", question: "Question", options: ["A", "B"], answer: "A"
    });
    const bulk = await request(app).post("/api/questions/bulk").send({
      course: COURSE_ID, questions: [{ question: "Question", options: ["A", "B"], answer: "A" }]
    });
    assert.equal(single.status, 403);
    assert.equal(bulk.status, 403);
    assert.equal(state.created, null);
    assert.equal(state.inserted, null);
  });
});

test("administrators retain full question-management access and new questions are explicitly approved", async () => {
  await withQuestionMocks(async (state) => {
    const app = buildApp(ADMIN, "admin");
    const list = await request(app).get("/api/questions");
    const created = await request(app).post("/api/questions").send({
      course: COURSE_ID,
      topic: "Algebra",
      question: "Question",
      options: ["A", "B"],
      answer: "A",
      explanation: "Admin-only answer"
    });
    assert.equal(list.status, 200);
    assert.equal(list.body.questions.length, 2);
    assert.equal(created.status, 200);
    assert.equal(state.created.department, DEPARTMENT_A);
    assert.equal(state.created.approvalStatus, "approved");
    assert.equal(state.created.approvedBy, ADMIN);
    assert.equal(state.created.optionIds.length, 2);
  });
});

test("quiz session router is mounted at the intended API prefix", async () => {
  process.env.NODE_ENV = "test";
  const app = require("../app");
  const response = await request(app).get("/api/quiz/health");
  assert.equal(response.status, 200);
  assert.equal(response.body.service, "quiz");
});
