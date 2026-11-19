const test = require("node:test");
const assert = require("node:assert/strict");
const File = require("../models/File");
const Course = require("../models/course");
const materialAccessService = require("../services/materialAccessService");
const courseMaterialService = require("../services/courseMaterialService");

const COURSE_ID = "507f1f77bcf86cd799439021";

test("course material listing separates accessible storage-unavailable items", async () => {
  const originals = {
    fileFind: File.find,
    canViewMaterial: materialAccessService.canViewMaterial
  };
  const available = {
    _id: "507f1f77bcf86cd799439031",
    storageProvider: "local-disk",
    storageFilename: "available.pdf",
    storageStatus: "pending"
  };
  const unavailable = {
    _id: "507f1f77bcf86cd799439032",
    storageProvider: "local-disk",
    storageFilename: "missing.pdf",
    storageStatus: "missing"
  };
  const deleted = {
    _id: "507f1f77bcf86cd799439033",
    storageProvider: "local-disk",
    storageFilename: "deleted.pdf",
    storageStatus: "pending"
  };

  File.find = async (query) => {
    assert.equal(query.$or[0].courseRef, COURSE_ID);
    return [available, unavailable, deleted];
  };
  materialAccessService.canViewMaterial = async ({ material }) => ({
    allowed: material !== deleted,
    reason: material === deleted ? "deleted" : "course_access_granted"
  });

  try {
    const items = await courseMaterialService.listCourseMaterials({
      course: { _id: COURSE_ID, title: "Course", code: "C101" },
      user: { role: "student" }
    });
    assert.deepEqual(items.map((item) => [item.material._id, item.available]), [
      [available._id, true],
      [unavailable._id, false]
    ]);
  } finally {
    File.find = originals.fileFind;
    materialAccessService.canViewMaterial = originals.canViewMaterial;
  }
});

test("material storage availability supports local legacy and object storage metadata", () => {
  assert.equal(materialAccessService.isMaterialStorageAvailable({
    storageProvider: "local-disk",
    storageFilename: "notes.pdf",
    storageStatus: "pending"
  }), true);
  assert.equal(materialAccessService.isMaterialStorageAvailable({
    storageProvider: "local-disk",
    fileUrl: "/uploads/legacy-notes.pdf",
    storageStatus: "pending"
  }), true);
  assert.equal(materialAccessService.isMaterialStorageAvailable({
    storageProvider: "object-storage",
    storageKey: "materials/material-id/notes.pdf",
    storageStatus: "migrated"
  }), true);
  assert.equal(materialAccessService.isMaterialStorageAvailable({
    storageProvider: "object-storage",
    storageKey: "",
    storageStatus: "migrated"
  }), false);
  assert.equal(materialAccessService.isMaterialStorageAvailable({
    storageProvider: "object-storage",
    storageKey: "materials/../private.pdf",
    storageStatus: "migrated"
  }), false);
  assert.equal(materialAccessService.isMaterialStorageAvailable({
    storageProvider: "local-disk",
    storageFilename: "missing.pdf",
    storageStatus: "missing"
  }), false);
});

test("material updates require the material to resolve to the requested course and be accessible", async (t) => {
  const originals = {
    fileFindById: File.findById,
    courseFindById: Course.findById,
    canViewMaterial: materialAccessService.canViewMaterial
  };
  const material = {
    _id: "507f1f77bcf86cd799439031",
    courseRef: COURSE_ID,
    storageProvider: "local-disk",
    storageFilename: "notes.pdf",
    storageStatus: "pending"
  };
  let resolvedCourseId = COURSE_ID;
  let allowed = true;
  File.findById = async () => material;
  Course.findById = async () => ({ _id: resolvedCourseId });
  materialAccessService.canViewMaterial = async () => ({
    allowed,
    reason: allowed ? "course_access_granted" : "course_membership_required"
  });

  try {
    await t.test("accepts an accessible material in the requested course", async () => {
      const result = await courseMaterialService.getCourseMaterial({
        course: { _id: COURSE_ID },
        user: { role: "student" },
        materialId: material._id
      });
      assert.equal(result.available, true);
    });

    await t.test("rejects a material associated with another course", async () => {
      resolvedCourseId = "507f1f77bcf86cd799439099";
      const result = await courseMaterialService.getCourseMaterial({
        course: { _id: COURSE_ID },
        user: { role: "student" },
        materialId: material._id
      });
      assert.equal(result, null);
    });

    await t.test("rejects a material denied by shared access rules", async () => {
      resolvedCourseId = COURSE_ID;
      allowed = false;
      const result = await courseMaterialService.getCourseMaterial({
        course: { _id: COURSE_ID },
        user: { role: "student" },
        materialId: material._id
      });
      assert.equal(result, null);
    });
  } finally {
    File.findById = originals.fileFindById;
    Course.findById = originals.courseFindById;
    materialAccessService.canViewMaterial = originals.canViewMaterial;
  }
});
