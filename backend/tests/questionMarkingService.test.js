const test = require("node:test");
const assert = require("node:assert/strict");
const Question = require("../models/Question");
const QuestionMarkingVersion = require("../models/QuestionMarkingVersion");
const PastQuestionPaper = require("../models/PastQuestionPaper");
const gemini = require("../utils/gemini");
const markingService = require("../services/questionMarkingService");

const COURSE_ID = "507f1f77bcf86cd799439021";
const DEPARTMENT_ID = "507f1f77bcf86cd799439022";
const PAPER_ID = "507f1f77bcf86cd799439024";
const QUESTION_ID = "507f1f77bcf86cd799439025";

const originals = {};
let questions;
let papers;
let versions;
let generationCalls;

const makeQuestion = (overrides = {}) => ({
  _id: QUESTION_ID,
  course: COURSE_ID,
  department: DEPARTMENT_ID,
  topic: "Arithmetic",
  question: "What is two plus two?",
  questionType: "objective",
  options: ["3", "4"],
  optionIds: ["option-a", "option-b"],
  answer: "",
  year: "2025",
  session: "Harmattan",
  marks: 2,
  approvalStatus: "approved",
  sourcePaper: PAPER_ID,
  sourceExamYear: "2025",
  sourceAcademicSession: "2025/2026",
  sourcePaperMetadata: {
    title: "Arithmetic past paper",
    examinationYear: "2025",
    level: "ND1",
    semester: "First"
  },
  sourcePage: 2,
  sourceExcerpt: "What is two plus two?",
  ...overrides
});

const makePaper = (overrides = {}) => ({
  _id: PAPER_ID,
  course: COURSE_ID,
  department: DEPARTMENT_ID,
  title: "Arithmetic past paper",
  examinationYear: "2025",
  level: "ND1",
  semester: "First",
  ...overrides
});

const generatedObjective = (answerOptionId = "option-b", verifierOptionId = answerOptionId) => ({
  message: JSON.stringify({
    answerOptionId,
    explanation: "Two plus two equals four.",
    uncertain: false,
    uncertaintyReason: ""
  }),
  verifierMessage: JSON.stringify({
    selectedOptionId: verifierOptionId,
    uncertain: false,
    uncertaintyReason: ""
  }),
  model: "test-model"
});

const setupMocks = () => {
  questions = new Map([[QUESTION_ID, makeQuestion()]]);
  papers = new Map([[PAPER_ID, makePaper()]]);
  versions = new Map();
  generationCalls = 0;
  Question.findById = async (id) => questions.get(String(id)) || null;
  PastQuestionPaper.findById = async (id) => papers.get(String(id)) || null;
  QuestionMarkingVersion.findOne = async ({ generationKey }) =>
    [...versions.values()].find((version) => version.generationKey === generationKey) || null;
  QuestionMarkingVersion.countDocuments = async ({ question }) =>
    [...versions.values()].filter((version) => String(version.question) === String(question)).length;
  QuestionMarkingVersion.create = async (payload) => {
    if ([...versions.values()].some((version) => version.generationKey === payload.generationKey)) {
      const error = new Error("Duplicate generation key.");
      error.code = 11000;
      throw error;
    }
    const record = {
      _id: `marking-${payload.version}`,
      ...payload,
      async save() { versions.set(String(this._id), this); }
    };
    versions.set(String(record._id), record);
    return record;
  };
  gemini.getUsageStats = () => ({ model: "test-model" });
  gemini.generateQuestionMarking = async () => {
    generationCalls += 1;
    return generatedObjective();
  };
};

const restoreMocks = () => {
  Question.findById = originals.questionFindById;
  PastQuestionPaper.findById = originals.paperFindById;
  QuestionMarkingVersion.findOne = originals.versionFindOne;
  QuestionMarkingVersion.countDocuments = originals.versionCountDocuments;
  QuestionMarkingVersion.create = originals.versionCreate;
  gemini.getUsageStats = originals.getUsageStats;
  gemini.generateQuestionMarking = originals.generateQuestionMarking;
};

test.before(() => {
  originals.questionFindById = Question.findById;
  originals.paperFindById = PastQuestionPaper.findById;
  originals.versionFindOne = QuestionMarkingVersion.findOne;
  originals.versionCountDocuments = QuestionMarkingVersion.countDocuments;
  originals.versionCreate = QuestionMarkingVersion.create;
  originals.getUsageStats = gemini.getUsageStats;
  originals.generateQuestionMarking = gemini.generateQuestionMarking;
});
test.beforeEach(setupMocks);
test.after(restoreMocks);

test("objective marking requires independent agreement on a valid option ID", () => {
  const optionIds = ["option-a", "option-b"];
  const agrees = markingService.validateObjective(
    JSON.parse(generatedObjective().message),
    JSON.parse(generatedObjective().verifierMessage),
    optionIds
  );
  assert.equal(agrees.status, "ready");
  assert.equal(agrees.marking.objective.correctOptionId, "option-b");

  const disagrees = markingService.validateObjective(
    JSON.parse(generatedObjective("option-a", "option-b").message),
    JSON.parse(generatedObjective("option-a", "option-b").verifierMessage),
    optionIds
  );
  assert.equal(disagrees.status, "uncertain");
  assert.match(disagrees.reasons[0], /different options/);

  const invalid = markingService.validateObjective(
    JSON.parse(generatedObjective("not-an-option").message),
    JSON.parse(generatedObjective().verifierMessage),
    optionIds
  );
  assert.equal(invalid.status, "invalid");

  const selfReportedUncertainty = markingService.validateObjective(
    {
      answerOptionId: "option-b",
      explanation: "Likely four.",
      uncertain: true,
      uncertaintyReason: "The text is unclear."
    },
    {
      selectedOptionId: "option-b",
      uncertain: false,
      uncertaintyReason: ""
    },
    optionIds
  );
  assert.equal(selfReportedUncertainty.status, "uncertain");
});

test("fill-in-the-gap marking validates blanks, accepted alternatives and bounded mark totals", () => {
  const valid = markingService.validateFillInGap({
    uncertain: false,
    uncertaintyReason: "",
    blanks: [{
      blankNumber: 1,
      expectedAnswer: "four",
      acceptableAnswers: ["4"],
      gradingCriteria: [{ criterion: "Identifies the result as four", marks: 2 }],
      semanticGuidance: "Accept the number four written as a word or numeral."
    }],
    explanation: "Two plus two is four.",
    totalMarks: 2
  }, 1, 2);
  assert.equal(valid.status, "ready");
  assert.deepEqual(valid.marking.fillInGap.blanks[0].acceptableAnswers, ["four", "4"]);

  const uncertain = markingService.validateFillInGap({
    uncertain: true,
    uncertaintyReason: "The source wording could refer to two different quantities.",
    blanks: [{
      blankNumber: 1,
      expectedAnswer: "four",
      acceptableAnswers: [],
      gradingCriteria: [{ criterion: "Provides the result four.", marks: 2 }],
      semanticGuidance: "Must express the result four."
    }],
    explanation: "Two plus two is four.",
    totalMarks: 2
  }, 1, 2);
  assert.equal(uncertain.status, "uncertain");
  assert.equal(uncertain.reasons.length, 1);

  const overAllocated = markingService.validateFillInGap({
    uncertain: false,
    uncertaintyReason: "",
    blanks: [{
      blankNumber: 1,
      expectedAnswer: "four",
      acceptableAnswers: [],
      gradingCriteria: [{ criterion: "Correct result", marks: 3 }],
      semanticGuidance: "Must express the result four."
    }],
    explanation: "Two plus two is four.",
    totalMarks: 2
  }, 1, 2);
  assert.equal(overAllocated.status, "invalid");
});

test("theory marking requires a bounded rubric whose marks sum to the question total", () => {
  const valid = markingService.validateTheory({
    uncertain: false,
    uncertaintyReason: "",
    referenceAnswer: "A concise reference response.",
    criteria: [
      { criterionId: "point-1", description: "States the main point.", marks: 1, acceptableAlternatives: [] },
      { criterionId: "point-2", description: "Supports the point.", marks: 1, acceptableAlternatives: ["Equivalent evidence."] }
    ],
    explanation: "Credit is awarded for both required points.",
    totalMarks: 2
  }, 2);
  assert.equal(valid.status, "ready");
  assert.equal(valid.marking.theory.criteria.length, 2);

  const malformed = markingService.validateTheory({
    uncertain: false,
    uncertaintyReason: "",
    referenceAnswer: "A concise reference response.",
    criteria: [{ criterionId: "point-1", description: "States the main point.", marks: 3, acceptableAlternatives: [] }],
    explanation: "A reason.",
    totalMarks: 2
  }, 2);
  assert.equal(malformed.status, "invalid");
});

test("approved question generation is content-hashed, versioned and idempotent", async () => {
  const first = await markingService.generateForQuestion(QUESTION_ID, "reviewer-id");
  const duplicate = await markingService.generateForQuestion(QUESTION_ID, "reviewer-id");
  assert.equal(first.status, "ready");
  assert.equal(first.version.version, 1);
  assert.equal(first.version.promptVersion, "question-marking-v1");
  assert.match(first.version.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(first.version.course, COURSE_ID);
  assert.equal(first.version.department, DEPARTMENT_ID);
  assert.equal(first.version.questionYear, "2025");
  assert.equal(first.version.questionSession, "Harmattan");
  assert.equal(first.version.sourceExamYear, "2025");
  assert.equal(first.version.sourceAcademicSession, "2025/2026");
  assert.equal(duplicate.version._id, first.version._id);
  assert.equal(generationCalls, 1);

  questions.get(QUESTION_ID).question = "What is three plus one?";
  const changed = await markingService.generateForQuestion(QUESTION_ID, "reviewer-id");
  assert.equal(changed.status, "ready");
  assert.equal(changed.version.version, 2);
  assert.notEqual(changed.version.contentHash, first.version.contentHash);
});

test("missing and cross-course provenance never trigger AI marking", async () => {
  questions.get(QUESTION_ID).sourcePaper = null;
  const missing = await markingService.generateForQuestion(QUESTION_ID, "reviewer-id");
  assert.equal(missing.status, "needs_source");
  assert.equal(generationCalls, 0);

  questions.get(QUESTION_ID).sourcePaper = PAPER_ID;
  papers.set(PAPER_ID, makePaper({ course: "507f1f77bcf86cd799439099" }));
  const mismatched = await markingService.generateForQuestion(QUESTION_ID, "reviewer-id");
  assert.equal(mismatched.status, "invalid");
  assert.equal(generationCalls, 0);
});

test("fill-in and theory question records are represented without objective answer fields", async () => {
  const fillQuestion = makeQuestion({
    questionType: "fill_in_gap",
    question: "The result is ____.",
    options: [],
    optionIds: [],
    blankCount: 1,
    marks: 2
  });
  const fill = markingService.buildQuestionInput(fillQuestion, makePaper());
  assert.equal(fill.input.questionType, "fill_in_gap");
  assert.equal(fill.input.blankCount, 1);
  assert.equal(Object.hasOwn(fill.input, "options"), false);

  const theory = markingService.buildQuestionInput(makeQuestion({
    questionType: "theory",
    question: "Explain the result.",
    options: [],
    optionIds: [],
    marks: 5
  }), makePaper());
  assert.equal(theory.input.questionType, "theory");
  assert.equal(theory.input.marks, 5);
  assert.equal(Object.hasOwn(theory.input, "options"), false);
});

test("fill-in and theory marking outputs are persisted as typed records", async () => {
  const fillId = "507f1f77bcf86cd799439026";
  questions.set(fillId, makeQuestion({
    _id: fillId,
    questionType: "fill_in_gap",
    question: "The result is ____.",
    options: [],
    optionIds: [],
    blankCount: 1,
    marks: 2
  }));
  gemini.generateQuestionMarking = async () => ({
    message: JSON.stringify({
      uncertain: false,
      uncertaintyReason: "",
      blanks: [{
        blankNumber: 1,
        expectedAnswer: "four",
        acceptableAnswers: ["4"],
        gradingCriteria: [{ criterion: "Provides the result four.", marks: 2 }],
        semanticGuidance: "Accept equivalent wording for four."
      }],
      explanation: "Two plus two is four.",
      totalMarks: 2
    }),
    verifierMessage: "",
    model: "test-model"
  });
  const fill = await markingService.generateForQuestion(fillId, "reviewer-id");
  assert.equal(fill.status, "ready");
  assert.equal(fill.version.questionType, "fill_in_gap");
  assert.equal(fill.version.marking.fillInGap.blanks[0].expectedAnswer, "four");

  const theoryId = "507f1f77bcf86cd799439027";
  questions.set(theoryId, makeQuestion({
    _id: theoryId,
    questionType: "theory",
    question: "Explain the result.",
    options: [],
    optionIds: [],
    marks: 3
  }));
  gemini.generateQuestionMarking = async () => ({
    message: JSON.stringify({
      uncertain: false,
      uncertaintyReason: "",
      referenceAnswer: "A model response.",
      criteria: [{
        criterionId: "point-1",
        description: "States the key idea.",
        marks: 3,
        acceptableAlternatives: ["Equivalent explanation."]
      }],
      explanation: "Credit is awarded for the key idea.",
      totalMarks: 3
    }),
    verifierMessage: "",
    model: "test-model"
  });
  const theory = await markingService.generateForQuestion(theoryId, "reviewer-id");
  assert.equal(theory.status, "ready");
  assert.equal(theory.version.questionType, "theory");
  assert.equal(theory.version.marking.theory.totalMarks, 3);
});

test("malformed AI JSON is invalid and provider failure is explicitly recorded", async () => {
  gemini.generateQuestionMarking = async () => ({
    message: '{"answerOptionId":',
    verifierMessage: "",
    model: "test-model"
  });
  const invalid = await markingService.generateForQuestion(QUESTION_ID, "reviewer-id");
  assert.equal(invalid.status, "invalid");
  assert.deepEqual(invalid.version.validationErrors, ["The AI response was not valid JSON."]);

  const nextId = "507f1f77bcf86cd799439028";
  questions.set(nextId, makeQuestion({ _id: nextId }));
  gemini.generateQuestionMarking = async () => {
    const error = new Error("provider unreachable");
    error.statusCode = 503;
    throw error;
  };
  const failed = await markingService.generateForQuestion(nextId, "reviewer-id");
  assert.equal(failed.status, "failed");
  assert.equal(failed.version.failureCode, "not_configured");
});
