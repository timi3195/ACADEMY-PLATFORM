const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const express = require("express");
const request = require("supertest");
const { Readable } = require("node:stream");
const path = require("node:path");

process.env.JWT_SECRET = process.env.JWT_SECRET || "curriculum-private-api-test-secret";
const { generateAccessToken } = require("../utils/token");
const curriculumImportService = require("../services/curriculumImportService");
const curriculumImportController = require("../controllers/curriculumImportController");
const contentRoutes = require("../routes/lecturer");

const USER_ID = "507f1f77bcf86cd799439011";
const importId = "507f1f77bcf86cd799439019";
const originalMethods = {};
for (const method of [
  "listCurriculumImports",
  "getCurriculumImport",
  "createCurriculumImportFromFile",
  "getCurriculumDocumentStream",
  "getCurriculumEntryEvidence",
  "requestCurriculumExtraction",
  "updateCurriculumEntry",
  "reviewCurriculumEntry"
]) {
  originalMethods[method] = curriculumImportService[method];
}

test.afterEach(() => {
  for (const [method, implementation] of Object.entries(originalMethods)) {
    curriculumImportService[method] = implementation;
  }
});

const buildApp = (role) => {
  const app = express();
  app.use(express.json());
  if (role) {
    const token = generateAccessToken(USER_ID, { role });
    app.use((req, _res, next) => {
      req.headers.authorization = `Bearer ${token}`;
      next();
    });
  }
  app.use("/api/admin/content", contentRoutes);
  return app;
};

test("curriculum APIs reject unauthenticated and student requests", async () => {
  const unauthenticated = await request(buildApp()).get("/api/admin/content/curricula");
  assert.equal(unauthenticated.status, 401);

  const student = await request(buildApp("student"))
    .get(`/api/admin/content/curricula/${importId}/document`);
  assert.equal(student.status, 403);
  const studentUpload = await request(buildApp("student"))
    .post("/api/admin/content/curricula")
    .attach("document", Buffer.from("%PDF-1.7"), {
      filename: "curriculum.pdf",
      contentType: "application/pdf"
    });
  assert.equal(studentUpload.status, 403);
});

test("Admin curriculum list and document streaming endpoints work", async () => {
  const record = {
    _id: importId,
    programmeHeading: "Computer Science",
    draftEntries: [{
      title: "Computing",
      sourceEvidence: [{ field: "title", excerpt: "private OCR excerpt", page: 1 }],
      idempotencyKey: "private-key"
    }],
    extractedSegments: [{ text: "private extracted text" }],
    extractionJob: { leaseToken: "private-lease-token" },
    diagnostics: [{
      stage: "extraction",
      code: "OCR_FAILED",
      message: "private worker diagnostic"
    }]
  };
  curriculumImportService.getCurriculumImport = async () =>
    curriculumImportService.serializeCurriculumImport(record);
  curriculumImportService.listCurriculumImports = async () => ({
    imports: [curriculumImportService.serializeCurriculumImport(record)],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 }
  });
  curriculumImportService.getCurriculumDocumentStream = async () => ({
    stream: Readable.from(["private curriculum"]),
    originalFilename: "curriculum.pdf",
    mimeType: "application/pdf",
    size: 18
  });

  const app = buildApp("admin");
  const list = await request(app).get("/api/admin/content/curricula");
  assert.equal(list.status, 200);
  assert.equal(list.body.imports[0].programmeHeading, "Computer Science");
  assert.doesNotMatch(JSON.stringify(list.body), /private OCR excerpt|private extracted text|private-lease-token|private worker diagnostic/);

  const detail = await request(app).get(`/api/admin/content/curricula/${importId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.curriculumImport.programmeHeading, "Computer Science");
  assert.doesNotMatch(JSON.stringify(detail.body), /private OCR excerpt|private extracted text|private-lease-token|private worker diagnostic/);

  const document = await request(app).get(`/api/admin/content/curricula/${importId}/document`);
  assert.equal(document.status, 200);
  assert.equal(document.body.toString(), "private curriculum");
  assert.equal(document.headers["cache-control"], "private, no-store");
  assert.match(document.headers["content-disposition"], /attachment/);
});

test("Admin evidence endpoint is purpose-specific and students cannot access excerpts", async () => {
  curriculumImportService.getCurriculumEntryEvidence = async () => ({
    importId,
    entryId: "507f1f77bcf86cd799439023",
    sourceEvidence: [{
      field: "title",
      page: 3,
      locator: "page:3;item:2",
      excerpt: "Admin-only review evidence",
      extractionMethod: "ocr",
      confidence: 0.94
    }]
  });
  const path = `/api/admin/content/curricula/${importId}/entries/507f1f77bcf86cd799439023/evidence`;
  const response = await request(buildApp("admin")).get(path);
  assert.equal(response.status, 200);
  assert.equal(response.body.sourceEvidence[0].excerpt, "Admin-only review evidence");
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.equal(response.headers["x-content-type-options"], "nosniff");

  const unauthenticated = await request(buildApp()).get(path);
  assert.equal(unauthenticated.status, 401);
  const student = await request(buildApp("student")).get(path);
  assert.equal(student.status, 403);
});

test("Admin entry edit and review endpoints pass the acting Admin to the service", async () => {
  let editedBy;
  let reviewedBy;
  curriculumImportService.updateCurriculumEntry = async (input) => {
    editedBy = input.reviewerId;
    return { _id: importId, draftEntries: [{ title: input.updates.title }] };
  };
  curriculumImportService.reviewCurriculumEntry = async (input) => {
    reviewedBy = input.reviewerId;
    return { _id: importId, status: input.action === "approve" ? "reviewed" : "needs_review" };
  };
  const app = buildApp("admin");
  const edit = await request(app)
    .patch(`/api/admin/content/curricula/${importId}/entries/507f1f77bcf86cd799439023`)
    .send({ title: "Reviewed title", note: "Admin edit" });
  assert.equal(edit.status, 200);
  assert.equal(editedBy, USER_ID);

  const review = await request(app)
    .post(`/api/admin/content/curricula/${importId}/entries/507f1f77bcf86cd799439023/review`)
    .send({ action: "approve", note: "Confirmed from source." });
  assert.equal(review.status, 200);
  assert.equal(reviewedBy, USER_ID);

  const studentEdit = await request(buildApp("student"))
    .patch(`/api/admin/content/curricula/${importId}/entries/507f1f77bcf86cd799439023`)
    .send({ title: "Not permitted" });
  assert.equal(studentEdit.status, 403);
});

test("curriculum upload uses a temporary private file and duplicate retry creates no response URL", async () => {
  let observedTempFile;
  let observedTempDirectory;
  let observedUploader;
  curriculumImportService.createCurriculumImportFromFile = async ({ file, uploadedBy }) => {
    observedTempFile = file.path;
    observedTempDirectory = file.destination;
    observedUploader = uploadedBy;
    return {
      status: "duplicate_retry",
      existingImportId: importId,
      version: 2
    };
  };
  const response = await request(buildApp("admin"))
    .post("/api/admin/content/curricula")
    .field("schoolId", "507f1f77bcf86cd799439021")
    .field("departmentId", "507f1f77bcf86cd799439022")
    .field("programmeHeading", "Computer Science")
    .field("uploadedBy", "507f1f77bcf86cd799439099")
    .attach("document", Buffer.from("%PDF-1.7 test"), {
      filename: "curriculum.pdf",
      contentType: "application/pdf"
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.duplicate, true);
  assert.equal(response.body.curriculumImportId, importId);
  assert.equal(observedUploader, USER_ID);
  assert.equal(response.body.fileUrl, undefined);
  assert.equal(fs.existsSync(observedTempFile), false);
  assert.equal(fs.existsSync(observedTempDirectory), false);
});

test("invalid extension, MIME and content signature are rejected", async () => {
  let createCalls = 0;
  let invalidSignaturePath;
  curriculumImportService.createCurriculumImportFromFile = async (input) => {
    createCalls += 1;
    invalidSignaturePath = input.file.path;
    return originalMethods.createCurriculumImportFromFile(input);
  };

  const app = buildApp("admin");
  const extensionError = await request(app)
    .post("/api/admin/content/curricula")
    .attach("document", Buffer.from("data"), {
      filename: "payload.exe",
      contentType: "application/octet-stream"
    });
  assert.equal(extensionError.status, 400);

  const mimeError = await request(app)
    .post("/api/admin/content/curricula")
    .attach("document", Buffer.from("%PDF-1.7"), {
      filename: "curriculum.pdf",
      contentType: "text/plain"
    });
  assert.equal(mimeError.status, 400);

  const signatureError = await request(app)
    .post("/api/admin/content/curricula")
    .field("schoolId", "507f1f77bcf86cd799439021")
    .field("departmentId", "507f1f77bcf86cd799439022")
    .field("programmeHeading", "Computer Science")
    .attach("document", Buffer.from("not a PDF"), {
      filename: "curriculum.pdf",
      contentType: "application/pdf"
    });
  assert.equal(signatureError.status, 400);
  assert.equal(createCalls, 1);
  assert.equal(fs.existsSync(path.dirname(invalidSignaturePath)), false);
});

test("extraction requests are Admin-only and persist an explicit queue request", async () => {
  let calls = 0;
  curriculumImportService.requestCurriculumExtraction = async () => {
    calls += 1;
    return { status: "pending", queued: true };
  };
  const student = await request(buildApp("student"))
    .post(`/api/admin/content/curricula/${importId}/extract`);
  assert.equal(student.status, 403);
  assert.equal(calls, 0);

  const admin = await request(buildApp("admin"))
    .post(`/api/admin/content/curricula/${importId}/extract`);
  assert.equal(admin.status, 202);
  assert.deepEqual(admin.body, { success: true, status: "pending", queued: true });
  assert.equal(calls, 1);
});

test("curriculum upload rejects documents above the configured 10 MiB limit", async () => {
  const { maxUploadBytes } = require("../config/curriculumExtractionLimits");
  const oversized = Buffer.alloc(maxUploadBytes + 1);
  oversized.write("%PDF-1.7");
  const originalRemoveTempDirectory = curriculumImportController.removeTempDirectory;
  let temporaryDirectory;
  curriculumImportController.removeTempDirectory = async (req) => {
    temporaryDirectory = req.curriculumTempDirectory;
    return originalRemoveTempDirectory(req);
  };
  let response;
  try {
    response = await request(buildApp("admin"))
      .post("/api/admin/content/curricula")
      .attach("document", oversized, {
        filename: "oversized.pdf",
        contentType: "application/pdf"
      });
  } finally {
    curriculumImportController.removeTempDirectory = originalRemoveTempDirectory;
  }
  assert.equal(response.status, 413);
  assert.deepEqual(response.body, {
    success: false,
    message: "The curriculum document exceeds the upload limit."
  });
  assert.ok(temporaryDirectory);
  assert.equal(fs.existsSync(temporaryDirectory), false);
});

test("curriculum upload removes its temporary file after document validation fails", async () => {
  let temporaryFile;
  let temporaryDirectory;
  curriculumImportService.createCurriculumImportFromFile = async ({ file }) => {
    temporaryFile = file.path;
    temporaryDirectory = file.destination;
    return curriculumImportService.validateCurriculumUpload(file);
  };
  const response = await request(buildApp("admin"))
    .post("/api/admin/content/curricula")
    .field("schoolId", "507f1f77bcf86cd799439021")
    .field("departmentId", "507f1f77bcf86cd799439022")
    .field("programmeHeading", "Computer Science")
    .attach("document", Buffer.from("%PDF-1.7\nnot a valid PDF structure"), {
      filename: "malformed.pdf",
      contentType: "application/pdf"
    });
  assert.equal(response.status, 400);
  assert.ok(temporaryFile);
  assert.ok(temporaryDirectory);
  assert.equal(fs.existsSync(temporaryFile), false);
  assert.equal(fs.existsSync(temporaryDirectory), false);
});
