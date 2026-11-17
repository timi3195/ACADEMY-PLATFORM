const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { S3Client, HeadObjectCommand } = require("@aws-sdk/client-s3");

process.env.JWT_SECRET = process.env.JWT_SECRET || "course-material-diagnostic-test-secret";
const { generateAccessToken } = require("../utils/token");
const adminRouter = require("../routes/admin");
const Course = require("../models/course");
const Department = require("../models/Department");
const File = require("../models/File");
const { logger } = require("../utils/logger");
const materialAccessService = require("../services/materialAccessService");
const storageService = require("../services/storageService");

const ADMIN_ID = "507f1f77bcf86cd799439012";
const MATERIAL_ID = "507f1f77bcf86cd799439022";
const COURSE_ID = "507f1f77bcf86cd799439021";
const DEPARTMENT_ID = "507f1f77bcf86cd799439031";
const INTERNAL_KEY = "test-only-private-object-key";
const DIAGNOSTIC_PATH = "/api/admin/diagnostics/course-material";
const MATERIAL_FIELDS =
  "_id course courseCode department level semester courseRef storageProvider storageStatus storageKey";

const courseRecord = {
  _id: COURSE_ID,
  title: "Cloud Computing 4",
  code: "NCC221",
  department: DEPARTMENT_ID,
  level: "HND1",
  semester: "Second",
  lecturers: []
};

const materialRecord = {
  _id: MATERIAL_ID,
  course: "Cloud Computing 4",
  courseCode: "NCC221",
  department: DEPARTMENT_ID,
  level: "HND1",
  semester: "Second",
  courseRef: null,
  storageProvider: "object-storage",
  storageStatus: "migrated",
  storageKey: INTERNAL_KEY
};

const buildApp = (role) => {
  const app = express();
  if (role) {
    const token = generateAccessToken(ADMIN_ID, { role });
    app.use((req, res, next) => {
      req.headers.authorization = `Bearer ${token}`;
      next();
    });
  }
  app.use("/api/admin", adminRouter);
  return app;
};

const withMocks = async (t, {
  material = materialRecord,
  courses = [courseRecord],
  referencedCourse = courseRecord,
  r2Object = { status: "present", contentLength: 1234, contentType: "application/pdf" }
} = {}, run) => {
  const originals = {
    fileFindById: File.findById,
    courseFind: Course.find,
    courseFindById: Course.findById,
    departmentFind: Department.find,
    headObjectMetadata: storageService.headObjectMetadata
  };
  const state = {
    materialId: null,
    selectedFields: null,
    courseQueries: [],
    referencedCourseId: null,
    headRecord: null,
    headCalls: 0
  };

  File.findById = (id) => {
    state.materialId = String(id);
    return {
      select(fields) {
        state.selectedFields = fields;
        return this;
      },
      lean: async () => material
    };
  };
  Course.find = async (filter) => {
    state.courseQueries.push(filter);
    return courses;
  };
  Course.findById = async (id) => {
    state.referencedCourseId = String(id);
    return referencedCourse;
  };
  Department.find = async () => [{ _id: DEPARTMENT_ID, name: "Computer Science" }];
  storageService.headObjectMetadata = async (record) => {
    state.headCalls += 1;
    state.headRecord = record;
    return r2Object;
  };

  try {
    await run(state);
  } finally {
    File.findById = originals.fileFindById;
    Course.find = originals.courseFind;
    Course.findById = originals.courseFindById;
    Department.find = originals.departmentFind;
    storageService.headObjectMetadata = originals.headObjectMetadata;
  }
};

const getDiagnostic = (role, materialId = MATERIAL_ID) =>
  request(buildApp(role))
    .get(DIAGNOSTIC_PATH)
    .query(materialId === undefined ? {} : { materialId });

test("course-material diagnostic rejects unauthenticated and non-admin requests before querying", async () => {
  const originalFileFindById = File.findById;
  const originalHeadObjectMetadata = storageService.headObjectMetadata;
  let queryCount = 0;
  File.findById = () => {
    queryCount += 1;
    throw new Error("File lookup must not run");
  };
  storageService.headObjectMetadata = async () => {
    queryCount += 1;
    throw new Error("R2 lookup must not run");
  };

  try {
    const unauthenticated = await request(buildApp())
      .get(DIAGNOSTIC_PATH)
      .query({ materialId: MATERIAL_ID });
    const student = await getDiagnostic("student");
    const lecturer = await getDiagnostic("lecturer");

    assert.equal(unauthenticated.status, 401);
    assert.equal(student.status, 403);
    assert.equal(lecturer.status, 403);
    assert.equal(queryCount, 0);
  } finally {
    File.findById = originalFileFindById;
    storageService.headObjectMetadata = originalHeadObjectMetadata;
  }
});

test("diagnostic requires a strictly formatted File ID", async () => {
  const originalFileFindById = File.findById;
  let queryCount = 0;
  File.findById = () => {
    queryCount += 1;
    throw new Error("File lookup must not run");
  };

  try {
    const missing = await request(buildApp("admin")).get(DIAGNOSTIC_PATH);
    const malformed = await getDiagnostic("admin", "not-an-id");

    assert.equal(missing.status, 400);
    assert.equal(malformed.status, 400);
    assert.equal(queryCount, 0);
  } finally {
    File.findById = originalFileFindById;
  }
});

test("successful diagnostic resolves by stored course code and never returns the storage key", async (t) => {
  await withMocks(t, {}, async (state) => {
    const response = await getDiagnostic("admin");
    const body = response.body;

    assert.equal(response.status, 200);
    assert.equal(state.materialId, MATERIAL_ID);
    assert.equal(state.selectedFields, MATERIAL_FIELDS);
    assert.deepEqual(state.courseQueries, [{ code: "NCC221" }]);
    assert.equal(state.headRecord.storageKey, INTERNAL_KEY);
    assert.equal(state.headCalls, 1);
    assert.deepEqual(body, {
      success: true,
      materialExists: true,
      material: {
        course: "Cloud Computing 4",
        courseCode: "NCC221",
        department: DEPARTMENT_ID,
        level: "HND1",
        semester: "Second",
        storageProvider: "object-storage",
        storageStatus: "migrated"
      },
      courseResolution: {
        status: "resolved",
        course: {
          id: COURSE_ID,
          title: "Cloud Computing 4",
          code: "NCC221",
          department: DEPARTMENT_ID,
          level: "HND1",
          semester: "Second"
        }
      },
      r2Object: {
        status: "present",
        contentLength: 1234,
        contentType: "application/pdf"
      }
    });
    assert.doesNotMatch(JSON.stringify(body), /storageKey|test-only-private-object-key/);
  });
});

test("diagnostic prefers a valid courseRef without running fallback queries", async (t) => {
  await withMocks(t, {
    material: { ...materialRecord, courseRef: COURSE_ID },
    courses: []
  }, async (state) => {
    const response = await getDiagnostic("admin");

    assert.equal(response.status, 200);
    assert.equal(response.body.courseResolution.status, "resolved");
    assert.equal(state.referencedCourseId, COURSE_ID);
    assert.deepEqual(state.courseQueries, []);
  });
});

test("missing material does not query courses or R2", async (t) => {
  await withMocks(t, { material: null }, async (state) => {
    const response = await getDiagnostic("admin");

    assert.equal(response.status, 200);
    assert.equal(response.body.materialExists, false);
    assert.equal(response.body.material, null);
    assert.equal(response.body.courseResolution.status, "not_checked");
    assert.equal(response.body.r2Object, null);
    assert.deepEqual(state.courseQueries, []);
    assert.equal(state.headCalls, 0);
  });
});

test("missing Course is reported without guessing a relationship", async (t) => {
  await withMocks(t, { courses: [] }, async (state) => {
    const response = await getDiagnostic("admin");

    assert.equal(response.status, 200);
    assert.equal(response.body.materialExists, true);
    assert.equal(response.body.courseResolution.status, "missing");
    assert.equal(response.body.courseResolution.course, null);
    assert.equal(response.body.r2Object.status, "present");
    assert.doesNotMatch(JSON.stringify(response.body), /storageKey|test-only-private-object-key/);
    assert.equal(state.headCalls, 1);
  });
});

test("course metadata that fails shared resolution checks is reported as unresolved", async (t) => {
  await withMocks(t, {
    courses: [{ ...courseRecord, title: "Renamed Course" }]
  }, async () => {
    const response = await getDiagnostic("admin");

    assert.equal(response.status, 200);
    assert.equal(response.body.courseResolution.status, "unresolved");
    assert.equal(response.body.courseResolution.course, null);
  });
});

test("ambiguous fallback course matches are reported without choosing a record", async (t) => {
  await withMocks(t, {
    courses: [courseRecord, { ...courseRecord, _id: "507f1f77bcf86cd799439032" }]
  }, async () => {
    const response = await getDiagnostic("admin");

    assert.equal(response.status, 200);
    assert.equal(response.body.courseResolution.status, "ambiguous");
    assert.equal(response.body.courseResolution.course, null);
  });
});

test("missing and unavailable R2 objects are distinguished", async (t) => {
  await t.test("missing", async (subtest) => {
    await withMocks(subtest, {
      r2Object: { status: "missing", contentLength: null, contentType: null }
    }, async () => {
      const response = await getDiagnostic("admin");
      assert.equal(response.status, 200);
      assert.equal(response.body.r2Object.status, "missing");
    });
  });

  await t.test("unavailable", async (subtest) => {
    await withMocks(subtest, {
      r2Object: { status: "unavailable", contentLength: null, contentType: null }
    }, async () => {
      const response = await getDiagnostic("admin");
      assert.equal(response.status, 200);
      assert.equal(response.body.r2Object.status, "unavailable");
      assert.doesNotMatch(JSON.stringify(response.body), /storageKey|test-only-private-object-key/);
    });
  });
});

test("storage HeadObject reports only safe metadata and maps provider outcomes", async (t) => {
  const names = [
    "STORAGE_PROVIDER",
    "STORAGE_BUCKET",
    "STORAGE_ACCESS_KEY_ID",
    "STORAGE_SECRET_ACCESS_KEY",
    "STORAGE_ENDPOINT",
    "STORAGE_REGION"
  ];
  const previousEnvironment = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const originalSend = S3Client.prototype.send;
  const outcomes = [
    { ContentLength: 1234, ContentType: "application/pdf" },
    Object.assign(new Error("not found"), {
      name: "NotFound",
      $metadata: { httpStatusCode: 404 }
    }),
    new Error("network failure")
  ];
  const commands = [];

  process.env.STORAGE_PROVIDER = "object-storage";
  process.env.STORAGE_BUCKET = "test-bucket";
  process.env.STORAGE_ACCESS_KEY_ID = "test-access-key";
  process.env.STORAGE_SECRET_ACCESS_KEY = "test-secret-key";
  process.env.STORAGE_ENDPOINT = "https://r2.test.invalid";
  process.env.STORAGE_REGION = "auto";
  S3Client.prototype.send = async function (command) {
    commands.push(command);
    const outcome = outcomes.shift();
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };

  try {
    const present = await storageService.headObjectMetadata(materialRecord);
    const missing = await storageService.headObjectMetadata(materialRecord);
    const unavailable = await storageService.headObjectMetadata(materialRecord);

    assert.deepEqual(present, {
      status: "present",
      contentLength: 1234,
      contentType: "application/pdf"
    });
    assert.deepEqual(missing, {
      status: "missing",
      contentLength: null,
      contentType: null
    });
    assert.deepEqual(unavailable, {
      status: "unavailable",
      contentLength: null,
      contentType: null
    });
    assert.equal(commands.length, 3);
    assert.ok(commands.every((command) => command instanceof HeadObjectCommand));
    assert.equal(commands[0].input.Bucket, "test-bucket");
    assert.equal(commands[0].input.Key, INTERNAL_KEY);
  } finally {
    S3Client.prototype.send = originalSend;
    for (const name of names) {
      if (previousEnvironment[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnvironment[name];
    }
  }
});

test("diagnostic sanitizes database errors", async (t) => {
  const originalFileFindById = File.findById;
  const originalLoggerError = logger.error;
  let loggedEvent;
  let loggedDetails;
  File.findById = () => {
    throw new Error(`query failed for ${INTERNAL_KEY}`);
  };
  logger.error = (event, details) => {
    loggedEvent = event;
    loggedDetails = details;
  };

  try {
    const response = await getDiagnostic("admin");

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
      success: false,
      message: "Course-material diagnostic failed."
    });
    assert.doesNotMatch(JSON.stringify(response.body), /storageKey|test-only-private-object-key/);
    assert.equal(loggedEvent, "course_material_diagnostic_failed");
    assert.deepEqual(loggedDetails, { category: "operation-failed" });
    assert.doesNotMatch(JSON.stringify(loggedDetails), /storageKey|test-only-private-object-key|query failed/);
  } finally {
    File.findById = originalFileFindById;
    logger.error = originalLoggerError;
  }
});
