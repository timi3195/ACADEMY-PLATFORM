const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Course = require("../models/course");
const Question = require("../models/Question");
const Note = require("../models/note");
const materialAccessService = require("../services/materialAccessService");
const serializeAcademicMaterial = require("../utils/academicMaterialSerializer");

const STUDENT_ID = "507f1f77bcf86cd799439011";
const COURSE_ID = "507f1f77bcf86cd799439021";
const DEPARTMENT_ID = "507f1f77bcf86cd799439041";

test("course material access ignores legacy paid and premium markers", async (t) => {
  const originalFindById = Course.findById;
  const course = {
    _id: COURSE_ID,
    title: "Course",
    department: DEPARTMENT_ID,
    lecturers: []
  };
  Course.findById = async () => course;
  t.after(() => { Course.findById = originalFindById; });

  const user = {
    id: STUDENT_ID,
    role: "student",
    department: new mongoose.Types.ObjectId(DEPARTMENT_ID),
    plan: "free"
  };
  const material = {
    _id: "507f1f77bcf86cd799439031",
    courseRef: new mongoose.Types.ObjectId(COURSE_ID),
    status: "published",
    approved: true,
    isPaid: true,
    price: 500,
    isPremium: true
  };

  const access = await materialAccessService.canViewMaterial({
    user,
    material,
    restrictByCourse: true
  });

  assert.equal(access.allowed, true);
  assert.equal(access.reason, "course_access_granted");
});

test("academic material serialization excludes legacy commerce and review data", () => {
  const material = serializeAcademicMaterial({
    _id: "material-1",
    title: "Lecture notes",
    courseRef: COURSE_ID,
    course: "Course",
    price: 500,
    isFree: false,
    isPaid: true,
    isPremium: true,
    sales: 3,
    purchases: 2,
    ratingAverage: 4.5,
    ratingCount: 2,
    reviews: [{ rating: 5 }],
    status: "published"
  });

  assert.equal(material.title, "Lecture notes");
  assert.equal(material.status, "published");
  for (const field of ["price", "isFree", "isPaid", "isPremium", "sales", "purchases", "ratingAverage", "ratingCount", "reviews"]) {
    assert.equal(Object.hasOwn(material, field), false);
  }
});

test("course serialization does not expose a legacy premium marker", () => {
  const course = new Course({
    _id: COURSE_ID,
    title: "Course",
    code: "C101",
    department: DEPARTMENT_ID,
    level: "ND1",
    isPremium: true
  }).toJSON();

  assert.equal(course.title, "Course");
  assert.equal(Object.hasOwn(course, "isPremium"), false);
});

test("legacy note and question premium markers are not serialized", () => {
  const note = new Note({
    title: "Study note",
    content: "Content",
    course: COURSE_ID,
    isPremium: true
  }).toJSON();
  const question = new Question({
    course: COURSE_ID,
    department: DEPARTMENT_ID,
    topic: "Topic",
    question: "Question?",
    options: ["A", "B"],
    answer: "A",
    year: "2026",
    isPremium: true,
    subQuestions: [{
      question: "Subquestion?",
      options: ["A", "B"],
      answer: "A",
      isPremium: true
    }]
  }).toJSON();

  assert.equal(Object.hasOwn(note, "isPremium"), false);
  assert.equal(Object.hasOwn(question, "isPremium"), false);
  assert.equal(Object.hasOwn(question.subQuestions[0], "isPremium"), false);
});
