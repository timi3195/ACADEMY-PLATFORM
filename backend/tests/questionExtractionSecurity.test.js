const test = require("node:test");
const { describe, before, beforeEach, after } = test;
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const sharp = require("sharp");
const { Readable } = require("stream");

process.env.JWT_SECRET = process.env.JWT_SECRET || "phase-2-question-extraction-test-secret";
const { generateAccessToken } = require("../utils/token");
const User = require("../models/User");
const Course = require("../models/course");
const PastQuestionPaper = require("../models/PastQuestionPaper");
const QuestionExtraction = require("../models/QuestionExtraction");
const questionAccessService = require("../services/questionAccessService");
const storageService = require("../services/storageService");
const ocrService = require("../services/ocrService");
const questionStructuringService = require("../services/questionStructuringService");
const questionExtractionProcessingService = require("../services/questionExtractionProcessingService");
const imageValidation = require("../services/questionImageValidationService");
const fileRoutes = require("../routes/file");

const USER_A = "507f1f77bcf86cd799439011";
const USER_B = "507f1f77bcf86cd799439012";
const COURSE_ID = "507f1f77bcf86cd799439021";
const OTHER_COURSE_ID = "507f1f77bcf86cd799439022";
const PAPER_ID = "507f1f77bcf86cd799439023";
const BATCH_OBJECT_ID = "507f1f77bcf86cd799439031";
let databaseUser;
let courseAllowed = true;
let sourcePaperRecord;
let records;
let storedImages;
let ocrImplementation;
let structuringImplementation;
const originals = {};

questionAccessService.getCourseAccess = async (userId, courseId) => ({
  allowed: courseAllowed,
  manager: courseAllowed,
  statusCode: courseAllowed ? 200 : 403,
  message: courseAllowed ? "" : "Course assignment required.",
  course: { _id: courseId, department: "507f1f77bcf86cd799439099", level: "ND1", semester: "First" }
});

const extractionRoute = require("../routes/questionExtraction");

const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "test";
const mountedApp = require("../app");
if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = originalNodeEnv;

const asQuery = (value) => ({
  select() { return this; },
  sort() { return this; },
  skip() { return this; },
  limit() { return this; },
  lean: async () => value
});

const cloneValue = (value) => {
  if (value instanceof Date) return new Date(value);
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") {
    if (value._bsontype === "ObjectId") return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => typeof item !== "function")
      .map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
};

const cloneBatch = (batch) => {
  const copy = cloneValue(batch);
  copy.toObject = () => cloneValue(copy);
  return copy;
};

const setupMocks = () => {
  records = new Map();
  storedImages = new Map();
  databaseUser = { role: "admin" };
  courseAllowed = true;
  sourcePaperRecord = null;
  ocrImplementation = async (images, onPageResult) => {
    const results = [];
    for (const image of images) {
      const result = {
        imageId: image.imageId,
        text: "1. What is two plus two? A. 3 B. 4",
        confidence: 92,
        provider: "tesseract.js",
        version: "test",
        error: null
      };
      results.push(result);
      await onPageResult(result);
    }
    return results;
  };
  structuringImplementation = async ({ pages }) => ({
    drafts: pages.map((page) => ({
      questionNumber: "1",
      questionText: "What is two plus two?",
      options: [{ label: "A", text: "3" }, { label: "B", text: "4" }],
      possibleAnswer: "",
      answerStatus: "unconfirmed",
      sourceImage: page.imageId,
      sourcePage: page.pageNumber,
      reviewStatus: "pending",
      extractionWarnings: []
    })),
    provider: "gemini",
    model: "test-model",
    warnings: []
  });

  User.findById = () => ({
    select() {
      return { lean: async () => databaseUser };
    }
  });
  Course.find = () => asQuery([{ _id: COURSE_ID, title: "Test course", code: "TST", level: "ND1", semester: "First" }]);
  PastQuestionPaper.findById = async (id) =>
    sourcePaperRecord && String(sourcePaperRecord._id) === String(id)
      ? sourcePaperRecord
      : null;
  PastQuestionPaper.find = (query) => asQuery(
    sourcePaperRecord &&
    String(sourcePaperRecord.course) === String(query.course) &&
    String(sourcePaperRecord.department) === String(query.department) &&
    sourcePaperRecord.level === query.level &&
    sourcePaperRecord.semester === query.semester
      ? [sourcePaperRecord]
      : []
  );
  QuestionExtraction.countDocuments = async () => records.size;
  QuestionExtraction.create = async (input) => {
    const batch = {
      ...input,
      _id: BATCH_OBJECT_ID,
      processingErrors: [],
      drafts: [],
      retryCount: 0,
      processingAttemptCount: 0,
      save: async function save() {
        records.set(this.batchId, this);
        return this;
      }
    };
    records.set(batch.batchId, batch);
    return batch;
  };
  QuestionExtraction.findOneAndUpdate = async (filter, update) => {
    const batch = filter.batchId
      ? records.get(filter.batchId)
      : [...records.values()].find((item) => String(item._id) === String(filter._id));
    if (!batch) return null;
    const claimable = (filter.$or || []).some((condition) => {
      if (Array.isArray(condition.status?.$in)) {
        return condition.status.$in.includes(batch.status) &&
          (!condition.processingLockUntil?.$lte ||
            (batch.processingLockUntil &&
              batch.processingLockUntil <= condition.processingLockUntil.$lte));
      }
      return condition.status === "processing" &&
        batch.status === "processing" &&
        batch.processingLockUntil &&
        batch.processingLockUntil <= condition.processingLockUntil.$lte;
    });
    if (!claimable || (filter.retryCount && batch.retryCount >= filter.retryCount.$lt)) return null;
    Object.assign(batch, update.$set || {});
    for (const [field, increment] of Object.entries(update.$inc || {})) {
      batch[field] = Number(batch[field] || 0) + increment;
    }
    return cloneBatch(batch);
  };
  QuestionExtraction.updateOne = async (filter, update) => {
    const batch = [...records.values()].find((item) =>
      String(item._id) === String(filter._id)
    );
    if (!batch || batch.processingLockToken !== filter.processingLockToken) {
      return { matchedCount: 0 };
    }
    Object.assign(batch, cloneValue(update.$set || {}));
    return { matchedCount: 1 };
  };
  QuestionExtraction.findOne = async (filter) => {
    const batch = records.get(filter.batchId);
    if (!batch) return null;
    if (filter.processingLockToken && batch.processingLockToken !== filter.processingLockToken) return null;
    return cloneBatch(batch);
  };
  QuestionExtraction.find = () => asQuery([...records.values()]);

  storageService.storePrivateQuestionImage = async ({ buffer, batchId, imageId, extension, mimeType }) => {
    const storageFilename = `question-extractions/${batchId}/${imageId}.${extension}`;
    storedImages.set(storageFilename, buffer);
    return {
      storageProvider: "local-disk",
      storageFilename,
      storageKey: "",
      mimeType,
      size: buffer.length,
      storageStatus: "pending"
    };
  };
  storageService.getObjectReadStream = async (image) => {
    const content = storedImages.get(image.storageFilename);
    if (!content) throw new Error("Missing test image");
    return Readable.from([content]);
  };
  storageService.deleteObject = async (image) => storedImages.delete(image.storageFilename);
  ocrService.recognizeImages = (...args) => ocrImplementation(...args);
  ocrService.getProviderInfo = () => ({ provider: "tesseract.js", version: "test", language: "eng" });
  questionStructuringService.structureQuestionDrafts = (...args) => structuringImplementation(...args);
};

const buildApp = (identity = USER_A, role = "admin") => {
  const app = express();
  const token = generateAccessToken(identity, { role });
  app.use((req, res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    next();
  });
  app.use(express.json());
  app.use("/api/question-extractions", extractionRoute);
  return app;
};

const png = async () => sharp({
  create: { width: 120, height: 120, channels: 3, background: { r: 255, g: 255, b: 255 } }
}).png().toBuffer();

let processingToken = 0;
const processQueuedBatchForTest = async (batchId) => {
  const stored = records.get(batchId);
  if (!stored) throw new Error("Queued extraction batch was not persisted.");
  const token = `test-processing-token-${++processingToken}`;
  const stage = stored.processingStage && stored.processingStage !== "none"
    ? stored.processingStage
    : stored.images.some((image) => image.ocrStatus !== "succeeded") ? "ocr" : "structuring";
  stored.status = "processing";
  stored.processingStage = stage;
  stored.processingLockToken = token;
  stored.processingLockUntil = new Date(Date.now() + 60_000);
  stored.processingAttemptCount = Number(stored.processingAttemptCount || 0) + 1;
  await questionExtractionProcessingService.processClaimedBatch({
    batch: cloneBatch(stored),
    token,
    stage
  });
  return cloneBatch(records.get(batchId));
};

const uploadImages = async (
  app,
  images = [{ name: "page-one.png", buffer: null }],
  sourcePaperId,
  { processAfterUpload = true } = {}
) => {
  let call = request(app).post("/api/question-extractions")
    .field("courseId", COURSE_ID)
    .field("academicSession", "2025/2026")
    .field("sourceExamYear", "2025")
    .field("userId", USER_B)
    .field("role", "admin");
  if (sourcePaperId) call = call.field("sourcePaperId", sourcePaperId);
  for (const image of images) {
    call = call.attach("images", image.buffer, { filename: image.name, contentType: image.type || "image/png" });
  }
  const response = await call;
  if (processAfterUpload && response.status === 202) {
    await processQueuedBatchForTest(response.body.batch.batchId);
    const refreshed = await request(app)
      .get(`/api/question-extractions/${response.body.batch.batchId}`);
    response.body.batch = refreshed.body.batch;
  }
  return response;
};

const processQueuedRetryForTest = async (response) => {
  if (response.status === 202 && response.body.batch?.batchId) {
    response.body.batch = await processQueuedBatchForTest(response.body.batch.batchId);
  }
  return response;
};

describe("question extraction security", { concurrency: false }, () => {
before(() => {
  originals.userFindById = User.findById;
  originals.paperFindById = PastQuestionPaper.findById;
  originals.paperFind = PastQuestionPaper.find;
  originals.courseFind = Course.find;
  originals.countDocuments = QuestionExtraction.countDocuments;
  originals.create = QuestionExtraction.create;
  originals.findOneAndUpdate = QuestionExtraction.findOneAndUpdate;
  originals.updateOne = QuestionExtraction.updateOne;
  originals.findOne = QuestionExtraction.findOne;
  originals.find = QuestionExtraction.find;
  originals.storePrivateQuestionImage = storageService.storePrivateQuestionImage;
  originals.getObjectReadStream = storageService.getObjectReadStream;
  originals.deleteObject = storageService.deleteObject;
  originals.recognizeImages = ocrService.recognizeImages;
  originals.getProviderInfo = ocrService.getProviderInfo;
  originals.structureQuestionDrafts = questionStructuringService.structureQuestionDrafts;
});

beforeEach(setupMocks);

after(() => {
  User.findById = originals.userFindById;
  PastQuestionPaper.findById = originals.paperFindById;
  PastQuestionPaper.find = originals.paperFind;
  Course.find = originals.courseFind;
  QuestionExtraction.countDocuments = originals.countDocuments;
  QuestionExtraction.create = originals.create;
  QuestionExtraction.findOneAndUpdate = originals.findOneAndUpdate;
  QuestionExtraction.updateOne = originals.updateOne;
  QuestionExtraction.findOne = originals.findOne;
  QuestionExtraction.find = originals.find;
  storageService.storePrivateQuestionImage = originals.storePrivateQuestionImage;
  storageService.getObjectReadStream = originals.getObjectReadStream;
  storageService.deleteObject = originals.deleteObject;
  ocrService.recognizeImages = originals.recognizeImages;
  ocrService.getProviderInfo = originals.getProviderInfo;
  questionStructuringService.structureQuestionDrafts = originals.structureQuestionDrafts;
});

test("unauthenticated extraction upload is rejected", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/question-extractions", extractionRoute);
  const response = await request(app).post("/api/question-extractions");
  assert.equal(response.status, 401);
});

test("the extraction router is mounted under the protected API prefix", async () => {
  const token = generateAccessToken(USER_A, { role: "admin" });
  const response = await request(mountedApp)
    .get("/api/question-extractions/limits")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.limits.maxImages, imageValidation.MAX_IMAGE_COUNT);
});

test("daily upload rate limit is checked before accepting image data", async () => {
  QuestionExtraction.countDocuments = async () => 10;
  const response = await request(buildApp())
    .post("/api/question-extractions")
    .field("courseId", COURSE_ID)
    .field("academicSession", "2025/2026");
  assert.equal(response.status, 429);
});

test("upload returns accepted and persists a queued batch without running OCR", async () => {
  let ocrCalls = 0;
  ocrImplementation = async () => {
    ocrCalls += 1;
    return [];
  };
  const response = await uploadImages(
    buildApp(),
    [{ name: "page.png", buffer: await png() }],
    undefined,
    { processAfterUpload: false }
  );
  assert.equal(response.status, 202);
  assert.equal(response.body.batch.status, "queued");
  assert.equal(ocrCalls, 0);
  assert.equal(records.get(response.body.batch.batchId).status, "queued");
});

test("students cannot upload or view unapproved extraction batches", async () => {
  databaseUser = { role: "student" };
  const response = await uploadImages(buildApp(USER_A, "admin"), [{ name: "page.png", buffer: await png() }]);
  assert.equal(response.status, 403);
  assert.equal(records.size, 0);
});

test("a student role from the database cannot read an existing unapproved batch", async () => {
  const uploaded = await uploadImages(buildApp(), [{ name: "private.png", buffer: await png() }]);
  databaseUser = { role: "student" };
  const response = await request(buildApp(USER_A, "admin"))
    .get(`/api/question-extractions/${uploaded.body.batch.batchId}`);
  assert.equal(response.status, 403);
});

test("uploads are rejected when the administrator lacks course access", async () => {
  courseAllowed = false;
  const response = await uploadImages(buildApp(), [{ name: "page.png", buffer: await png() }]);
  assert.equal(response.status, 403);
  assert.equal(records.size, 0);
  assert.equal(storedImages.size, 0);
});

test("lecturers cannot upload extraction batches", async () => {
  databaseUser = { role: "lecturer", lecturerStatus: "approved" };
  const response = await uploadImages(
    buildApp(USER_A, "lecturer"),
    [{ name: "page.png", buffer: await png() }]
  );
  assert.equal(response.status, 403);
  assert.equal(records.size, 0);
  assert.equal(storedImages.size, 0);
});

test("administrators can upload multiple valid images into a private unapproved batch", async () => {
  const first = await png();
  const second = await png();
  const response = await uploadImages(buildApp(), [
    { name: "page-one.png", buffer: first },
    { name: "page-two.png", buffer: second }
  ]);
  assert.equal(response.status, 202, JSON.stringify(response.body));
  assert.equal(response.body.batch.status, "needs_review");
  assert.equal(response.body.batch.imageCount, 2);
  assert.equal(response.body.batch.questionCount, 2);
  assert.equal(response.body.batch.reviewStatus, "pending");
  assert.equal(response.body.batch.images[0].previewUrl.includes("/uploads/"), false);
  assert.equal("storageFilename" in response.body.batch.images[0], false);
  assert.equal("storageKey" in response.body.batch.images[0], false);
  assert.equal(records.get(response.body.batch.batchId).uploadedBy, USER_A);
  assert.equal(records.size, 1);
});

test("administrators can associate an extraction batch with its uploaded source paper", async () => {
  sourcePaperRecord = {
    _id: PAPER_ID,
    title: "Test course 2025 past questions",
    course: COURSE_ID,
    department: "507f1f77bcf86cd799439099",
    level: "ND1",
    semester: "First",
    examinationYear: "2025",
    storageKey: "must-not-be-returned"
  };

  const response = await uploadImages(
    buildApp(),
    [{ name: "page-one.png", buffer: await png() }],
    PAPER_ID
  );
  assert.equal(response.status, 202, JSON.stringify(response.body));
  assert.equal(response.body.batch.sourcePaper, PAPER_ID);
  assert.deepEqual(response.body.batch.sourcePaperMetadata, {
    title: "Test course 2025 past questions",
    examinationYear: "2025",
    level: "ND1",
    semester: "First"
  });
  assert.equal(response.body.batch.sourceExamYear, "2025");
  assert.equal(response.body.batch.academicSession, "2025/2026");
  assert.equal(JSON.stringify(response.body).includes("must-not-be-returned"), false);
});

test("source-paper lookup is course-scoped and returns no storage credentials", async () => {
  sourcePaperRecord = {
    _id: PAPER_ID,
    title: "Test course 2025 past questions",
    course: COURSE_ID,
    department: "507f1f77bcf86cd799439099",
    level: "ND1",
    semester: "First",
    examinationYear: "2025",
    storageKey: "must-not-be-returned"
  };

  const response = await request(buildApp())
    .get(`/api/question-extractions/source-papers?courseId=${COURSE_ID}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.papers, [{
    _id: PAPER_ID,
    title: "Test course 2025 past questions",
    examinationYear: "2025",
    level: "ND1",
    semester: "First"
  }]);
  assert.equal(JSON.stringify(response.body).includes("storageKey"), false);
});

test("source-paper lookup is rejected when course access is unavailable", async () => {
  courseAllowed = false;
  const response = await request(buildApp())
    .get(`/api/question-extractions/source-papers?courseId=${COURSE_ID}`);
  assert.equal(response.status, 403);
});

test("source papers from another course are rejected before storing images", async () => {
  sourcePaperRecord = {
    _id: PAPER_ID,
    title: "Other course paper",
    course: OTHER_COURSE_ID,
    department: "507f1f77bcf86cd799439099",
    level: "ND1",
    semester: "First",
    examinationYear: "2025"
  };

  const response = await uploadImages(
    buildApp(),
    [{ name: "page-one.png", buffer: await png() }],
    PAPER_ID
  );
  assert.equal(response.status, 400);
  assert.match(response.body.message, /source paper must belong to the selected course/i);
  assert.equal(records.size, 0);
  assert.equal(storedImages.size, 0);
});

test("a conflicting source examination year is rejected before storing images", async () => {
  sourcePaperRecord = {
    _id: PAPER_ID,
    title: "Test course 2024 past questions",
    course: COURSE_ID,
    department: "507f1f77bcf86cd799439099",
    level: "ND1",
    semester: "First",
    examinationYear: "2024"
  };

  const response = await uploadImages(
    buildApp(),
    [{ name: "page-one.png", buffer: await png() }],
    PAPER_ID
  );
  assert.equal(response.status, 400);
  assert.match(response.body.message, /year must match/i);
  assert.equal(records.size, 0);
  assert.equal(storedImages.size, 0);
});

test("invalid MIME, disguised signatures, corrupt images, excessive size, and traversal names are rejected", async () => {
  const image = await png();
  await assert.rejects(imageValidation.validateImage({
    originalname: "page.png", mimetype: "image/jpeg", buffer: image, size: image.length
  }), /matching MIME/);
  await assert.rejects(imageValidation.validateImage({
    originalname: "page.png", mimetype: "image/png", buffer: Buffer.from("not an image"), size: 12
  }), /corrupted|signature/i);
  await assert.rejects(imageValidation.validateImage({
    originalname: "page.png", mimetype: "image/png", buffer: Buffer.alloc(imageValidation.MAX_IMAGE_BYTES + 1), size: imageValidation.MAX_IMAGE_BYTES + 1
  }), /no larger than/i);
  await assert.rejects(imageValidation.validateImage({
    originalname: "..\\private.png", mimetype: "image/png", buffer: image, size: image.length
  }), /safely named/i);
});

test("batch image-count, total-byte, and decoded-pixel limits are enforced", () => {
  assert.throws(() => imageValidation.validateBatch(
    Array.from({ length: imageValidation.MAX_IMAGE_COUNT + 1 }, () => ({ size: 1 }))
  ), /images per batch/);
  assert.throws(() => imageValidation.validateBatch([
    { size: imageValidation.MAX_BATCH_BYTES + 1 }
  ]), /total image batch/);
  assert.throws(() => imageValidation.validateBatchPixels([
    { width: imageValidation.MAX_BATCH_PIXELS, height: 2 }
  ]), /decoded image size/);
});

test("students cannot read another user's extraction or original image", async () => {
  const response = await uploadImages(buildApp(), [{ name: "private.png", buffer: await png() }]);
  const batch = response.body.batch;
  courseAllowed = false;
  const crossUserApp = buildApp(USER_B, "admin");
  const details = await request(crossUserApp).get(`/api/question-extractions/${batch.batchId}`);
  const original = await request(crossUserApp).get(batch.images[0].previewUrl);
  assert.equal(details.status, 403);
  assert.equal(original.status, 403);
});

test("administrator authorization is derived from the database user record", async () => {
  databaseUser = { role: "admin" };
  const response = await uploadImages(buildApp(USER_A, "student"), [{ name: "page.png", buffer: await png() }]);
  assert.equal(response.status, 202);
  assert.equal(response.body.batch.status, "needs_review");
});

test("authorized uploader retrieves original privately through protected image route", async () => {
  const response = await uploadImages(buildApp(), [{ name: "private.png", buffer: await png() }]);
  const imageResponse = await request(buildApp()).get(response.body.batch.images[0].previewUrl);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers["cache-control"], "private, no-store");
  assert.equal(imageResponse.headers["x-content-type-options"], "nosniff");
  assert.equal(imageResponse.headers["content-type"], "image/png");
});

test("private extraction images are not served through legacy /uploads paths", async () => {
  const uploaded = await uploadImages(buildApp(), [{ name: "private.png", buffer: await png() }]);
  const app = express();
  app.use("/uploads", fileRoutes.legacyUploadsRouter);
  const image = records.get(uploaded.body.batch.batchId).images[0];
  const response = await request(app).get(`/uploads/${image.storageFilename}`);
  assert.equal(response.status, 404);
});

test("Gemini failure preserves OCR text and permits structuring-only retry", async () => {
  let ocrCalls = 0;
  const loggedErrors = [];
  ocrImplementation = async (images, onPageResult) => {
    ocrCalls += 1;
    const result = { imageId: images[0].imageId, text: "1. Read source text", confidence: 88, provider: "tesseract.js", version: "test" };
    await onPageResult(result);
    return [result];
  };
  structuringImplementation = async ({ pages }) => {
    assert.ok([...records.values()].some((batch) =>
      batch.images.some((image) => image.ocrText === pages[0].text)
    ), "OCR text must be persisted before structuring starts");
    const error = new Error("provider response details must not be logged");
    error.code = "AI_RATE_LIMITED";
    error.statusCode = 429;
    error.providerStatus = 429;
    throw error;
  };
  const originalConsoleError = console.error;
  console.error = (...args) => loggedErrors.push(args);
  let response;
  try {
    response = await uploadImages(buildApp(), [{ name: "page.png", buffer: await png() }]);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(response.body.batch.status, "partially_failed");
  assert.match(response.body.batch.ocrText, /Read source text/);
  assert.equal(response.body.batch.drafts.length, 0);
  assert.equal(response.body.batch.processingErrors[0].category, "rate_limit");
  assert.match(response.body.batch.processingErrors[0].message, /wait before retrying/i);
  assert.match(records.get(response.body.batch.batchId).images[0].ocrText, /Read source text/);
  assert.equal(loggedErrors.length, 1);
  const diagnostic = JSON.parse(loggedErrors[0][1]);
  assert.equal(diagnostic.stage, "structuring");
  assert.equal(diagnostic.category, "rate_limit");
  assert.equal(diagnostic.providerStatus, 429);
  assert.doesNotMatch(JSON.stringify(diagnostic), /provider response details|Read source text|USER_A/);

  structuringImplementation = async () => ({ drafts: [], provider: "gemini", model: "test-model", warnings: [] });
  const queuedRetry = await request(buildApp())
    .post(`/api/question-extractions/${response.body.batch.batchId}/retry`)
    .send({ stage: "structuring" });
  assert.equal(queuedRetry.status, 202);
  assert.equal(queuedRetry.body.batch.status, "queued");
  assert.equal(ocrCalls, 1);
  const retried = await processQueuedRetryForTest(queuedRetry);
  assert.equal(retried.body.batch.status, "needs_review");
  assert.equal(ocrCalls, 1);
});

test("successful structuring chunks persist through a partial failure and retry without duplicates", async () => {
  const completedChunkKey = "completed-test-chunk";
  const observedCompletedKeys = [];
  let structuringCalls = 0;
  structuringImplementation = async ({ pages, completedChunkKeys, onChunkSuccess }) => {
    structuringCalls += 1;
    observedCompletedKeys.push([...completedChunkKeys]);
    const draft = {
      questionNumber: "1",
      questionText: "What is two plus two?",
      options: [{ label: "A", text: "3" }, { label: "B", text: "4" }],
      answerStatus: "unconfirmed",
      sourceImage: pages[0].imageId,
      sourcePage: pages[0].pageNumber,
      reviewStatus: "pending",
      extractionWarnings: []
    };
    const alreadyCompleted = completedChunkKeys.includes(completedChunkKey);
    if (!alreadyCompleted) {
      await onChunkSuccess({
        chunkKey: completedChunkKey,
        drafts: [draft],
        warnings: ["Review OCR wording."],
        provider: "gemini",
        model: "test-model"
      });
    }
    return {
      drafts: [draft],
      completedChunkKeys: alreadyCompleted ? [] : [completedChunkKey],
      failures: alreadyCompleted ? [] : [{
        category: "provider_unavailable",
        providerStatus: 503,
        chunkIndex: 2,
        message: "The Gemini service could not complete this section."
      }],
      provider: "gemini",
      model: "test-model",
      warnings: []
    };
  };
  const originalConsoleError = console.error;
  console.error = () => {};
  let uploaded;
  try {
    uploaded = await uploadImages(buildApp(), [{ name: "page.png", buffer: await png() }]);
  } finally {
    console.error = originalConsoleError;
  }

  const batchId = uploaded.body.batch.batchId;
  const initialBatch = records.get(batchId);
  assert.equal(uploaded.body.batch.status, "partially_failed");
  assert.equal(initialBatch.structuringCompletedChunks.length, 1);
  assert.equal(initialBatch.drafts.length, 1);
  assert.equal(initialBatch.processingErrors[0].category, "provider_unavailable");
  assert.equal(initialBatch.images[0].ocrText, "1. What is two plus two? A. 3 B. 4");

  const retried = await processQueuedRetryForTest(await request(buildApp())
    .post(`/api/question-extractions/${batchId}/retry`)
    .send({ stage: "structuring" }));
  assert.equal(retried.status, 202);
  assert.equal(retried.body.batch.status, "needs_review");
  assert.equal(records.get(batchId).drafts.length, 1);
  assert.deepEqual(observedCompletedKeys[1], [completedChunkKey]);
  assert.equal(structuringCalls, 2);
});

test("persisted processing leases can be retried after a server interruption", async () => {
  let ocrCalls = 0;
  ocrImplementation = async (images, onPageResult) => {
    ocrCalls += 1;
    const result = { imageId: images[0].imageId, text: "Question text persisted before interruption", confidence: 90, provider: "tesseract.js", version: "test" };
    await onPageResult(result);
    return [result];
  };
  const response = await uploadImages(buildApp(), [{ name: "page.png", buffer: await png() }]);
  const persistedBatch = records.get(response.body.batch.batchId);
  persistedBatch.status = "processing";
  persistedBatch.processingStage = "structuring";
  persistedBatch.processingLockUntil = new Date(Date.now() - 1000);

  const retried = await processQueuedRetryForTest(await request(buildApp())
    .post(`/api/question-extractions/${persistedBatch.batchId}/retry`)
    .send({ stage: "structuring" }));
  assert.equal(retried.status, 202);
  assert.equal(retried.body.batch.status, "needs_review");
  assert.equal(ocrCalls, 1);
  assert.match(retried.body.batch.ocrText, /persisted before interruption/);
});

test("concurrent users cannot process one extraction batch twice", async () => {
  let structuringCalls = 0;
  let signalStarted;
  let releaseProcessing;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const hold = new Promise((resolve) => { releaseProcessing = resolve; });
  structuringImplementation = async ({ pages }) => {
    structuringCalls += 1;
    if (structuringCalls === 1) throw new Error("Initial Gemini failure");
    signalStarted();
    await hold;
    return {
      drafts: [{
        questionText: "Source-supported draft",
        options: [],
        answerStatus: "unconfirmed",
        reviewStatus: "pending"
      }],
      provider: "gemini",
      model: "test-model",
      warnings: []
    };
  };

  const uploaded = await uploadImages(buildApp(), [{ name: "page.png", buffer: await png() }]);
  const batchId = uploaded.body.batch.batchId;
  assert.equal(uploaded.body.batch.status, "partially_failed");
  databaseUser = { role: "admin" };

  const firstRetry = await request(buildApp(USER_A, "admin"))
    .post(`/api/question-extractions/${batchId}/retry`)
    .send({ stage: "structuring" });
  assert.equal(firstRetry.status, 202);
  const firstProcessing = processQueuedBatchForTest(batchId);
  await started;
  const secondRetry = await request(buildApp(USER_B, "admin"))
    .post(`/api/question-extractions/${batchId}/retry`)
    .send({ stage: "structuring" });
  assert.equal(secondRetry.status, 409);

  releaseProcessing();
  await firstProcessing;
  assert.equal(structuringCalls, 2);
  assert.equal(records.get(batchId).drafts.length, 1);
});

test("an expired worker lease cannot overwrite drafts from a newer retry", async () => {
  let structuringCalls = 0;
  let signalOldAttempt;
  let releaseOldAttempt;
  const oldAttemptStarted = new Promise((resolve) => { signalOldAttempt = resolve; });
  const holdOldAttempt = new Promise((resolve) => { releaseOldAttempt = resolve; });
  structuringImplementation = async () => {
    structuringCalls += 1;
    if (structuringCalls === 1) throw new Error("Initial Gemini failure");
    if (structuringCalls === 2) {
      signalOldAttempt();
      await holdOldAttempt;
      return {
        drafts: [{ questionText: "Stale draft", options: [], reviewStatus: "pending" }],
        provider: "gemini",
        model: "stale",
        warnings: []
      };
    }
    return {
      drafts: [{ questionText: "Newer draft", options: [], reviewStatus: "pending" }],
      provider: "gemini",
      model: "newer",
      warnings: []
    };
  };

  const uploaded = await uploadImages(buildApp(), [{ name: "page.png", buffer: await png() }]);
  const batchId = uploaded.body.batch.batchId;
  databaseUser = { role: "admin" };
  const staleRetry = await request(buildApp(USER_A, "admin"))
    .post(`/api/question-extractions/${batchId}/retry`)
    .send({ stage: "structuring" });
  assert.equal(staleRetry.status, 202);
  const staleProcessing = processQueuedBatchForTest(batchId);
  await oldAttemptStarted;

  records.get(batchId).processingLockUntil = new Date(Date.now() - 1000);
  const newerRetry = await request(buildApp(USER_B, "admin"))
    .post(`/api/question-extractions/${batchId}/retry`)
    .send({ stage: "structuring" });
  assert.equal(newerRetry.status, 202);
  const newerProcessing = await processQueuedBatchForTest(batchId);
  assert.equal(newerProcessing.drafts[0].questionText, "Newer draft");

  releaseOldAttempt();
  await assert.rejects(staleProcessing, (error) => error.code === "EXTRACTION_PROCESSING_LEASE_LOST");
  assert.equal(records.get(batchId).drafts[0].questionText, "Newer draft");
  assert.equal(structuringCalls, 3);
});

test("OCR failures remain retryable and successful retry preserves the original image", async () => {
  ocrImplementation = async (images, onPageResult) => {
    const result = { imageId: images[0].imageId, text: "", confidence: null, provider: "tesseract.js", version: "test", error: "unreadable" };
    await onPageResult(result);
    return [result];
  };
  const response = await uploadImages(buildApp(), [{ name: "page.png", buffer: await png() }]);
  assert.equal(response.body.batch.status, "failed");
  assert.equal(response.body.batch.images.length, 1);

  ocrImplementation = async (images, onPageResult) => {
    const result = { imageId: images[0].imageId, text: "Question OCR text", confidence: 90, provider: "tesseract.js", version: "test" };
    await onPageResult(result);
    return [result];
  };
  const retried = await processQueuedRetryForTest(await request(buildApp())
    .post(`/api/question-extractions/${response.body.batch.batchId}/retry`)
    .send({ stage: "ocr" }));
  assert.equal(retried.status, 202);
  assert.equal(retried.body.batch.status, "needs_review");
  assert.match(retried.body.batch.ocrText, /Question OCR text/);
  assert.equal(storedImages.size, 1);
});

test("OCR image failures remain queued for explicit retry with their original image", async () => {
  ocrImplementation = async (images, onPageResult) => {
    const result = {
      imageId: images[0].imageId,
      text: "",
      confidence: null,
      provider: "tesseract.js",
      version: "test",
      error: "unreadable"
    };
    await onPageResult(result);
    return [result];
  };
  const uploaded = await uploadImages(buildApp(), [{ name: "page.png", buffer: await png() }]);
  assert.equal(uploaded.body.batch.status, "failed");

  ocrImplementation = async (images, onPageResult) => {
    const result = {
      imageId: images[0].imageId,
      text: "Readable source text",
      confidence: 90,
      provider: "tesseract.js",
      version: "test"
    };
    await onPageResult(result);
    return [result];
  };
  const retried = await processQueuedRetryForTest(await request(buildApp())
    .post(`/api/question-extractions/${uploaded.body.batch.batchId}/retry`)
    .send({}));
  assert.equal(retried.status, 202);
  assert.equal(retried.body.batch.status, "needs_review");
});

test("real Tesseract reads PNG and JPEG, persists OCR before Gemini failure, and retries structuring only", {
  skip: process.env.RUN_REAL_OCR_TESTS !== "1"
}, async () => {
  const realRecognizeImages = originals.recognizeImages;
  let ocrCalls = 0;
  ocrService.recognizeImages = (...args) => {
    ocrCalls += 1;
    return realRecognizeImages(...args);
  };
  structuringImplementation = async ({ pages }) => {
    const batch = [...records.values()][0];
    assert.ok(batch.images.every((image) => image.ocrStatus === "succeeded"));
    assert.ok(batch.images.every((image) => image.ocrText.trim()));
    assert.ok(pages.every((page) => page.text === batch.images.find((image) =>
      String(image._id) === page.imageId
    ).ocrText));
    throw new Error("Gemini quota exceeded");
  };

  const makeImage = (source, format) => sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="420"><rect width="100%" height="100%" fill="white"/><text x="80" y="150" font-family="Arial,sans-serif" font-size="72" fill="black">LOCAL OCR VALIDATION</text><text x="80" y="280" font-family="Arial,sans-serif" font-size="64" fill="black">${source}</text></svg>`
  ))[format]().toBuffer();
  const pngImage = await makeImage("PNG SOURCE 2026", "png");
  const jpegImage = await makeImage("JPEG SOURCE 2026", "jpeg");
  const response = await uploadImages(buildApp(), [
    { name: "source.png", buffer: pngImage },
    { name: "source.jpg", type: "image/jpeg", buffer: jpegImage }
  ]);
  assert.equal(response.status, 202);
  assert.equal(response.body.batch.status, "partially_failed");
  assert.match(response.body.batch.images[0].ocrStatus, /succeeded/);
  assert.match(response.body.batch.images[1].ocrStatus, /succeeded/);
  assert.match(response.body.batch.ocrText, /PNG SOURCE/);
  assert.match(response.body.batch.ocrText, /JPEG SOURCE/);
  assert.match(response.body.batch.processingErrors[0].message, /structuring/i);

  structuringImplementation = async () => ({
    drafts: [],
    provider: "gemini",
    model: "test-model",
    warnings: []
  });
  const retry = await processQueuedRetryForTest(await request(buildApp())
    .post(`/api/question-extractions/${response.body.batch.batchId}/retry`)
    .send({ stage: "structuring" }));
  assert.equal(retry.status, 202);
  assert.equal(retry.body.batch.status, "needs_review");
  assert.equal(ocrCalls, 1);
  assert.equal(storedImages.size, 2);
});
});
