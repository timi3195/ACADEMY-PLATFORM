const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "phase-2-question-search-test-secret";
const { generateAccessToken } = require("../utils/token");
const searchRouter = require("../routes/search");
const Question = require("../models/Question");
const Course = require("../models/course");
const User = require("../models/User");
const Note = require("../models/note");
const Department = require("../models/Department");

const STUDENT_ID = "507f1f77bcf86cd799439011";
const COURSE_ID = "507f1f77bcf86cd799439021";
const OTHER_COURSE_ID = "507f1f77bcf86cd799439022";
const DEPARTMENT_ID = "507f1f77bcf86cd799439031";
const OTHER_DEPARTMENT_ID = "507f1f77bcf86cd799439032";
const UNSUPPORTED_USER_ID = "507f1f77bcf86cd799439041";
const OTHER_UNSUPPORTED_USER_ID = "507f1f77bcf86cd799439042";

const buildApp = ({ userId = STUDENT_ID, role = "student" } = {}) => {
  const app = express();
  const token = generateAccessToken(userId, { role });
  app.use((req, res, next) => {
    req.headers.authorization = "Bearer".concat(" ", token);
    next();
  });
  app.use("/api/search", searchRouter);
  return app;
};

const courses = [
  {
    _id: COURSE_ID,
    title: "Department Mathematics",
    code: "MATH101",
    department: DEPARTMENT_ID
  },
  {
    _id: OTHER_COURSE_ID,
    title: "Other Department Mathematics",
    code: "MATH201",
    department: OTHER_DEPARTMENT_ID
  }
];
const notes = [
  {
    _id: "507f1f77bcf86cd799439051",
    title: "Department Algebra Notes",
    content: "Department-only note content",
    course: COURSE_ID
  },
  {
    _id: "507f1f77bcf86cd799439052",
    title: "Other Department Algebra Notes",
    content: "PRIVATE_OTHER_DEPARTMENT_SNIPPET",
    course: OTHER_COURSE_ID
  }
];

const query = (value) => ({
  select() { return this; },
  sort() { return this; },
  limit() { return this; },
  populate() { return this; },
  lean: async () => value
});

const withSearchMocks = async (run, {
  user = {
    _id: STUDENT_ID,
    id: STUDENT_ID,
    role: "student",
    department: DEPARTMENT_ID,
    coursesEnrolled: [OTHER_COURSE_ID]
  },
  departmentRecords = [
    { _id: DEPARTMENT_ID },
    { _id: OTHER_DEPARTMENT_ID }
  ],
  courseRecords = courses
} = {}) => {
  const originals = {
    questionFind: Question.find,
    courseFind: Course.find,
    userFindById: User.findById,
    noteFind: Note.find,
    departmentFind: Department.find
  };
  const state = {
    filter: null,
    projection: null,
    courseFilter: null,
    noteFilter: null,
    departmentFilter: null
  };
  User.findById = async () => user;
  Course.find = (filter) => {
    state.courseFilter = filter;
    const matches = courseRecords.filter((course) => {
      if (filter.department && String(filter.department) !== String(course.department)) return false;
      if (filter.lecturers && !course.lecturers.some((id) => String(id) === String(filter.lecturers))) return false;
      if (filter._id?.$in && !filter._id.$in.some((id) => String(id) === String(course._id))) return false;
      return true;
    });
    return query(matches);
  };
  Department.find = (filter) => {
    state.departmentFilter = filter;
    const matches = departmentRecords.filter((department) =>
      filter._id.$in.some((id) => String(id) === String(department._id))
    );
    return query(matches);
  };
  Question.find = (filter, projection) => {
    state.filter = filter;
    state.projection = projection;
    const query = {
      sort() { return this; },
      limit() { return this; },
      select(fields) {
        state.projection = fields;
        return this;
      },
      populate() { return this; },
      lean: async () => [{
        _id: "507f1f77bcf86cd799439041",
        question: "Search-safe question",
        topic: "Algebra",
        course: COURSE_ID,
        options: ["A", "B"]
      }].filter((question) => {
        const courseIds = filter.course?.$in;
        return !courseIds || courseIds.some((id) => String(id) === String(question.course));
      })
    };
    return query;
  };
  Note.find = (filter) => {
    state.noteFilter = filter;
    const courseIds = filter.course?.$in;
    return query(notes.filter((note) =>
      !courseIds || courseIds.some((id) => String(id) === String(note.course))
    ));
  };

  try {
    await run(state);
  } finally {
    Question.find = originals.questionFind;
    Course.find = originals.courseFind;
    User.findById = originals.userFindById;
    Note.find = originals.noteFind;
    Department.find = originals.departmentFind;
  }
};

test("global question search is limited to approved questions in the student's department", async () => {
  await withSearchMocks(async (state) => {
    const response = await request(buildApp())
      .get("/api/search?q=algebra&type=questions");
    assert.equal(response.status, 200);
    assert.equal(state.filter.approvalStatus, "approved");
    assert.deepEqual(state.filter.course.$in, [COURSE_ID]);
    assert.equal(response.body.questions.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(response.body.questions[0], "answer"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(response.body.questions[0], "explanation"), false);
  });
});

test("advanced search ignores student-supplied departments and keeps results in their department", async () => {
  await withSearchMocks(async (state) => {
    const response = await request(buildApp())
      .get("/api/search/advanced?q=algebra&department=507f1f77bcf86cd799439099&level=HND2");
    assert.equal(response.status, 200);
    assert.equal(state.filter.approvalStatus, "approved");
    assert.deepEqual(state.filter.course.$in, [COURSE_ID]);
    assert.equal(state.filter.department, undefined);
    assert.deepEqual(state.courseFilter._id.$in, [COURSE_ID]);
    assert.match(state.projection, /question topic course year session difficulty options/);
    assert.equal(Object.prototype.hasOwnProperty.call(response.body.questions[0], "answer"), false);
  });
});

test("student note search returns only in-department notes, snippets, and course metadata", async () => {
  await withSearchMocks(async (state) => {
    const response = await request(buildApp()).get("/api/search?q=algebra&type=notes");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.notes.map((note) => note._id), ["507f1f77bcf86cd799439051"]);
    assert.deepEqual(state.noteFilter.course.$in, [COURSE_ID]);
    assert.equal(JSON.stringify(response.body).includes("PRIVATE_OTHER_DEPARTMENT_SNIPPET"), false);
    assert.equal(JSON.stringify(response.body).includes(OTHER_COURSE_ID), false);
  });
});

test("global student search limits course and note results to the registered department", async () => {
  await withSearchMocks(async () => {
    const response = await request(buildApp()).get("/api/search?q=mathematics");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.courses.map((course) => course._id), [COURSE_ID]);
    assert.deepEqual(response.body.notes.map((note) => note._id), ["507f1f77bcf86cd799439051"]);
  });
});

test("missing and deleted student departments fail closed in search", async (t) => {
  await t.test("missing department reference", async () => {
    await withSearchMocks(async () => {
      const response = await request(buildApp()).get("/api/search?q=algebra&type=notes");
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.notes, []);
    }, { user: { _id: STUDENT_ID, role: "student" } });
  });

  await t.test("deleted department record", async () => {
    await withSearchMocks(async (state) => {
      const response = await request(buildApp()).get("/api/search?q=algebra&type=notes");
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.notes, []);
      assert.deepEqual(state.noteFilter.course.$in, []);
    }, { departmentRecords: [{ _id: OTHER_DEPARTMENT_ID }] });
  });
});

test("unsupported roles do not receive course-scoped search results", async (t) => {
  await t.test("search results are empty", async () => {
    await withSearchMocks(async () => {
      const response = await request(buildApp({ userId: UNSUPPORTED_USER_ID, role: "unsupported" }))
        .get("/api/search?q=algebra&type=notes");

      assert.equal(response.status, 200);
      assert.deepEqual(response.body.notes, []);
    }, {
      user: {
        _id: UNSUPPORTED_USER_ID,
        id: UNSUPPORTED_USER_ID,
        role: "unsupported"
      }
    });
  });

  await t.test("a student without courses in their current department fails closed", async () => {
    await withSearchMocks(async () => {
      const response = await request(buildApp({ userId: OTHER_UNSUPPORTED_USER_ID }))
        .get("/api/search?q=algebra&type=notes");

      assert.equal(response.status, 200);
      assert.deepEqual(response.body.notes, []);
    }, {
      user: {
        _id: OTHER_UNSUPPORTED_USER_ID,
        id: OTHER_UNSUPPORTED_USER_ID,
        role: "student",
        department: DEPARTMENT_ID
      },
      courseRecords: [{ ...courses[0], department: OTHER_DEPARTMENT_ID }],
      departmentRecords: []
    });
  });
});

test("administrators retain global search access", async () => {
  await withSearchMocks(async () => {
    const response = await request(buildApp({ role: "admin" }))
      .get("/api/search?q=algebra&type=notes");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.notes.map((note) => note._id), [
      "507f1f77bcf86cd799439051",
      "507f1f77bcf86cd799439052"
    ]);
  }, {
    user: { _id: STUDENT_ID, id: STUDENT_ID, role: "admin" }
  });
});
