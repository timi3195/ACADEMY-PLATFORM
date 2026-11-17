const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "course-material-diagnostic-test-secret";
const { generateAccessToken } = require("../utils/token");
const adminRouter = require("../routes/admin");
const Course = require("../models/course");
const File = require("../models/File");
const { logger } = require("../utils/logger");

const ADMIN_ID = "507f1f77bcf86cd799439012";
const COURSE_ID = "507f1f77bcf86cd799439021";
const MATERIAL_KEY =
  "materials/6a7f568dbde058bf65575337/a2cb5112-5b44-4e30-b0db-725b40757417-Chapter1_Campus_Mesh_Network.docx";
const SELECTED_FIELDS = "courseCode course storageProvider storageStatus storageKey";

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

test("course-material diagnostic rejects unauthenticated, student, and lecturer requests before querying", async () => {
  const originalCourseExists = Course.exists;
  const originalFileFindOne = File.findOne;
  let queryCount = 0;
  Course.exists = async () => {
    queryCount += 1;
    return null;
  };
  File.findOne = () => {
    queryCount += 1;
    throw new Error("File lookup must not run");
  };

  try {
    const unauthenticated = await request(buildApp())
      .get("/api/admin/diagnostics/course-material");
    const student = await request(buildApp("student"))
      .get("/api/admin/diagnostics/course-material");
    const lecturer = await request(buildApp("lecturer"))
      .get("/api/admin/diagnostics/course-material");

    assert.equal(unauthenticated.status, 401);
    assert.equal(student.status, 403);
    assert.equal(lecturer.status, 403);
    assert.equal(queryCount, 0);
  } finally {
    Course.exists = originalCourseExists;
    File.findOne = originalFileFindOne;
  }
});

test("admin diagnostic performs fixed existence checks and returns only approved material fields", async () => {
  const originalCourseExists = Course.exists;
  const originalFileFindOne = File.findOne;
  const courseQueries = [];
  let fileQuery;
  Course.exists = async (filter) => {
    courseQueries.push(filter);
    return { _id: filter._id || COURSE_ID };
  };
  File.findOne = (filter) => {
    fileQuery = filter;
    return {
      select(fields) {
        assert.equal(fields, SELECTED_FIELDS);
        return this;
      },
      async lean() {
        return {
          courseCode: "NCC221",
          course: COURSE_ID,
          storageProvider: "object-storage",
          storageStatus: "migrated",
          storageKey: MATERIAL_KEY,
          lecturerName: "Must not be returned",
          studentEmail: "must-not-be-returned@example.test"
        };
      }
    };
  };

  try {
    const response = await request(buildApp("admin"))
      .get("/api/admin/diagnostics/course-material")
      .query({
        code: "UNRELATED",
        title: "Unrelated title",
        storageKey: "unrelated-key"
      });

    assert.equal(response.status, 200);
    assert.deepEqual(courseQueries, [
      { code: "NCC221" },
      { title: "Cloud Computing 4" },
      { _id: COURSE_ID }
    ]);
    assert.deepEqual(fileQuery, { storageKey: MATERIAL_KEY });
    assert.deepEqual(response.body, {
      success: true,
      courseCodeNCC221Exists: true,
      courseTitleCloudComputing4Exists: true,
      materialExists: true,
      material: {
        courseCode: "NCC221",
        courseId: COURSE_ID,
        storageProvider: "object-storage",
        storageStatus: "migrated",
        storageKey: MATERIAL_KEY
      },
      referencedCourseResolves: true
    });
  } finally {
    Course.exists = originalCourseExists;
    File.findOne = originalFileFindOne;
  }
});

test("course-material diagnostic does not treat legacy course text as an ID", async () => {
  const originalCourseExists = Course.exists;
  const originalFileFindOne = File.findOne;
  const courseQueries = [];
  Course.exists = async (filter) => {
    courseQueries.push(filter);
    return null;
  };
  File.findOne = () => ({
    select(fields) {
      assert.equal(fields, SELECTED_FIELDS);
      return this;
    },
    async lean() {
      return {
        courseCode: "NCC221",
        course: "Cloud Computing 4",
        storageProvider: "local-disk",
        storageStatus: "pending",
        storageKey: MATERIAL_KEY
      };
    }
  });

  try {
    const response = await request(buildApp("admin"))
      .get("/api/admin/diagnostics/course-material");

    assert.equal(response.status, 200);
    assert.deepEqual(courseQueries, [
      { code: "NCC221" },
      { title: "Cloud Computing 4" }
    ]);
    assert.deepEqual(response.body, {
      success: true,
      courseCodeNCC221Exists: false,
      courseTitleCloudComputing4Exists: false,
      materialExists: true,
      material: {
        courseCode: "NCC221",
        courseId: null,
        storageProvider: "local-disk",
        storageStatus: "pending",
        storageKey: MATERIAL_KEY
      },
      referencedCourseResolves: false
    });
  } finally {
    Course.exists = originalCourseExists;
    File.findOne = originalFileFindOne;
  }
});

test("course-material diagnostic returns a sanitized error when a read fails", async () => {
  const originalCourseExists = Course.exists;
  const originalLoggerError = logger.error;
  let loggedError;
  Course.exists = async () => {
    throw new Error("diagnostic-error-sentinel");
  };
  logger.error = (event, details) => {
    loggedError = { event, details };
  };

  try {
    const response = await request(buildApp("admin"))
      .get("/api/admin/diagnostics/course-material");

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
      success: false,
      message: "Course-material diagnostic failed."
    });
    assert.doesNotMatch(JSON.stringify(response.body), /diagnostic-error-sentinel/);
    assert.deepEqual(loggedError, {
      event: "course_material_diagnostic_failed",
      details: { category: "operation-failed" }
    });
  } finally {
    Course.exists = originalCourseExists;
    logger.error = originalLoggerError;
  }
});
