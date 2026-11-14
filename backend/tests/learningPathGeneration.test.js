const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "learning-path-generation-test-secret";
const { generateAccessToken } = require("../utils/token");
const aiRouter = require("../routes/ai");
const User = require("../models/User");
const Course = require("../models/course");
const LearningPath = require("../models/LearningPath");
const geminiService = require("../utils/gemini");

const STUDENT_ID = "507f1f77bcf86cd799439011";
const COURSE_ID = "507f1f77bcf86cd799439021";
const OTHER_DEPARTMENT_ID = "507f1f77bcf86cd799439099";
const DEPARTMENT_ID = "507f1f77bcf86cd799439041";
const FIXED_NOW = "2026-01-15T12:00:00.000Z";

const freezeTestTime = (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(FIXED_NOW) });
};

const buildApp = ({ authenticated = true, role = "student" } = {}) => {
  const app = express();
  app.use(express.json());
  if (authenticated) {
    const token = generateAccessToken(STUDENT_ID, { role });
    app.use((req, res, next) => {
      req.headers.authorization = `Bearer ${token}`;
      next();
    });
  }
  app.use("/api/ai", aiRouter);
  return app;
};

const makeUser = (role = "student", department = DEPARTMENT_ID) => ({
  _id: STUDENT_ID,
  role,
  plan: "premium",
  subscriptionType: "premium",
  department,
  yearOfStudy: "ND1",
  semester: "First"
});

const makeCourse = (department = DEPARTMENT_ID) => ({
  _id: COURSE_ID,
  title: "Programming 101",
  code: "CSC101",
  department,
  level: "ND1",
  semester: "First",
  lecturers: [],
  async populate() {
    this.department = { _id: this.department, name: "Computer Science" };
    return this;
  }
});

const withGenerationMocks = async (run, {
  role = "student",
  user = makeUser(role),
  course = makeCourse(),
  generate
} = {}) => {
  const originals = {
    userFindById: User.findById,
    courseFindById: Course.findById,
    pathSave: LearningPath.prototype.save,
    generateLearningPath: geminiService.generateLearningPath
  };
  const state = {
    courseLookups: 0,
    generationCalls: 0,
    generationContext: null,
    savedPath: null,
    saveCalls: 0
  };
  User.findById = async () => user;
  Course.findById = async () => {
    state.courseLookups += 1;
    return course;
  };
  LearningPath.prototype.save = async function save() {
    state.saveCalls += 1;
    this._id = "507f1f77bcf86cd799439055";
    state.savedPath = this;
    return this;
  };
  geminiService.generateLearningPath = async (context, userId) => {
    state.generationCalls += 1;
    state.generationContext = { ...context, userId };
    if (generate) return generate(context, userId);
    return {
      success: true,
      path: validPathFor(context.planning.scheduleDays),
      tokens: { total: 12 },
      cost: 0
    };
  };

  try {
    await run(state);
  } finally {
    User.findById = originals.userFindById;
    Course.findById = originals.courseFindById;
    LearningPath.prototype.save = originals.pathSave;
    geminiService.generateLearningPath = originals.generateLearningPath;
  }
};

const validPathFor = (scheduleDays) => ({
  title: "Programming revision plan",
  schedule: scheduleDays.map((day) => ({
    ...day,
    status: "pending",
    summary: "Review and practise the scheduled course topic.",
    activities: [{
      type: "practice-questions",
      title: "Practise course questions",
      description: "Complete a short practice set and review your reasoning.",
      topic: "General course revision",
      duration: 30
    }]
  }))
});

const requestGeneration = (app, body = { courseId: COURSE_ID }) =>
  request(app).post("/api/ai/learning-path/generate").send(body);
const requestProgressUpdate = (app, pathId, body) =>
  request(app).put(`/api/ai/learning-path/${pathId}/update-progress`).send(body);

const withProgressMocks = async (run, { path = makeLearningPath() } = {}) => {
  const originals = {
    userFindById: User.findById,
    pathFindOne: LearningPath.findOne
  };
  const state = { path, lookup: null, saveCalls: 0 };
  User.findById = async () => makeUser();
  LearningPath.findOne = async (query) => {
    state.lookup = query;
    return path;
  };
  if (path) {
    path.save = async function save() {
      state.saveCalls += 1;
      return this;
    };
  }

  try {
    await run(state);
  } finally {
    User.findById = originals.userFindById;
    LearningPath.findOne = originals.pathFindOne;
  }
};

const makeLearningPath = () => ({
  _id: "507f1f77bcf86cd799439055",
  user: STUDENT_ID,
  schedule: [{
    activities: [{
      completed: false,
      completedAt: null,
      score: undefined
    }]
  }],
  async save() {}
});

test("unauthenticated requests are rejected", async () => {
  const response = await requestGeneration(buildApp({ authenticated: false }));
  assert.equal(response.status, 401);
});

test("progress update completes an existing activity and preserves optional score", async () => {
  await withProgressMocks(async (state) => {
    const response = await requestProgressUpdate(buildApp(), state.path._id, {
      dayIndex: 0,
      activityIndex: 0,
      completed: true,
      score: 85
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(state.path.schedule[0].activities[0].completed, true);
    assert.ok(state.path.schedule[0].activities[0].completedAt instanceof Date);
    assert.equal(state.path.schedule[0].activities[0].score, 85);
    assert.equal(state.saveCalls, 1);
    assert.equal(String(state.lookup.user), STUDENT_ID);
  });
});

test("progress update marks an activity incomplete and clears its completion timestamp", async () => {
  const path = makeLearningPath();
  path.schedule[0].activities[0].completed = true;
  path.schedule[0].activities[0].completedAt = new Date("2026-01-01T00:00:00.000Z");
  await withProgressMocks(async (state) => {
    const response = await requestProgressUpdate(buildApp(), state.path._id, {
      dayIndex: 0,
      activityIndex: 0,
      completed: false
    });

    assert.equal(response.status, 200);
    assert.equal(state.path.schedule[0].activities[0].completed, false);
    assert.equal(state.path.schedule[0].activities[0].completedAt, null);
    assert.equal(state.saveCalls, 1);
  }, { path });
});

test("invalid progress updates are rejected without modifying saved progress", async () => {
  const invalidCases = [
    { body: { activityIndex: 0, completed: true } },
    { body: { dayIndex: 0, completed: true } },
    { body: { dayIndex: -1, activityIndex: 0, completed: true } },
    { body: { dayIndex: 0, activityIndex: -1, completed: true } },
    { body: { dayIndex: 0.5, activityIndex: 0, completed: true } },
    { body: { dayIndex: 0, activityIndex: 0.5, completed: true } },
    { body: { dayIndex: 1, activityIndex: 0, completed: true } },
    { body: { dayIndex: 0, activityIndex: 1, completed: true } },
    { body: { dayIndex: 0, activityIndex: 0 } },
    { body: { dayIndex: 0, activityIndex: 0, completed: "true" } },
    { body: { dayIndex: 0, activityIndex: 0, completed: true, score: "85" } }
  ];

  for (const { body } of invalidCases) {
    await withProgressMocks(async (state) => {
      const before = { ...state.path.schedule[0].activities[0] };
      const response = await requestProgressUpdate(buildApp(), state.path._id, body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal(state.saveCalls, 0, JSON.stringify(body));
      assert.deepEqual(state.path.schedule[0].activities[0], before, JSON.stringify(body));
    });
  }
});

test("progress update cannot access another user's learning path", async () => {
  await withProgressMocks(async (state) => {
    const response = await requestProgressUpdate(buildApp(), "507f1f77bcf86cd799439055", {
      dayIndex: 0,
      activityIndex: 0,
      completed: true
    });

    assert.equal(response.status, 404);
    assert.equal(response.body.message, "Path not found");
    assert.equal(String(state.lookup.user), STUDENT_ID);
    assert.equal(state.saveCalls, 0);
  }, { path: null });
});

test("premium access restriction remains enforced", async () => {
  await withGenerationMocks(async (state) => {
    const response = await requestGeneration(buildApp(), { courseId: COURSE_ID });
    assert.equal(response.status, 403);
    assert.equal(state.courseLookups, 0);
    assert.equal(state.generationCalls, 0);
  }, {
    user: { ...makeUser(), plan: "basic", subscriptionType: "free" }
  });
});

test("administrator retains generation access under existing premium middleware", async () => {
  await withGenerationMocks(async (state) => {
    const response = await requestGeneration(buildApp({ role: "admin" }));
    assert.equal(response.status, 200);
    assert.equal(state.generationCalls, 1);
    assert.equal(String(state.savedPath.user), STUDENT_ID);
  }, {
    role: "admin",
    user: { ...makeUser("admin", OTHER_DEPARTMENT_ID), plan: "basic", subscriptionType: "free" },
    course: makeCourse(OTHER_DEPARTMENT_ID)
  });
});

test("unauthorized students are rejected before Gemini or persistence", async () => {
  await withGenerationMocks(async (state) => {
    const response = await requestGeneration(buildApp());
    assert.equal(response.status, 403);
    assert.equal(state.generationCalls, 0);
    assert.equal(state.saveCalls, 0);
  }, { user: makeUser("student", OTHER_DEPARTMENT_ID) });
});

test("invalid course IDs are rejected before course lookup", async () => {
  await withGenerationMocks(async (state) => {
    const response = await requestGeneration(buildApp(), { courseId: "not-an-object-id" });
    assert.equal(response.status, 400);
    assert.equal(state.courseLookups, 0);
    assert.equal(state.generationCalls, 0);
  });
});

test("valid date-only target is persisted and included in schedule generation", async (t) => {
  freezeTestTime(t);
  await withGenerationMocks(async (state) => {
    const response = await requestGeneration(buildApp(), {
      courseId: COURSE_ID,
      targetExamDate: "2026-01-15"
    });

    assert.equal(response.status, 200);
    assert.equal(state.savedPath.targetExamDate.toISOString(), "2026-01-15T00:00:00.000Z");
    assert.equal(state.generationContext.planning.daysRemaining, 1);
    assert.deepEqual(state.generationContext.planning.scheduleDays, [
      { day: 1, date: "2026-01-15" }
    ]);
  });
});

test("valid ISO timestamps with timezone use the same UTC date for persistence and scheduling", async (t) => {
  freezeTestTime(t);
  const cases = [
    { value: "2026-01-16T12:00Z", expected: "2026-01-16T12:00:00.000Z" },
    { value: "2026-01-16T12:30:45Z", expected: "2026-01-16T12:30:45.000Z" },
    { value: "2026-01-16T12:30:45.123Z", expected: "2026-01-16T12:30:45.123Z" },
    { value: "2026-01-16T12:00+01:00", expected: "2026-01-16T11:00:00.000Z" },
    { value: "2026-01-16T12:00-05:00", expected: "2026-01-16T17:00:00.000Z" },
    { value: "2026-01-17T00:30:00+02:00", expected: "2026-01-16T22:30:00.000Z" }
  ];

  for (const { value, expected } of cases) {
    await withGenerationMocks(async (state) => {
      const response = await requestGeneration(buildApp(), {
        courseId: COURSE_ID,
        targetExamDate: value
      });

      assert.equal(response.status, 200, value);
      assert.equal(state.savedPath.targetExamDate.toISOString(), expected, value);
      const expectedUtcDate = expected.slice(0, 10);
      assert.equal(state.generationContext.planning.targetExamDate, expectedUtcDate);
      assert.equal(state.generationContext.planning.scheduleDays.at(-1).date, expectedUtcDate);
    });
  }
});

test("today and one-day-ahead targets are accepted at the UTC date boundary", async (t) => {
  freezeTestTime(t);
  await withGenerationMocks(async (state) => {
    const todayResponse = await requestGeneration(buildApp(), {
      courseId: COURSE_ID,
      targetExamDate: "2026-01-15"
    });
    assert.equal(todayResponse.status, 200);
    assert.equal(state.generationContext.planning.daysRemaining, 1);

    const tomorrowResponse = await requestGeneration(buildApp(), {
      courseId: COURSE_ID,
      targetExamDate: "2026-01-16"
    });
    assert.equal(tomorrowResponse.status, 200);
    assert.equal(state.generationContext.planning.daysRemaining, 2);
    assert.deepEqual(state.generationContext.planning.scheduleDays.map((day) => day.date), [
      "2026-01-15",
      "2026-01-16"
    ]);
  });
});

test("invalid scheduling inputs are rejected", async (t) => {
  freezeTestTime(t);
  const invalidCases = [
    { targetExamDate: "not-a-date" },
    { targetExamDate: "2026-02-31" },
    { targetExamDate: "2026-01-16 12:00:00Z" },
    { targetExamDate: "2026-01-16T12:00:00" },
    { targetExamDate: "2026-01-16T12:00" },
    { targetExamDate: "2026-01-16T25:00:00Z" },
    { targetExamDate: "2026-01-16T12:00:00+14:01" },
    { targetExamDate: "2026-01-16T12:00Z+01:00" },
    { targetExamDate: "2026-01-16T12:00+15:00" },
    { targetExamDate: "2026-01-16T12:00+01:60" },
    { targetExamDate: "2026-01-14" },
    { studyHoursPerDay: 0 },
    { studyHoursPerDay: 0.1 },
    { studyHoursPerDay: 12.5 },
    { studyHoursPerDay: "2" }
  ];
  for (const invalid of invalidCases) {
    await t.test(JSON.stringify(invalid), async () => {
      await withGenerationMocks(async (state) => {
        const response = await requestGeneration(buildApp(), { courseId: COURSE_ID, ...invalid });
        assert.equal(response.status, 400);
        assert.equal(state.courseLookups, 0);
        assert.equal(state.generationCalls, 0);
      });
    });
  }
});

test("valid structured schedule is saved for the authenticated user and authorized course", async () => {
  const targetExamDate = new Date(Date.now() + 3 * 86400000).toISOString();
  await withGenerationMocks(async (state) => {
    const response = await requestGeneration(buildApp(), {
      courseId: COURSE_ID,
      targetExamDate,
      studyHoursPerDay: 1.5,
      userId: "507f1f77bcf86cd799439099",
      role: "admin"
    });

    assert.equal(response.status, 200);
    assert.equal(state.generationCalls, 1);
    assert.equal(state.generationContext.userId, STUDENT_ID);
    assert.equal(state.generationContext.planning.studyHoursPerDay, 1.5);
    assert.equal(state.generationContext.planning.targetExamDate, targetExamDate.slice(0, 10));
    assert.equal(String(state.savedPath.user), STUDENT_ID);
    assert.equal(String(state.savedPath.course), COURSE_ID);
    assert.equal(state.savedPath.title, "Programming revision plan");
    assert.equal(state.savedPath.targetExamDate.toISOString(), targetExamDate);
    assert.ok(state.savedPath.startDate instanceof Date);
    assert.equal(state.savedPath.daysRemaining, state.generationContext.planning.daysRemaining);
    assert.equal(state.savedPath.schedule.length, state.generationContext.planning.scheduleDays.length);
    assert.ok(state.savedPath.schedule.every((day) => day.status === "pending" && day.activities.length > 0));
    assert.equal(response.body.path.schedule.length, state.savedPath.schedule.length);
  });
});

test("malformed generated schedules are rejected and never saved", async () => {
  await withGenerationMocks(async (state) => {
    const response = await requestGeneration(buildApp());
    assert.equal(response.status, 502);
    assert.match(response.body.message, /valid learning path/i);
    assert.equal(state.saveCalls, 0);
  }, {
    generate: async () => ({
      success: true,
      path: { title: "Incomplete path", schedule: [] },
      tokens: {},
      cost: 0
    })
  });
});

test("Gemini failures return a safe error without persisting a path", async () => {
  await withGenerationMocks(async (state) => {
    const response = await requestGeneration(buildApp());
    assert.equal(response.status, 500);
    assert.equal(response.body.message, "Unable to generate a learning path. Please try again.");
    assert.doesNotMatch(response.body.message, /internal provider detail|credential/i);
    assert.equal(state.saveCalls, 0);
  }, {
    generate: async () => {
      throw new Error("internal provider detail credential");
    }
  });
});

test("Gemini JSON parser rejects malformed, empty, incomplete, and invalid activity output", () => {
  const scheduleDays = [{ day: 1, date: "2026-01-01" }];
  const options = { scheduleDays, maxStudyMinutes: 120 };
  const valid = validPathFor(scheduleDays);

  assert.throws(
    () => geminiService.parseLearningPathResponse("not-json", options),
    { statusCode: 502, isSafeLearningPathError: true }
  );
  assert.throws(
    () => geminiService.parseLearningPathResponse(JSON.stringify({ title: "Empty", schedule: [] }), options),
    { statusCode: 502, isSafeLearningPathError: true }
  );
  assert.throws(
    () => geminiService.parseLearningPathResponse(JSON.stringify({
      ...valid,
      schedule: [{ ...valid.schedule[0], activities: [{ ...valid.schedule[0].activities[0], type: "unknown" }] }]
    }), options),
    { statusCode: 502, isSafeLearningPathError: true }
  );
  assert.throws(
    () => geminiService.parseLearningPathResponse(JSON.stringify({
      ...valid,
      schedule: [{ ...valid.schedule[0], activities: [{ ...valid.schedule[0].activities[0], duration: 121 }] }]
    }), options),
    { statusCode: 502, isSafeLearningPathError: true }
  );
});

test("Gemini JSON parser accepts a complete Markdown JSON fence", () => {
  const scheduleDays = [{ day: 1, date: "2026-01-15" }];
  const result = geminiService.parseLearningPathResponse(
    `\`\`\`json\n${JSON.stringify(validPathFor(scheduleDays))}\n\`\`\``,
    { scheduleDays, maxStudyMinutes: 120 }
  );
  assert.equal(result.title, "Programming revision plan");
  assert.equal(result.schedule.length, 1);
});

test("Gemini JSON parser rejects malformed fences and prose around JSON", () => {
  const scheduleDays = [{ day: 1, date: "2026-01-15" }];
  const options = { scheduleDays, maxStudyMinutes: 120 };
  const validJson = JSON.stringify(validPathFor(scheduleDays));

  assert.throws(
    () => geminiService.parseLearningPathResponse(`\`\`\`json\n${validJson}\n`, options),
    { statusCode: 502, isSafeLearningPathError: true }
  );
  assert.throws(
    () => geminiService.parseLearningPathResponse(`Here is your plan:\n${validJson}`, options),
    { statusCode: 502, isSafeLearningPathError: true }
  );
  assert.throws(
    () => geminiService.parseLearningPathResponse(`\`\`\`json\n${validJson}\n\`\`\`\nDone`, options),
    { statusCode: 502, isSafeLearningPathError: true }
  );
});

test("Gemini output rejects combined activity duration above the daily limit", () => {
  const scheduleDays = [{ day: 1, date: "2026-01-15" }];
  const path = validPathFor(scheduleDays);
  path.schedule[0].activities.push({
    type: "read-notes",
    title: "Review notes",
    description: "Review the main definitions.",
    topic: "Definitions",
    duration: 35
  });

  assert.throws(
    () => geminiService.validateLearningPathOutput(path, { scheduleDays, maxStudyMinutes: 60 }),
    { statusCode: 502, isSafeLearningPathError: true }
  );
});

test("Gemini output rejects missing required schedule or activity fields and invalid dates", () => {
  const scheduleDays = [{ day: 1, date: "2026-01-15" }];
  const options = { scheduleDays, maxStudyMinutes: 120 };
  const validPath = validPathFor(scheduleDays);

  for (const path of [
    { title: "Missing schedule" },
    {
      ...validPath,
      schedule: [{ ...validPath.schedule[0], activities: [{
        ...validPath.schedule[0].activities[0],
        title: ""
      }] }]
    },
    {
      ...validPath,
      schedule: [{ ...validPath.schedule[0], date: "2026-02-31" }]
    }
  ]) {
    assert.throws(
      () => geminiService.validateLearningPathOutput(path, options),
      { statusCode: 502, isSafeLearningPathError: true }
    );
  }
});

test("Gemini output rejects normalized impossible dates and accepts the exact expected date", () => {
  const scheduleDays = [{ day: 1, date: "2026-03-03" }];
  const options = { scheduleDays, maxStudyMinutes: 120 };
  const invalidPath = validPathFor(scheduleDays);
  invalidPath.schedule[0].date = "2026-02-31";

  assert.throws(
    () => geminiService.validateLearningPathOutput(invalidPath, options),
    { statusCode: 502, isSafeLearningPathError: true }
  );

  const validResult = geminiService.validateLearningPathOutput(validPathFor(scheduleDays), options);
  assert.equal(validResult.schedule[0].date.toISOString(), "2026-03-03T00:00:00.000Z");
});
