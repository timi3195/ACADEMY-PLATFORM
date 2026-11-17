const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "note-course-access-test-secret";
const { generateAccessToken } = require("../utils/token");
const notesRouter = require("../routes/note");
const Note = require("../models/note");
const Course = require("../models/course");
const User = require("../models/User");

const STUDENT_ID = "507f1f77bcf86cd799439011";
const OTHER_STUDENT_ID = "507f1f77bcf86cd799439012";
const COURSE_ID = "507f1f77bcf86cd799439021";
const OTHER_COURSE_ID = "507f1f77bcf86cd799439022";
const DEPARTMENT_ID = "507f1f77bcf86cd799439031";
const OTHER_DEPARTMENT_ID = "507f1f77bcf86cd799439032";

const buildApp = (userId = STUDENT_ID, role = "student") => {
  const app = express();
  app.use(express.json());
  if (userId) {
    const token = generateAccessToken(userId, { role });
    app.use((req, res, next) => {
      req.headers.authorization = `Bearer ${token}`;
      next();
    });
  }
  app.use("/api/notes", notesRouter);
  return app;
};

const withMocks = async (run, {
  enrolled = [],
  department = DEPARTMENT_ID
} = {}) => {
  const originals = {
    noteFind: Note.find,
    noteCreate: Note.create,
    courseFind: Course.find,
    courseFindById: Course.findById,
    userFindById: User.findById
  };
  const state = { noteQuery: null, createdNote: null };
  const user = { _id: STUDENT_ID, role: "student", department, coursesEnrolled: enrolled };
  const courses = [
    { _id: COURSE_ID, department: DEPARTMENT_ID, lecturers: [] },
    { _id: OTHER_COURSE_ID, department: OTHER_DEPARTMENT_ID, lecturers: [] }
  ];
  const notes = [
    { _id: "note-free", course: COURSE_ID, isPremium: false },
    { _id: "note-legacy-premium", course: COURSE_ID, isPremium: true },
    { _id: "note-other-course", course: OTHER_COURSE_ID, isPremium: false }
  ];

  User.findById = async (id) => String(id) === STUDENT_ID ? user : null;
  Course.findById = async (id) => courses.find((course) => String(course._id) === String(id)) || null;
  Course.find = (filter) => ({
    select() { return this; },
    lean: async () => courses.filter((course) =>
      filter._id?.$in
        ? filter._id.$in.some((courseId) => String(courseId) === String(course._id))
        : String(filter.department) === String(course.department)
    )
  });
  Note.find = (filter) => {
    state.noteQuery = filter;
    const result = filter.course?.$in
      ? notes.filter((note) => filter.course.$in.some((id) => String(id) === String(note.course)))
      : filter.course
        ? notes.filter((note) => String(note.course) === String(filter.course))
        : notes;
    return {
      populate: async () => result
    };
  };
  Note.create = async (payload) => {
    state.createdNote = payload;
    return { _id: "new-note", ...payload };
  };

  try {
    await run(state);
  } finally {
    Note.find = originals.noteFind;
    Note.create = originals.noteCreate;
    Course.find = originals.courseFind;
    Course.findById = originals.courseFindById;
    User.findById = originals.userFindById;
  }
};

test("students see notes for their department without enrollment", async () => {
  await withMocks(async (state) => {
    const response = await request(buildApp()).get("/api/notes");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.notes.map((note) => note._id), ["note-free", "note-legacy-premium"]);
    assert.deepEqual(state.noteQuery, { course: { $in: [COURSE_ID] } });
  });
});

test("students cannot read or create notes in another department despite enrollment", async () => {
  await withMocks(async (state) => {
    const readResponse = await request(buildApp()).get(`/api/notes/course/${OTHER_COURSE_ID}`);
    const createResponse = await request(buildApp())
      .post("/api/notes")
      .send({ title: "Test", content: "Content", course: OTHER_COURSE_ID, isPremium: true });

    assert.equal(readResponse.status, 403);
    assert.equal(createResponse.status, 403);
    assert.equal(state.createdNote, null);
  }, { enrolled: [OTHER_COURSE_ID] });
});

test("note creation requires authentication and cannot mark a note as premium", async () => {
  await withMocks(async (state) => {
    const unauthenticated = await request(buildApp(null)).get("/api/notes");
    const created = await request(buildApp())
      .post("/api/notes")
      .send({ title: "Study note", content: "Review chapter 1", course: COURSE_ID, isPremium: true });

    assert.equal(unauthenticated.status, 401);
    assert.equal(created.status, 201);
    assert.equal(state.createdNote.isPremium, false);
  });
});
