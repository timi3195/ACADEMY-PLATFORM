const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { Readable } = require("node:stream");

process.env.JWT_SECRET = process.env.JWT_SECRET || "file-course-membership-test-secret";
const { generateAccessToken } = require("../utils/token");
const fileRouter = require("../routes/file");
const File = require("../models/File");
const Course = require("../models/course");
const Department = require("../models/Department");
const User = require("../models/User");
const materialAccessService = require("../services/materialAccessService");
const storageService = require("../services/storageService");

const STUDENT_ID = "507f1f77bcf86cd799439011";
const OTHER_STUDENT_ID = "507f1f77bcf86cd799439012";
const OWNER_ID = "507f1f77bcf86cd799439013";
const MATERIAL_ID = "507f1f77bcf86cd799439021";
const COURSE_ID = "507f1f77bcf86cd799439031";
const DEPARTMENT_ID = "507f1f77bcf86cd799439041";

const courseRecord = {
  _id: COURSE_ID,
  title: "Applied Mathematics",
  code: "MATH101",
  department: DEPARTMENT_ID,
  level: "ND1",
  semester: "First"
};

const buildApp = (user) => {
  const app = express();
  const token = generateAccessToken(user.id, user);
  app.use((req, res, next) => {
    req.headers.authorization = ["Be", "arer ", token].join("");
    next();
  });
  app.use("/api/files", fileRouter);
  return app;
};

const makeMaterial = (overrides = {}) => {
  const material = new File({
    _id: MATERIAL_ID,
    title: "Mathematics notes",
    fileUrl: `/api/files/view/${MATERIAL_ID}`,
    course: courseRecord.title,
    courseCode: courseRecord.code,
    department: "Computer Science",
    semester: "First",
    level: "ND1",
    category: "Lecture Notes",
    materialType: "Lecture Note",
    visibility: "public",
    productStatus: "published",
    status: "published",
    approved: true,
    hidden: false,
    isDeleted: false,
    deletedAt: null,
    isFree: true,
    originalName: "mathematics.txt",
    storageFilename: "mathematics.txt",
    mimeType: "text/plain",
    ...overrides
  });
  material.save = async () => material;
  return material;
};

const makeStudent = (overrides = {}) => ({
  id: STUDENT_ID,
  _id: STUDENT_ID,
  role: "student",
  department: { _id: DEPARTMENT_ID },
  yearOfStudy: "ND1",
  semester: "First",
  coursesEnrolled: [],
  ...overrides
});

const withAccessMocks = async (run, {
  material = makeMaterial(),
  user = makeStudent(),
  course = courseRecord,
  courses = [courseRecord],
} = {}) => {
  const originals = {
    fileFindById: File.findById,
    fileFind: File.find,
    userFindById: User.findById,
    courseFind: Course.find,
    courseFindById: Course.findById,
    departmentFind: Department.find,
    canViewMaterial: materialAccessService.canViewMaterial,
    getObjectReadStream: storageService.getObjectReadStream
  };

  File.findById = async () => material;
  User.findById = async () => user;
  Course.find = async (query) => courses.filter((candidate) =>
    Object.entries(query).every(([key, value]) => String(candidate[key]) === String(value))
  );
  Department.find = async ({ name }) =>
    name === "Computer Science" ? [{ _id: DEPARTMENT_ID, name }] : [];
  storageService.getObjectReadStream = async () => Readable.from(["file contents"]);

  try {
    await run();
  } finally {
    File.findById = originals.fileFindById;
    File.find = originals.fileFind;
    User.findById = originals.userFindById;
    Course.find = originals.courseFind;
    Course.findById = originals.courseFindById;
    Department.find = originals.departmentFind;
    materialAccessService.canViewMaterial = originals.canViewMaterial;
    storageService.getObjectReadStream = originals.getObjectReadStream;
  }
};

test("course material listing omits metadata for materials denied by shared access", async () => {
  const user = makeStudent();
  await withAccessMocks(async () => {
    const courseQuery = {
      populate() { return this; },
      then(resolve, reject) { return Promise.resolve(courseRecord).then(resolve, reject); }
    };
    const allowed = makeMaterial({ _id: "507f1f77bcf86cd799439051" });
    const denied = makeMaterial({
      _id: "507f1f77bcf86cd799439052",
      title: "Restricted draft metadata"
    });

    Course.findById = () => courseQuery;
    File.find = async () => [allowed, denied];
    materialAccessService.canViewMaterial = async ({ material }) => ({
      allowed: material._id.toString() === allowed._id.toString(),
      reason: "unpublished"
    });

    const response = await request(buildApp(user)).get(`/api/files/course/${COURSE_ID}`);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.files.map((file) => file._id), [allowed._id.toString()]);
    assert.equal(JSON.stringify(response.body).includes("Restricted draft metadata"), false);
    assert.equal(response.body.files[0].accessible, true);
  }, { user });
});

test("student automatically views and downloads same-department course material without enrollment", async () => {
  const user = makeStudent({ coursesEnrolled: [] });
  await withAccessMocks(async () => {
    const app = buildApp(user);

    const view = await request(app).get(`/api/files/view/${MATERIAL_ID}`);
    const download = await request(app).get(`/api/files/download/${MATERIAL_ID}`);

    assert.equal(view.status, 200);
    assert.equal(download.status, 200);
  }, { user });
});

test("students cannot access another department's material even when manually enrolled", async () => {
  const user = makeStudent({
    department: { _id: "507f1f77bcf86cd799439099" },
    coursesEnrolled: [COURSE_ID]
  });
  await withAccessMocks(async () => {
    const app = buildApp(user);
    const material = makeMaterial({ lecturer: OWNER_ID });
    File.findById = async () => material;

    const view = await request(app).get(`/api/files/view/${MATERIAL_ID}`);
    const download = await request(app).get(`/api/files/download/${MATERIAL_ID}`);

    assert.equal(view.status, 403);
    assert.equal(download.status, 403);
    assert.equal(view.body.message, "course_membership_required");
    assert.equal(download.body.message, "course_membership_required");
  }, { user });
});

test("student with missing or invalid department is denied view and download", async (t) => {
  for (const department of [null, "not-a-department-id"]) {
    await t.test(String(department), async () => {
      const user = makeStudent({ department, coursesEnrolled: [COURSE_ID] });
      await withAccessMocks(async () => {
        const app = buildApp(user);
        const view = await request(app).get(`/api/files/view/${MATERIAL_ID}`);
        const download = await request(app).get(`/api/files/download/${MATERIAL_ID}`);

        assert.equal(view.status, 403);
        assert.equal(download.status, 403);
        assert.equal(view.body.message, "course_membership_required");
        assert.equal(download.body.message, "course_membership_required");
      }, { user });
    });
  }
});

test("missing course department fails closed for material view and download", async (t) => {
  for (const department of [null, "invalid-department"]) {
    await t.test(String(department), async () => {
      const user = makeStudent();
      await withAccessMocks(async () => {
        const app = buildApp(user);
        const material = makeMaterial();
        File.findById = async () => material;
        Course.find = async () => [{ ...courseRecord, department }];

        const view = await request(app).get(`/api/files/view/${MATERIAL_ID}`);
        const download = await request(app).get(`/api/files/download/${MATERIAL_ID}`);

        assert.equal(view.status, 403);
        assert.equal(download.status, 403);
        assert.equal(view.body.message, "course_unresolved");
        assert.equal(download.body.message, "course_unresolved");
      }, { user });
    });
  }
});

test("matching department grants access without admin-assigned enrollment", async () => {
  const user = makeStudent({ coursesEnrolled: [] });
  await withAccessMocks(async () => {
    const app = buildApp(user);
    const view = await request(app).get(`/api/files/view/${MATERIAL_ID}`);
    const download = await request(app).get(`/api/files/download/${MATERIAL_ID}`);

    assert.equal(view.status, 200);
    assert.equal(download.status, 200);
  }, { user });
});

test("matching department grants access despite unrelated profile mismatches", async () => {
  const user = makeStudent({
    department: { _id: DEPARTMENT_ID },
    yearOfStudy: "HND2",
    semester: "Second",
    coursesEnrolled: []
  });
  await withAccessMocks(async () => {
    const app = buildApp(user);
    const view = await request(app).get(`/api/files/view/${MATERIAL_ID}`);
    const download = await request(app).get(`/api/files/download/${MATERIAL_ID}`);

    assert.equal(view.status, 200);
    assert.equal(download.status, 200);
  }, { user });
});

test("matching student can access lecturer-uploaded course material", async () => {
  const user = makeStudent();
  await withAccessMocks(async () => {
    const app = buildApp(user);
    const material = makeMaterial({ lecturer: OWNER_ID });
    File.findById = async () => material;

    const view = await request(app).get(`/api/files/view/${MATERIAL_ID}`);
    const download = await request(app).get(`/api/files/download/${MATERIAL_ID}`);

    assert.equal(view.status, 200);
    assert.equal(download.status, 200);
  }, { user });
});

test("course materials with missing or unresolved course details fail closed", async (t) => {
  await t.test("missing course details", async () => {
    await withAccessMocks(async () => {
      const app = buildApp(makeStudent());
      const material = makeMaterial({ course: "", courseCode: "" });
      File.findById = async () => material;

      const response = await request(app).get(`/api/files/view/${MATERIAL_ID}`);

      assert.equal(response.status, 403);
      assert.equal(response.body.message, "course_unresolved");
    });
  });

  await t.test("unknown course code", async () => {
    await withAccessMocks(async () => {
      const app = buildApp(makeStudent());
      const material = makeMaterial({ courseCode: "UNKNOWN101" });
      File.findById = async () => material;

      const response = await request(app).get(`/api/files/download/${MATERIAL_ID}`);

      assert.equal(response.status, 403);
      assert.equal(response.body.message, "course_unresolved");
    });
  });

  await t.test("missing legacy semester", async () => {
    await withAccessMocks(async () => {
      const app = buildApp(makeStudent());
      const material = makeMaterial({ courseCode: "", semester: "" });
      File.findById = async () => material;

      const response = await request(app).get(`/api/files/view/${MATERIAL_ID}`);

      assert.equal(response.status, 403);
      assert.equal(response.body.message, "course_unresolved");
    });
  });

  await t.test("invalid legacy semester", async () => {
    await withAccessMocks(async () => {
      const app = buildApp(makeStudent());
      const material = makeMaterial({ courseCode: "", semester: "Rain Semester" });
      File.findById = async () => material;

      const response = await request(app).get(`/api/files/download/${MATERIAL_ID}`);

      assert.equal(response.status, 403);
      assert.equal(response.body.message, "course_unresolved");
    });
  });

  await t.test("legacy course title resolves only within its department and level", async () => {
    await withAccessMocks(async () => {
      const app = buildApp(makeStudent());
      const material = makeMaterial({ courseCode: "" });
      File.findById = async () => material;
      Course.find = async (query) => {
        assert.deepEqual(query, {
          title: courseRecord.title,
          department: DEPARTMENT_ID,
          level: "ND1",
          semester: "First"
        });
        return [courseRecord];
      };
      const access = await materialAccessService.canViewMaterial({
        user: makeStudent(),
        material,
        restrictByCourse: true
      });
      assert.equal(access.allowed, true);

      const response = await request(app).get(`/api/files/view/${MATERIAL_ID}`);

      assert.equal(response.status, 200, JSON.stringify(response.body));
    });
  });

  await t.test("ambiguous legacy course title", async () => {
    await withAccessMocks(async () => {
      const app = buildApp(makeStudent());
      const material = makeMaterial({ courseCode: "" });
      File.findById = async () => material;
      Course.find = async () => [
        courseRecord,
        { ...courseRecord, _id: "507f1f77bcf86cd799439032" }
      ];

      const response = await request(app).get(`/api/files/view/${MATERIAL_ID}`);

      assert.equal(response.status, 403);
      assert.equal(response.body.message, "course_unresolved");
    });
  });

  await t.test("duplicate course-code matches are denied", async () => {
    await withAccessMocks(async () => {
      const app = buildApp(makeStudent());
      const material = makeMaterial();
      File.findById = async () => material;
      Course.find = async (query) =>
        query.code === courseRecord.code
          ? [courseRecord, { ...courseRecord, _id: "507f1f77bcf86cd799439033" }]
          : [];

      const response = await request(app).get(`/api/files/view/${MATERIAL_ID}`);

      assert.equal(response.status, 403);
      assert.equal(response.body.message, "course_unresolved");
    });
  });

  await t.test("ambiguous legacy department name", async () => {
    await withAccessMocks(async () => {
      const app = buildApp(makeStudent());
      const material = makeMaterial({ courseCode: "" });
      File.findById = async () => material;
      Department.find = async () => [
        { _id: DEPARTMENT_ID, name: "Computer Science" },
        { _id: "507f1f77bcf86cd799439042", name: "Computer Science" }
      ];

      const response = await request(app).get(`/api/files/view/${MATERIAL_ID}`);

      assert.equal(response.status, 403);
      assert.equal(response.body.message, "course_unresolved");
    });
  });
});

test("owner and admin access remain available for course materials", async (t) => {
  await t.test("owner", async () => {
    const user = makeStudent({ id: OWNER_ID, _id: OWNER_ID, department: null });
    await withAccessMocks(async () => {
      const app = buildApp(user);
      const material = makeMaterial({ courseCode: "UNKNOWN101", lecturer: OWNER_ID });
      File.findById = async () => material;

      const response = await request(app).get(`/api/files/view/${MATERIAL_ID}`);

      assert.equal(response.status, 200);
    }, { user });
  });

  await t.test("admin", async () => {
    const user = { id: STUDENT_ID, _id: STUDENT_ID, role: "admin" };
    await withAccessMocks(async () => {
      const app = buildApp(user);
      const material = makeMaterial({ courseCode: "UNKNOWN101" });
      File.findById = async () => material;

      const response = await request(app).get(`/api/files/download/${MATERIAL_ID}`);

      assert.equal(response.status, 200);
    }, { user });
  });
});

test("owner and admin retain streaming access to their unpublished materials", async (t) => {
  await t.test("owner", async () => {
    const user = makeStudent({ id: OWNER_ID, _id: OWNER_ID });
    await withAccessMocks(async () => {
      const app = buildApp(user);
      File.findById = async () => makeMaterial({
        lecturer: OWNER_ID,
        productStatus: "draft",
        status: "draft",
        approved: false
      });

      const response = await request(app).get(`/api/files/view/${MATERIAL_ID}`);

      assert.equal(response.status, 200);
    }, { user });
  });

  await t.test("admin", async () => {
    const user = { id: STUDENT_ID, _id: STUDENT_ID, role: "admin" };
    await withAccessMocks(async () => {
      const app = buildApp(user);
      File.findById = async () => makeMaterial({
        productStatus: "draft",
        status: "draft",
        approved: false
      });

      const response = await request(app).get(`/api/files/download/${MATERIAL_ID}`);

      assert.equal(response.status, 200);
    }, { user });
  });
});

test("generic non-course materials cannot be streamed through academic file endpoints", async (t) => {
  for (const route of ["view", "download"]) {
    await t.test(route, async () => {
      const user = makeStudent({ department: null, yearOfStudy: null });
      await withAccessMocks(async () => {
        const app = buildApp(user);
        const material = makeMaterial({
          course: "",
          courseCode: "",
          department: null,
          status: "published",
          approved: true,
          category: "Other",
          materialType: "Other"
        });
        File.findById = async () => material;

        const response = await request(app).get(`/api/files/${route}/${MATERIAL_ID}`);
        assert.equal(response.status, 403);
        assert.equal(response.body.message, "unpublished");
      }, { user });
    });
  }
});

test("unpublished course materials cannot bypass department course access", async (t) => {
  const cases = [
    ["draft status", { status: "draft", approved: true }],
    ["pending and unapproved", { status: "pending", approved: false }],
    ["published but unapproved", { status: "published", approved: false }],
    ["rejected", { status: "rejected", approved: false }]
  ];

  for (const [label, publicationFields] of cases) {
    await t.test(label, async () => {
      const user = makeStudent();
      await withAccessMocks(async () => {
        const app = buildApp(user);
        const material = makeMaterial(publicationFields);
        File.findById = async () => material;

        const response = await request(app).get(`/api/files/view/${MATERIAL_ID}`);

        assert.equal(response.status, 403);
        assert.equal(response.body.message, "unpublished");
      }, { user });
    });
  }
});

test("course-associated drafts are denied streaming even to matching students", async (t) => {
  for (const route of ["view", "download"]) {
    await t.test(route, async () => {
      await withAccessMocks(async () => {
        const app = buildApp(makeStudent());
        const material = makeMaterial({
          productStatus: "draft",
          status: "draft",
          approved: true
        });
        File.findById = async () => material;

        const response = await request(app).get(`/api/files/${route}/${MATERIAL_ID}`);

        assert.equal(response.status, 403);
        assert.equal(response.body.message, "unpublished");
      });
    });
  }
});

test("hidden and deleted materials cannot be streamed by ordinary students", async (t) => {
  for (const [label, overrides, reason] of [
    ["hidden", { hidden: true }, "hidden"],
    ["deleted", { isDeleted: true }, "deleted"],
    ["soft-deleted", { deletedAt: new Date() }, "deleted"]
  ]) {
    await t.test(label, async (subtest) => {
      for (const route of ["view", "download"]) {
        await subtest.test(route, async () => {
          await withAccessMocks(async () => {
            const app = buildApp(makeStudent());
            File.findById = async () => makeMaterial(overrides);

            const response = await request(app).get(`/api/files/${route}/${MATERIAL_ID}`);

            assert.equal(response.status, 403);
            assert.equal(response.body.message, reason);
          });
        });
      }
    });
  }
});

test("legacy price and premium flags do not restrict otherwise eligible course materials", async (t) => {
  for (const [label, overrides, user] of [
    ["paid course material", { isFree: false, isPaid: true }, makeStudent()],
    ["premium course material", { isFree: false, isPremium: true }, makeStudent()]
  ]) {
    await t.test(label, async () => {
      await withAccessMocks(async () => {
        const app = buildApp(user);
        File.findById = async () => makeMaterial(overrides);
        const view = await request(app).get(`/api/files/view/${MATERIAL_ID}`);
        const download = await request(app).get(`/api/files/download/${MATERIAL_ID}`);

        assert.equal(view.status, 200);
        assert.equal(download.status, 200);
      }, { user });
    });
  }
});
