const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "ai-chat-course-access-test-secret";
const { generateAccessToken } = require("../utils/token");
const aiRouter = require("../routes/ai");
const User = require("../models/User");
const Course = require("../models/course");
const AIConversation = require("../models/AIConversation");
const StudentPerformance = require("../models/StudentPerformance");
const File = require("../models/File");
const PastQuestionPaper = require("../models/PastQuestionPaper");
const geminiService = require("../utils/gemini");

const STUDENT_ID = "507f1f77bcf86cd799439011";
const COURSE_ID = "507f1f77bcf86cd799439021";
const CONVERSATION_ID = "507f1f77bcf86cd799439031";
const DEPARTMENT_ID = "507f1f77bcf86cd799439041";

const buildApp = (userId = STUDENT_ID, role = "student") => {
  const app = express();
  const token = generateAccessToken(userId, { role });
  app.use(express.json());
  app.use((req, res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    next();
  });
  app.use("/api/ai", aiRouter);
  return app;
};

const makeCourse = (department, level = "ND1", semester = "First") => ({
  _id: COURSE_ID,
  title: "Programming 101",
  code: "CSC101",
  department,
  level,
  semester,
  lecturers: [],
  async populate() {
    this.department = { _id: this.department, name: "Computer Science" };
    return this;
  }
});

const asQuery = (result) => ({
  select() { return this; },
  lean: async () => result
});

const withChatMocks = async (run, { role = "student", course = makeCourse(DEPARTMENT_ID) } = {}) => {
  const originals = {
    userFindById: User.findById,
    courseFindById: Course.findById,
    conversationFindById: AIConversation.findById,
    performanceFindOne: StudentPerformance.findOne,
    fileFind: File.find,
    paperFind: PastQuestionPaper.find,
    chatWithStudent: geminiService.chatWithStudent
  };
  const state = { contextLoads: 0, conversationLoads: 0, geminiCalls: 0 };

  User.findById = async (userId) => {
    assert.equal(String(userId), STUDENT_ID);
    return {
      _id: STUDENT_ID,
      role,
      department: DEPARTMENT_ID,
      yearOfStudy: "ND1",
      semester: "First"
    };
  };
  Course.findById = async (courseId) => {
    assert.equal(String(courseId), COURSE_ID);
    return course;
  };
  AIConversation.findById = async () => {
    state.conversationLoads += 1;
    return {
      _id: CONVERSATION_ID,
      user: STUDENT_ID,
      title: "New Chat",
      messages: [],
      totalTokens: 0,
      async save() { return this; }
    };
  };
  StudentPerformance.findOne = async () => {
    state.contextLoads += 1;
    return null;
  };
  File.find = () => {
    state.contextLoads += 1;
    return asQuery([]);
  };
  PastQuestionPaper.find = () => {
    state.contextLoads += 1;
    return asQuery([]);
  };
  geminiService.chatWithStudent = async () => {
    state.geminiCalls += 1;
    return { message: "Study response", tokens: { total: 1 }, cost: 0 };
  };

  try {
    await run(state);
  } finally {
    User.findById = originals.userFindById;
    Course.findById = originals.courseFindById;
    AIConversation.findById = originals.conversationFindById;
    StudentPerformance.findOne = originals.performanceFindOne;
    File.find = originals.fileFind;
    PastQuestionPaper.find = originals.paperFind;
    geminiService.chatWithStudent = originals.chatWithStudent;
  }
};

test("authorized student can chat about an accessible course", async () => {
  await withChatMocks(async (state) => {
    const response = await request(buildApp())
      .post("/api/ai/chat")
      .send({ courseId: COURSE_ID, message: "Explain variables", conversationId: CONVERSATION_ID });

    assert.equal(response.status, 200);
    assert.equal(response.body.message, "Study response");
    assert.equal(state.geminiCalls, 1);
    assert.ok(state.contextLoads > 0);
  });
});

test("student cannot access a restricted course by supplying its ID", async () => {
  await withChatMocks(async (state) => {
    const response = await request(buildApp())
      .post("/api/ai/chat")
      .send({
        courseId: COURSE_ID,
        message: "Show me course materials",
        userId: STUDENT_ID,
        role: "admin"
      });

    assert.equal(response.status, 403);
    assert.equal(response.body.message, "You are not authorized to access this course.");
    assert.equal(state.contextLoads, 0);
    assert.equal(state.conversationLoads, 0);
    assert.equal(state.geminiCalls, 0);
  }, {
    course: makeCourse("507f1f77bcf86cd799439099", "HND2", "Second")
  });
});

test("nonexistent course returns 404 without loading context or invoking Gemini", async () => {
  await withChatMocks(async (state) => {
    const response = await request(buildApp())
      .post("/api/ai/chat")
      .send({ courseId: COURSE_ID, message: "Explain variables", conversationId: CONVERSATION_ID });

    assert.equal(response.status, 404);
    assert.equal(state.conversationLoads, 0);
    assert.equal(state.contextLoads, 0);
    assert.equal(state.geminiCalls, 0);
  }, { course: null });
});

test("unauthenticated chat requests are rejected", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/ai", aiRouter);

  const response = await request(app)
    .post("/api/ai/chat")
    .send({ courseId: COURSE_ID, message: "Explain variables" });

  assert.equal(response.status, 401);
});

test("administrator can access a course under the shared course-access policy", async () => {
  await withChatMocks(async (state) => {
    const response = await request(buildApp(STUDENT_ID, "admin"))
      .post("/api/ai/chat")
      .send({ courseId: COURSE_ID, message: "Explain variables", conversationId: CONVERSATION_ID });

    assert.equal(response.status, 200);
    assert.equal(state.geminiCalls, 1);
  }, {
    role: "admin",
    course: makeCourse("507f1f77bcf86cd799439099", "HND2", "Second")
  });
});
