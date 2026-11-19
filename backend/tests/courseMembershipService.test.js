const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  canAccessCourse,
  getAccessibleCourseFilter,
  isStudentInCourseDepartment
} = require("../services/courseMembershipService");

const COURSE_ID = "507f1f77bcf86cd799439021";
const OTHER_COURSE_ID = "507f1f77bcf86cd799439022";
const DEPARTMENT_ID = "507f1f77bcf86cd799439041";
const OTHER_DEPARTMENT_ID = "507f1f77bcf86cd799439042";

const course = {
  _id: COURSE_ID,
  department: DEPARTMENT_ID
};

test("students automatically access courses in their department without enrollment", () => {
  const student = {
    role: "student",
    department: { _id: DEPARTMENT_ID },
    yearOfStudy: "HND2",
    semester: "Second",
    coursesEnrolled: []
  };

  assert.equal(isStudentInCourseDepartment(student, course), true);
  assert.equal(canAccessCourse(student, course), true);
});

test("students cannot access another department through a manually enrolled course ID", () => {
  assert.equal(canAccessCourse({
    role: "student",
    department: DEPARTMENT_ID,
    yearOfStudy: "ND1",
    semester: "First",
    coursesEnrolled: [OTHER_COURSE_ID]
  }, { ...course, _id: OTHER_COURSE_ID, department: OTHER_DEPARTMENT_ID }), false);
});

test("missing and invalid student or course departments fail closed", () => {
  assert.equal(canAccessCourse({
    role: "student",
    coursesEnrolled: [COURSE_ID]
  }, course), false);
  assert.equal(canAccessCourse({
    role: "student",
    department: "not-a-department-id"
  }, course), false);
  assert.equal(canAccessCourse({
    role: "student",
    department: DEPARTMENT_ID
  }, { _id: COURSE_ID }), false);
  assert.equal(canAccessCourse({
    role: "student",
    department: DEPARTMENT_ID
  }, { ...course, department: "invalid" }), false);
  assert.equal(canAccessCourse({
    role: "student",
    department: DEPARTMENT_ID
  }, { ...course, department: [DEPARTMENT_ID, OTHER_DEPARTMENT_ID] }), false);
});

test("administrators have course access and unsupported roles do not", () => {
  assert.equal(canAccessCourse({ role: "admin" }, { _id: COURSE_ID }), true);
  assert.equal(canAccessCourse({
    role: "unsupported"
  }, course), false);
});

test("course list filters use the student's department or administrator access", () => {
  assert.deepEqual(getAccessibleCourseFilter({
    role: "student",
    department: DEPARTMENT_ID,
    coursesEnrolled: [OTHER_COURSE_ID]
  }), { department: new mongoose.Types.ObjectId(DEPARTMENT_ID) });

  assert.deepEqual(getAccessibleCourseFilter({
    role: "student",
    coursesEnrolled: [COURSE_ID]
  }), { _id: { $in: [] } });

  assert.deepEqual(getAccessibleCourseFilter({ role: "unsupported" }), {
    _id: { $in: [] }
  });
  assert.deepEqual(getAccessibleCourseFilter({ role: "admin" }), {});
});
