const test = require("node:test");
const assert = require("node:assert/strict");
const QuizSession = require("../models/QuizSession");
const quizSessionService = require("../services/quizSessionService");

const OWNER_ID = "507f1f77bcf86cd799439011";
const ATTEMPT_ID = "507f1f77bcf86cd799439051";
const QUESTION_A = "507f1f77bcf86cd799439041";
const QUESTION_B = "507f1f77bcf86cd799439042";

const createAttempt = (overrides = {}) => ({
  _id: ATTEMPT_ID,
  user: OWNER_ID,
  status: "in_progress",
  stateVersion: 0,
  startedAt: new Date("2030-01-01T10:00:00.000Z"),
  timeStarted: new Date("2030-01-01T10:00:00.000Z"),
  expiresAt: new Date("2030-01-01T10:30:00.000Z"),
  questions: [
    {
      questionId: QUESTION_A,
      question: "First?",
      presentedOptions: [
        { optionId: "a1", text: "A" },
        { optionId: "a2", text: "B" }
      ],
      correctOptionId: "a1"
    },
    {
      questionId: QUESTION_B,
      question: "Second?",
      presentedOptions: [
        { optionId: "b1", text: "A" },
        { optionId: "b2", text: "B" }
      ],
      correctOptionId: "b2"
    }
  ],
  ...overrides
});

const withSessionStore = async (attempt, run) => {
  const originals = {
    findOne: QuizSession.findOne,
    findOneAndUpdate: QuizSession.findOneAndUpdate,
    find: QuizSession.find
  };
  const state = { attempt, updates: 0 };

  QuizSession.findOne = async (filter) => {
    if (String(filter._id) !== String(state.attempt._id)) return null;
    if (filter.user && String(filter.user) !== String(state.attempt.user)) return null;
    return state.attempt;
  };

  QuizSession.findOneAndUpdate = async (filter, update) => {
    const conditions = filter.$and || [filter];
    for (const condition of conditions) {
      if (condition._id && String(condition._id) !== String(state.attempt._id)) return null;
      if (condition.user && String(condition.user) !== String(state.attempt.user)) return null;
      if (condition.status && state.attempt.status !== condition.status) return null;
      if (condition.$or) {
        const matched = condition.$or.some((branch) => {
          if (branch.status === "in_progress") return state.attempt.status === "in_progress";
          if (branch.stateVersion?.$exists === false) return !state.attempt.stateVersion;
          if (branch.stateVersion !== undefined) return state.attempt.stateVersion === branch.stateVersion;
          if (branch.expiresAt?.$gt) return state.attempt.expiresAt > branch.expiresAt.$gt;
          if (branch.expiresAt?.$exists === false) return !state.attempt.expiresAt;
          if (branch.expiresAt === null) return !state.attempt.expiresAt;
          return false;
        });
        if (!matched) return null;
      }
      if (condition.expiresAt?.$lte &&
          !(state.attempt.expiresAt && state.attempt.expiresAt <= condition.expiresAt.$lte)) return null;
      if (condition.questions?.$elemMatch &&
          !state.attempt.questions.some((question) =>
            String(question.questionId) === String(condition.questions.$elemMatch.questionId)
          )) return null;
    }

    for (const [path, value] of Object.entries(update.$set || {})) {
      if (path === "questions") {
        state.attempt.questions = value;
      } else if (path.startsWith("questions.$[question].")) {
        const questionId = conditions.find((condition) => condition.questions?.$elemMatch)
          ?.questions.$elemMatch.questionId;
        const question = state.attempt.questions.find((item) =>
          String(item.questionId) === String(questionId)
        );
        question[path.split(".").pop()] = value;
      } else if (path.startsWith("questions.")) {
        const [, index, field] = path.split(".");
        state.attempt.questions[Number(index)][field] = value;
      } else {
        state.attempt[path] = value;
      }
    }
    for (const path of Object.keys(update.$unset || {})) {
      if (path.startsWith("questions.$[question].")) {
        const questionId = conditions.find((condition) => condition.questions?.$elemMatch)
          ?.questions.$elemMatch.questionId;
        const question = state.attempt.questions.find((item) =>
          String(item.questionId) === String(questionId)
        );
        delete question[path.split(".").pop()];
      }
    }
    for (const [field, value] of Object.entries(update.$inc || {})) {
      state.attempt[field] = (state.attempt[field] || 0) + value;
    }
    state.updates += 1;
    return state.attempt;
  };

  QuizSession.find = (query) => {
    const result = {
      sort() { return result; },
      limit() { return result; },
      select() { return result; },
      lean() {
        const now = query.expiresAt.$lte;
        return Promise.resolve(
          state.attempt.status === "in_progress" && state.attempt.expiresAt <= now
            ? [{ _id: state.attempt._id }]
            : []
        );
      }
    };
    return result;
  };

  try {
    await run(state);
  } finally {
    QuizSession.findOne = originals.findOne;
    QuizSession.findOneAndUpdate = originals.findOneAndUpdate;
    QuizSession.find = originals.find;
  }
};

test("saved answers are graded once on expiry and unanswered questions remain incorrect", async () => {
  const now = new Date("2030-01-01T10:31:00.000Z");
  await withSessionStore(createAttempt({
    questions: createAttempt().questions.map((question, index) => ({
      ...question,
      ...(index === 0 ? { selectedOptionId: "a1" } : {})
    }))
  }), async (state) => {
    const first = await quizSessionService.processExpiredAttempts({ now });
    const second = await quizSessionService.processExpiredAttempts({ now });
    assert.deepEqual(first, { inspected: 1, finalized: 1 });
    assert.deepEqual(second, { inspected: 0, finalized: 0 });
    assert.equal(state.updates, 1);
    assert.equal(state.attempt.status, "completed");
    assert.equal(state.attempt.completionReason, "expired");
    assert.equal(state.attempt.score, 1);
    assert.equal(state.attempt.percentage, 50);
    assert.equal(state.attempt.duration, 30 * 60);
    assert.equal(state.attempt.questions[1].isCorrect, false);
    assert.equal(state.attempt.questions[1].selectedOptionId, undefined);
  });
});

test("concurrent saves with the same version cannot overwrite each other", async () => {
  const now = new Date("2030-01-01T10:10:00.000Z");
  await withSessionStore(createAttempt(), async (state) => {
    const save = (selectedOptionId) => quizSessionService.saveAnswer({
      attemptId: ATTEMPT_ID,
      userId: OWNER_ID,
      questionId: QUESTION_A,
      selectedOptionId,
      expectedVersion: 0,
      now
    });
    const results = await Promise.all([save("a1"), save("a2")]);
    assert.equal(results.filter((result) => result.kind === "saved").length, 1);
    assert.equal(results.filter((result) => result.kind === "conflict").length, 1);
    assert.equal(state.attempt.stateVersion, 1);
    assert.ok(["a1", "a2"].includes(state.attempt.questions[0].selectedOptionId));
  });
});

test("a save that crosses the expiry deadline while being processed is not persisted", async () => {
  const beforeExpiry = new Date("2030-01-01T10:29:59.000Z");
  const afterExpiry = new Date("2030-01-01T10:30:01.000Z");
  await withSessionStore(createAttempt(), async (state) => {
    const result = await quizSessionService.saveAnswer({
      attemptId: ATTEMPT_ID,
      userId: OWNER_ID,
      questionId: QUESTION_A,
      selectedOptionId: "a1",
      expectedVersion: 0,
      now: beforeExpiry,
      clock: () => afterExpiry
    });
    assert.equal(result.kind, "expired");
    assert.equal(state.attempt.status, "completed");
    assert.equal(state.attempt.questions[0].selectedOptionId, undefined);
  });
});

test("manual and expiry finalizers return one persisted result", async () => {
  const now = new Date("2030-01-01T10:31:00.000Z");
  await withSessionStore(createAttempt(), async (state) => {
    const results = await Promise.all([
      quizSessionService.finalizeAttempt(ATTEMPT_ID, {
        userId: OWNER_ID,
        reason: "manual",
        now: () => now
      }),
      quizSessionService.finalizeAttempt(ATTEMPT_ID, {
        userId: OWNER_ID,
        reason: "expired",
        now: () => now
      })
    ]);
    assert.equal(state.updates, 1);
    assert.equal(state.attempt.status, "completed");
    assert.equal(state.attempt.completionReason, "expired");
    assert.equal(results[0].score, results[1].score);
    assert.equal(results[0].timeEnded.getTime(), results[1].timeEnded.getTime());
  });
});
