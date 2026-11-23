const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "question-marking-diagnostic-test-secret";

const Question = require("../models/Question");
const QuestionMarkingVersion = require("../models/QuestionMarkingVersion");
const Course = require("../models/course");
const PastQuestionPaper = require("../models/PastQuestionPaper");
const { generateAccessToken } = require("../utils/token");
const questionMarkingService = require("../services/questionMarkingService");
const questionRoutes = require("../routes/question");

const ADMIN_ID = "507f1f77bcf86cd799439011";
const COURSE_ID = "507f1f77bcf86cd799439021";
const DEPARTMENT_ID = "507f1f77bcf86cd799439031";
const PAPER_ID = "507f1f77bcf86cd799439041";
const QUESTION_ID = "507f1f77bcf86cd799439051";

const course = {
  _id: COURSE_ID,
  department: DEPARTMENT_ID,
  level: "HND2",
  semester: "Second"
};
const paper = {
  _id: PAPER_ID,
  title: "Test source",
  course: COURSE_ID,
  department: DEPARTMENT_ID,
  examinationYear: "2025",
  level: "HND2",
  semester: "Second"
};
const paperMetadata = {
  title: paper.title,
  examinationYear: paper.examinationYear,
  level: paper.level,
  semester: paper.semester
};
const queryFor = (value) => ({
  select() { return this; },
  lean() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
});

const makeQuestion = (overrides = {}) => ({
  _id: QUESTION_ID,
  course: COURSE_ID,
  department: DEPARTMENT_ID,
  topic: "Topic",
  question: "PRIVATE_QUESTION_TEXT",
  questionType: "objective",
  options: ["PRIVATE_OPTION_A", "PRIVATE_OPTION_B"],
  optionIds: ["option-a", "option-b"],
  answer: "PRIVATE_ANSWER",
  marks: 2,
  year: "2025",
  session: "Rain",
  questionOrigin: "original_practice",
  approvalStatus: "approved",
  approvedBy: ADMIN_ID,
  approvedAt: new Date("2026-01-01T00:00:00.000Z"),
  sourcePaper: null,
  sourcePaperMetadata: undefined,
  sourceExamYear: "",
  sourceAcademicSession: "",
  sourcePage: null,
  sourceExcerpt: "",
  extractionKey: undefined,
  extractionBatchId: "",
  extractionDraftId: "",
  ...overrides
});

const makeVersion = (question, sourcePaper = null, overrides = {}) => {
  const prepared = questionMarkingService.buildQuestionInput(question, sourcePaper);
  assert.ok(prepared.input);
  const type = prepared.input.questionType;
  const marking = type === "objective"
    ? {
      objective: {
        correctOptionId: question.optionIds[0],
        verificationOptionId: question.optionIds[0],
        explanation: "PRIVATE_MARKING_EXPLANATION"
      }
    }
    : type === "fill_in_gap"
      ? {
        fillInGap: {
          blanks: [{
            blankNumber: 1,
            expectedAnswer: "PRIVATE_EXPECTED_ANSWER",
            acceptableAnswers: ["PRIVATE_EXPECTED_ANSWER"],
            gradingCriteria: [{ criterion: "Correct answer", marks: Number(question.marks) }],
            semanticGuidance: "Accept the expected answer."
          }],
          explanation: "The answer is verified.",
          totalMarks: Number(question.marks)
        }
      }
      : {
        theory: {
          referenceAnswer: "PRIVATE_REFERENCE_ANSWER",
          criteria: [{
            criterionId: "criterion-1",
            description: "Includes the main point.",
            marks: Number(question.marks),
            acceptableAlternatives: []
          }],
          explanation: "The response is assessed against the rubric.",
          totalMarks: Number(question.marks)
        }
      };

  return {
    _id: "507f1f77bcf86cd799439061",
    question: question._id,
    course: question.course,
    department: question.department,
    questionYear: String(question.year || ""),
    questionSession: question.session || "Rain",
    sourceExamYear: String(question.sourceExamYear || ""),
    sourceAcademicSession: String(question.sourceAcademicSession || ""),
    questionOrigin: question.questionOrigin,
    questionType: type,
    version: 1,
    contentHash: questionMarkingService.buildContentHash(question, prepared.input),
    status: "ready",
    marking,
    sourcePaper: sourcePaper?._id || null,
    sourcePaperMetadata: sourcePaper ? paperMetadata : undefined,
    sourcePage: question.sourcePage ?? null,
    sourceExcerpt: String(question.sourceExcerpt || "").slice(0, 1000),
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides
  };
};

const originals = {};
let currentQuestion;
let currentCourse;
let currentPaper;
let currentVersions;

const buildApp = (role = "admin") => {
  const app = express();
  const token = generateAccessToken(ADMIN_ID, { role });
  app.use((req, _res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    next();
  });
  app.use("/api/questions", questionRoutes);
  return app;
};

test.beforeEach(() => {
  currentQuestion = makeQuestion();
  currentCourse = course;
  currentPaper = paper;
  currentVersions = [];

  originals.questionFindById = Question.findById;
  originals.versionFind = QuestionMarkingVersion.find;
  originals.courseFindById = Course.findById;
  originals.paperFindById = PastQuestionPaper.findById;

  Question.findById = () => queryFor(currentQuestion);
  QuestionMarkingVersion.find = () => queryFor(currentVersions);
  Course.findById = () => queryFor(currentCourse);
  PastQuestionPaper.findById = () => queryFor(currentPaper);
});

test.afterEach(() => {
  Question.findById = originals.questionFindById;
  QuestionMarkingVersion.find = originals.versionFind;
  Course.findById = originals.courseFindById;
  PastQuestionPaper.findById = originals.paperFindById;
});

test("admin diagnostic confirms source-free original practice marking without disclosing content", async () => {
  currentQuestion = makeQuestion({
    apiCredential: "PRIVATE_API_CREDENTIAL",
    accessToken: "PRIVATE_ACCESS_TOKEN"
  });
  currentVersions = [makeVersion(currentQuestion)];

  const response = await request(buildApp())
    .get(`/api/questions/${QUESTION_ID}/marking-diagnostic`);

  assert.equal(response.status, 200);
  assert.equal(response.body.diagnostic.eligible, true);
  assert.equal(response.body.diagnostic.question.origin, "original_practice");
  assert.equal(response.body.diagnostic.question.sourcePaperMatches, true);
  assert.equal(response.body.diagnostic.markingVersionExists, true);
  assert.equal(response.body.diagnostic.matchingContentVersionExists, true);
  assert.equal(response.body.diagnostic.selectedMarkingVersion.markingUsable, true);
  assert.deepEqual(response.body.diagnostic.eligibilityFailureReasons, []);

  const json = JSON.stringify(response.body);
  for (const privateValue of [
    "PRIVATE_QUESTION_TEXT",
    "PRIVATE_OPTION_A",
    "PRIVATE_ANSWER",
    "PRIVATE_MARKING_EXPLANATION",
    "PRIVATE_API_CREDENTIAL",
    "PRIVATE_ACCESS_TOKEN",
    currentVersions[0].contentHash
  ]) {
    assert.equal(json.includes(privateValue), false);
  }
});

test("diagnostic identifies a current-content hash mismatch without exposing either hash", async () => {
  currentVersions = [makeVersion(currentQuestion, null, { contentHash: "stale-content-hash" })];

  const response = await request(buildApp())
    .get(`/api/questions/${QUESTION_ID}/marking-diagnostic`);

  assert.equal(response.status, 200);
  assert.equal(response.body.diagnostic.markingVersionExists, true);
  assert.equal(response.body.diagnostic.matchingContentVersionExists, false);
  assert.equal(response.body.diagnostic.selectedMarkingVersion, null);
  assert.deepEqual(response.body.diagnostic.eligibilityFailureReasons, [
    "marking_content_hash_mismatch"
  ]);
  assert.equal(JSON.stringify(response.body).includes("stale-content-hash"), false);
});

test("diagnostic reports non-ready marking status as an eligibility failure", async () => {
  currentVersions = [makeVersion(currentQuestion, null, { status: "uncertain" })];

  const response = await request(buildApp())
    .get(`/api/questions/${QUESTION_ID}/marking-diagnostic`);

  assert.equal(response.status, 200);
  assert.equal(response.body.diagnostic.selectedMarkingVersion.status, "uncertain");
  assert.deepEqual(response.body.diagnostic.eligibilityFailureReasons, [
    "marking_version_status_uncertain"
  ]);
});

test("diagnostic distinguishes a missing version from mismatched metadata and unusable marking", async () => {
  let response = await request(buildApp())
    .get(`/api/questions/${QUESTION_ID}/marking-diagnostic`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.diagnostic.eligibilityFailureReasons, [
    "marking_version_missing"
  ]);

  currentVersions = [makeVersion(currentQuestion, null, {
    course: "507f1f77bcf86cd799439099",
    marking: {
      objective: {
        correctOptionId: "wrong-option",
        verificationOptionId: "wrong-option",
        explanation: "The answer is verified."
      }
    }
  })];
  response = await request(buildApp())
    .get(`/api/questions/${QUESTION_ID}/marking-diagnostic`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.diagnostic.eligibilityFailureReasons, [
    "marking_question_metadata_mismatch",
    "marking_payload_unusable"
  ]);
});

test("verified past-paper diagnostics retain source verification", async () => {
  currentQuestion = makeQuestion({
    questionOrigin: "verified_past_paper",
    sourcePaper: PAPER_ID,
    sourcePaperMetadata: paperMetadata,
    sourceExamYear: "2025",
    sourceAcademicSession: "2025/2026"
  });
  currentVersions = [makeVersion(currentQuestion, currentPaper)];

  const response = await request(buildApp())
    .get(`/api/questions/${QUESTION_ID}/marking-diagnostic`);

  assert.equal(response.status, 200);
  assert.equal(response.body.diagnostic.question.origin, "verified_past_paper");
  assert.equal(response.body.diagnostic.question.sourcePaperMatches, true);
  assert.equal(response.body.diagnostic.eligible, true);
});

test("diagnostic accepts usable objective, fill-in, and theory marking payloads", async () => {
  for (const questionType of ["objective", "fill_in_gap", "theory"]) {
    currentQuestion = makeQuestion({
      questionType,
      options: questionType === "objective" ? ["PRIVATE_OPTION_A", "PRIVATE_OPTION_B"] : [],
      optionIds: questionType === "objective" ? ["option-a", "option-b"] : [],
      blankCount: questionType === "fill_in_gap" ? 1 : undefined
    });
    currentVersions = [makeVersion(currentQuestion)];

    const response = await request(buildApp())
      .get(`/api/questions/${QUESTION_ID}/marking-diagnostic`);

    assert.equal(response.status, 200, questionType);
    assert.equal(response.body.diagnostic.eligible, true, questionType);
    assert.equal(
      response.body.diagnostic.selectedMarkingVersion.markingUsable,
      true,
      questionType
    );
  }
});

test("non-admin users cannot read marking diagnostics", async () => {
  const response = await request(buildApp("student"))
    .get(`/api/questions/${QUESTION_ID}/marking-diagnostic`);

  assert.equal(response.status, 403);
});

test("the mounted application requires authentication for marking diagnostics", async () => {
  process.env.NODE_ENV = "test";
  process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "test-client-secret";
  const app = require("../app");
  const response = await request(app)
    .get(`/api/questions/${QUESTION_ID}/marking-diagnostic`);

  assert.equal(response.status, 401);
});
