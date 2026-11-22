const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "manual-question-entry-test-secret";

const Question = require("../models/Question");
const QuizSession = require("../models/QuizSession");
const Course = require("../models/course");
const PastQuestionPaper = require("../models/PastQuestionPaper");
const QuestionExtraction = require("../models/QuestionExtraction");
const questionMarkingService = require("../services/questionMarkingService");
const practiceTestService = require("../services/practiceTestService");
const { generateAccessToken } = require("../utils/token");
const questionRoutes = require("../routes/question");

const USER_ID = "507f1f77bcf86cd799439011";
const COURSE_ID = "507f1f77bcf86cd799439021";
const DEPARTMENT_ID = "507f1f77bcf86cd799439022";
const PAPER_ID = "507f1f77bcf86cd799439023";
const QUESTION_ID = "507f1f77bcf86cd799439024";
const BATCH_ID = "manual-entry-batch";
const originals = {};
let questions;
let courses;
let papers;
let batches;
let markingVersions;
let markingCalls;
let attemptedQuestionIds;

const queryFor = (value) => ({
  populate() { return this; },
  select() { return this; },
  lean() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
});

const createReadyMarkingVersion = (question) => {
  const paper = papers.get(String(question.sourcePaper));
  const prepared = questionMarkingService.buildQuestionInput(question, paper);
  const contentHash = questionMarkingService.buildContentHash(question, prepared.input);
  const questionType = question.questionType || "objective";
  const marks = Number(question.marks);
  let marking;

  if (questionType === "objective") {
    const correctOptionId = question.optionIds[0];
    marking = {
      objective: {
        correctOptionId,
        verificationOptionId: correctOptionId,
        explanation: "The answer is verified."
      }
    };
  } else if (questionType === "fill_in_gap") {
    const blankMarks = marks / question.blankCount;
    marking = {
      fillInGap: {
        blanks: Array.from({ length: question.blankCount }, (_, index) => ({
          blankNumber: index + 1,
          expectedAnswer: question.answer,
          acceptableAnswers: [question.answer],
          gradingCriteria: [{ criterion: "Correct answer", marks: blankMarks }],
          semanticGuidance: "Accept the stated correct answer."
        })),
        explanation: "The answer is verified.",
        totalMarks: marks
      }
    };
  } else {
    marking = {
      theory: {
        referenceAnswer: question.answer,
        explanation: "The answer is verified.",
        criteria: [{
          criterionId: "criterion-1",
          description: "Includes the reference answer.",
          marks,
          acceptableAlternatives: []
        }],
        totalMarks: marks
      }
    };
  }

  return {
    _id: `marking-${String(question._id)}`,
    question: question._id,
    course: question.course,
    department: question.department,
    questionYear: String(question.year || ""),
    questionSession: question.session || "Rain",
    sourceExamYear: String(question.sourceExamYear || ""),
    sourceAcademicSession: String(question.sourceAcademicSession || ""),
    questionType,
    version: 1,
    contentHash,
    status: "ready",
    sourcePaper: paper._id,
    sourcePaperMetadata: {
      title: paper.title,
      examinationYear: String(paper.examinationYear),
      level: paper.level,
      semester: paper.semester
    },
    sourcePage: question.sourcePage || null,
    sourceExcerpt: String(question.sourceExcerpt || "").slice(0, 1000),
    marking,
    createdAt: new Date()
  };
};

const buildApp = (role = "admin") => {
  const app = express();
  const token = generateAccessToken(USER_ID, { role });
  app.use((req, _res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    next();
  });
  app.use(express.json());
  app.use("/api/questions", questionRoutes);
  return app;
};

test.beforeEach(() => {
  questions = new Map();
  courses = new Map([[COURSE_ID, {
    _id: COURSE_ID,
    department: DEPARTMENT_ID,
    level: "ND1",
    semester: "First"
  }]]);
  papers = new Map([[PAPER_ID, {
    _id: PAPER_ID,
    title: "Test paper",
    course: COURSE_ID,
    department: DEPARTMENT_ID,
    level: "ND1",
    semester: "First",
    examinationYear: "2024"
  }]]);
  batches = new Map([[BATCH_ID, {
    batchId: BATCH_ID,
    course: COURSE_ID,
    department: DEPARTMENT_ID,
    academicLevel: "ND1",
    semester: "First",
    academicSession: "2024/2025",
    sourceExamYear: "2024",
    sourcePaper: PAPER_ID,
    sourcePaperMetadata: {
      title: "Test paper",
      examinationYear: "2024",
      level: "ND1",
      semester: "First"
    }
  }]]);
  markingVersions = new Map();
  markingCalls = [];
  attemptedQuestionIds = new Set();

  originals.create = Question.create;
  originals.findById = Question.findById;
  originals.findOneAndDelete = Question.findOneAndDelete;
  originals.save = Question.prototype.save;
  originals.quizSessionExists = QuizSession.exists;
  originals.courseFindById = Course.findById;
  originals.paperFindById = PastQuestionPaper.findById;
  originals.batchFindOne = QuestionExtraction.findOne;
  originals.generateForQuestion = questionMarkingService.generateForQuestion;

  Question.create = async (input) => {
    const question = new Question({ ...input, _id: QUESTION_ID });
    await question.validate();
    questions.set(String(question._id), question);
    return question;
  };
  Question.findById = (id) => queryFor(questions.get(String(id)) || null);
  Question.findOneAndDelete = async (filter) => {
    const question = questions.get(String(filter._id));
    if (!question || (filter.approvalStatus && question.approvalStatus !== filter.approvalStatus)) return null;
    questions.delete(String(filter._id));
    return question;
  };
  Question.prototype.save = async function save() {
    await this.validate();
    questions.set(String(this._id), this);
    return this;
  };
  Course.findById = async (id) => courses.get(String(id)) || null;
  PastQuestionPaper.findById = async (id) => papers.get(String(id)) || null;
  QuestionExtraction.findOne = async ({ batchId }) => batches.get(batchId) || null;
  QuizSession.exists = async (filter) => attemptedQuestionIds.has(String(filter["questions.questionId"]))
    ? { _id: "attempt-record" }
    : null;
  questionMarkingService.generateForQuestion = async (questionId, userId) => {
    markingCalls.push({ questionId: String(questionId), userId: String(userId) });
    const question = questions.get(String(questionId));
    const generated = createReadyMarkingVersion(question);
    const key = `${String(question._id)}:${generated.contentHash}`;
    if (!markingVersions.has(key)) markingVersions.set(key, generated);
    const version = markingVersions.get(key);
    return { status: version.status, version };
  };
});

test.afterEach(() => {
  Question.create = originals.create;
  Question.findById = originals.findById;
  Question.findOneAndDelete = originals.findOneAndDelete;
  Question.prototype.save = originals.save;
  QuizSession.exists = originals.quizSessionExists;
  Course.findById = originals.courseFindById;
  PastQuestionPaper.findById = originals.paperFindById;
  QuestionExtraction.findOne = originals.batchFindOne;
  questionMarkingService.generateForQuestion = originals.generateForQuestion;
});

test("saves a manual draft without complete multiple-choice answers and preserves batch associations", async () => {
  const response = await request(buildApp())
    .post("/api/questions")
    .send({
      course: COURSE_ID,
      batchId: BATCH_ID,
      sourcePaperId: PAPER_ID,
      topic: "Algebra",
      question: "Solve x + 2 = 4",
      questionType: "objective",
      options: ["", ""],
      answer: "",
      year: "2024",
      session: "Rain",
      marks: 2,
      approvalStatus: "draft"
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.question.approvalStatus, "draft");
  assert.equal(String(response.body.question.course), COURSE_ID);
  assert.equal(String(response.body.question.department), DEPARTMENT_ID);
  assert.equal(response.body.question.extractionBatchId, BATCH_ID);
  assert.equal(String(response.body.question.sourcePaper), PAPER_ID);
  assert.equal(response.body.question.sourceAcademicSession, "2024/2025");
});

test("saves the legacy AdminPanel payload as a source-less draft without generating marking", async () => {
  const response = await request(buildApp())
    .post("/api/questions")
    .send({
      topic: "Algebra",
      question: "Solve x + 2 = 4",
      options: ["2", "3"],
      answer: "2",
      explanation: "",
      year: "2024",
      session: "Rain",
      marks: 2,
      difficulty: "medium",
      subQuestions: [],
      course: COURSE_ID,
      department: DEPARTMENT_ID,
      approvalStatus: "draft"
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.question.approvalStatus, "draft");
  assert.equal(response.body.question.sourcePaper, null);
  assert.equal(response.body.markingStatus, undefined);
  assert.equal(markingCalls.length, 0);
});

test("publishes valid multiple-choice questions and rejects incomplete publication", async () => {
  const invalidResponse = await request(buildApp())
    .post("/api/questions")
    .send({
      course: COURSE_ID,
      topic: "Algebra",
      question: "Solve x + 2 = 4",
      questionType: "objective",
      options: ["2", "3"],
      answer: "",
      year: "2024",
      sourcePaperId: PAPER_ID,
      approvalStatus: "approved"
    });
  assert.equal(invalidResponse.status, 400);
  assert.match(invalidResponse.body.message, /correct answer/i);

  const response = await request(buildApp())
    .post("/api/questions")
    .send({
      course: COURSE_ID,
      topic: "Algebra",
      question: "Solve x + 2 = 4",
      questionType: "objective",
      options: ["2", "3"],
      answer: "2",
      year: "2024",
      sourcePaperId: PAPER_ID,
      approvalStatus: "approved"
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.question.approvalStatus, "approved");
  assert.equal(response.body.question.answer, "2");
  assert.equal(response.body.markingStatus, "ready");
  assert.ok(response.body.markingVersion);
  assert.equal(markingCalls.length, 1);
  assert.equal(markingCalls[0].questionId, QUESTION_ID);
  assert.equal(markingCalls[0].userId, USER_ID);
  assert.equal(
    practiceTestService.isEligibleQuestion(
      questions.get(QUESTION_ID),
      courses.get(COURSE_ID),
      papers.get(PAPER_ID),
      [...markingVersions.values()][0]
    ),
    true
  );
});

test("publishing without a source paper is rejected before creating the question", async () => {
  const response = await request(buildApp())
    .post("/api/questions")
    .send({
      course: COURSE_ID,
      topic: "Algebra",
      question: "Solve x + 2 = 4",
      questionType: "objective",
      options: ["2", "3"],
      answer: "2",
      year: "2024",
      approvalStatus: "approved"
    });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /source past-question paper is required/i);
  assert.equal(questions.size, 0);
  assert.equal(markingCalls.length, 0);
});

test("republishing unchanged content reuses its marking version", async () => {
  const payload = {
    course: COURSE_ID,
    topic: "Algebra",
    question: "Solve x + 2 = 4",
    questionType: "objective",
    options: ["2", "3"],
    answer: "2",
    year: "2024",
    sourcePaperId: PAPER_ID,
    approvalStatus: "approved"
  };
  const app = buildApp();
  const first = await request(app).post("/api/questions").send(payload);
  const republished = await request(app)
    .put(`/api/questions/${QUESTION_ID}`)
    .send(payload);

  assert.equal(first.status, 200);
  assert.equal(republished.status, 200);
  assert.equal(republished.body.markingStatus, "ready");
  assert.equal(republished.body.markingVersion, first.body.markingVersion);
  assert.equal(markingVersions.size, 1);
});

test("validates fill-in-the-gap answers and associates a manually selected paper", async () => {
  const draftResponse = await request(buildApp())
    .post("/api/questions")
    .send({
      course: COURSE_ID,
      sourcePaperId: PAPER_ID,
      topic: "Algebra",
      question: "Solve x + 2 = 4",
      questionType: "fill_in_gap",
      options: [],
      answer: "",
      year: "2024",
      approvalStatus: "draft"
    });
  assert.equal(draftResponse.status, 200);
  assert.equal(draftResponse.body.question.blankCount, undefined);
  assert.equal(draftResponse.body.question.sourcePaperMetadata.title, "Test paper");

  const invalidPublish = await request(buildApp())
    .post("/api/questions")
    .send({
      course: COURSE_ID,
      topic: "Algebra",
      question: "Solve x + 2 = 4",
      questionType: "fill_in_gap",
      blankCount: 0,
      answer: "2",
      year: "2024",
      sourcePaperId: PAPER_ID,
      approvalStatus: "approved"
    });
  assert.equal(invalidPublish.status, 400);
  assert.match(invalidPublish.body.message, /between 1 and 20 blanks/i);

  const published = await request(buildApp())
    .post("/api/questions")
    .send({
      course: COURSE_ID,
      topic: "Algebra",
      question: "Solve x + 2 = 4",
      questionType: "fill_in_gap",
      blankCount: 1,
      answer: "2",
      year: "2024",
      sourcePaperId: PAPER_ID,
      approvalStatus: "approved"
    });
  assert.equal(published.status, 200);
  assert.equal(published.body.question.blankCount, 1);
  assert.equal(published.body.markingStatus, "ready");
  assert.equal(
    practiceTestService.isEligibleQuestion(
      questions.get(QUESTION_ID),
      courses.get(COURSE_ID),
      papers.get(PAPER_ID),
      [...markingVersions.values()][0]
    ),
    true
  );
});

test("supports editing and publishing a manual question", async () => {
  const createResponse = await request(buildApp())
    .post("/api/questions")
    .send({
      course: COURSE_ID,
      topic: "Algebra",
      question: "Draft question",
      questionType: "theory",
      options: [],
      answer: "",
      year: "2024",
      approvalStatus: "draft"
    });
  assert.equal(createResponse.status, 200);

  const updateResponse = await request(buildApp())
    .put(`/api/questions/${QUESTION_ID}`)
    .send({
      course: COURSE_ID,
      topic: "Algebra",
      question: "Updated question",
      questionType: "theory",
      options: [],
      answer: "Reference answer",
      year: "2024",
      sourcePaperId: PAPER_ID,
      approvalStatus: "approved"
    });
  assert.equal(updateResponse.status, 200);
  assert.equal(updateResponse.body.question.question, "Updated question");
  assert.equal(updateResponse.body.question.approvalStatus, "approved");
  assert.equal(updateResponse.body.markingStatus, "ready");
  assert.equal(
    practiceTestService.isEligibleQuestion(
      questions.get(QUESTION_ID),
      courses.get(COURSE_ID),
      papers.get(PAPER_ID),
      [...markingVersions.values()][0]
    ),
    true
  );
});

test("prevents editing or deleting questions referenced by QuizSession snapshots", async () => {
  const createResponse = await request(buildApp())
    .post("/api/questions")
    .send({
      course: COURSE_ID,
      topic: "Algebra",
      question: "Previously attempted question",
      questionType: "objective",
      options: ["2", "3"],
      answer: "2",
      year: "2024",
      sourcePaperId: PAPER_ID,
      approvalStatus: "approved"
    });
  assert.equal(createResponse.status, 200);
  attemptedQuestionIds.add(QUESTION_ID);

  const updateResponse = await request(buildApp())
    .put(`/api/questions/${QUESTION_ID}`)
    .send({
      course: COURSE_ID,
      topic: "Algebra",
      question: "Changed after attempt",
      questionType: "objective",
      options: ["2", "3"],
      answer: "2",
      year: "2024",
      sourcePaperId: PAPER_ID,
      approvalStatus: "approved"
    });
  const deleteResponse = await request(buildApp()).delete(`/api/questions/${QUESTION_ID}`);

  assert.equal(updateResponse.status, 409);
  assert.match(updateResponse.body.message, /included in student attempts cannot be edited/i);
  assert.equal(questions.get(QUESTION_ID).question, "Previously attempted question");
  assert.equal(deleteResponse.status, 409);
  assert.match(deleteResponse.body.message, /included in student attempts cannot be deleted/i);
  assert.equal(questions.has(QUESTION_ID), true);
});

test("allows deletion only for a draft with no QuizSession snapshot", async () => {
  const createResponse = await request(buildApp())
    .post("/api/questions")
    .send({
      course: COURSE_ID,
      topic: "Algebra",
      question: "Unused draft",
      questionType: "theory",
      options: [],
      answer: "",
      year: "2024",
      approvalStatus: "draft"
    });
  assert.equal(createResponse.status, 200);

  const deleteResponse = await request(buildApp()).delete(`/api/questions/${QUESTION_ID}`);
  assert.equal(deleteResponse.status, 200);
  assert.equal(questions.has(QUESTION_ID), false);
});

test("enforces administrator permissions and denies deletion of an unused published question", async () => {
  const forbidden = await request(buildApp("lecturer"))
    .post("/api/questions")
    .send({ course: COURSE_ID });
  assert.equal(forbidden.status, 403);

  const createResponse = await request(buildApp())
    .post("/api/questions")
    .send({
      course: COURSE_ID,
      topic: "Algebra",
      question: "Previously attempted question",
      questionType: "theory",
      options: [],
      year: "2024",
      approvalStatus: "draft"
    });
  const deleteResponse = await request(buildApp()).delete(`/api/questions/${QUESTION_ID}`);
  assert.equal(createResponse.status, 200);
  assert.equal(deleteResponse.status, 200);
  assert.equal(questions.has(QUESTION_ID), false);

  const publishedResponse = await request(buildApp())
    .post("/api/questions")
    .send({
      course: COURSE_ID,
      topic: "Algebra",
      question: "Published question",
      questionType: "objective",
      options: ["2", "3"],
      answer: "2",
      year: "2024",
      sourcePaperId: PAPER_ID,
      approvalStatus: "approved"
    });
  const publishedDeleteResponse = await request(buildApp()).delete(`/api/questions/${QUESTION_ID}`);
  assert.equal(publishedResponse.status, 200);
  assert.equal(publishedDeleteResponse.status, 409);
  assert.match(publishedDeleteResponse.body.message, /only unused draft questions/i);
  assert.equal(questions.has(QUESTION_ID), true);
});

test("rejects mismatched extraction batch and course associations", async () => {
  const otherCourseId = "507f1f77bcf86cd799439099";
  courses.set(otherCourseId, {
    _id: otherCourseId,
    department: DEPARTMENT_ID,
    level: "ND1",
    semester: "First"
  });
  const response = await request(buildApp())
    .post("/api/questions")
    .send({
      course: otherCourseId,
      batchId: BATCH_ID,
      topic: "Algebra",
      question: "Question",
      questionType: "theory",
      year: "2024",
      approvalStatus: "draft"
    });
  assert.equal(response.status, 400);
  assert.match(response.body.message, /batch must match/i);
});
