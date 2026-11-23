const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "phase-2-quiz-session-test-secret";
const { generateAccessToken } = require("../utils/token");
const quizRouter = require("../routes/quizSession");
const QuizSession = require("../models/QuizSession");
const Question = require("../models/Question");
const Course = require("../models/course");
const User = require("../models/User");
const shuffle = require("../utils/shuffle");
const quizSessionService = require("../services/quizSessionService");
const quizGradingService = require("../services/quizGradingService");
const practiceTestService = require("../services/practiceTestService");
const questionAccess = require("../services/questionAccessService");

const STUDENT_A = "507f1f77bcf86cd799439011";
const STUDENT_B = "507f1f77bcf86cd799439012";
const COURSE_ID = "507f1f77bcf86cd799439021";
const OTHER_COURSE_ID = "507f1f77bcf86cd799439022";
const DEPARTMENT_ID = "507f1f77bcf86cd799439031";
const QUESTION_A = "507f1f77bcf86cd799439041";
const QUESTION_B = "507f1f77bcf86cd799439042";
const QUESTION_FOREIGN = "507f1f77bcf86cd799439043";
const ATTEMPT_ID = "507f1f77bcf86cd799439051";
const SOURCE_PAPER_ID = "507f1f77bcf86cd799439081";

test("configured examination duration accepts only bounded whole-minute values", () => {
  assert.equal(quizSessionService.getConfiguredDurationMinutes("1"), 1);
  assert.equal(quizSessionService.getConfiguredDurationMinutes("30"), 30);
  assert.equal(quizSessionService.getConfiguredDurationMinutes("180"), 180);
  for (const invalid of ["0", "181", "1.5", "-1", " 30", "1e2", "abc"]) {
    assert.throws(() => quizSessionService.getConfiguredDurationMinutes(invalid), /between 1 and 180/);
  }
});

const student = {
  _id: STUDENT_A,
  id: STUDENT_A,
  role: "student",
  plan: "free",
  department: DEPARTMENT_ID,
  yearOfStudy: "ND1",
  semester: "First",
  coursesEnrolled: [COURSE_ID]
};
const course = {
  _id: COURSE_ID,
  department: DEPARTMENT_ID,
  level: "ND1",
  semester: "First",
  lecturers: []
};
const questions = [
  {
    _id: QUESTION_A,
    course: COURSE_ID,
    department: DEPARTMENT_ID,
    approvalStatus: "approved",
    approvedBy: "507f1f77bcf86cd799439013",
    approvedAt: new Date(),
    question: "One plus one?",
    topic: "Addition",
    options: ["2", "3"],
    optionIds: ["option-two", "option-three"],
    answer: "2"
  },
  {
    _id: QUESTION_B,
    course: COURSE_ID,
    department: DEPARTMENT_ID,
    approvalStatus: "approved",
    approvedBy: "507f1f77bcf86cd799439013",
    approvedAt: new Date(),
    question: "Two plus two?",
    topic: "Addition",
    options: ["4", "5"],
    optionIds: ["option-four", "option-five"],
    answer: "4"
  }
];
const startQuestions = Array.from({ length: 10 }, (_, index) => {
  const source = questions[index % questions.length];
  const optionIds = [`start-${index}-correct`, `start-${index}-incorrect`];
  return {
    ...source,
    _id: `507f1f77bcf86cd79943${String(60 + index).padStart(4, "0")}`,
    question: `Practice question ${index + 1}`,
    options: [`Correct ${index + 1}`, `Incorrect ${index + 1}`],
    optionIds,
    answer: `Correct ${index + 1}`
  };
});
const typedEntries = Array.from({ length: 10 }, (_, index) => {
  const type = index < 4 ? "objective" : index < 7 ? "fill_in_gap" : "theory";
  const questionId = `507f1f77bcf86cd79944${String(100 + index).padStart(4, "0")}`;
  const optionIds = type === "objective" ? [`typed-${index}-a`, `typed-${index}-b`] : [];
  const question = {
    _id: questionId,
    course: COURSE_ID,
    department: DEPARTMENT_ID,
    approvalStatus: "approved",
    approvedBy: "507f1f77bcf86cd799439013",
    approvedAt: new Date(),
    question: `Typed question ${index + 1}`,
    questionType: type,
    blankCount: type === "fill_in_gap" ? 2 : undefined,
    topic: "Typed questions",
    marks: type === "objective" ? 1 : type === "fill_in_gap" ? 4 : 6,
    options: type === "objective" ? [`Option A ${index}`, `Option B ${index}`] : [],
    optionIds,
    sourcePaper: SOURCE_PAPER_ID,
    sourcePaperMetadata: {
      title: "Typed past paper",
      examinationYear: "2025",
      level: "HND1",
      semester: "Second"
    },
    sourceExamYear: "2025",
    sourcePage: index + 1,
    sourceExcerpt: `Source excerpt ${index + 1}`
  };
  const marking = type === "objective"
    ? {
      objective: {
        correctOptionId: optionIds[0],
        verificationOptionId: optionIds[0],
        explanation: "Verified objective answer."
      }
    }
    : type === "fill_in_gap"
      ? {
        fillInGap: {
          blanks: [
            {
              blankNumber: 1,
              expectedAnswer: "alpha",
              acceptableAnswers: ["alpha"],
              gradingCriteria: [{ criterion: "First blank", marks: 2 }],
              semanticGuidance: "Equivalent wording will be assessed later."
            },
            {
              blankNumber: 2,
              expectedAnswer: "beta",
              acceptableAnswers: ["beta"],
              gradingCriteria: [{ criterion: "Second blank", marks: 2 }],
              semanticGuidance: "Equivalent wording will be assessed later."
            }
          ],
          explanation: "Fill-in marking snapshot.",
          totalMarks: 4
        }
      }
      : {
        theory: {
          referenceAnswer: "Private reference answer.",
          criteria: [{
            criterionId: "point-1",
            description: "Private theory criterion.",
            marks: 6,
            acceptableAlternatives: ["Private alternative."]
          }],
          explanation: "Private marking explanation.",
          totalMarks: 6
        }
      };
  return {
    question,
    paper: {
      _id: SOURCE_PAPER_ID,
      title: "Typed past paper",
      examinationYear: "2025",
      level: "HND1",
      semester: "Second"
    },
    markingVersion: {
      _id: `507f1f77bcf86cd79944${String(900 + index).padStart(4, "0")}`,
      marking
    }
  };
});
const ineligibleQuestions = [
  { ...questions[0], _id: "507f1f77bcf86cd799439044", approvalStatus: "draft" },
  { ...questions[0], _id: "507f1f77bcf86cd799439045", course: OTHER_COURSE_ID },
  { ...questions[0], _id: "507f1f77bcf86cd799439049", department: "507f1f77bcf86cd799439032" },
  { ...questions[0], _id: "507f1f77bcf86cd799439046", answer: "not an option" },
  { ...questions[0], _id: "507f1f77bcf86cd799439047", options: ["", "3"] },
  { ...questions[0], _id: "507f1f77bcf86cd799439048", options: ["2", "2"] }
];

const buildApp = (userId = STUDENT_A, role = "student") => {
  const app = express();
  app.use(express.json());
  if (userId) {
    const token = generateAccessToken(userId, { role });
    app.use((req, res, next) => {
      req.headers.authorization = "Bearer".concat(" ", token);
      next();
    });
  }
  app.use("/api/quiz", quizRouter);
  return app;
};

const createAttempt = (overrides = {}) => ({
  _id: ATTEMPT_ID,
  user: STUDENT_A,
  course: COURSE_ID,
  status: "in_progress",
  timeStarted: new Date(Date.now() - 15000),
  startedAt: new Date(Date.now() - 15000),
  expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  durationMinutes: 30,
  stateVersion: 0,
  questions: questions.map((question) => ({
    questionId: question._id,
    question: question.question,
    topic: question.topic,
    presentedOptions: question.options.map((text, index) => ({
      optionId: question.optionIds[index],
      text
    })),
    correctOptionId: question.optionIds[0]
  })),
  ...overrides
});

const withQuizMocks = async (run, {
  attempt = null,
  user = student,
  courseRecord = course,
  beforeAnswerUpdate,
  eligibleQuestions = questions,
  eligibleEntries = null
} = {}) => {
  const originals = {
    sessionCreate: QuizSession.create,
    sessionFindOne: QuizSession.findOne,
    sessionFindOneAndUpdate: QuizSession.findOneAndUpdate,
    sessionFind: QuizSession.find,
    questionAggregate: Question.aggregate,
    questionFind: Question.find,
    userFindById: User.findById,
    courseFindById: Course.findById,
    getEligibleQuestionsForCourse: practiceTestService.getEligibleQuestionsForCourse,
    assemblePracticeTest: practiceTestService.assemblePracticeTest
  };
  const state = {
    attempt,
    attempts: attempt ? [attempt] : [],
    createCount: 0,
    query: null,
    pipeline: null,
    sampleSize: null,
    updated: false,
    updateCount: 0,
    finalizationUpdateCount: 0
  };

  User.findById = async (id) => String(id) === String(user._id) ? user : null;
  Course.findById = async (id) => String(id) === String(courseRecord?._id) ? courseRecord : null;
  Question.find = async (query) => {
    state.query = query;
    return [...questions, ...ineligibleQuestions].filter((question) =>
      (!query.course || String(question.course) === String(query.course)) &&
      (!query.department || String(question.department) === String(query.department)) &&
      (!query.approvalStatus || question.approvalStatus === query.approvalStatus) &&
      (!query.approvedBy || Boolean(question.approvedBy)) &&
      (!query.approvedAt || question.approvedAt instanceof Date) &&
      (!query._id?.$in || query._id.$in.some((id) => String(id) === String(question._id)))
    );
  };
  practiceTestService.getEligibleQuestionsForCourse = async (selectedCourse) => {
    state.query = {
      course: selectedCourse._id,
      department: selectedCourse.department,
      approvalStatus: "approved"
    };
    return eligibleQuestions;
  };
  practiceTestService.assemblePracticeTest = async (selectedCourse, count) => {
    state.query = {
      course: selectedCourse._id,
      department: selectedCourse.department,
      approvalStatus: "approved"
    };
    const sourceEntries = eligibleEntries || eligibleQuestions.map((original, index) => {
      const question = { ...original, marks: Number(original.marks || 1) };
      const optionIds = questionAccess.stableOptionIds(question);
      const correctIndex = question.options.findIndex((option) => option === question.answer);
      const correctOptionId = optionIds[correctIndex < 0 ? 0 : correctIndex];
      return {
        question,
        paper: {
          _id: SOURCE_PAPER_ID,
          title: "Test past paper",
          examinationYear: "2024",
          level: "ND1",
          semester: "First"
        },
        markingVersion: {
          _id: `507f1f77bcf86cd79943${String(9000 + index).padStart(4, "0")}`,
          marking: {
            objective: {
              correctOptionId,
              verificationOptionId: correctOptionId,
              explanation: "The independently verified option is correct."
            }
          }
        }
      };
    });
    const unique = [...new Map(sourceEntries.map((entry) => [
      String(entry.question._id),
      entry
    ])).values()].slice(0, count);
    if (unique.length !== count) {
      return {
        ok: false,
        code: "insufficient_questions",
        entries: [],
        questions: [],
        eligibleQuestionCount: sourceEntries.length
      };
    }
    return {
      ok: true,
      code: "",
      entries: unique,
      questions: unique.map((entry) => entry.question),
      eligibleQuestionCount: sourceEntries.length
    };
  };
  QuizSession.create = async (payload) => {
    state.createCount += 1;
    const attemptId = state.createCount === 1
      ? ATTEMPT_ID
      : "507f1f77bcf86cd799439052";
    state.attempt = { _id: attemptId, ...payload };
    state.attempts.push(state.attempt);
    return state.attempt;
  };
  const matchesAttemptQuery = (item, filter) => {
    if (filter._id && String(item._id) !== String(filter._id)) return false;
    if (filter.user && String(item.user) !== String(filter.user)) return false;
    if (filter.course && String(item.course) !== String(filter.course)) return false;
    if (filter.$or && !filter.$or.some((branch) => {
      if (branch.status === "in_progress") return item.status === "in_progress";
      if (branch.status?.$exists === false) return !item.status && !item.timeEnded;
      return false;
    })) return false;
    return true;
  };
  QuizSession.findOne = (filter) => {
    const query = {
      sort() {
        return query;
      },
      then(resolve, reject) {
        return Promise.resolve(state.attempts.find((item) => matchesAttemptQuery(item, filter)) || null)
          .then(resolve, reject);
      }
    };
    return query;
  };
  QuizSession.findOneAndUpdate = async (filter, update) => {
    if (beforeAnswerUpdate && update.$inc?.stateVersion && !update.$set?.status) {
      const simulateConcurrentUpdate = beforeAnswerUpdate;
      beforeAnswerUpdate = undefined;
      await simulateConcurrentUpdate(state);
    }
    const conditions = filter.$and || [filter];
    const found = state.attempts.find((item) => conditions.every((condition) => {
      if (condition._id && String(item._id) !== String(condition._id)) return false;
      if (condition.user && String(item.user) !== String(condition.user)) return false;
      if (condition.$or) {
        return condition.$or.some((branch) => {
          if (branch.status === "in_progress") return item.status === "in_progress";
          if (branch.status?.$exists === false) return !item.status && !item.timeEnded;
          if (branch.stateVersion?.$exists === false) return !item.stateVersion;
          if (branch.stateVersion !== undefined) return item.stateVersion === branch.stateVersion;
          if (branch.expiresAt?.$gt) return !item.expiresAt || item.expiresAt > branch.expiresAt.$gt;
          if (branch.expiresAt?.$exists === false) return !item.expiresAt;
          if (branch.expiresAt === null) return !item.expiresAt;
          return false;
        });
      }
      if (condition.expiresAt?.$lte && !(item.expiresAt && item.expiresAt <= condition.expiresAt.$lte)) return false;
      if (condition.questions?.$elemMatch &&
          !item.questions.some((question) => String(question.questionId) === String(condition.questions.$elemMatch.questionId))) return false;
      return true;
    }));
    if (!found) return null;
    for (const [path, value] of Object.entries(update.$set || {})) {
      const parts = path.split(".");
      if (parts[0] !== "questions") {
        found[path] = value;
      } else if (parts.length === 1) {
        found.questions = value;
      } else if (parts[1] === "$[question]") {
        const questionId = filter.$and
          ?.find((condition) => condition.questions?.$elemMatch)
          ?.questions.$elemMatch.questionId;
        const question = found.questions.find((item) => String(item.questionId) === String(questionId));
        if (question) question[parts[2]] = value;
      } else if (/^\d+$/.test(parts[1])) {
        found.questions[Number(parts[1])][parts[2]] = value;
      }
    }
    for (const path of Object.keys(update.$unset || {})) {
      const parts = path.split(".");
      if (parts[0] === "questions" && /^\d+$/.test(parts[1])) {
        delete found.questions[Number(parts[1])][parts[2]];
      } else if (parts[0] === "questions" && parts[1] === "$[question]") {
        const questionId = filter.$and
          ?.find((condition) => condition.questions?.$elemMatch)
          ?.questions.$elemMatch.questionId;
        const question = found.questions.find((item) => String(item.questionId) === String(questionId));
        if (question) delete question[parts[2]];
      }
    }
    for (const [field, increment] of Object.entries(update.$inc || {})) {
      found[field] = (found[field] || 0) + increment;
    }
    state.updated = true;
    state.updateCount += 1;
    if (update.$set?.status === "completed") state.finalizationUpdateCount += 1;
    return found;
  };
  QuizSession.find = () => {
    let projection = "";
    const query = {
      select(fields) {
        projection = fields || "";
        return query;
      },
      populate() {
        return query;
      },
      sort: async () => state.attempts.map((record) => {
        const copy = { ...record };
        if (projection.includes("-questions.correctOptionId")) {
          copy.questions = record.questions.map((question) => {
            const safeQuestion = { ...question };
            delete safeQuestion.correctOptionId;
            delete safeQuestion.correctAnswer;
            delete safeQuestion.isCorrect;
            return safeQuestion;
          });
        }
        return copy;
      })
    };
    return query;
  };

  try {
    await run(state);
  } finally {
    QuizSession.create = originals.sessionCreate;
    QuizSession.findOne = originals.sessionFindOne;
    QuizSession.findOneAndUpdate = originals.sessionFindOneAndUpdate;
    QuizSession.find = originals.sessionFind;
    Question.aggregate = originals.questionAggregate;
    Question.find = originals.questionFind;
    User.findById = originals.userFindById;
    Course.findById = originals.courseFindById;
    practiceTestService.getEligibleQuestionsForCourse = originals.getEligibleQuestionsForCourse;
    practiceTestService.assemblePracticeTest = originals.assemblePracticeTest;
  }
};

test("unauthenticated users cannot start or submit CBT attempts", async () => {
  await withQuizMocks(async (state) => {
    const app = buildApp(null);
    assert.equal((await request(app).post("/api/quiz/start").send({ courseId: COURSE_ID })).status, 401);
    assert.equal((await request(app).post("/api/quiz/submit").send({ attemptId: ATTEMPT_ID, answers: [] })).status, 401);
    assert.equal(state.createCount, 0);
  });
});

test("starting an exam persists a server-owned attempt and returns no answer keys", async () => {
  const expectedDuration = quizSessionService.getConfiguredDurationMinutes();
  await withQuizMocks(async (state) => {
    const response = await request(buildApp())
      .post("/api/quiz/start")
      .send({ courseId: COURSE_ID, questionCount: 10 });

    assert.equal(response.status, 201);
    assert.equal(state.createCount, 1);
    assert.equal(state.attempt.user, STUDENT_A);
    assert.equal(state.attempt.status, "in_progress");
    assert.equal(state.attempt.startedAt instanceof Date, true);
    assert.equal(state.attempt.timeStarted.getTime(), state.attempt.startedAt.getTime());
    assert.equal(state.attempt.expiresAt.getTime() - state.attempt.startedAt.getTime(), expectedDuration * 60 * 1000);
    assert.equal(state.attempt.durationMinutes, expectedDuration);
    assert.equal(response.body.expiresAt, state.attempt.expiresAt.toISOString());
    assert.equal(state.attempt.totalQuestions, 10);
    assert.equal(state.attempt.questions.length, 10);
    assert.equal(response.body.attemptId, ATTEMPT_ID);
    assert.equal(response.body.totalQuestions, 10);
    assert.equal(Object.prototype.hasOwnProperty.call(response.body.questions[0], "correctOptionId"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(response.body.questions[0], "answer"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(response.body.questions[0], "explanation"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(response.body.questions[0], "markingSnapshot"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(response.body.questions[0], "markingVersionId"), false);
    assert.equal(response.body.questions[0].questionType, "objective");
    assert.equal(Object.prototype.hasOwnProperty.call(response.body, "session"), false);
    assert.equal(state.query.approvalStatus, "approved");
    assert.equal(state.query.course.toString(), COURSE_ID);
    assert.equal(state.query.department.toString(), DEPARTMENT_ID);
    for (const question of state.attempt.questions) {
      const correctOption = question.presentedOptions.find((option) =>
        option.optionId === question.markingSnapshot.objective.correctOptionId
      );
      const sourceQuestion = startQuestions.find((item) => String(item._id) === String(question.questionId));
      assert.equal(correctOption.text, sourceQuestion.answer);
      assert.deepEqual(
        [...question.presentedOptions].sort((a, b) => a.text.localeCompare(b.text)),
        sourceQuestion.options
          .map((text, index) => ({ optionId: sourceQuestion.optionIds[index], text }))
          .sort((a, b) => a.text.localeCompare(b.text))
      );
    }
  }, { eligibleQuestions: startQuestions });
});

test("starting a mixed-format attempt stores ordered, provenance-backed immutable marking snapshots", async () => {
  const entries = JSON.parse(JSON.stringify(typedEntries));
  await withQuizMocks(async (state) => {
    const response = await request(buildApp())
      .post("/api/quiz/start")
      .send({ courseId: COURSE_ID, questionCount: 10 });

    assert.equal(response.status, 201);
    assert.equal(state.attempt.attemptFormatVersion, 2);
    assert.equal(state.attempt.activeAttempt, true);
    assert.equal(state.attempt.gradingStatus, "pending");
    assert.equal(state.attempt.score, null);
    assert.equal(state.attempt.percentage, null);
    assert.equal(state.attempt.questions.length, 10);
    assert.equal(new Set(state.attempt.questions.map((question) => String(question.questionId))).size, 10);
    assert.deepEqual(
      state.attempt.questions.map((question) => question.questionOrder),
      Array.from({ length: 10 }, (_, index) => index + 1)
    );
    assert.deepEqual(
      state.attempt.questions.reduce((counts, question) => {
        counts[question.questionType] += 1;
        return counts;
      }, { objective: 0, fill_in_gap: 0, theory: 0 }),
      { objective: 4, fill_in_gap: 3, theory: 3 }
    );
    for (const [index, snapshot] of state.attempt.questions.entries()) {
      const source = entries.find((entry) => String(entry.question._id) === String(snapshot.questionId));
      assert.equal(snapshot.markingVersionId, source.markingVersion._id);
      assert.deepEqual(snapshot.markingSnapshot, source.markingVersion.marking);
      assert.equal(snapshot.marks, source.question.marks);
      assert.equal(snapshot.sourceSnapshot.paperId, SOURCE_PAPER_ID);
      assert.equal(snapshot.sourceSnapshot.title, "Typed past paper");
      assert.equal(snapshot.sourceSnapshot.page, index + 1);
      assert.equal(snapshot.questionOrder, index + 1);
      if (snapshot.questionType === "objective") {
        assert.equal(snapshot.presentedOptions.length, 2);
      } else {
        assert.deepEqual(snapshot.presentedOptions, []);
      }
    }

    const serialized = JSON.stringify(response.body);
    for (const hidden of [
      "markingSnapshot",
      "markingVersionId",
      "correctOptionId",
      "verificationOptionId",
      "acceptableAnswers",
      "referenceAnswer",
      "gradingCriteria",
      "Private reference answer",
      "Private theory criterion"
    ]) {
      assert.equal(serialized.includes(hidden), false);
    }
    assert.equal(response.body.questions[0].marks, 1);
    assert.equal(response.body.questions[0].questionOrder, 1);

    const originalText = state.attempt.questions[0].question;
    const originalMarking = JSON.stringify(state.attempt.questions[0].markingSnapshot);
    entries[0].question.question = "Edited source question";
    entries[0].markingVersion.marking.objective.explanation = "Edited marking explanation";
    entries[0].paper.title = "Edited source paper";
    assert.equal(state.attempt.questions[0].question, originalText);
    assert.equal(JSON.stringify(state.attempt.questions[0].markingSnapshot), originalMarking);
    assert.equal(state.attempt.questions[0].sourceSnapshot.title, "Typed past paper");
  }, { eligibleEntries: entries });
});

test("starting an original-practice attempt records origin without a source-paper snapshot", async () => {
  const entries = JSON.parse(JSON.stringify(typedEntries)).map((entry) => ({
    ...entry,
    paper: null,
    question: {
      ...entry.question,
      questionOrigin: "original_practice",
      sourcePaper: null,
      sourcePaperMetadata: null,
      sourceExamYear: null,
      sourcePage: null,
      sourceExcerpt: null
    }
  }));
  await withQuizMocks(async (state) => {
    const response = await request(buildApp())
      .post("/api/quiz/start")
      .send({ courseId: COURSE_ID, questionCount: 10 });

    assert.equal(response.status, 201);
    assert.equal(state.attempt.questions.length, 10);
    for (const snapshot of state.attempt.questions) {
      assert.equal(snapshot.questionOrigin, "original_practice");
      assert.equal(snapshot.sourceSnapshot, undefined);
    }
  }, { eligibleEntries: entries });
});

test("a second start for the same student and course is rejected while an attempt is active", async () => {
  await withQuizMocks(async (state) => {
    const first = await request(buildApp())
      .post("/api/quiz/start")
      .send({ courseId: COURSE_ID, questionCount: 10 });
    const second = await request(buildApp())
      .post("/api/quiz/start")
      .send({ courseId: COURSE_ID, questionCount: 10 });

    assert.equal(first.status, 201);
    assert.equal(second.status, 409);
    assert.equal(second.body.code, "ACTIVE_ATTEMPT_EXISTS");
    assert.equal(state.createCount, 1);
  }, { eligibleEntries: typedEntries });
});

test("active-attempt uniqueness uses a partial index that leaves historical records untouched", () => {
  const activeIndex = QuizSession.schema.indexes().find(([, options]) =>
    options.name === "unique_active_attempt_per_user_course"
  );
  assert.ok(activeIndex);
  assert.deepEqual(activeIndex[0], { user: 1, course: 1 });
  assert.deepEqual(activeIndex[1].partialFilterExpression, { activeAttempt: true });
  assert.equal(activeIndex[1].unique, true);

  const questionSchema = QuizSession.schema.path("questions").schema;
  assert.equal(questionSchema.path("question").options.immutable, true);
  assert.equal(questionSchema.path("markingSnapshot").options.immutable, true);
  assert.equal(questionSchema.path("markingVersionId").options.immutable, true);
  assert.equal(questionSchema.path("sourceSnapshot").options.immutable, true);
});

test("students cannot add a client-controlled duration or expiry at attempt start", async () => {
  await withQuizMocks(async (state) => {
    for (const extra of [
      { durationMinutes: 180 },
      { expiresAt: "2099-01-01T00:00:00.000Z" },
      { startedAt: "2000-01-01T00:00:00.000Z" },
      { duration: 999 }
    ]) {
      const response = await request(buildApp())
        .post("/api/quiz/start")
        .send({ courseId: COURSE_ID, questionCount: 1, ...extra });
      assert.equal(response.status, 400);
    }
    assert.equal(state.createCount, 0);
  });
});

test("start rejects client-supplied identity and question data", async () => {
  await withQuizMocks(async (state) => {
    for (const extra of [
      { userId: STUDENT_B },
      { questions: questions },
      { answer: "2" },
      { isCorrect: true }
    ]) {
      const response = await request(buildApp())
        .post("/api/quiz/start")
        .send({ courseId: COURSE_ID, questionCount: 1, ...extra });
      assert.equal(response.status, 400);
    }
    assert.equal(state.pipeline, null);
    assert.equal(state.createCount, 0);
  });
});

for (const questionCount of [0, -1, 1, 2, 3, 9, 11, 49, 1.5, "10", 51, null]) {
  test(`start rejects invalid questionCount ${JSON.stringify(questionCount)}`, async () => {
    await withQuizMocks(async (state) => {
      const response = await request(buildApp())
        .post("/api/quiz/start")
        .send({ courseId: COURSE_ID, questionCount });
      assert.equal(response.status, 400);
      assert.equal(state.pipeline, null);
      assert.equal(state.createCount, 0);
    });
  });
}

test("start defaults to 10 and refuses to create an incomplete attempt", async () => {
  await withQuizMocks(async (state) => {
    const response = await request(buildApp())
      .post("/api/quiz/start")
      .send({ courseId: COURSE_ID });
    assert.equal(response.status, 409);
    assert.match(response.body.message, /Only 2 eligible questions are available; 10 were requested/);
    assert.equal(state.query.approvalStatus, "approved");
    assert.equal(state.createCount, 0);
  });
});

test("start rejects insufficient eligible questions without persisting an attempt", async () => {
  await withQuizMocks(async (state) => {
    const response = await request(buildApp())
      .post("/api/quiz/start")
      .send({ courseId: COURSE_ID, questionCount: 10 });
    assert.equal(response.status, 409);
    assert.match(response.body.message, /10 were requested/);
    assert.equal(state.createCount, 0);
  });
});

test("legacy malformed option IDs are replaced with deterministic stable IDs", async () => {
  const legacyQuestion = {
    ...startQuestions[0],
    optionIds: ["", "duplicate"],
  };
  const legacyPool = [legacyQuestion, ...startQuestions.slice(1)];
  await withQuizMocks(async (state) => {
    const response = await request(buildApp())
      .post("/api/quiz/start")
      .send({ courseId: COURSE_ID, questionCount: 10 });
    assert.equal(response.status, 201);
    const savedQuestion = state.attempt.questions.find((item) =>
      String(item.questionId) === String(legacyQuestion._id)
    );
    const ids = savedQuestion.presentedOptions.map((option) => option.optionId);
    assert.equal(new Set(ids).size, 2);
    assert.equal(ids.every((id) => id.startsWith("legacy_")), true);
    assert.equal(
      savedQuestion.presentedOptions.find((option) =>
        option.optionId === savedQuestion.markingSnapshot.objective.correctOptionId
      ).text,
      legacyQuestion.answer
    );
  }, { eligibleQuestions: legacyPool });
});

test("repeated attempts each persist their own question and option ordering", async () => {
  await withQuizMocks(async (state) => {
    const first = await request(buildApp()).post("/api/quiz/start")
      .send({ courseId: COURSE_ID, questionCount: 10 });
    const firstSnapshot = state.attempt.questions.map((question) => ({
      questionId: String(question.questionId),
      options: question.presentedOptions.map((option) => ({ ...option }))
    }));
    await quizSessionService.finalizeAttempt(state.attempt._id, { userId: STUDENT_A });

    const second = await request(buildApp()).post("/api/quiz/start")
      .send({ courseId: COURSE_ID, questionCount: 10 });

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(state.attempts.length, 2);
    assert.equal(state.attempt.questions.length, 10);
    assert.deepEqual(
      state.attempts[0].questions.map((question) => ({
        questionId: String(question.questionId),
        options: question.presentedOptions.map((option) => ({ ...option }))
      })),
      firstSnapshot
    );
    for (const savedQuestion of state.attempts.flatMap((attempt) => attempt.questions)) {
      assert.equal(savedQuestion.presentedOptions.length, 2);
      assert.equal(new Set(savedQuestion.presentedOptions.map((option) => option.optionId)).size, 2);
      assert.equal(
        savedQuestion.presentedOptions.find((option) =>
          option.optionId === savedQuestion.markingSnapshot.objective.correctOptionId
        ).text,
        startQuestions.find((item) => String(item._id) === String(savedQuestion.questionId)).answer
      );
    }
  }, { eligibleQuestions: startQuestions });
});

test("Fisher-Yates shuffle preserves every option and stable ID", () => {
  const options = [
    { optionId: "a", text: "A" },
    { optionId: "b", text: "B" },
    { optionId: "c", text: "C" }
  ];
  const shuffled = shuffle(options, () => 0);
  assert.deepEqual(shuffled, [
    { optionId: "b", text: "B" },
    { optionId: "c", text: "C" },
    { optionId: "a", text: "A" }
  ]);
  assert.deepEqual(options.map((option) => option.optionId), ["a", "b", "c"]);
});

test("students cannot start an exam for another academic course", async () => {
  await withQuizMocks(async (state) => {
    const response = await request(buildApp())
      .post("/api/quiz/start")
      .send({ courseId: OTHER_COURSE_ID });
    assert.equal(response.status, 404);
    assert.equal(state.pipeline, null);
    assert.equal(state.createCount, 0);
  });
});

test("students cannot start an exam for another department, even with course ID enrollment", async () => {
  for (const courseRecord of [
    { ...course, department: "507f1f77bcf86cd799439032" },
    { ...course, department: null }
  ]) {
    await withQuizMocks(async (state) => {
      const response = await request(buildApp())
        .post("/api/quiz/start")
        .send({ courseId: COURSE_ID, questionCount: 10 });
      assert.equal(response.status, 403);
      assert.equal(state.pipeline, null);
      assert.equal(state.createCount, 0);
    }, { courseRecord, user: { ...student, coursesEnrolled: [COURSE_ID] } });
  }
});

test("same-department students access courses without enrollment or academic-field matching", async () => {
  await withQuizMocks(async (state) => {
    const response = await request(buildApp())
      .post("/api/quiz/start")
      .send({ courseId: COURSE_ID, questionCount: 10 });

    assert.equal(response.status, 201);
    assert.equal(state.createCount, 1);
  }, {
    user: {
      ...student,
      coursesEnrolled: [],
      yearOfStudy: "HND2",
      semester: "Second"
    },
    eligibleQuestions: startQuestions
  });
});

for (const [field, value] of [
  ["userId", STUDENT_B],
  ["score", 100],
  ["startTime", "2000-01-01T00:00:00.000Z"],
  ["percentage", 100],
  ["correctOptionId", "option-two"],
  ["correctAnswer", "2"],
  ["isCorrect", true]
]) {
  test(`submission rejects client-supplied ${field}`, async () => {
    await withQuizMocks(async (state) => {
      const body = {
        attemptId: ATTEMPT_ID,
        answers: [
          { questionId: QUESTION_A, selectedOptionId: "option-two" },
          { questionId: QUESTION_B, selectedOptionId: "option-four" }
        ],
        [field]: value
      };
      const response = await request(buildApp()).post("/api/quiz/submit").send(body);
      assert.equal(response.status, 400);
      assert.equal(state.updated, false);
    }, { attempt: createAttempt() });
  });
}

test("submission rejects duplicate question IDs", async () => {
  await withQuizMocks(async (state) => {
    const response = await request(buildApp()).post("/api/quiz/submit").send({
      attemptId: ATTEMPT_ID,
      answers: [
        { questionId: QUESTION_A, selectedOptionId: "option-two" },
        { questionId: QUESTION_A, selectedOptionId: "option-three" }
      ]
    });
    assert.equal(response.status, 400);
    assert.equal(state.updated, false);
    assert.equal(state.query, null);
  }, { attempt: createAttempt() });
});

test("submission rejects client correctness fields inside answer records", async () => {
  await withQuizMocks(async (state) => {
    const response = await request(buildApp()).post("/api/quiz/submit").send({
      attemptId: ATTEMPT_ID,
      answers: [
        { questionId: QUESTION_A, selectedOptionId: "option-two", isCorrect: true },
        { questionId: QUESTION_B, selectedOptionId: "option-four" }
      ]
    });
    assert.equal(response.status, 400);
    assert.equal(state.updated, false);
  }, { attempt: createAttempt() });
});

test("submission rejects option IDs not in the saved attempt snapshot", async () => {
  await withQuizMocks(async (state) => {
    const response = await request(buildApp()).post("/api/quiz/submit").send({
      attemptId: ATTEMPT_ID,
      answers: [
        { questionId: QUESTION_A, selectedOptionId: "forged-option" },
        { questionId: QUESTION_B, selectedOptionId: "option-four" }
      ]
    });
    assert.equal(response.status, 400);
    assert.equal(state.updated, false);
  }, { attempt: createAttempt() });
});

test("submission rejects question IDs not included in this course attempt", async () => {
  await withQuizMocks(async (state) => {
    const response = await request(buildApp()).post("/api/quiz/submit").send({
      attemptId: ATTEMPT_ID,
      answers: [
        { questionId: QUESTION_A, selectedOptionId: "option-two" },
        { questionId: "507f1f77bcf86cd799439099", selectedOptionId: "option-four" }
      ]
    });
    assert.equal(response.status, 400);
    assert.equal(state.updated, false);
    assert.equal(state.query, null);
  }, { attempt: createAttempt() });
});

test("submission grades the immutable question snapshot even if the source question is unavailable", async () => {
  await withQuizMocks(async (state) => {
    state.attempt.questions = [{
      questionId: QUESTION_FOREIGN,
      question: "Foreign course question",
      topic: "Addition",
      presentedOptions: [
        { optionId: "foreign-a", text: "A" },
        { optionId: "foreign-b", text: "B" }
      ],
      correctOptionId: "foreign-a"
    }];
    const response = await request(buildApp()).post("/api/quiz/submit").send({
      attemptId: ATTEMPT_ID,
      answers: [{ questionId: QUESTION_FOREIGN, selectedOptionId: "foreign-a" }]
    });
    assert.equal(response.status, 200);
    assert.equal(state.query, null);
    assert.equal(state.attempt.status, "completed");
    assert.equal(state.attempt.score, 1);
  }, { attempt: createAttempt() });
});

test("successful submission persists answers and correct server-calculated results", async () => {
  await withQuizMocks(async (state) => {
    const response = await request(buildApp()).post("/api/quiz/submit").send({
      attemptId: ATTEMPT_ID,
      answers: [
        { questionId: QUESTION_A, selectedOptionId: "option-three" },
        { questionId: QUESTION_B, selectedOptionId: "option-four" }
      ]
    });
    assert.equal(response.status, 200);
    assert.equal(state.query, null);
    assert.equal(state.updated, true);
    assert.equal(state.attempt.status, "completed");
    assert.equal(state.attempt.score, 1);
    assert.equal(state.attempt.totalQuestions, 2);
    assert.equal(state.attempt.percentage, 50);
    assert.equal(state.attempt.duration >= 0, true);
    assert.equal(state.attempt.questions[0].correctOptionId, "option-two");
    assert.equal(state.attempt.questions[0].selectedOptionId, "option-three");
    assert.equal(state.attempt.questions[0].isCorrect, false);
    assert.equal(state.attempt.questions[1].selectedOptionId, "option-four");
    assert.equal(state.attempt.questions[1].isCorrect, true);
    assert.equal(response.body.session.score, 1);
    assert.equal(response.body.session.percentage, 50);
  }, { attempt: createAttempt() });
});

test("submission returns a conflict and does not finalize after a concurrent answer update", async () => {
  await withQuizMocks(async (state) => {
    const response = await request(buildApp()).post("/api/quiz/submit").send({
      attemptId: ATTEMPT_ID,
      answers: [
        { questionId: QUESTION_A, selectedOptionId: "option-two" },
        { questionId: QUESTION_B, selectedOptionId: "option-four" }
      ]
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.code, "ANSWER_VERSION_CONFLICT");
    assert.match(response.body.message, /latest saved answers/);
    assert.equal(response.body.attempt.status, "in_progress");
    assert.equal(response.body.attempt.questions[0].selectedOptionId, "option-three");
    assert.equal(
      Object.prototype.hasOwnProperty.call(response.body.attempt.questions[0], "correctOptionId"),
      false
    );
    assert.equal(state.attempt.status, "in_progress");
    assert.equal(state.attempt.questions[0].selectedOptionId, "option-three");
    assert.equal(state.attempt.questions[1].selectedOptionId, undefined);
    assert.equal(state.finalizationUpdateCount, 0);
    assert.equal(state.attempt.score, undefined);
  }, {
    attempt: createAttempt(),
    beforeAnswerUpdate: async (state) => {
      state.attempt.questions[0].selectedOptionId = "option-three";
      state.attempt.stateVersion += 1;
    }
  });
});

test("students cannot read another student's results", async () => {
  await withQuizMocks(async (state) => {
    const response = await request(buildApp())
      .get(`/api/quiz/results/${STUDENT_B}`);
    assert.equal(response.status, 403);
  });
});

test("quiz history omits answer keys and correctness fields", async () => {
  await withQuizMocks(async () => {
    const response = await request(buildApp()).get(`/api/quiz/results/${STUDENT_A}`);
    assert.equal(response.status, 200);
    const question = response.body.results[0].questions[0];
    assert.equal(response.body.results[0].historicalScoreStatus, "unverified");
    assert.equal(response.body.results[0].score, null);
    assert.equal(Object.prototype.hasOwnProperty.call(question, "correctOptionId"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(question, "correctAnswer"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(question, "isCorrect"), false);
  }, {
    attempt: createAttempt({
      status: "completed",
      score: 1,
      questions: createAttempt().questions.map((question) => ({
        ...question,
        selectedOptionId: question.presentedOptions[0].optionId,
        isCorrect: true
      }))
    })
  });
});

test("quiz history verifies a status-less historical objective score from saved correctness", async () => {
  await withQuizMocks(async () => {
    const response = await request(buildApp()).get(`/api/quiz/results/${STUDENT_A}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.results.length, 1);
    assert.equal(response.body.results[0].status, "completed");
    assert.equal(response.body.results[0].historicalScoreStatus, "verified");
    assert.equal(response.body.results[0].score, 1);
    assert.equal(response.body.results[0].totalQuestions, 2);
    assert.equal(response.body.results[0].percentage, 50);
  }, {
    attempt: createAttempt({
      status: undefined,
      completedAt: new Date("2025-02-01T12:00:00.000Z"),
      score: 1,
      totalQuestions: 2,
      questions: createAttempt().questions.map((question, index) => ({
        ...question,
        isCorrect: index === 0
      }))
    })
  });
});

test("quiz history omits incomplete records with missing status and no completion evidence", async () => {
  await withQuizMocks(async () => {
    const response = await request(buildApp()).get(`/api/quiz/results/${STUDENT_A}`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.results, []);
  }, {
    attempt: createAttempt({
      status: undefined,
      timeEnded: undefined,
      completedAt: undefined,
      score: 0
    })
  });
});

test("quiz history hides a typed score when grading details do not reconcile", async () => {
  await withQuizMocks(async () => {
    const response = await request(buildApp()).get(`/api/quiz/results/${STUDENT_A}`);
    assert.equal(response.status, 200);
    const result = response.body.results[0];
    assert.equal(result.gradingStatus, "unverified");
    assert.equal(result.score, null);
    assert.equal(result.totalMarks, null);
    assert.equal(result.questions[0].gradingResult, undefined);
  }, {
    attempt: createAttempt({
      attemptFormatVersion: 2,
      status: "completed",
      gradingStatus: "graded",
      score: 0,
      totalMarks: 2,
      percentage: 0,
      questions: [{
        questionId: QUESTION_A,
        question: "Typed question",
        questionType: "objective",
        marks: 2,
        gradingResult: {
          status: "graded",
          awardedMarks: 2,
          maxMarks: 2,
          isCorrect: true
        }
      }]
    })
  });
});

test("a student cannot submit another student's attempt", async () => {
  await withQuizMocks(async (state) => {
    const response = await request(buildApp(STUDENT_B))
      .post("/api/quiz/submit")
      .send({
        attemptId: ATTEMPT_ID,
        answers: [
          { questionId: QUESTION_A, selectedOptionId: "option-two" },
          { questionId: QUESTION_B, selectedOptionId: "option-four" }
        ]
      });
    assert.equal(response.status, 404);
    assert.equal(state.updated, false);
  }, { attempt: createAttempt(), user: { ...student, _id: STUDENT_B, id: STUDENT_B } });
});

test("the owner can autosave, change, clear, and recover an answer without exposing the answer key", async () => {
  await withQuizMocks(async (state) => {
    const app = buildApp();
    const first = await request(app)
      .patch(`/api/quiz/${ATTEMPT_ID}/answers`)
      .send({ questionId: QUESTION_A, selectedOptionId: "option-three", expectedVersion: 0 });
    assert.equal(first.status, 200);
    assert.equal(first.body.answer.selectedOptionId, "option-three");
    assert.equal(first.body.stateVersion, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(first.body, "correctOptionId"), false);
    assert.equal(state.attempt.questions[0].selectedOptionId, "option-three");

    const changed = await request(app)
      .patch(`/api/quiz/${ATTEMPT_ID}/answers`)
      .send({ questionId: QUESTION_A, selectedOptionId: "option-two", expectedVersion: 1 });
    assert.equal(changed.status, 200);
    assert.equal(state.attempt.questions[0].selectedOptionId, "option-two");

    const cleared = await request(app)
      .patch(`/api/quiz/${ATTEMPT_ID}/answers`)
      .send({ questionId: QUESTION_A, selectedOptionId: null, expectedVersion: 2 });
    assert.equal(cleared.status, 200);
    assert.equal(state.attempt.questions[0].selectedOptionId, undefined);

    const recovered = await request(app).get(`/api/quiz/${ATTEMPT_ID}`);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.attempt.questions[0].selectedOptionId, null);
    assert.equal(Object.prototype.hasOwnProperty.call(recovered.body.attempt.questions[0], "correctOptionId"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(recovered.body.attempt, "score"), false);

    const active = await request(app).get("/api/quiz/active");
    assert.equal(active.status, 200);
    assert.equal(active.body.attempt._id, ATTEMPT_ID);
    assert.equal(active.body.attempt.questions[0].selectedOptionId, null);
  }, { attempt: createAttempt() });
});

test("grading endpoint requires ownership and rejects client-supplied grading data", async () => {
  await withQuizMocks(async (state) => {
    const foreign = await request(buildApp(STUDENT_B))
      .post(`/api/quiz/${ATTEMPT_ID}/grade`)
      .send({});
    assert.equal(foreign.status, 404);

    const forged = await request(buildApp())
      .post(`/api/quiz/${ATTEMPT_ID}/grade`)
      .send({ score: 100, feedback: "client result" });
    assert.equal(forged.status, 400);

    const legacy = await request(buildApp())
      .post(`/api/quiz/${ATTEMPT_ID}/grade`)
      .send({});
    assert.equal(legacy.status, 409);
    assert.equal(state.attempt.score, undefined);
  }, { attempt: createAttempt() });
});

test("typed answers autosave by format and recover without exposing marking snapshots", async () => {
  await withQuizMocks(async (state) => {
    const start = await request(buildApp()).post("/api/quiz/start")
      .send({ courseId: COURSE_ID, questionCount: 10 });
    assert.equal(start.status, 201);
    const byType = Object.fromEntries(state.attempt.questions.map((question) => [
      question.questionType,
      question
    ]));
    const objective = state.attempt.questions.find((question) => question.questionType === "objective");
    const fill = state.attempt.questions.find((question) => question.questionType === "fill_in_gap");
    const theory = state.attempt.questions.find((question) => question.questionType === "theory");

    const objectiveSave = await request(buildApp())
      .patch(`/api/quiz/${ATTEMPT_ID}/answers`)
      .send({
        questionId: objective.questionId,
        selectedOptionId: objective.presentedOptions[1].optionId,
        expectedVersion: 0
      });
    assert.equal(objectiveSave.status, 200);
    assert.equal(objectiveSave.body.answer.selectedOptionId, objective.presentedOptions[1].optionId);

    const fillSave = await request(buildApp())
      .patch(`/api/quiz/${ATTEMPT_ID}/answers`)
      .send({
        questionId: fill.questionId,
        selectedAnswers: ["first response", "second response"],
        expectedVersion: 1
      });
    assert.equal(fillSave.status, 200);
    assert.deepEqual(fillSave.body.answer.selectedAnswers, ["first response", "second response"]);

    const theoryResponse = "A student's long-form response.";
    const theorySave = await request(buildApp())
      .patch(`/api/quiz/${ATTEMPT_ID}/answers`)
      .send({
        questionId: theory.questionId,
        theoryResponse,
        expectedVersion: 2
      });
    assert.equal(theorySave.status, 200);
    assert.equal(theorySave.body.answer.theoryResponse, theoryResponse);
    assert.equal(state.attempt.questions.find((question) =>
      String(question.questionId) === String(fill.questionId)
    ).selectedAnswers[1], "second response");

    const recovered = await request(buildApp()).get(`/api/quiz/${ATTEMPT_ID}`);
    assert.equal(recovered.status, 200);
    const recoveredQuestions = recovered.body.attempt.questions;
    assert.equal(recoveredQuestions.find((question) => question.questionType === "objective")
      .selectedOptionId, objective.presentedOptions[1].optionId);
    assert.deepEqual(recoveredQuestions.find((question) => question.questionType === "fill_in_gap")
      .selectedAnswers, ["first response", "second response"]);
    assert.equal(recoveredQuestions.find((question) => question.questionType === "theory")
      .theoryResponse, theoryResponse);
    const serialized = JSON.stringify(recovered.body);
    for (const hidden of ["markingSnapshot", "correctOptionId", "acceptableAnswers", "referenceAnswer"]) {
      assert.equal(serialized.includes(hidden), false);
    }

    const foreign = await request(buildApp(STUDENT_B)).get(`/api/quiz/${ATTEMPT_ID}`);
    assert.equal(foreign.status, 404);
    assert.equal(Object.keys(byType).length, 3);
  }, { eligibleEntries: typedEntries });
});

test("typed answer autosave rejects wrong-format, malformed, oversized, and arbitrary input", async () => {
  await withQuizMocks(async () => {
    await request(buildApp()).post("/api/quiz/start")
      .send({ courseId: COURSE_ID, questionCount: 10 });
    const objective = typedEntries.find((entry) => entry.question.questionType === "objective").question;
    const fill = typedEntries.find((entry) => entry.question.questionType === "fill_in_gap").question;
    const theory = typedEntries.find((entry) => entry.question.questionType === "theory").question;
    const invalidPayloads = [
      { questionId: objective._id, selectedAnswers: ["wrong", "type"], expectedVersion: 0 },
      { questionId: fill._id, selectedAnswers: ["only one"], expectedVersion: 0 },
      { questionId: fill._id, selectedAnswers: ["a".repeat(1001), "ok"], expectedVersion: 0 },
      { questionId: theory._id, theoryResponse: "x".repeat(20001), expectedVersion: 0 },
      { questionId: theory._id, theoryResponse: "answer", score: 10, expectedVersion: 0 }
    ];
    for (const payload of invalidPayloads) {
      const response = await request(buildApp())
        .patch(`/api/quiz/${ATTEMPT_ID}/answers`)
        .send(payload);
      assert.equal(response.status, 400);
    }
  }, { eligibleEntries: typedEntries });
});

test("typed submission saves responses once and completes without grading or answer-key disclosure", async () => {
  await withQuizMocks(async (state) => {
    const start = await request(buildApp()).post("/api/quiz/start")
      .send({ courseId: COURSE_ID, questionCount: 10 });
    assert.equal(start.status, 201);
    const submissionAnswers = state.attempt.questions.map((question) => {
      if (question.questionType === "objective") {
        return {
          questionId: question.questionId,
          selectedOptionId: question.presentedOptions[0].optionId
        };
      }
      if (question.questionType === "fill_in_gap") {
        return { questionId: question.questionId, selectedAnswers: ["alpha", "beta"] };
      }
      return { questionId: question.questionId, theoryResponse: "Written theory response." };
    });

    const response = await request(buildApp()).post("/api/quiz/submit").send({
      attemptId: ATTEMPT_ID,
      answers: submissionAnswers
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.session.status, "completed");
    assert.equal(response.body.session.gradingStatus, "pending");
    assert.equal(Object.hasOwn(response.body.session, "score"), false);
    assert.equal(Object.hasOwn(response.body.session, "percentage"), false);
    assert.equal(state.attempt.activeAttempt, false);
    assert.equal(state.attempt.questions.find((question) => question.questionType === "theory")
      .theoryResponse, "Written theory response.");
    assert.equal(state.attempt.questions[0].markingSnapshot.objective.correctOptionId.length > 0, true);
    assert.equal(JSON.stringify(response.body).includes("markingSnapshot"), false);

    const duplicate = await request(buildApp()).post("/api/quiz/submit").send({
      attemptId: ATTEMPT_ID
    });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.alreadySubmitted, true);
    assert.equal(state.finalizationUpdateCount, 1);
  }, { eligibleEntries: typedEntries });
});

test("typed submission grades only after saving, and returns feedback only in the completed response", async () => {
  const originalGradeAttempt = quizGradingService.gradeAttempt;
  try {
    await withQuizMocks(async (state) => {
      quizGradingService.gradeAttempt = async ({ attemptId, userId }) => {
        assert.equal(String(attemptId), ATTEMPT_ID);
        assert.equal(String(userId), STUDENT_A);
        assert.equal(state.attempt.status, "completed");
        assert.equal(state.attempt.questions[0].selectedOptionId !== undefined, true);
        state.attempt.gradingStatus = "graded";
        let score = 0;
        let totalMarks = 0;
        state.attempt.questions.forEach((question, index) => {
          const questionType = question.questionType || "objective";
          const maxMarks = question.marks;
          let gradingResult;
          if (questionType === "objective") {
            gradingResult = {
              status: "graded",
              questionType,
              isCorrect: true,
              awardedMarks: maxMarks,
              maxMarks,
              correctAnswer: "The stored answer",
              explanation: "The stored explanation."
            };
          } else if (questionType === "fill_in_gap") {
            gradingResult = {
              status: "graded",
              questionType,
              awardedMarks: maxMarks,
              maxMarks,
              blanks: Array.from({ length: question.blankCount }, (_, blankIndex) => ({
                status: "graded",
                awardedMarks: maxMarks / question.blankCount,
                maxMarks: maxMarks / question.blankCount,
                criteria: [{
                  awardedMarks: maxMarks / question.blankCount,
                  maxMarks: maxMarks / question.blankCount
                }]
              }))
            };
          } else {
            gradingResult = {
              status: "graded",
              questionType,
              awardedMarks: maxMarks,
              maxMarks,
              criteria: question.markingSnapshot.theory.criteria.map((criterion) => ({
                criterionId: criterion.criterionId,
                description: criterion.description,
                awardedMarks: criterion.marks,
                maxMarks: criterion.marks,
                feedback: "Complete."
              }))
            };
          }
          state.attempt.questions[index].gradingResult = gradingResult;
          score += gradingResult.awardedMarks;
          totalMarks += gradingResult.maxMarks;
        });
        state.attempt.score = score;
        state.attempt.totalMarks = totalMarks;
        state.attempt.percentage = 100;
        return { kind: "graded", session: state.attempt };
      };

      const start = await request(buildApp()).post("/api/quiz/start")
        .send({ courseId: COURSE_ID, questionCount: 10 });
      assert.equal(start.status, 201);
      const submittedAnswers = state.attempt.questions.map((question) => {
        if (question.questionType === "objective") {
          return { questionId: question.questionId, selectedOptionId: question.presentedOptions[0].optionId };
        }
        if (question.questionType === "fill_in_gap") {
          return { questionId: question.questionId, selectedAnswers: ["alpha", "beta"] };
        }
        return { questionId: question.questionId, theoryResponse: "An essay answer." };
      });
      const response = await request(buildApp()).post("/api/quiz/submit").send({
        attemptId: ATTEMPT_ID,
        answers: submittedAnswers
      });
      assert.equal(response.status, 200);
      assert.equal(response.body.session.gradingStatus, "graded");
      assert.equal(response.body.session.score, 34);
      assert.equal(response.body.session.questions[0].gradingResult.correctAnswer, "The stored answer");
      assert.equal(JSON.stringify(response.body).includes("markingSnapshot"), false);
    }, { eligibleEntries: typedEntries });
  } finally {
    quizGradingService.gradeAttempt = originalGradeAttempt;
  }
});

test("expired typed attempts finalize saved responses without calculating a score", async () => {
  await withQuizMocks(async (state) => {
    const start = await request(buildApp()).post("/api/quiz/start")
      .send({ courseId: COURSE_ID, questionCount: 10 });
    assert.equal(start.status, 201);
    const fill = state.attempt.questions.find((question) => question.questionType === "fill_in_gap");
    const saved = await request(buildApp())
      .patch(`/api/quiz/${ATTEMPT_ID}/answers`)
      .send({
        questionId: fill.questionId,
        selectedAnswers: ["persisted", "before-expiry"],
        expectedVersion: 0
      });
    assert.equal(saved.status, 200);
    state.attempt.expiresAt = new Date(Date.now() - 1000);

    const response = await request(buildApp()).post("/api/quiz/submit").send({
      attemptId: ATTEMPT_ID
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.expired, true);
    assert.equal(response.body.session.gradingStatus, "pending");
    assert.equal(Object.hasOwn(response.body.session, "score"), false);
    assert.equal(state.attempt.questions.find((question) => question.questionType === "fill_in_gap")
      .selectedAnswers[0], "persisted");
    assert.equal(state.attempt.activeAttempt, false);
  }, { eligibleEntries: typedEntries });
});

test("autosave enforces owner, question, option, and version checks", async () => {
  await withQuizMocks(async (state) => {
    const owner = buildApp();
    const foreign = await request(buildApp(STUDENT_B))
      .patch(`/api/quiz/${ATTEMPT_ID}/answers`)
      .send({ questionId: QUESTION_A, selectedOptionId: "option-two", expectedVersion: 0 });
    assert.equal(foreign.status, 404);
    assert.equal((await request(buildApp(STUDENT_B)).get(`/api/quiz/${ATTEMPT_ID}`)).status, 404);

    const invalidQuestion = await request(owner)
      .patch(`/api/quiz/${ATTEMPT_ID}/answers`)
      .send({ questionId: QUESTION_FOREIGN, selectedOptionId: "option-two", expectedVersion: 0 });
    assert.equal(invalidQuestion.status, 400);

    const invalidOption = await request(owner)
      .patch(`/api/quiz/${ATTEMPT_ID}/answers`)
      .send({ questionId: QUESTION_A, selectedOptionId: "not-an-option", expectedVersion: 0 });
    assert.equal(invalidOption.status, 400);

    const unknownField = await request(owner)
      .patch(`/api/quiz/${ATTEMPT_ID}/answers`)
      .send({ questionId: QUESTION_A, selectedOptionId: "option-two", expectedVersion: 0, isCorrect: true });
    assert.equal(unknownField.status, 400);
    assert.equal(state.attempt.questions[0].selectedOptionId, undefined);
  }, { attempt: createAttempt() });
});

test("completed and expired attempts cannot accept autosaves", async () => {
  await withQuizMocks(async (state) => {
    state.attempt.status = "completed";
    const completed = await request(buildApp())
      .patch(`/api/quiz/${ATTEMPT_ID}/answers`)
      .send({ questionId: QUESTION_A, selectedOptionId: "option-two", expectedVersion: 0 });
    assert.equal(completed.status, 409);

    state.attempt.status = "in_progress";
    state.attempt.expiresAt = new Date(Date.now() - 1000);
    const expired = await request(buildApp())
      .patch(`/api/quiz/${ATTEMPT_ID}/answers`)
      .send({ questionId: QUESTION_A, selectedOptionId: "option-two", expectedVersion: 0 });
    assert.equal(expired.status, 409);
    assert.equal(expired.body.code, "ATTEMPT_EXPIRED");
    assert.equal(state.attempt.status, "completed");
    assert.equal(state.attempt.completionReason, "expired");
    assert.equal(state.attempt.questions[0].selectedOptionId, undefined);
  }, { attempt: createAttempt() });
});

test("late submission finalizes only previously saved answers", async () => {
  await withQuizMocks(async (state) => {
    state.attempt.questions[0].selectedOptionId = "option-two";
    state.attempt.expiresAt = new Date(Date.now() - 1000);
    const response = await request(buildApp())
      .post("/api/quiz/submit")
      .send({
        attemptId: ATTEMPT_ID,
        answers: [
          { questionId: QUESTION_A, selectedOptionId: "option-three" },
          { questionId: QUESTION_B, selectedOptionId: "option-five" }
        ]
      });
    assert.equal(response.status, 200);
    assert.equal(response.body.expired, true);
    assert.equal(state.attempt.status, "completed");
    assert.equal(state.attempt.completionReason, "expired");
    assert.equal(state.attempt.questions[0].selectedOptionId, "option-two");
    assert.equal(state.attempt.score, 1);
  }, { attempt: createAttempt() });
});

test("legacy attempts without expiry fields remain recoverable and manually submittable", async () => {
  const legacyAttempt = createAttempt();
  delete legacyAttempt.startedAt;
  delete legacyAttempt.expiresAt;
  delete legacyAttempt.durationMinutes;
  delete legacyAttempt.stateVersion;
  await withQuizMocks(async (state) => {
    const restored = await request(buildApp()).get(`/api/quiz/${ATTEMPT_ID}`);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.attempt.status, "in_progress");
    assert.equal(restored.body.attempt.expiresAt, null);

    const submitted = await request(buildApp()).post("/api/quiz/submit").send({
      attemptId: ATTEMPT_ID,
      answers: [
        { questionId: QUESTION_A, selectedOptionId: "option-two" },
        { questionId: QUESTION_B, selectedOptionId: "option-four" }
      ]
    });
    assert.equal(submitted.status, 200);
    assert.equal(state.attempt.status, "completed");
    assert.equal(state.attempt.score, 2);
  }, { attempt: legacyAttempt });
});

test("completed attempts cannot be rescored by a later submission", async () => {
  await withQuizMocks(async (state) => {
    state.attempt.status = "completed";
    state.attempt.score = 2;
    state.attempt.totalQuestions = 2;
    state.attempt.percentage = 100;
    const response = await request(buildApp()).post("/api/quiz/submit").send({
      attemptId: ATTEMPT_ID,
      answers: [
        { questionId: QUESTION_A, selectedOptionId: "option-three" },
        { questionId: QUESTION_B, selectedOptionId: "option-five" }
      ]
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.alreadySubmitted, true);
    assert.equal(response.body.session.historicalScoreStatus, "unverified");
    assert.equal(response.body.session.score, undefined);
    assert.equal(state.attempt.score, 2);
    assert.equal(state.updated, false);
  }, { attempt: createAttempt() });
});

test("concurrent submissions finalize an attempt exactly once", async () => {
  await withQuizMocks(async (state) => {
    const firstAnswers = [
      { questionId: QUESTION_A, selectedOptionId: "option-two" },
      { questionId: QUESTION_B, selectedOptionId: "option-four" }
    ];
    const secondAnswers = [
      { questionId: QUESTION_A, selectedOptionId: "option-three" },
      { questionId: QUESTION_B, selectedOptionId: "option-five" }
    ];
    const [first, second] = await Promise.all([
      request(buildApp()).post("/api/quiz/submit").send({ attemptId: ATTEMPT_ID, answers: firstAnswers }),
      request(buildApp()).post("/api/quiz/submit").send({ attemptId: ATTEMPT_ID, answers: secondAnswers })
    ]);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(state.finalizationUpdateCount, 1);
    assert.equal(state.attempt.status, "completed");
    assert.equal(first.body.session.score, state.attempt.score);
    assert.equal(second.body.session.score, state.attempt.score);
  }, { attempt: createAttempt() });
});
