const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { Readable } = require("stream");

process.env.JWT_SECRET = process.env.JWT_SECRET || "question-extraction-review-test-secret";
const { generateAccessToken } = require("../utils/token");
const User = require("../models/User");
const Course = require("../models/course");
const Department = require("../models/Department");
const Question = require("../models/Question");
const QuestionExtraction = require("../models/QuestionExtraction");
const questionAccess = require("../services/questionAccessService");
const storageService = require("../services/storageService");

const LECTURER = "507f1f77bcf86cd799439011";
const ADMIN = "507f1f77bcf86cd799439012";
const STUDENT = "507f1f77bcf86cd799439013";
const OUTSIDER = "507f1f77bcf86cd799439014";
const COURSE_ID = "507f1f77bcf86cd799439021";
const DEPARTMENT_ID = "507f1f77bcf86cd799439022";
const DRAFT_A = "507f1f77bcf86cd799439031";
const DRAFT_B = "507f1f77bcf86cd799439032";
const IMAGE_ID = "507f1f77bcf86cd799439041";
const BATCH_ID = "review-batch-001";

const originals = {};
let users;
let records;
let questions;
let courseAccess;
let imageBuffer;

const clone = (value) => {
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
};

const makeDraft = (id, overrides = {}) => ({
  _id: id,
  questionNumber: "1",
  questionText: "What is two plus two?",
  options: [
    { optionId: "stable-option-a", label: "A", text: "3" },
    { optionId: "stable-option-b", label: "B", text: "4" }
  ],
  possibleAnswer: "B",
  answerStatus: "unconfirmed",
  confirmedAnswerOptionId: "",
  answerConfirmedBy: null,
  answerConfirmedAt: null,
  explanation: "",
  topic: "Arithmetic",
  difficulty: "medium",
  marks: 2,
  sourceImage: IMAGE_ID,
  sourcePage: 1,
  ocrConfidence: 92,
  structuringConfidence: 0.8,
  extractionWarnings: ["Verify answer against the image."],
  reviewStatus: "pending",
  reviewHistory: [],
  ...overrides
});

const seedBatch = (drafts = [makeDraft(DRAFT_A)]) => ({
  batchId: BATCH_ID,
  uploadedBy: OUTSIDER,
  course: COURSE_ID,
  department: DEPARTMENT_ID,
  academicLevel: "ND1",
  semester: "First",
  academicSession: "2025/2026",
  sourceExamYear: "2025",
  status: "needs_review",
  reviewStatus: "pending",
  images: [{
    _id: IMAGE_ID,
    originalName: "exam.png",
    mimeType: "image/png",
    extension: "png",
    size: 12,
    width: 10,
    height: 10,
    storageProvider: "local-disk",
    storageFilename: "private/exam.png",
    ocrStatus: "succeeded",
    ocrConfidence: 92,
    ocrText: "What is two plus two?"
  }],
  drafts
});

const buildApp = (identity, roleClaim) => {
  const app = express();
  app.use(express.json());
  if (identity) {
    const token = generateAccessToken(identity, { role: roleClaim });
    app.use((req, res, next) => {
      req.headers.authorization = `Bearer ${token}`;
      next();
    });
  }
  app.use("/api/question-extractions", require("../routes/questionExtraction"));
  return app;
};

const setupMocks = () => {
  users = {
    [LECTURER]: { _id: LECTURER, role: "lecturer", lecturerStatus: "approved" },
    [ADMIN]: { _id: ADMIN, role: "admin" },
    [STUDENT]: { _id: STUDENT, role: "student" },
    [OUTSIDER]: { _id: OUTSIDER, role: "lecturer", lecturerStatus: "approved" }
  };
  records = new Map([[BATCH_ID, seedBatch()]]);
  questions = new Map();
  courseAccess = true;
  imageBuffer = Buffer.from("private-image");

  User.findById = (id) => ({
    select() {
      return { lean: async () => users[String(id)] || null };
    }
  });
  Course.find = () => ({
    select() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean: async () => [{ _id: COURSE_ID }]
  });
  Course.findById = async (id) => String(id) === COURSE_ID
    ? { _id: COURSE_ID, department: DEPARTMENT_ID, level: "ND1", semester: "First" }
    : null;
  Department.findById = async (id) => String(id) === DEPARTMENT_ID ? { _id: DEPARTMENT_ID } : null;
  questionAccess.getCourseAccess = async (userId, courseId) => {
    const user = users[String(userId)];
    if (!user || String(courseId) !== COURSE_ID) {
      return { allowed: false, manager: false, statusCode: 403, message: "Course access required." };
    }
    const manager = user.role === "admin" ||
      (courseAccess && user.role === "lecturer" && user.lecturerStatus === "approved");
    return manager
      ? { allowed: true, manager: true, course: { _id: COURSE_ID } }
      : { allowed: false, manager: false, statusCode: 403, message: "Course access required." };
  };
  QuestionExtraction.findOne = async ({ batchId }) => records.get(batchId) || null;
  QuestionExtraction.find = () => ({
    select() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean: async () => [...records.values()]
  });
  QuestionExtraction.updateOne = async (filter, update) => {
    const batch = records.get(filter.batchId);
    if (!batch) return { matchedCount: 0 };
    const element = filter.drafts?.$elemMatch;
    const draft = element
      ? batch.drafts.find((item) =>
        String(item._id) === String(element._id) &&
        (!element.reviewStatus || item.reviewStatus === element.reviewStatus) &&
        (!element.reviewLockToken || item.reviewLockToken === element.reviewLockToken) &&
        (!Object.hasOwn(element, "reviewLockUntil") ||
          String(item.reviewLockUntil || "") === String(element.reviewLockUntil || "")))
      : null;
    if (element && !draft) return { matchedCount: 0 };
    for (const [path, value] of Object.entries(update.$set || {})) {
      if (path.startsWith("drafts.$.")) draft[path.slice("drafts.$.".length)] = clone(value);
      else batch[path] = clone(value);
    }
    for (const [path, value] of Object.entries(update.$push || {})) {
      if (path === "drafts.$.reviewHistory") draft.reviewHistory.push(clone(value));
    }
    return { matchedCount: 1 };
  };
  QuestionExtraction.findOneAndUpdate = async (filter, update) => {
    const batch = records.get(filter.batchId);
    const element = filter.drafts?.$elemMatch;
    const draft = batch?.drafts.find((item) =>
      String(item._id) === String(element?._id) &&
      item.reviewStatus === element?.reviewStatus &&
      (!element?.reviewLockToken || item.reviewLockToken === element.reviewLockToken) &&
      (!element || !Object.hasOwn(element, "reviewLockUntil") ||
        String(item.reviewLockUntil || "") === String(element.reviewLockUntil || "")));
    if (!draft) return null;
    for (const [path, value] of Object.entries(update.$set || {})) {
      draft[path.slice("drafts.$.".length)] = clone(value);
    }
    return batch;
  };
  Question.findOne = async ({ extractionKey }) => questions.get(extractionKey) || null;
  Question.create = async (payload) => {
    if (questions.has(payload.extractionKey) ||
        [...questions.values()].some((question) => String(question._id) === String(payload._id))) {
      const error = new Error("Duplicate extraction key.");
      error.code = 11000;
      throw error;
    }
    const question = clone(payload);
    questions.set(payload.extractionKey, question);
    return question;
  };
  storageService.getObjectReadStream = async () => Readable.from([imageBuffer]);
};

const restoreMocks = () => {
  User.findById = originals.userFindById;
  Course.find = originals.courseFind;
  Course.findById = originals.courseFindById;
  Department.findById = originals.departmentFindById;
  Question.findOne = originals.questionFindOne;
  Question.create = originals.questionCreate;
  QuestionExtraction.findOne = originals.extractionFindOne;
  QuestionExtraction.find = originals.extractionFind;
  QuestionExtraction.updateOne = originals.extractionUpdateOne;
  QuestionExtraction.findOneAndUpdate = originals.extractionFindOneAndUpdate;
  questionAccess.getCourseAccess = originals.getCourseAccess;
  storageService.getObjectReadStream = originals.getObjectReadStream;
};

test.before(() => {
  originals.userFindById = User.findById;
  originals.courseFind = Course.find;
  originals.courseFindById = Course.findById;
  originals.departmentFindById = Department.findById;
  originals.questionFindOne = Question.findOne;
  originals.questionCreate = Question.create;
  originals.extractionFindOne = QuestionExtraction.findOne;
  originals.extractionFind = QuestionExtraction.find;
  originals.extractionUpdateOne = QuestionExtraction.updateOne;
  originals.extractionFindOneAndUpdate = QuestionExtraction.findOneAndUpdate;
  originals.getCourseAccess = questionAccess.getCourseAccess;
  originals.getObjectReadStream = storageService.getObjectReadStream;
});
test.beforeEach(setupMocks);
test.after(restoreMocks);

test("review endpoints require authentication and reject student roles from the database", async () => {
  assert.equal((await request(buildApp()).get(`/api/question-extractions/${BATCH_ID}`)).status, 401);
  const response = await request(buildApp(STUDENT, "admin"))
    .get(`/api/question-extractions/${BATCH_ID}`);
  assert.equal(response.status, 403);
});

test("lecturers can review only batches for courses they manage and the image route enforces the same rule", async () => {
  courseAccess = false;
  const app = buildApp(LECTURER, "lecturer");
  assert.equal((await request(app).get(`/api/question-extractions/${BATCH_ID}`)).status, 403);
  assert.equal((await request(app).get(`/api/question-extractions/${BATCH_ID}/images/${IMAGE_ID}`)).status, 403);
});

test("assigned lecturers and administrators can retrieve drafts and protected source images", async () => {
  const lecturerResponse = await request(buildApp(LECTURER, "lecturer"))
    .get(`/api/question-extractions/${BATCH_ID}`);
  assert.equal(lecturerResponse.status, 200);
  assert.equal(lecturerResponse.body.batch.drafts[0].ocrConfidence, 92);
  assert.equal(lecturerResponse.body.batch.drafts[0].extractionWarnings.length, 1);
  const image = await request(buildApp(LECTURER, "lecturer"))
    .get(`/api/question-extractions/${BATCH_ID}/images/${IMAGE_ID}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers["cache-control"], "private, no-store");

  const admin = await request(buildApp(ADMIN, "student"))
    .get(`/api/question-extractions/${BATCH_ID}`);
  assert.equal(admin.status, 200);
});

test("draft editing validates fields, preserves originals, and records reviewer history", async () => {
  const app = buildApp(LECTURER, "lecturer");
  const invalid = await request(app)
    .patch(`/api/question-extractions/${BATCH_ID}/drafts/${DRAFT_A}`)
    .send({ options: [{ text: "Only one option" }] });
  assert.equal(invalid.status, 400);

  const response = await request(app)
    .patch(`/api/question-extractions/${BATCH_ID}/drafts/${DRAFT_A}`)
    .send({
      questionText: "Corrected question text?",
      options: [
        { optionId: "stable-option-b", text: "4" },
        { optionId: "stable-option-a", text: "3" }
      ],
      confirmedAnswerOptionId: "stable-option-b",
      confirmCorrectAnswer: true,
      topic: "Number operations",
      difficulty: "easy",
      marks: 3,
      explanation: "Because two plus two is four."
    });
  assert.equal(response.status, 200);
  const saved = response.body.batch.drafts[0];
  assert.deepEqual(saved.options.map((option) => option.optionId), ["stable-option-b", "stable-option-a"]);
  assert.equal(saved.confirmedAnswerOptionId, "stable-option-b");
  assert.equal(saved.originalContent.questionText, "What is two plus two?");
  assert.equal(saved.reviewHistory[0].reviewer, LECTURER);
  assert.equal(saved.reviewHistory[0].action, "edited");
});

test("approval requires explicit correct-answer confirmation and creates one approved question", async () => {
  const app = buildApp(LECTURER, "lecturer");
  const missingAnswer = await request(app)
    .post(`/api/question-extractions/${BATCH_ID}/drafts/${DRAFT_A}/approve`);
  assert.equal(missingAnswer.status, 400);
  assert.equal(questions.size, 0);

  await request(app)
    .patch(`/api/question-extractions/${BATCH_ID}/drafts/${DRAFT_A}`)
    .send({
      confirmedAnswerOptionId: "stable-option-b",
      confirmCorrectAnswer: true
    })
    .expect(200);
  const approved = await request(app)
    .post(`/api/question-extractions/${BATCH_ID}/drafts/${DRAFT_A}/approve`);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(questions.size, 1);
  const question = [...questions.values()][0];
  assert.equal(question.approvalStatus, "approved");
  assert.equal(question.answer, "4");
  assert.equal(question.questionNumber, "1");
  assert.deepEqual(question.optionIds, ["stable-option-a", "stable-option-b"]);
  assert.equal(question.extractionBatchId, BATCH_ID);
  const reviewedDraft = records.get(BATCH_ID).drafts[0];
  assert.equal(reviewedDraft.reviewStatus, "approved");
  assert.equal(reviewedDraft.reviewHistory.at(-1).action, "approved");
  assert.equal(reviewedDraft.reviewer, LECTURER);
});

test("duplicate and concurrent approval requests do not create duplicate questions", async () => {
  const app = buildApp(LECTURER, "lecturer");
  await request(app)
    .patch(`/api/question-extractions/${BATCH_ID}/drafts/${DRAFT_A}`)
    .send({ confirmedAnswerOptionId: "stable-option-b", confirmCorrectAnswer: true })
    .expect(200);
  const url = `/api/question-extractions/${BATCH_ID}/drafts/${DRAFT_A}/approve`;
  const results = await Promise.all([request(app).post(url), request(app).post(url)]);
  assert.ok(results.some((response) => response.status === 200));
  assert.ok(results.every((response) => [200, 409].includes(response.status)));
  assert.equal((await request(app).post(url)).status, 200);
  assert.equal(questions.size, 1);
  assert.equal(records.get(BATCH_ID).drafts[0].reviewHistory.filter((entry) => entry.action === "approved").length, 1);
});

test("individual rejection records its reason and leaves the draft out of the question bank", async () => {
  const response = await request(buildApp(LECTURER, "lecturer"))
    .post(`/api/question-extractions/${BATCH_ID}/drafts/${DRAFT_A}/reject`)
    .send({ reason: "The image is unclear." });
  assert.equal(response.status, 200);
  assert.equal(records.get(BATCH_ID).drafts[0].reviewStatus, "rejected");
  assert.equal(records.get(BATCH_ID).drafts[0].rejectionReason, "The image is unclear.");
  assert.equal(records.get(BATCH_ID).drafts[0].reviewHistory[0].action, "rejected");
  assert.equal(questions.size, 0);
  assert.equal((await request(buildApp(LECTURER, "lecturer"))
    .post(`/api/question-extractions/${BATCH_ID}/drafts/${DRAFT_A}/approve`)).status, 409);
});

test("selective batch approval reports each result and never approves unselected or invalid drafts", async () => {
  records.set(BATCH_ID, seedBatch([makeDraft(DRAFT_A), makeDraft(DRAFT_B, {
    questionText: "Another question?",
    topic: "Algebra"
  })]));
  const app = buildApp(LECTURER, "lecturer");
  await request(app)
    .patch(`/api/question-extractions/${BATCH_ID}/drafts/${DRAFT_A}`)
    .send({ confirmedAnswerOptionId: "stable-option-a", confirmCorrectAnswer: true })
    .expect(200);
  const response = await request(app)
    .post(`/api/question-extractions/${BATCH_ID}/review-selected`)
    .send({ action: "approve", draftIds: [DRAFT_A, DRAFT_B] });
  assert.equal(response.status, 200);
  assert.equal(response.body.success, false);
  assert.deepEqual(response.body.results.map((result) => result.success), [true, false]);
  assert.equal(records.get(BATCH_ID).drafts[0].reviewStatus, "approved");
  assert.equal(records.get(BATCH_ID).drafts[1].reviewStatus, "pending");
  assert.equal(questions.size, 1);
});
