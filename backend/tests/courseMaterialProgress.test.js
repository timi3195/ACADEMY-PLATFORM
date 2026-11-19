const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "course-material-progress-test-secret";
const { generateAccessToken } = require("../utils/token");
const progressRouter = require("../routes/courseProgress");
const Course = require("../models/course");
const CourseMaterialProgress = require("../models/CourseMaterialProgress");
const User = require("../models/User");
const courseMaterialService = require("../services/courseMaterialService");

const STUDENT_ID = "507f1f77bcf86cd799439011";
const OTHER_STUDENT_ID = "507f1f77bcf86cd799439012";
const COURSE_ID = "507f1f77bcf86cd799439021";
const MATERIAL_ID = "507f1f77bcf86cd799439031";
const SECOND_MATERIAL_ID = "507f1f77bcf86cd799439032";
const UNAVAILABLE_MATERIAL_ID = "507f1f77bcf86cd799439033";
const DEPARTMENT_ID = "507f1f77bcf86cd799439041";

const makeStudent = (id = STUDENT_ID, department = DEPARTMENT_ID) => ({
  _id: id,
  id,
  role: "student",
  department
});

const courseRecord = {
  _id: COURSE_ID,
  title: "Applied Mathematics",
  code: "MATH101",
  department: DEPARTMENT_ID
};

const makeMaterialEntry = (id, available = true) => ({
  material: { _id: id },
  available,
  accessReason: "course_access_granted"
});

const buildApp = (student = makeStudent()) => {
  const app = express();
  app.use(express.json());
  const token = generateAccessToken(student.id, student);
  app.use((req, res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    next();
  });
  app.use("/api/course-progress", progressRouter);
  return app;
};

const withMocks = async (run, {
  student = makeStudent(),
  course = courseRecord,
  materials = [makeMaterialEntry(MATERIAL_ID), makeMaterialEntry(SECOND_MATERIAL_ID)],
  records = []
} = {}) => {
  const original = {
    userFindById: User.findById,
    courseFindById: Course.findById,
    progressFind: CourseMaterialProgress.find,
    progressFindOneAndUpdate: CourseMaterialProgress.findOneAndUpdate,
    listCourseMaterials: courseMaterialService.listCourseMaterials,
    getCourseMaterial: courseMaterialService.getCourseMaterial
  };
  const savedRecords = records;

  User.findById = async (id) => String(id) === String(student._id) ? student : null;
  Course.findById = async (id) => String(id) === String(course._id) ? course : null;
  courseMaterialService.listCourseMaterials = async () => materials;
  courseMaterialService.getCourseMaterial = async ({ materialId }) =>
    materials.find(({ material }) => String(material._id) === String(materialId)) || null;
  CourseMaterialProgress.find = (query) => ({
    lean: async () => savedRecords.filter((record) =>
      String(record.student) === String(query.student) &&
      String(record.course) === String(query.course) &&
      query.material.$in.some((id) => String(id) === String(record.material))
    )
  });
  CourseMaterialProgress.findOneAndUpdate = async (filter, update, options = {}) => {
    let record = savedRecords.find((item) =>
      String(item.student) === String(filter.student) &&
      String(item.material) === String(filter.material)
    );
    if (!record && options.upsert) {
      record = { ...update.$setOnInsert };
      savedRecords.push(record);
    }
    if (!record) return null;
    Object.assign(record, update.$set);
    return record;
  };

  try {
    await run({ records: savedRecords });
  } finally {
    User.findById = original.userFindById;
    Course.findById = original.courseFindById;
    CourseMaterialProgress.find = original.progressFind;
    CourseMaterialProgress.findOneAndUpdate = original.progressFindOneAndUpdate;
    courseMaterialService.listCourseMaterials = original.listCourseMaterials;
    courseMaterialService.getCourseMaterial = original.getCourseMaterial;
  }
};

test("course progress counts only available materials and returns null for an empty course", async (t) => {
  await t.test("calculates progress from available items only", async () => {
    await withMocks(async ({ records }) => {
      records.push({
        student: STUDENT_ID,
        course: COURSE_ID,
        material: MATERIAL_ID,
        completed: true,
        completedAt: new Date("2025-01-01T00:00:00.000Z")
      });
      const app = buildApp();
      const response = await request(app).get(`/api/course-progress/${COURSE_ID}`);

      assert.equal(response.status, 200);
      assert.equal(response.body.progress.completedCount, 1);
      assert.equal(response.body.progress.availableMaterialCount, 2);
      assert.equal(response.body.progress.unavailableMaterialCount, 1);
      assert.equal(response.body.progress.completionPercentage, 50);
      assert.equal(response.body.progress.materials.length, 2);
    }, {
      materials: [
        makeMaterialEntry(MATERIAL_ID),
        makeMaterialEntry(SECOND_MATERIAL_ID),
        makeMaterialEntry(UNAVAILABLE_MATERIAL_ID, false)
      ]
    });
  });

  await t.test("does not fabricate a percentage for an empty course", async () => {
    await withMocks(async () => {
      const response = await request(buildApp()).get(`/api/course-progress/${COURSE_ID}`);
      assert.equal(response.status, 200);
      assert.equal(response.body.progress.availableMaterialCount, 0);
      assert.equal(response.body.progress.completionPercentage, null);
    }, { materials: [] });
  });
});

test("completion updates persist across requests, do not duplicate, and can be reopened", async () => {
  await withMocks(async ({ records }) => {
    const app = buildApp();
    const updatePath = `/api/course-progress/${COURSE_ID}/materials/${MATERIAL_ID}`;

    const completed = await request(app).patch(updatePath).send({ completed: true });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.progress.completionPercentage, 50);
    assert.equal(records.length, 1);

    const repeated = await request(app).patch(updatePath).send({ completed: true });
    assert.equal(repeated.status, 200);
    assert.equal(records.length, 1);

    const retrieved = await request(app).get(`/api/course-progress/${COURSE_ID}`);
    assert.equal(retrieved.body.progress.completedCount, 1);
    assert.equal(retrieved.body.progress.materials.find((item) => item.materialId === MATERIAL_ID).completed, true);

    const reopened = await request(app).patch(updatePath).send({ completed: false });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.progress.completedCount, 0);
    assert.equal(records.length, 1);
  });
});

test("progress is scoped to the authenticated student and department", async (t) => {
  await t.test("unauthenticated requests are denied", async () => {
    const app = express();
    app.use("/api/course-progress", progressRouter);
    const response = await request(app).get(`/api/course-progress/${COURSE_ID}`);
    assert.equal(response.status, 401);
  });

  await t.test("non-students cannot record course completion", async () => {
    const lecturer = { ...makeStudent(), role: "lecturer" };
    await withMocks(async () => {
      const response = await request(buildApp(lecturer))
        .get(`/api/course-progress/${COURSE_ID}`);
      assert.equal(response.status, 403);
    }, { student: lecturer });
  });

  await t.test("another student does not receive the owner's completion data", async () => {
    const ownerRecord = {
      student: STUDENT_ID,
      course: COURSE_ID,
      material: MATERIAL_ID,
      completed: true
    };
    await withMocks(async () => {
      const response = await request(buildApp(makeStudent(OTHER_STUDENT_ID)))
        .get(`/api/course-progress/${COURSE_ID}`);
      assert.equal(response.status, 200);
      assert.equal(response.body.progress.completedCount, 0);
      assert.equal(response.body.progress.materials[0].completed, false);
    }, {
      student: makeStudent(OTHER_STUDENT_ID),
      records: [ownerRecord]
    });
  });

  await t.test("students outside the course department are denied", async () => {
    await withMocks(async () => {
      const response = await request(buildApp(makeStudent(
        STUDENT_ID,
        "507f1f77bcf86cd799439099"
      ))).get(`/api/course-progress/${COURSE_ID}`);
      assert.equal(response.status, 403);
    }, {
      student: makeStudent(STUDENT_ID, "507f1f77bcf86cd799439099")
    });
  });
});

test("invalid IDs, invalid payloads, and unavailable materials are rejected", async (t) => {
  await withMocks(async () => {
    const app = buildApp();
    assert.equal((await request(app).get("/api/course-progress/not-an-id")).status, 400);
    assert.equal((await request(app)
      .patch(`/api/course-progress/${COURSE_ID}/materials/not-an-id`)
      .send({ completed: true })).status, 400);
    assert.equal((await request(app)
      .patch(`/api/course-progress/${COURSE_ID}/materials/${MATERIAL_ID}`)
      .send({ completed: true, student: OTHER_STUDENT_ID })).status, 400);
  });

  await t.test("unknown material cannot create progress", async () => {
    await withMocks(async ({ records }) => {
      courseMaterialService.getCourseMaterial = async () => null;
      const response = await request(buildApp())
        .patch(`/api/course-progress/${COURSE_ID}/materials/${MATERIAL_ID}`)
        .send({ completed: true });
      assert.equal(response.status, 404);
      assert.equal(records.length, 0);
    });
  });

  await t.test("unavailable material cannot be marked complete", async () => {
    await withMocks(async ({ records }) => {
      courseMaterialService.getCourseMaterial = async () => ({
        material: { _id: UNAVAILABLE_MATERIAL_ID },
        available: false
      });
      const response = await request(buildApp())
        .patch(`/api/course-progress/${COURSE_ID}/materials/${UNAVAILABLE_MATERIAL_ID}`)
        .send({ completed: true });
      assert.equal(response.status, 404);
      assert.equal(records.length, 0);
    });
  });
});

test("progress schema enforces one record per student and material", () => {
  const progressModel = require("../models/CourseMaterialProgress");
  const uniqueIndex = progressModel.schema.indexes().find(([fields, options]) =>
    fields.student === 1 && fields.material === 1 && options.unique
  );
  assert.ok(uniqueIndex);
});
