const File = require("../models/File");
const materialAccessService = require("./materialAccessService");

const getCourseMaterialFilter = (course) => ({
  $or: [
    { courseRef: course._id },
    { course: { $in: [String(course._id), course.title, course.code] } },
    { courseCode: course.code }
  ]
});

const listCourseMaterials = async ({ course, user }) => {
  const materials = await File.find(getCourseMaterialFilter(course));
  const accessible = await Promise.all(materials.map(async (material) => {
    const access = await materialAccessService.canViewMaterial({
      user,
      material,
      restrictByCourse: true
    });

    return access.allowed
      ? {
          material,
          accessReason: access.reason,
          available: materialAccessService.isMaterialStorageAvailable(material)
        }
      : null;
  }));

  return accessible.filter(Boolean);
};

const getCourseMaterial = async ({ course, user, materialId }) => {
  const material = await File.findById(materialId);
  if (!material) return null;

  const associatedCourse = await materialAccessService.resolveCourseForMaterial(material);
  if (String(associatedCourse?._id || "") !== String(course._id)) return null;

  const access = await materialAccessService.canViewMaterial({
    user,
    material,
    restrictByCourse: true
  });
  if (!access.allowed) return null;

  return {
    material,
    accessReason: access.reason,
    available: materialAccessService.isMaterialStorageAvailable(material)
  };
};

module.exports = {
  getCourseMaterialFilter,
  listCourseMaterials,
  getCourseMaterial
};
