const test = require("node:test");
const assert = require("node:assert/strict");
const QuizSession = require("../models/QuizSession");
const gemini = require("../utils/gemini");
const gradingService = require("../services/quizGradingService");
const quizSessionService = require("../services/quizSessionService");

const USER_ID = "507f1f77bcf86cd799439011";
const OTHER_USER_ID = "507f1f77bcf86cd799439012";
const ATTEMPT_ID = "507f1f77bcf86cd799439051";
const OBJECTIVE_ID = "507f1f77bcf86cd799439041";
const FILL_ID = "507f1f77bcf86cd799439042";
const THEORY_ID = "507f1f77bcf86cd799439043";

const objectiveQuestion = ({ selectedOptionId = "option-a" } = {}) => ({
  questionId: OBJECTIVE_ID,
  question: "Which option is correct?",
  questionType: "objective",
  questionOrder: 1,
  marks: 2,
  presentedOptions: [
    { optionId: "option-a", text: "Correct choice" },
    { optionId: "option-b", text: "Incorrect choice" }
  ],
  selectedOptionId,
  markingSnapshot: {
    objective: {
      correctOptionId: "option-a",
      verificationOptionId: "option-a",
      explanation: "The stored answer is independently confirmed."
    }
  }
});

const fillQuestion = ({ selectedAnswers = ["ALPHA", "gamma   with whitespace"] } = {}) => ({
  questionId: FILL_ID,
  question: "Complete the two blanks.",
  questionType: "fill_in_gap",
  questionOrder: 2,
  blankCount: 2,
  marks: 4,
  selectedAnswers,
  markingSnapshot: {
    fillInGap: {
      totalMarks: 4,
      explanation: "Both answers are required.",
      blanks: [
        {
          blankNumber: 1,
          expectedAnswer: "alpha",
          acceptableAnswers: ["alpha", "first letter"],
          semanticGuidance: "The first Greek letter.",
          marks: 2,
          gradingCriteria: [
            { criterion: "Identifies alpha.", marks: 2 }
          ]
        },
        {
          blankNumber: 2,
          expectedAnswer: "gamma with whitespace",
          acceptableAnswers: ["gamma with whitespace"],
          semanticGuidance: "The third Greek letter.",
          marks: 2,
          gradingCriteria: [
            { criterion: "Identifies gamma.", marks: 2 }
          ]
        }
      ]
    }
  }
});

const theoryQuestion = ({ theoryResponse = "An alternate but correct explanation." } = {}) => ({
  questionId: THEORY_ID,
  question: "Explain the two required ideas.",
  questionType: "theory",
  questionOrder: 3,
  marks: 4,
  theoryResponse,
  markingSnapshot: {
    theory: {
      referenceAnswer: "The model answer for both points.",
      totalMarks: 4,
      explanation: "Both concepts are needed.",
      criteria: [
        {
          criterionId: "criterion-one",
          description: "States the first idea.",
          marks: 2,
          acceptableAlternatives: ["A valid first-idea alternative."]
        },
        {
          criterionId: "criterion-two",
          description: "Explains the second idea.",
          marks: 2,
          acceptableAlternatives: []
        }
      ]
    }
  }
});

const createSession = (questions, overrides = {}) => ({
  _id: ATTEMPT_ID,
  user: USER_ID,
  course: "507f1f77bcf86cd799439021",
  status: "completed",
  attemptFormatVersion: 2,
  gradingStatus: "pending",
  score: null,
  percentage: null,
  totalQuestions: questions.length,
  questions,
  ...overrides
});

const withGradingMocks = async (session, assess, run) => {
  const originalFindOne = QuizSession.findOne;
  const originalFindOneAndUpdate = QuizSession.findOneAndUpdate;
  const originalGradeCbtResponses = gemini.gradeCbtResponses;
  let aiCalls = 0;
  let writes = 0;

  QuizSession.findOne = async (filter) => {
    if (String(filter._id) !== String(session._id) ||
        String(filter.user) !== String(session.user)) return null;
    return session;
  };
  QuizSession.findOneAndUpdate = async (filter, update) => {
    const conditions = filter.$and;
    if (conditions) {
      if (String(conditions[0]._id) !== String(session._id) ||
          String(conditions[0].user) !== String(session.user) ||
          session.status !== "completed" ||
          session.attemptFormatVersion < 2) return null;
      const allowedStatuses = conditions[1].$or;
      const eligible = allowedStatuses.some((branch) => {
        if (branch.gradingStatus?.$in) return branch.gradingStatus.$in.includes(session.gradingStatus);
        if (branch.gradingStatus?.$exists === false) return session.gradingStatus === undefined;
        if (branch.gradingStatus === "grading") {
          if (branch.gradingStartedAt?.$lte) {
            return session.gradingStatus === "grading" &&
              session.gradingStartedAt <= branch.gradingStartedAt.$lte;
          }
          return session.gradingStatus === "grading" && !session.gradingStartedAt;
        }
        return false;
      });
      if (!eligible) return null;
    } else if (String(filter._id) !== String(session._id) ||
        String(filter.user) !== String(session.user) ||
        session.gradingStatus !== "grading" ||
        session.gradingToken !== filter.gradingToken) {
      return null;
    }

    for (const [path, value] of Object.entries(update.$set || {})) {
      const match = path.match(/^questions\.(\d+)\.(.+)$/);
      if (match) {
        session.questions[Number(match[1])][match[2]] = value;
      } else {
        session[path] = value;
      }
    }
    for (const path of Object.keys(update.$unset || {})) delete session[path];
    for (const [field, value] of Object.entries(update.$inc || {})) {
      session[field] = (session[field] || 0) + value;
    }
    writes += 1;
    return session;
  };
  gemini.gradeCbtResponses = async (...args) => {
    aiCalls += 1;
    return assess(...args);
  };

  try {
    await run({
      session,
      get aiCalls() { return aiCalls; },
      get writes() { return writes; }
    });
  } finally {
    QuizSession.findOne = originalFindOne;
    QuizSession.findOneAndUpdate = originalFindOneAndUpdate;
    gemini.gradeCbtResponses = originalGradeCbtResponses;
  }
};

const fillAssessment = (overrides = {}) => ({
  message: JSON.stringify({
    results: [{
      questionId: FILL_ID,
      blankNumber: 1,
      uncertain: false,
      uncertaintyReason: "",
      criteria: [{
        criterionId: "blank-1-criterion-1",
        awardedMarks: 1,
        feedback: "The response gives the relevant meaning.",
        missingPoint: "The answer omitted a required detail."
      }],
      totalAwardedMarks: 1,
      explanation: "The response is partly correct."
    }],
    ...overrides
  })
});

test("objective grading uses only the snapshotted agreed option and does not call Gemini", async () => {
  for (const [selectedOptionId, expectedCorrect, expectedMarks] of [
    ["option-a", true, 2],
    ["option-b", false, 0]
  ]) {
    const session = createSession([objectiveQuestion({ selectedOptionId })]);
    await withGradingMocks(session, async () => {
      throw new Error("Objective answers must not trigger Gemini.");
    }, async (state) => {
      const result = await gradingService.gradeAttempt({ attemptId: ATTEMPT_ID, userId: USER_ID });
      assert.equal(result.kind, "graded");
      assert.equal(result.session.gradingStatus, "graded");
      assert.equal(result.session.score, expectedMarks);
      assert.equal(result.session.totalMarks, 2);
      assert.equal(result.session.percentage, expectedMarks ? 100 : 0);
      assert.equal(result.session.questions[0].gradingResult.isCorrect, expectedCorrect);
      assert.equal(result.session.questions[0].gradingResult.correctAnswer, "Correct choice");
      assert.equal(state.aiCalls, 0);
    });
  }
});

test("fill-in answers exact-match case and whitespace variants without AI", async () => {
  const session = createSession([fillQuestion()]);
  const originalSnapshot = JSON.stringify(session.questions[0].markingSnapshot);
  await withGradingMocks(session, async () => {
    throw new Error("Exact fill-in answers must not trigger Gemini.");
  }, async (state) => {
    const result = await gradingService.gradeAttempt({ attemptId: ATTEMPT_ID, userId: USER_ID });
    assert.equal(result.kind, "graded");
    assert.equal(result.session.score, 4);
    assert.equal(result.session.percentage, 100);
    assert.deepEqual(result.session.questions[0].gradingResult.blanks.map((blank) => blank.awardedMarks), [2, 2]);
    assert.equal(state.aiCalls, 0);
    assert.equal(JSON.stringify(session.questions[0].markingSnapshot), originalSnapshot);
  });
});

test("administrator marking grades the stored answer and accepted answers without Gemini", async () => {
  for (const [selectedOptionId, expectedMarks] of [
    ["option-b", 2],
    ["option-a", 0]
  ]) {
    const objective = objectiveQuestion({ selectedOptionId });
    objective.markingSnapshot.markingSource = "admin_authored";
    objective.markingSnapshot.objective.correctOptionId = "option-b";
    delete objective.markingSnapshot.objective.verificationOptionId;
    const fill = fillQuestion();
    fill.markingSnapshot.markingSource = "admin_authored";
    for (const blank of fill.markingSnapshot.fillInGap.blanks) {
      delete blank.semanticGuidance;
      delete blank.gradingCriteria;
    }
    const session = createSession([objective, fill]);
    const snapshot = JSON.stringify(session.questions.map((question) => question.markingSnapshot));

    await withGradingMocks(session, async () => {
      throw new Error("Administrator-authored answers must not trigger Gemini.");
    }, async (state) => {
      const result = await gradingService.gradeAttempt({ attemptId: ATTEMPT_ID, userId: USER_ID });
      assert.equal(result.kind, "graded");
      assert.equal(result.session.gradingStatus, "graded");
      assert.equal(result.session.score, expectedMarks + 4);
      assert.equal(result.session.totalMarks, 6);
      assert.equal(result.session.questions[0].gradingResult.awardedMarks, expectedMarks);
      assert.equal(result.session.questions[1].gradingResult.awardedMarks, 4);
      assert.equal(state.aiCalls, 0);
      assert.equal(JSON.stringify(session.questions.map((question) => question.markingSnapshot)), snapshot);
    });
  }
});

test("administrator theory rubrics require manual marking and do not receive automatic marks", async () => {
  const theory = theoryQuestion();
  theory.markingSnapshot.markingSource = "admin_authored";
  delete theory.markingSnapshot.theory.referenceAnswer;
  delete theory.markingSnapshot.theory.explanation;
  const session = createSession([theory]);
  await withGradingMocks(session, async () => {
    throw new Error("Administrator-authored theory rubrics must not trigger Gemini.");
  }, async (state) => {
    const result = await gradingService.gradeAttempt({ attemptId: ATTEMPT_ID, userId: USER_ID });
    assert.equal(result.kind, "needs_review");
    assert.equal(result.session.gradingStatus, "needs_review");
    assert.equal(result.session.score, null);
    assert.equal(result.session.percentage, null);
    assert.equal(result.session.provisionalScore, 0);
    assert.equal(result.session.questions[0].gradingResult.awardedMarks, null);
    assert.equal(result.session.questions[0].gradingResult.criteria.length, 2);
    assert.equal(state.aiCalls, 0);
  });
});

test("enabling non-AI mode leaves existing quiz-session marking snapshots unchanged", async () => {
  const previousMode = process.env.CBT_NON_AI_MODE;
  process.env.CBT_NON_AI_MODE = "true";
  const objective = {
    ...objectiveQuestion(),
    markingVersionId: "previous-ai-version"
  };
  const fill = fillQuestion({ selectedAnswers: ["not an exact answer", "gamma with whitespace"] });
  const theory = theoryQuestion();
  const session = createSession([objective, fill, theory]);
  const snapshots = JSON.stringify(session.questions.map((question) => question.markingSnapshot));
  try {
    await withGradingMocks(session, async () => {
      throw new Error("Existing AI-marked attempt snapshots must not be sent to Gemini.");
    }, async (state) => {
      const result = await gradingService.gradeAttempt({ attemptId: ATTEMPT_ID, userId: USER_ID });
      assert.equal(result.kind, "needs_review");
      assert.equal(result.session.gradingStatus, "needs_review");
      assert.equal(result.session.score, null);
      assert.deepEqual(result.session.questions.map((question) => question.gradingResult.status), [
        "needs_review",
        "needs_review",
        "needs_review"
      ]);
      assert.deepEqual(result.session.questions.map((question) => question.gradingResult.awardedMarks), [
        null,
        null,
        null
      ]);
      assert.equal(result.session.questions[0].markingVersionId, "previous-ai-version");
      assert.equal(
        JSON.stringify(result.session.questions.map((question) => question.markingSnapshot)),
        snapshots
      );
      assert.equal(state.aiCalls, 0);
    });
  } finally {
    if (previousMode === undefined) delete process.env.CBT_NON_AI_MODE;
    else process.env.CBT_NON_AI_MODE = previousMode;
  }
});

test("fill-in semantic grading returns validated partial marks by criterion", async () => {
  const session = createSession([fillQuestion({ selectedAnswers: ["a meaningful alpha", "gamma with whitespace"] })]);
  await withGradingMocks(session, async (items) => {
    assert.equal(items.length, 1);
    assert.equal(items[0].blankNumber, 1);
    assert.equal(items[0].criteria[0].criterionId, "blank-1-criterion-1");
    return fillAssessment();
  }, async (state) => {
    const result = await gradingService.gradeAttempt({ attemptId: ATTEMPT_ID, userId: USER_ID });
    const blank = result.session.questions[0].gradingResult.blanks[0];
    assert.equal(result.kind, "graded");
    assert.equal(result.session.score, 3);
    assert.equal(result.session.totalMarks, 4);
    assert.equal(result.session.percentage, 75);
    assert.equal(blank.awardedMarks, 1);
    assert.equal(blank.provisional, false);
    assert.equal(blank.criteria[0].missingPoint, "The answer omitted a required detail.");
    assert.equal(state.aiCalls, 1);
  });
});

test("theory grading assesses each rubric criterion and caps marks to its allocation", async () => {
  const session = createSession([theoryQuestion()]);
  await withGradingMocks(session, async (items) => {
    assert.equal(items.length, 1);
    assert.equal(items[0].referenceAnswer, "The model answer for both points.");
    return {
      message: JSON.stringify({
        results: [{
          questionId: THEORY_ID,
          uncertain: false,
          uncertaintyReason: "",
          criteria: [
            {
              criterionId: "criterion-one",
              awardedMarks: 2,
              feedback: "A valid alternative explanation demonstrates the first idea.",
              missingPoint: ""
            },
            {
              criterionId: "criterion-two",
              awardedMarks: 1,
              feedback: "The second idea is partly explained.",
              missingPoint: "The response omitted one required relationship."
            }
          ],
          totalAwardedMarks: 3,
          explanation: "The answer uses valid alternative wording but misses some detail."
        }]
      })
    };
  }, async (state) => {
    const result = await gradingService.gradeAttempt({ attemptId: ATTEMPT_ID, userId: USER_ID });
    const feedback = result.session.questions[0].gradingResult;
    assert.equal(result.kind, "graded");
    assert.equal(result.session.score, 3);
    assert.equal(result.session.totalMarks, 4);
    assert.equal(feedback.provisional, false);
    assert.deepEqual(feedback.criteria.map((criterion) => criterion.awardedMarks), [2, 1]);
    assert.equal(feedback.lostMarks, "The response omitted one required relationship.");
    assert.equal(state.aiCalls, 1);
  });
});

test("uncertain AI output needs review and does not silently assign a zero", async () => {
  const session = createSession([objectiveQuestion(), theoryQuestion()]);
  await withGradingMocks(session, async () => ({
    message: JSON.stringify({
      results: [{
        questionId: THEORY_ID,
        uncertain: true,
        uncertaintyReason: "The response is ambiguous.",
        criteria: [],
        totalAwardedMarks: null,
        explanation: "The answer cannot be assessed reliably."
      }]
    })
  }), async () => {
    const result = await gradingService.gradeAttempt({ attemptId: ATTEMPT_ID, userId: USER_ID });
    assert.equal(result.kind, "needs_review");
    assert.equal(result.session.gradingStatus, "needs_review");
    assert.equal(result.session.score, null);
    assert.equal(result.session.percentage, null);
    assert.equal(result.session.provisionalScore, 2);
    assert.equal(result.session.provisionalMaxMarks, 2);
    assert.equal(result.session.questions[1].gradingResult.awardedMarks, null);
    assert.equal(result.session.questions[1].gradingResult.uncertaintyReason, "The response is ambiguous.");
    assert.equal(result.session.questions[0].gradingResult.provisional, false);
    assert.equal(result.session.questions[1].gradingResult.provisional, true);
  });
});

test("malformed, contradictory, and over-maximum AI marks fail without dropping answers", async () => {
  const session = createSession([fillQuestion({ selectedAnswers: ["a meaningful alpha", "gamma with whitespace"] })]);
  await withGradingMocks(session, async () => ({
    message: JSON.stringify({
      results: [{
        questionId: FILL_ID,
        blankNumber: 1,
        uncertain: false,
        uncertaintyReason: "",
        criteria: [{
          criterionId: "blank-1-criterion-1",
          awardedMarks: 3,
          feedback: "Too many marks.",
          missingPoint: ""
        }],
        totalAwardedMarks: 3,
        explanation: "Malformed result."
      }]
    })
  }), async () => {
    const result = await gradingService.gradeAttempt({ attemptId: ATTEMPT_ID, userId: USER_ID });
    assert.equal(result.kind, "failed");
    assert.equal(result.session.gradingStatus, "failed");
    assert.equal(result.session.gradingErrorCode, "invalid_output");
    assert.equal(result.session.score, null);
    assert.equal(result.session.questions[0].selectedAnswers[0], "a meaningful alpha");
    assert.equal(result.session.questions[0].gradingResult, undefined);
  });
});

test("provider failures are safely retryable and successful retries are idempotent", async () => {
  const session = createSession([theoryQuestion()]);
  let providerCalls = 0;
  await withGradingMocks(session, async () => {
    providerCalls += 1;
    if (providerCalls === 1) {
      const error = new Error("private provider details");
      error.statusCode = 503;
      throw error;
    }
    return {
      message: JSON.stringify({
        results: [{
          questionId: THEORY_ID,
          uncertain: false,
          uncertaintyReason: "",
          criteria: [
            { criterionId: "criterion-one", awardedMarks: 2, feedback: "Complete.", missingPoint: "" },
            { criterionId: "criterion-two", awardedMarks: 2, feedback: "Complete.", missingPoint: "" }
          ],
          totalAwardedMarks: 4,
          explanation: "Both criteria are satisfied."
        }]
      })
    };
  }, async (state) => {
    const first = await gradingService.gradeAttempt({ attemptId: ATTEMPT_ID, userId: USER_ID });
    assert.equal(first.kind, "failed");
    assert.equal(first.session.gradingErrorCode, "not_configured");
    assert.equal(first.session.questions[0].theoryResponse, "An alternate but correct explanation.");
    const second = await gradingService.gradeAttempt({ attemptId: ATTEMPT_ID, userId: USER_ID });
    assert.equal(second.kind, "graded");
    assert.equal(second.session.score, 4);
    const duplicate = await gradingService.gradeAttempt({ attemptId: ATTEMPT_ID, userId: USER_ID });
    assert.equal(duplicate.kind, "already_graded");
    assert.equal(state.session.gradingAttemptCount, 2);
    assert.equal(state.aiCalls, 2);
  });
});

test("concurrent retries cannot overwrite a live grading claim", async () => {
  const session = createSession([theoryQuestion()]);
  let releaseAssessment;
  const assessmentPending = new Promise((resolve) => { releaseAssessment = resolve; });
  await withGradingMocks(session, async () => assessmentPending, async () => {
    const firstPromise = gradingService.gradeAttempt({ attemptId: ATTEMPT_ID, userId: USER_ID });
    await new Promise((resolve) => setImmediate(resolve));
    const second = await gradingService.gradeAttempt({ attemptId: ATTEMPT_ID, userId: USER_ID });
    assert.equal(second.kind, "already_grading");
    releaseAssessment({
      message: JSON.stringify({
        results: [{
          questionId: THEORY_ID,
          uncertain: true,
          uncertaintyReason: "Requires specialist interpretation.",
          criteria: [],
          totalAwardedMarks: null,
          explanation: "The expected knowledge is outside the available assessment context."
        }]
      })
    });
    const first = await firstPromise;
    assert.equal(first.kind, "needs_review");
    assert.equal(session.gradingAttemptCount, 1);
  });
});

test("owners only can grade submitted typed attempts and historical attempts are never regraded", async () => {
  const session = createSession([objectiveQuestion()]);
  await withGradingMocks(session, async () => ({
    message: JSON.stringify({ results: [] })
  }), async (state) => {
    assert.equal((await gradingService.gradeAttempt({ attemptId: ATTEMPT_ID, userId: OTHER_USER_ID })).kind, "not_found");
    const legacy = createSession([objectiveQuestion()], { attemptFormatVersion: 1, gradingStatus: undefined });
    const original = QuizSession.findOne;
    QuizSession.findOne = async (filter) =>
      String(filter.user) === String(USER_ID) ? legacy : null;
    try {
      assert.equal((await gradingService.gradeAttempt({ attemptId: ATTEMPT_ID, userId: USER_ID })).kind, "legacy");
      assert.equal(legacy.gradingStatus, undefined);
      assert.equal(state.aiCalls, 0);
    } finally {
      QuizSession.findOne = original;
    }
  });
});

test("timeouts persist failed state while stale provider completions cannot change the result", async () => {
  const session = createSession([theoryQuestion()]);
  await withGradingMocks(session, () => new Promise(() => {}), async () => {
    const result = await gradingService.gradeAttempt({
      attemptId: ATTEMPT_ID,
      userId: USER_ID,
      timeoutMs: 1
    });
    assert.equal(result.kind, "failed");
    assert.equal(result.session.gradingStatus, "failed");
    assert.equal(result.session.gradingErrorCode, "grading_timeout");
    assert.equal(result.session.questions[0].theoryResponse, "An alternate but correct explanation.");
  });
});

test("student attempt serialization hides grading data until completion and successful grading", () => {
  const question = {
    ...objectiveQuestion(),
    gradingResult: {
      status: "graded",
      questionType: "objective",
      isCorrect: true,
      awardedMarks: 2,
      maxMarks: 2,
      correctAnswer: "Correct choice",
      explanation: "Private before submit."
    }
  };
  const active = createSession([question], { status: "in_progress", gradingStatus: "graded" });
  const activeView = quizSessionService.toStudentAttempt(active);
  assert.equal(Object.hasOwn(activeView.questions[0], "gradingResult"), false);
  assert.equal(Object.hasOwn(activeView.questions[0], "correctOptionId"), false);

  const pending = createSession([question], { gradingStatus: "pending" });
  const pendingView = quizSessionService.toStudentAttempt(pending);
  assert.equal(Object.hasOwn(pendingView.questions[0], "gradingResult"), false);

  const completed = createSession([question], {
    gradingStatus: "graded",
    score: 2,
    totalMarks: 2,
    percentage: 100
  });
  const completedView = quizSessionService.toStudentAttempt(completed);
  assert.equal(completedView.questions[0].gradingResult.correctAnswer, undefined);
  assert.equal(completedView.questions[0].gradingResult.isCorrect, true);
  assert.equal(completedView.score, 2);
  assert.equal(completedView.totalMarks, 2);
});

test("student attempt serialization omits nested answers, marking guides, and theory rubrics without mutating saved data", () => {
  const objective = {
    ...objectiveQuestion(),
    markingSnapshot: {
      markingSource: "admin_authored",
      objective: { correctOptionId: "private-option-id" }
    },
    gradingResult: {
      status: "graded",
      questionType: "objective",
      isCorrect: false,
      awardedMarks: 0,
      maxMarks: 2,
      correctOptionId: "private-option-id",
      correctAnswer: "private-correct-answer",
      explanation: "private-objective-explanation",
      lostMarks: "private-lost-marks"
    }
  };
  const theory = {
    ...theoryQuestion(),
    markingSnapshot: {
      markingSource: "admin_authored",
      theory: {
        referenceAnswer: "private-reference-answer",
        criteria: [{
          criterionId: "private-criterion-id",
          description: "private-rubric-description",
          acceptableAlternatives: ["private-acceptable-alternative"],
          marks: 4
        }]
      }
    },
    gradingResult: {
      status: "needs_review",
      questionType: "theory",
      awardedMarks: null,
      maxMarks: 4,
      referenceAnswer: "private-reference-answer",
      explanation: "private-theory-explanation",
      criteria: [{
        criterionId: "private-criterion-id",
        description: "private-rubric-description",
        acceptableAlternatives: ["private-acceptable-alternative"],
        awardedMarks: null,
        maxMarks: 4,
        feedback: "private-rubric-feedback"
      }]
    }
  };
  const session = createSession([objective, theory], {
    gradingStatus: "needs_review",
    totalMarks: 6
  });
  const storedSnapshot = JSON.stringify(session.questions.map((item) => item.markingSnapshot));

  const studentView = quizSessionService.toStudentAttempt(session);
  const serialized = JSON.stringify(studentView);

  for (const secret of [
    "private-option-id",
    "private-correct-answer",
    "private-objective-explanation",
    "private-lost-marks",
    "private-reference-answer",
    "private-rubric-description",
    "private-acceptable-alternative",
    "private-rubric-feedback",
    "private-theory-explanation"
  ]) {
    assert.equal(serialized.includes(secret), false, `${secret} must not reach students`);
  }
  assert.equal(Object.hasOwn(studentView.questions[1].gradingResult, "criteria"), false);
  assert.equal(studentView.questions[1].gradingResult.status, "needs_review");
  assert.equal(
    JSON.stringify(session.questions.map((item) => item.markingSnapshot)),
    storedSnapshot
  );
});
