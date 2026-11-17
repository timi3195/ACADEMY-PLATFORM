const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "course-enrollment-management-test-secret";
const { generateAccessToken } = require("../utils/token");
const usersRouter = require("../routes/users");
const User = require("../models/User");
const Course = require("../models/course");
const Department = require("../models/Department");

const STUDENT_ID = "507f1f77bcf86cd799439011";
const ADMIN_ID = "507f1f77bcf86cd799439012";
const COURSE_ID = "507f1f77bcf86cd799439021";
const OTHER_COURSE_ID = "507f1f77bcf86cd799439022";
const DEPARTMENT_ID = "507f1f77bcf86cd799439031";
const OTHER_DEPARTMENT_ID = "507f1f77bcf86cd799439032";

const buildApp = (userId, role) => {
  const app = express();
  app.use(express.json());
  const token = generateAccessToken(userId, { role });
  app.use((req, res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    next();
  });
  app.use("/api/users", usersRouter);
  return app;
};

const withUserMocks = async (run) => {
  const originalFindById = User.findById;
  const originalCourseFind = Course.find;
  const originalDepartmentFindById = Department.findById;
  const student = {
    _id: STUDENT_ID,
    role: "student",
    name: "Original Student",
    department: DEPARTMENT_ID,
    coursesEnrolled: [],
    async save() { return this; },
    toObject() {
      return {
        _id: this._id,
        role: this.role,
        name: this.name,
        department: this.department,
        coursesEnrolled: this.coursesEnrolled
      };
    }
  };
  User.findById = async () => student;
  Course.find = (query) => ({
    select() { return this; },
    lean: async () => query._id.$in
      .filter((courseId) => [COURSE_ID, OTHER_COURSE_ID].includes(String(courseId)))
      .map((_id) => ({ _id }))
  });
  Department.findById = (departmentId) => ({
    select() { return this; },
    lean: async () => [DEPARTMENT_ID, OTHER_DEPARTMENT_ID]
      .includes(String(departmentId))
      ? { _id: String(departmentId) }
      : null
  });

  try {
    await run(student);
  } finally {
    User.findById = originalFindById;
    Course.find = originalCourseFind;
    Department.findById = originalDepartmentFindById;
  }
};

test("admins can assign only existing course IDs to a student", async () => {
  await withUserMocks(async (student) => {
    const response = await request(buildApp(ADMIN_ID, "admin"))
      .put(`/api/users/${STUDENT_ID}`)
      .send({ coursesEnrolled: [COURSE_ID, COURSE_ID, OTHER_COURSE_ID] });

    assert.equal(response.status, 200);
    assert.deepEqual(student.coursesEnrolled, [COURSE_ID, OTHER_COURSE_ID]);
    assert.deepEqual(response.body.user.coursesEnrolled, [COURSE_ID, OTHER_COURSE_ID]);
  });
});

test("students cannot assign themselves a course", async () => {
  await withUserMocks(async (student) => {
    const response = await request(buildApp(STUDENT_ID, "student"))
      .put(`/api/users/${STUDENT_ID}`)
      .send({ coursesEnrolled: [COURSE_ID] });

    assert.equal(response.status, 400);
    assert.deepEqual(student.coursesEnrolled, []);
  });
});

test("students cannot change their own department", async () => {
  await withUserMocks(async (student) => {
    const response = await request(buildApp(STUDENT_ID, "student"))
      .put(`/api/users/${STUDENT_ID}`)
      .send({ department: OTHER_DEPARTMENT_ID });

    assert.equal(response.status, 400);
    assert.equal(student.department, DEPARTMENT_ID);
  });
});

test("students can update permitted profile fields without changing department or role", async () => {
  await withUserMocks(async (student) => {
    const response = await request(buildApp(STUDENT_ID, "student"))
      .put(`/api/users/${STUDENT_ID}`)
      .send({
        name: "Updated Student",
        department: OTHER_DEPARTMENT_ID,
        role: "admin",
        coursesEnrolled: [OTHER_COURSE_ID]
      });

    assert.equal(response.status, 200);
    assert.equal(student.name, "Updated Student");
    assert.equal(student.department, DEPARTMENT_ID);
    assert.equal(student.role, "student");
    assert.deepEqual(student.coursesEnrolled, []);
  });
});

test("administrators can change a student's department to an existing department", async () => {
  await withUserMocks(async (student) => {
    const response = await request(buildApp(ADMIN_ID, "admin"))
      .put(`/api/users/${STUDENT_ID}`)
      .send({ department: OTHER_DEPARTMENT_ID });

    assert.equal(response.status, 200);
    assert.equal(student.department, OTHER_DEPARTMENT_ID);
  });
});

test("administrators cannot assign an unknown department", async () => {
  await withUserMocks(async (student) => {
    const response = await request(buildApp(ADMIN_ID, "admin"))
      .put(`/api/users/${STUDENT_ID}`)
      .send({ department: "507f1f77bcf86cd799439099" });

    assert.equal(response.status, 400);
    assert.equal(student.department, DEPARTMENT_ID);
  });
});

test("admins cannot assign malformed or unknown course IDs", async () => {
  await withUserMocks(async (student) => {
    const malformed = await request(buildApp(ADMIN_ID, "admin"))
      .put(`/api/users/${STUDENT_ID}`)
      .send({ coursesEnrolled: ["not-an-id"] });
    const unknown = await request(buildApp(ADMIN_ID, "admin"))
      .put(`/api/users/${STUDENT_ID}`)
      .send({ coursesEnrolled: ["507f1f77bcf86cd799439099"] });

    assert.equal(malformed.status, 400);
    assert.equal(unknown.status, 400);
    assert.deepEqual(student.coursesEnrolled, []);
  });
});
