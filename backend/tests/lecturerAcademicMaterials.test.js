const test = require("node:test");
const assert = require("node:assert/strict");
const File = require("../models/File");
const User = require("../models/User");
const Course = require("../models/course");
const lecturerService = require("../services/lecturerService");
const storageService = require("../services/storageService");

const LECTURER_ID = "507f1f77bcf86cd799439011";
const COURSE_ID = "507f1f77bcf86cd799439021";
const OTHER_COURSE_ID = "507f1f77bcf86cd799439022";
const DEPARTMENT_ID = "507f1f77bcf86cd799439031";

const courseRecord = {
  _id: COURSE_ID,
  title: "Trusted course title",
  code: "CSC201",
  department: DEPARTMENT_ID,
  level: "HND1",
  semester: "Second",
  lecturers: [LECTURER_ID]
};

const withModelStubs = (t, { course = courseRecord, material } = {}) => {
  const originals = {
    userFindById: User.findById,
    courseFindOne: Course.findOne,
    courseFindById: Course.findById,
    fileCreate: File.create,
    fileFindOne: File.findOne,
    uploadUploadedFile: storageService.uploadUploadedFile
  };
  User.findById = () => ({
    select() {
      return {
        lean: async () => ({ name: "Approved lecturer", email: "lecturer@example.test", role: "lecturer", lecturerStatus: "approved" })
      };
    }
  });
  Course.findOne = () => ({ lean: async () => course });
  Course.findById = async () => course;
  File.create = async (data) => ({ ...data, toObject() { return { ...this }; } });
  File.findOne = async () => material;
  storageService.uploadUploadedFile = async () => ({ storageProvider: "local-disk", storageFilename: "stored.pdf" });

  t.after(() => {
    User.findById = originals.userFindById;
    Course.findOne = originals.courseFindOne;
    Course.findById = originals.courseFindById;
    File.create = originals.fileCreate;
    File.findOne = originals.fileFindOne;
    storageService.uploadUploadedFile = originals.uploadUploadedFile;
  });
};

test("lecturer uploads bind material to assigned Course data and return no commerce fields", async (t) => {
  withModelStubs(t);
  let created;
  File.create = async (data) => {
    created = data;
    return { ...data, toObject() { return { ...this }; } };
  };

  const material = await lecturerService.createLecturerMaterial({
    user: { id: LECTURER_ID },
    body: {
      title: "  Lecture notes  ",
      description: "  Course introduction  ",
      course: COURSE_ID,
      department: "attacker-controlled-department",
      courseCode: "WRONG999",
      level: "ND1",
      semester: "First",
      price: "999",
      isPaid: "true",
      isPremium: "true",
      materialType: "Lecture Note"
    },
    file: { originalname: "notes.pdf" }
  });

  assert.equal(created.courseRef, COURSE_ID);
  assert.equal(created.course, courseRecord.title);
  assert.equal(created.courseCode, courseRecord.code);
  assert.equal(created.department, DEPARTMENT_ID);
  assert.equal(created.level, "HND1");
  assert.equal(created.semester, "Second");
  assert.equal(created.price, undefined);
  assert.equal(created.isPaid, undefined);
  assert.equal(material.title, "Lecture notes");
  for (const field of ["price", "isPaid", "isPremium", "sales", "purchases"]) {
    assert.equal(Object.hasOwn(material, field), false);
  }
});

test("unassigned courses and unapproved lecturers cannot upload teaching materials", async (t) => {
  withModelStubs(t, { course: null });
  let storageCalls = 0;
  storageService.uploadUploadedFile = async () => {
    storageCalls += 1;
    return {};
  };

  await assert.rejects(
    lecturerService.createLecturerMaterial({
      user: { id: LECTURER_ID },
      body: { title: "Attempt", description: "Attempt", course: OTHER_COURSE_ID },
      file: { originalname: "attempt.pdf" }
    }),
    (error) => error.statusCode === 403
  );
  assert.equal(storageCalls, 0);
});

test("lecturer cannot move or manage a material into a course they are not assigned", async (t) => {
  const material = {
    _id: "507f1f77bcf86cd799439041",
    courseRef: COURSE_ID,
    course: courseRecord.title,
    courseCode: courseRecord.code,
    department: DEPARTMENT_ID,
    lecturer: LECTURER_ID,
    isDeleted: false,
    async save() { this.saved = true; return this; }
  };
  withModelStubs(t, { course: null, material });
  Course.findById = async () => courseRecord;

  await assert.rejects(
    lecturerService.updateLecturerMaterial({
      user: { id: LECTURER_ID },
      materialId: material._id,
      body: { course: OTHER_COURSE_ID, title: "Unauthorized move" }
    }),
    (error) => error.statusCode === 403
  );
  assert.equal(material.saved, undefined);
});
