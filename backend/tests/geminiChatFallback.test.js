const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const {
  GoogleGenerativeAI,
  GoogleGenerativeAIAbortError
} = require("@google/generative-ai");
const User = require("../models/User");

const PRIMARY_MODEL = "primary-test-model";
const FALLBACK_MODEL = "chat-fallback-test-model";
const TEST_API_KEY = "test-only-gemini-api-key";
const USER_ID = "507f1f77bcf86cd799439011";
const geminiPath = require.resolve("../utils/gemini");

const loadGeminiService = (fallbackModel) => {
  process.env.GEMINI_API_KEY = TEST_API_KEY;
  process.env.GEMINI_MODEL = PRIMARY_MODEL;
  if (fallbackModel) {
    process.env.GEMINI_CHAT_FALLBACK_MODEL = fallbackModel;
  } else {
    delete process.env.GEMINI_CHAT_FALLBACK_MODEL;
  }
  delete require.cache[geminiPath];
  return require(geminiPath);
};

const successfulResult = (message = "A helpful answer") => ({
  response: {
    text: () => message,
    candidates: [{ finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 }
  }
});

const withProviderMocks = async (run, respond, { abortOnCalls = [] } = {}) => {
  const originalGetGenerativeModel = GoogleGenerativeAI.prototype.getGenerativeModel;
  const originalUserFindById = User.findById;
  const originalSetTimeout = global.setTimeout;
  const originalConsoleError = console.error;
  const originalConsoleInfo = console.info;
  const calls = [];
  const waits = [];
  const errors = [];
  const infos = [];
  let timeoutCount = 0;

  GoogleGenerativeAI.prototype.getGenerativeModel = function getGenerativeModel({ model }) {
    return {
      generateContent: async (requestBody, requestOptions) => {
        calls.push({ model, requestBody, requestOptions });
        const callNumber = calls.length;
        if (abortOnCalls.includes(callNumber)) await Promise.resolve();
        if (requestOptions?.signal?.aborted) {
          throw new GoogleGenerativeAIAbortError(
            "Request aborted when fetching: This operation was aborted"
          );
        }
        return respond(model, callNumber, requestBody, requestOptions);
      }
    };
  };
  User.findById = () => ({
    select: async () => ({
      role: "student",
      aiUsage: {},
      async save() {}
    })
  });
  global.setTimeout = (callback, milliseconds, ...args) => {
    if (milliseconds === 750 || milliseconds === 1500) {
      waits.push(milliseconds);
      queueMicrotask(() => callback(...args));
      return 0;
    }
    if (milliseconds === 6500) {
      timeoutCount += 1;
      if (abortOnCalls.includes(timeoutCount)) {
        queueMicrotask(() => callback(...args));
        return 0;
      }
    }
    return originalSetTimeout(callback, milliseconds, ...args);
  };
  console.error = (...args) => errors.push(args);
  console.info = (...args) => infos.push(args);

  try {
    await run({ calls, waits, errors, infos });
  } finally {
    GoogleGenerativeAI.prototype.getGenerativeModel = originalGetGenerativeModel;
    User.findById = originalUserFindById;
    global.setTimeout = originalSetTimeout;
    console.error = originalConsoleError;
    console.info = originalConsoleInfo;
  }
};

const makeChatRequest = (gemini) => gemini.chatWithStudent(
  [{ role: "user", content: "A private test prompt" }],
  { courseName: "Test course" },
  USER_ID
);

test("chat uses the primary model and does not call fallback when the primary succeeds", async () => {
  const gemini = loadGeminiService();
  await withProviderMocks(async ({ calls, infos }) => {
    const result = await makeChatRequest(gemini);

    assert.equal(result.message, "A helpful answer");
    assert.equal(result.model, PRIMARY_MODEL);
    assert.deepEqual(calls.map((call) => call.model), [PRIMARY_MODEL]);
    assert.equal(infos.length, 0);
  }, async () => successfulResult());
});

test("chat falls back after retryable primary failures and reports the actual model safely", async () => {
  const gemini = loadGeminiService(FALLBACK_MODEL);
  await withProviderMocks(async ({ calls, waits, errors, infos }) => {
    const result = await makeChatRequest(gemini);

    assert.equal(result.message, "A helpful answer");
    assert.equal(result.model, FALLBACK_MODEL);
    assert.deepEqual(calls.map((call) => call.model), [
      PRIMARY_MODEL,
      PRIMARY_MODEL,
      PRIMARY_MODEL,
      FALLBACK_MODEL
    ]);
    assert.deepEqual(waits, [750, 1500]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], "[GEMINI_PROVIDER_FAILURE]");
    assert.equal(infos.length, 1);
    assert.equal(infos[0][0], "[GEMINI_CHAT_FALLBACK_SUCCESS]");
    assert.match(infos[0][1], new RegExp(FALLBACK_MODEL));
    assert.doesNotMatch(JSON.stringify([...errors, ...infos]), /A private test prompt|test-only-gemini-api-key/);
  }, async (model) => {
    if (model === PRIMARY_MODEL) {
      throw Object.assign(new Error("This model is currently experiencing high demand."), {
        status: 503,
        statusText: "Service Unavailable"
      });
    }
    return successfulResult();
  });
});

test("chat retries an SDK-aborted primary request and succeeds on the primary model", async () => {
  const gemini = loadGeminiService(FALLBACK_MODEL);
  await withProviderMocks(async ({ calls, waits }) => {
    const result = await makeChatRequest(gemini);

    assert.equal(result.model, PRIMARY_MODEL);
    assert.deepEqual(calls.map((call) => call.model), [PRIMARY_MODEL, PRIMARY_MODEL]);
    assert.deepEqual(waits, [750]);
    assert.notEqual(calls[0].requestOptions.signal, calls[1].requestOptions.signal);
    assert.equal(calls[0].requestOptions.signal.aborted, true);
    assert.equal(calls[1].requestOptions.signal.aborted, false);
  }, async () => successfulResult(), { abortOnCalls: [1] });
});

test("chat uses its fallback after retrying primary request timeouts", async () => {
  const gemini = loadGeminiService(FALLBACK_MODEL);
  await withProviderMocks(async ({ calls, waits, infos }) => {
    const result = await makeChatRequest(gemini);

    assert.equal(result.model, FALLBACK_MODEL);
    assert.deepEqual(calls.map((call) => call.model), [
      PRIMARY_MODEL,
      PRIMARY_MODEL,
      PRIMARY_MODEL,
      FALLBACK_MODEL
    ]);
    assert.deepEqual(waits, [750, 1500]);
    assert.ok(calls.slice(0, 3).every((call) => call.requestOptions.signal.aborted));
    assert.equal(calls[3].requestOptions.signal.aborted, false);
    assert.ok(calls.every((call, index) =>
      calls.slice(index + 1).every((nextCall) =>
        call.requestOptions.signal !== nextCall.requestOptions.signal
      )
    ));
    assert.equal(infos[0][0], "[GEMINI_CHAT_FALLBACK_SUCCESS]");
    assert.match(infos[0][1], new RegExp(FALLBACK_MODEL));
  }, async () => successfulResult(), { abortOnCalls: [1, 2, 3] });
});

test("chat returns temporary unavailability when both models time out", async () => {
  const gemini = loadGeminiService(FALLBACK_MODEL);
  await withProviderMocks(async ({ calls, errors }) => {
    await assert.rejects(makeChatRequest(gemini), (error) => {
      assert.equal(error.message, "The AI assistant is temporarily busy. Please try again in a moment.");
      assert.equal(error.statusCode, 502);
      assert.equal(error.temporarilyUnavailable, true);
      assert.equal(error.providerRetryCount, 2);
      return true;
    });

    assert.deepEqual(calls.map((call) => call.model), [
      PRIMARY_MODEL,
      PRIMARY_MODEL,
      PRIMARY_MODEL,
      FALLBACK_MODEL
    ]);
    assert.equal(calls[3].requestOptions.signal.aborted, true);
    assert.equal(errors.length, 2);
    const fallbackDiagnostic = JSON.parse(errors[1][1]);
    assert.equal(fallbackDiagnostic.model, FALLBACK_MODEL);
    assert.equal(fallbackDiagnostic.httpStatus, null);
    assert.equal(fallbackDiagnostic.retryCount, 0);
    assert.equal(fallbackDiagnostic.temporarilyUnavailable, true);
  }, async () => successfulResult(), { abortOnCalls: [1, 2, 3, 4] });
});

test("chat retries recognized Node.js timeout codes", async () => {
  const gemini = loadGeminiService(FALLBACK_MODEL);
  await withProviderMocks(async ({ calls }) => {
    const result = await makeChatRequest(gemini);

    assert.equal(result.model, PRIMARY_MODEL);
    assert.deepEqual(calls.map((call) => call.model), [PRIMARY_MODEL, PRIMARY_MODEL]);
  }, async (model, callNumber) => {
    if (callNumber === 1) {
      throw Object.assign(new Error("Socket timed out"), {
        code: "UND_ERR_CONNECT_TIMEOUT"
      });
    }
    return successfulResult();
  });
});

test("chat keeps the friendly temporary-unavailability error when both models fail", async () => {
  const gemini = loadGeminiService(FALLBACK_MODEL);
  await withProviderMocks(async ({ calls, errors }) => {
    await assert.rejects(makeChatRequest(gemini), (error) => {
      assert.equal(error.message, "The AI assistant is temporarily busy. Please try again in a moment.");
      assert.equal(error.statusCode, 503);
      assert.equal(error.providerRetryCount, 2);
      return true;
    });

    assert.deepEqual(calls.map((call) => call.model), [
      PRIMARY_MODEL,
      PRIMARY_MODEL,
      PRIMARY_MODEL,
      FALLBACK_MODEL
    ]);
    assert.equal(errors.length, 2);
    assert.match(errors[0][1], new RegExp(PRIMARY_MODEL));
    assert.match(errors[1][1], new RegExp(FALLBACK_MODEL));
  }, async () => {
    throw Object.assign(new Error("Provider unavailable"), {
      status: 503,
      statusText: "Service Unavailable"
    });
  });
});

test("chat does not use fallback for permanent primary errors", async () => {
  const gemini = loadGeminiService(FALLBACK_MODEL);
  await withProviderMocks(async ({ calls }) => {
    await assert.rejects(makeChatRequest(gemini), (error) => {
      assert.equal(error.message, "Gemini provider request failed.");
      assert.equal(error.statusCode, 400);
      assert.equal(error.temporarilyUnavailable, false);
      return true;
    });

    assert.deepEqual(calls.map((call) => call.model), [PRIMARY_MODEL]);
  }, async () => {
    throw Object.assign(new Error("Invalid request"), {
      status: 400,
      statusText: "Bad Request"
    });
  });
});

test("question structuring continues to use only the primary model", async () => {
  const gemini = loadGeminiService(FALLBACK_MODEL);
  await withProviderMocks(async ({ calls }) => {
    const pages = [{ pageNumber: 1, text: "Question 1: What is a variable?" }];
    const reservation = await gemini.reserveQuestionStructuringRequests(pages, USER_ID);
    const result = await gemini.structureQuestionDrafts(pages, USER_ID, reservation);

    assert.equal(result.model, PRIMARY_MODEL);
    assert.deepEqual(calls.map((call) => call.model), [PRIMARY_MODEL]);
  }, async () => successfulResult('{"questions":[],"warnings":[]}'));
});

test("successful chat fallback persists the conversation once", async () => {
  process.env.JWT_SECRET = "gemini-chat-fallback-route-test-secret";
  loadGeminiService(FALLBACK_MODEL);
  const routerPath = require.resolve("../routes/ai");
  delete require.cache[routerPath];
  const aiRouter = require(routerPath);
  const AIConversation = require("../models/AIConversation");
  const questionAccess = require("../services/questionAccessService");
  const studentAnalytics = require("../services/studentAnalyticsService");
  const File = require("../models/File");
  const PastQuestionPaper = require("../models/PastQuestionPaper");
  const { generateAccessToken } = require("../utils/token");
  const originals = {
    findById: AIConversation.findById,
    save: AIConversation.prototype.save,
    getCourseAccess: questionAccess.getCourseAccess,
    getStudentAnalytics: studentAnalytics.getStudentAnalytics,
    fileFind: File.find,
    paperFind: PastQuestionPaper.find
  };
  const conversation = {
    _id: "507f1f77bcf86cd799439031",
    user: USER_ID,
    title: "New Chat",
    messages: [],
    totalTokens: 0,
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
      return this;
    }
  };
  const course = {
    _id: "507f1f77bcf86cd799439021",
    title: "Test course",
    code: "TST101",
    department: { _id: "507f1f77bcf86cd799439041", name: "Testing" },
    async populate() { return this; }
  };

  AIConversation.findById = async () => conversation;
  questionAccess.getCourseAccess = async () => ({ allowed: true, course });
  studentAnalytics.getStudentAnalytics = async () => ({ courses: [], trend: {} });
  File.find = () => [];
  PastQuestionPaper.find = () => [];

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.headers.authorization = `Bearer ${generateAccessToken(USER_ID, { role: "student" })}`;
    next();
  });
  app.use("/api/ai", aiRouter);

  try {
    await withProviderMocks(async ({ calls }) => {
      const response = await request(app)
        .post("/api/ai/chat")
        .send({
          courseId: course._id,
          message: "Hello",
          conversationId: conversation._id
        });

      assert.equal(response.status, 200);
      assert.equal(response.body.message, "A helpful answer");
      assert.equal(calls.filter((call) => call.model === PRIMARY_MODEL).length, 3);
      assert.equal(calls.filter((call) => call.model === FALLBACK_MODEL).length, 1);
      assert.equal(conversation.saveCalls, 1);
      assert.equal(conversation.messages.length, 2);
    }, async (model) => {
      if (model === PRIMARY_MODEL) {
        throw new GoogleGenerativeAIAbortError(
          "Request aborted when fetching: This operation was aborted"
        );
      }
      return successfulResult();
    }, { abortOnCalls: [1, 2, 3] });
  } finally {
    AIConversation.findById = originals.findById;
    AIConversation.prototype.save = originals.save;
    questionAccess.getCourseAccess = originals.getCourseAccess;
    studentAnalytics.getStudentAnalytics = originals.getStudentAnalytics;
    File.find = originals.fileFind;
    PastQuestionPaper.find = originals.paperFind;
  }
});
