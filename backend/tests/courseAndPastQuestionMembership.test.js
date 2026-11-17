const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { Readable } = require("node:stream");

process.env.JWT_SECRET = process.env.JWT_SECRET || "course-resource-membership-test-secret";
const { generateAccessToken } = require("../utils/token");
const coursesRouter = require("../routes/course");
const filesRouter = require("../routes/file");
const Course = require("../models/course");
const User = require("../models/User");
const File = require("../models/File");
const PastQuestionPaper = require("../models/PastQuestionPaper");
const materialAccessService = require("../services/materialAccessService");
const storageService = require("../services/storageService");

const STUDENT_ID = "507f1f77bcf86cd799439011";
const COURSE_ID = "507f1f77bcf86cd799439021";
const OTHER_COURSE_ID = "507f1f77bcf86cd799439022";
const DEPARTMENT_ID = "507f1f77bcf86cd799439031";
const OTHER_DEPARTMENT_ID = "507f1f77bcf86cd799439032";

const courses = [
  { _id: COURSE_ID, title: "Course A", code: "A101", department: DEPARTMENT_ID, lecturers: [] },
  { _id: OTHER_COURSE_ID, title: "Course B", code: "B101", department: OTHER_DEPARTMENT_ID, lecturers: [] }
];
const student = {
  _id: STUDENT_ID,
  id: STUDENT_ID,
  role: "student",
  coursesEnrolled: [OTHER_COURSE_ID],
  department: DEPARTMENT_ID,
  yearOfStudy: "ND1",
  semester: "First"
};
const materials = [
  { _id: "material-a", title: "Course A material", course: COURSE_ID, department: DEPARTMENT_ID },
  { _id: "material-b", title: "Course B material", course: OTHER_COURSE_ID, department: OTHER_DEPARTMENT_ID }
];
const papers = [
  { _id: "paper-a", course: COURSE_ID, mimeType: "application/pdf" },
  { _id: "paper-b", course: OTHER_COURSE_ID, mimeType: "application/pdf" }
];

const query = (value) => ({
  populate() { return this; },
  select() { return this; },
  sort() { return this; },
  lean() { return Promise.resolve(value); },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
});

const buildApp = (router, prefix) => {
  const app = express();
  const token = generateAccessToken(STUDENT_ID, { role: "student" });
  app.use((req, res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    next();
  });
  app.use(prefix, router);
  return app;
};

const withMocks = async (run) => {
  const originals = {
    courseFind: Course.find,
    courseFindById: Course.findById,
    userFindById: User.findById,
    fileFind: File.find,
    paperFind: PastQuestionPaper.find,
    paperFindById: PastQuestionPaper.findById,
    canViewMaterial: materialAccessService.canViewMaterial,
    getObjectReadStream: storageService.getObjectReadStream
  };
  const state = { courseFilter: null, fileFilter: null, paperFilter: null, streams: 0 };

  Course.find = (filter) => {
    state.courseFilter = filter;
    return query(courses.filter((course) => {
      if (filter._id?.$in && !filter._id.$in.some((id) => String(id) === String(course._id))) {
        return false;
      }
      if (filter.department && String(filter.department) !== String(course.department)) {
        return false;
      }
      return true;
    }));
  };
  Course.findById = (id) => query(courses.find((course) => String(course._id) === String(id)) || null);
  User.findById = () => query(student);
  File.find = (filter) => {
    state.fileFilter = filter;
    return query(materials.filter((material) => filter.$or.some((clause) =>
      (clause.courseRef?.$in || []).some((courseValue) => String(courseValue) === String(material.courseRef)) ||
      (clause.course?.$in || []).some((courseValue) => String(courseValue) === String(material.course)) ||
      (clause.courseCode?.$in || []).some((courseValue) => String(courseValue) === String(material.courseCode))
    )));
  };
  PastQuestionPaper.find = (filter) => {
    state.paperFilter = filter;
    const courseIds = filter.course?.$in;
    return query(papers.filter((paper) =>
      !courseIds || courseIds.some((courseId) => String(courseId) === String(paper.course))
    ));
  };
  PastQuestionPaper.findById = (id) => query(papers.find((paper) => paper._id === id) || null);
  materialAccessService.canViewMaterial = async ({ user, material }) => ({
    allowed: String(user.department) === String(material.department),
    reason: "course_department_required"
  });
  storageService.getObjectReadStream = async () => {
    state.streams += 1;
    return Readable.from(["past-question"]);
  };

  try {
    await run(state);
  } finally {
    Course.find = originals.courseFind;
    Course.findById = originals.courseFindById;
    User.findById = originals.userFindById;
    File.find = originals.fileFind;
    PastQuestionPaper.find = originals.paperFind;
    PastQuestionPaper.findById = originals.paperFindById;
    materialAccessService.canViewMaterial = originals.canViewMaterial;
    storageService.getObjectReadStream = originals.getObjectReadStream;
  }
};

test("course list and detail allow courses in the student's department without enrollment", async () => {
  await withMocks(async () => {
    const app = buildApp(coursesRouter, "/api/courses");
    const list = await request(app).get("/api/courses");
    const sameDepartment = await request(app).get(`/api/courses/${COURSE_ID}`);
    const otherDepartment = await request(app).get(`/api/courses/${OTHER_COURSE_ID}`);

    assert.equal(list.status, 200);
    assert.deepEqual(list.body.courses.map((course) => course._id), [COURSE_ID]);
    assert.equal(sameDepartment.status, 200);
    assert.equal(otherDepartment.status, 403);
  });
});

test("file listing is limited to resources from the student's department", async () => {
  await withMocks(async (state) => {
    const response = await request(buildApp(filesRouter, "/api/files")).get("/api/files");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.files.map((file) => file._id), ["material-a"]);
    assert.deepEqual(state.fileFilter.$or, [
      { courseRef: { $in: [COURSE_ID] } },
      { course: { $in: [COURSE_ID, "Course A", "A101"] } },
      { courseCode: { $in: ["A101"] } }
    ]);
    assert.equal(String(state.courseFilter.department), DEPARTMENT_ID);
  });
});

test("past-question listing and streaming use department access without enrollment", async () => {
  await withMocks(async (state) => {
    const app = buildApp(filesRouter, "/api/files");
    const list = await request(app).get("/api/files/past-questions");
    const denied = await request(app).get("/api/files/past-questions/paper-b");
    const allowed = await request(app).get("/api/files/past-questions/paper-a");

    assert.equal(list.status, 200);
    assert.deepEqual(list.body.papers.map((paper) => paper._id), ["paper-a"]);
    assert.deepEqual(state.paperFilter.course.$in, [COURSE_ID]);
    assert.equal(denied.status, 403);
    assert.equal(allowed.status, 200);
    assert.equal(state.streams, 1);
  });
});
