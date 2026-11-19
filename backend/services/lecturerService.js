const mongoose = require("mongoose");
const File = require("../models/File");
const User = require("../models/User");
const Course = require("../models/course");
const materialAccessService = require("./materialAccessService");
const { normalizeAcademicLevel } = require("../utils/academicLevels");
const storageService = require("./storageService");
const serializeAcademicMaterial = require("../utils/academicMaterialSerializer");

const normalizeTags = (tags) => {
  if (!tags) return [];
  const values = Array.isArray(tags) ? tags : String(tags).split(",");
  return values.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean);
};

const findAssignedCourse = async (lecturerId, courseId) => {
  if (!mongoose.Types.ObjectId.isValid(String(courseId || ""))) return null;
  const [lecturer, course] = await Promise.all([
    User.findById(lecturerId).select("role lecturerStatus").lean(),
    Course.findOne({ _id: courseId }).lean()
  ]);
  if (lecturer?.role !== "admin") return null;
  return course;
};

const findOwnedAssignedMaterial = async (lecturerId, materialId) => {
  if (!mongoose.Types.ObjectId.isValid(String(materialId || ""))) return null;
  const material = await File.findOne({ _id: materialId, isDeleted: false });
  if (!material) return null;

  const course = await materialAccessService.resolveCourseForMaterial(material);
  if (!course) return null;
  if (!material.courseRef) {
    material.courseRef = course._id;
    await material.save();
  }
  return material;
};

const getAssignedMaterialsFilter = (lecturerId, courses) => ({
  lecturer: lecturerId,
  isDeleted: false,
  $or: [
    { courseRef: { $in: courses.map((course) => course._id) } },
    { course: { $in: courses.flatMap((course) => [course.title, course.code]) } },
    { courseCode: { $in: courses.map((course) => course.code) } }
  ]
});

const getLecturerDashboard = async (lecturerId) => {
  const courses = await getLecturerCourses(lecturerId);
  const filters = {
    isDeleted: false,
    $or: [
      { courseRef: { $in: courses.map((course) => course._id) } },
      { course: { $in: courses.flatMap((course) => [course.title, course.code]) } },
      { courseCode: { $in: courses.map((course) => course.code) } }
    ]
  };
  const materials = await File.find(filters);
  const newestMaterials = await File.find(filters)
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  return {
    totalMaterials: materials.length,
    publishedMaterials: materials.filter((material) => material.status === "published" || material.status === "approved" || material.approved).length,
    draftMaterials: materials.filter((material) => material.status === "draft").length,
    totalDownloads: materials.reduce((sum, material) => sum + (material.downloads || 0), 0),
    totalViews: materials.reduce((sum, material) => sum + (material.views || 0), 0),
    newestMaterials: newestMaterials.map((material) => serializeAcademicMaterial({
      ...material,
      fileUrl: `/api/files/view/${material._id}`,
      downloadUrl: `/api/files/download/${material._id}`
    }))
  };
};

const getLecturerCourses = async (lecturerId) => {
  const lecturer = await User.findById(lecturerId).select("role lecturerStatus").lean();
  if (lecturer?.role !== "admin") return [];
  return Course.find({})
    .select("_id title code department level semester")
    .populate("department", "name")
    .sort({ code: 1 })
    .lean();
};

const getLecturerMaterials = async (lecturerId, query = {}) => {
  const courses = await getLecturerCourses(lecturerId);
  const courseIds = courses.map((course) => course._id);
  const filters = {
    isDeleted: false,
    $or: [
      { courseRef: { $in: courseIds } },
      { course: { $in: courses.flatMap((course) => [course.title, course.code]) } },
      { courseCode: { $in: courses.map((course) => course.code) } }
    ]
  };
  if (query.q) filters.$text = { $search: query.q };
  if (query.course) {
    if (!courseIds.some((id) => String(id) === String(query.course))) {
      return { materials: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    }
    filters.courseRef = query.course;
  }
  if (query.status && ["draft", "published"].includes(query.status)) filters.status = query.status;

  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Number(query.limit) || 20, 50);
  const skip = (page - 1) * limit;
  const materials = await File.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
  const total = await File.countDocuments(filters);
  return {
    materials: materials.map((material) => serializeAcademicMaterial({
      ...material,
      fileUrl: `/api/files/view/${material._id}`,
      downloadUrl: `/api/files/download/${material._id}`
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  };
};

const createLecturerMaterial = async ({ user, body, file, coverImage }) => {
  const course = await findAssignedCourse(user.id, body.course);
  if (!course) {
    const error = new Error("Select a course assigned to your approved lecturer account.");
    error.statusCode = 403;
    throw error;
  }
  const lecturer = await User.findById(user.id).select("name email").lean();
  const materialId = new mongoose.Types.ObjectId();
  const storageData = await storageService.uploadUploadedFile({ file, materialId });
  const isDraft = body.status === "draft";
  const created = await File.create({
    _id: materialId,
    title: body.title.trim(),
    description: body.description.trim(),
    coverImageUrl: coverImage ? `/uploads/${coverImage.filename}` : "",
    coverImageFilename: coverImage?.filename || "",
    coverImageOriginalName: coverImage?.originalname || "",
    fileUrl: `/api/files/view/${materialId}`,
    ...storageData,
    originalFilename: file.originalname,
    originalName: file.originalname,
    course: course.title,
    courseRef: course._id,
    courseCode: course.code,
    department: String(course.department),
    semester: course.semester,
    lecturer: null,
    lecturerName: lecturer?.name || lecturer?.email || user.email || "",
    category: body.category || body.materialType || "Lecture Notes",
    materialType: body.materialType || "Lecture Note",
    visibility: "public",
    level: normalizeAcademicLevel(course.level),
    previewPages: Number(body.previewPages || 0),
    pageCount: Number(body.pageCount || body.previewPages || 0),
    productStatus: isDraft ? "draft" : "published",
    status: isDraft ? "draft" : "published",
    language: body.language || "English",
    tags: normalizeTags(body.tags),
    approved: true,
    hidden: false,
    isDeleted: false,
    downloads: 0,
    views: 0
  });
  return serializeAcademicMaterial(created);
};

const updateLecturerMaterial = async ({ user, materialId, body, file, coverImage }) => {
  const material = await findOwnedAssignedMaterial(user.id, materialId);
  if (!material) return null;

  const course = body.course
    ? await findAssignedCourse(user.id, body.course)
    : await findAssignedCourse(user.id, material.courseRef);
  if (!course) {
    const error = new Error("Material must belong to a course assigned to your approved lecturer account.");
    error.statusCode = 403;
    throw error;
  }

  const updates = {
    title: body.title !== undefined ? body.title.trim() : material.title,
    description: body.description !== undefined ? body.description.trim() : material.description,
    course: course.title,
    courseRef: course._id,
    courseCode: course.code,
    department: String(course.department),
    semester: course.semester,
    level: normalizeAcademicLevel(course.level),
    category: body.category ?? material.category,
    materialType: body.materialType ?? material.materialType,
    status: body.status === "draft" ? "draft" : body.status === "published" ? "published" : material.status,
    productStatus: body.status === "draft" ? "draft" : body.status === "published" ? "published" : material.productStatus,
    tags: body.tags !== undefined ? normalizeTags(body.tags) : material.tags,
    previewPages: body.previewPages !== undefined ? Number(body.previewPages) : material.previewPages,
    pageCount: body.pageCount !== undefined ? Number(body.pageCount) : material.pageCount
  };

  if (coverImage) {
    updates.coverImageUrl = `/uploads/${coverImage.filename}`;
    updates.coverImageFilename = coverImage.filename;
    updates.coverImageOriginalName = coverImage.originalname;
  }
  if (file) {
    const storageData = await storageService.uploadUploadedFile({ file, materialId: material._id });
    Object.assign(updates, storageData, {
      originalFilename: file.originalname,
      originalName: file.originalname,
      fileUrl: `/api/files/view/${material._id}`
    });
  }

  Object.assign(material, updates);
  await material.save();
  return serializeAcademicMaterial(material);
};

const softDeleteMaterial = async (materialId, user) => {
  const material = await findOwnedAssignedMaterial(user.id, materialId);
  if (!material) return null;
  material.isDeleted = true;
  material.deletedAt = new Date();
  await material.save();
  return material;
};

const getMaterialAnalytics = async (lecturerId, materialId) => {
  const material = await findOwnedAssignedMaterial(lecturerId, materialId);
  if (!material) {
    const error = new Error("Material not found");
    error.statusCode = 404;
    throw error;
  }
  return { views: material.views || 0, downloads: material.downloads || 0 };
};

module.exports = {
  getLecturerDashboard,
  getLecturerCourses,
  getLecturerMaterials,
  createLecturerMaterial,
  updateLecturerMaterial,
  softDeleteMaterial,
  getMaterialAnalytics
};
