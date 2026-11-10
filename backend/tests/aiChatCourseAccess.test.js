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
const studentAnalytics = require("../services/studentAnalyticsService");

const STUDENT_ID = "507f1f77bcf86cd799439011";
const COURSE_ID = "507f1f77bcf86cd799439021";
const CONVERSATION_ID = "507f1f77bcf86cd799439031";
const DEPARTMENT_ID = "507f1f77bcf86cd799439041";
const OTHER_COURSE_ID = "507f1f77bcf86cd799439051";

const analyticsWithCourseResults = {
  courses: [
    {
      courseId: COURSE_ID,
      completedAttempts: 4,
      averageScorePercentage: 72.5,
      accuracy: 70,
      questionsAnswered: 20,
      strongestTopics: [{ topic: "Variables", questionsAnswered: 5, accuracy: 90 }],
      weakestTopics: [{ topic: "Loops", questionsAnswered: 5, accuracy: 40 }],
      insufficientTopics: [{ topic: "Functions", questionsAnswered: 2, accuracy: 50 }]
    },
    {
      courseId: OTHER_COURSE_ID,
      completedAttempts: 8,
      averageScorePercentage: 98,
      accuracy: 99,
      questionsAnswered: 80,
      strongestTopics: [{ topic: "Private course topic", questionsAnswered: 10, accuracy: 100 }],
      weakestTopics: [],
      insufficientTopics: []
    }
  ],
  trend: {
    direction: "improving",
    comparedAttempts: 4,
    changePercentagePoints: 12.5
  }
};

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

const withChatMocks = async (run, {
  role = "student",
  course = makeCourse(DEPARTMENT_ID),
  analytics = analyticsWithCourseResults
} = {}) => {
  const originals = {
    userFindById: User.findById,
    courseFindById: Course.findById,
    conversationFindById: AIConversation.findById,
    performanceFindOne: StudentPerformance.findOne,
    fileFind: File.find,
    paperFind: PastQuestionPaper.find,
    chatWithStudent: geminiService.chatWithStudent,
    getStudentAnalytics: studentAnalytics.getStudentAnalytics
  };
  const state = {
    contextLoads: 0,
    conversationLoads: 0,
    legacyPerformanceCalls: 0,
    analyticsCalls: 0,
    analyticsUserId: null,
    geminiCalls: 0,
    geminiContext: null
  };

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
    state.legacyPerformanceCalls += 1;
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
  studentAnalytics.getStudentAnalytics = async (userId) => {
    state.analyticsCalls += 1;
    state.analyticsUserId = String(userId);
    return analytics;
  };
  geminiService.chatWithStudent = async (messages, context) => {
    state.geminiCalls += 1;
    state.geminiContext = context;
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
    studentAnalytics.getStudentAnalytics = originals.getStudentAnalytics;
  }
};

test("authorized student can chat about an accessible course", async () => {
  await withChatMocks(async (state) => {
    const response = await request(buildApp())
      .post("/api/ai/chat")
      .send({
        courseId: COURSE_ID,
        message: "Explain variables",
        conversationId: CONVERSATION_ID,
        userId: OTHER_COURSE_ID,
        role: "admin"
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.message, "Study response");
    assert.equal(state.geminiCalls, 1);
    assert.equal(state.analyticsUserId, STUDENT_ID);
    assert.equal(state.legacyPerformanceCalls, 0);
    assert.deepEqual(state.geminiContext.cbtPerformance, {
      hasCompletedAttempts: true,
      scope: "selected_course",
      completedAttempts: 4,
      averageScorePercentage: 72.5,
      accuracy: 70,
      questionsAnswered: 20,
      strongTopics: [{ topic: "Variables", questionsAnswered: 5, accuracy: 90 }],
      weakTopics: [{ topic: "Loops", questionsAnswered: 5, accuracy: 40 }],
      topicsWithInsufficientEvidence: [{ topic: "Functions", questionsAnswered: 2 }],
      overallTrend: {
        scope: "all_courses",
        direction: "improving",
        comparedAttempts: 4,
        changePercentagePoints: 12.5
      }
    });
    assert.doesNotMatch(JSON.stringify(state.geminiContext.cbtPerformance), /Private course topic|correctAnswer|correctOptionId/);
    assert.ok(state.contextLoads > 0);
  }, { analytics: analyticsWithCourseResults });
});

test("student without completed course attempts can still use ordinary AI chat", async () => {
  await withChatMocks(async (state) => {
    const response = await request(buildApp())
      .post("/api/ai/chat")
      .send({
        courseId: COURSE_ID,
        message: "Explain variables",
        conversationId: CONVERSATION_ID
      });

    assert.equal(response.status, 200);
    assert.equal(state.geminiCalls, 1);
    assert.equal(state.legacyPerformanceCalls, 0);
    assert.deepEqual(state.geminiContext.cbtPerformance, {
      hasCompletedAttempts: false,
      scope: "selected_course",
      completedAttempts: 0
    });
  }, { analytics: { courses: [], trend: { direction: "insufficient_data" } } });
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
    assert.equal(state.analyticsCalls, 0);
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
    assert.equal(state.analyticsCalls, 0);
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
