const express = require("express");
const mongoose = require("mongoose");
const protect = require("../config/middleware/authMiddleware");
const Course = require("../models/course");
const CourseMaterialProgress = require("../models/CourseMaterialProgress");
const User = require("../models/User");
const courseMaterialService = require("../services/courseMaterialService");
const { canAccessCourse } = require("../services/courseMembershipService");

const router = express.Router();

const loadStudentCourse = async (studentId, courseId) => {
  const student = await User.findById(studentId);
  if (!student || student.role !== "student") {
    const error = new Error("Course learning progress is available to students only.");
    error.statusCode = 403;
    throw error;
  }

  const course = await Course.findById(courseId);
  if (!course) {
    const error = new Error("Course not found.");
    error.statusCode = 404;
    throw error;
  }
  if (!canAccessCourse(student, course)) {
    const error = new Error("You do not have access to this course.");
    error.statusCode = 403;
    throw error;
  }

  return { student, course };
};

const serializeCourseProgress = async ({ student, course }) => {
  const courseMaterials = await courseMaterialService.listCourseMaterials({ course, user: student });
  const availableMaterials = courseMaterials.filter((item) => item.available);
  const unavailableMaterialCount = courseMaterials.length - availableMaterials.length;
  const materialIds = availableMaterials.map(({ material }) => material._id);

  const records = materialIds.length
    ? await CourseMaterialProgress.find({
        student: student._id,
        course: course._id,
        material: { $in: materialIds }
      }).lean()
    : [];
  const progressByMaterial = new Map(
    records.map((record) => [String(record.material), record])
  );
  const materials = availableMaterials.map(({ material }) => {
    const progress = progressByMaterial.get(String(material._id));
    return {
      materialId: String(material._id),
      completed: Boolean(progress?.completed),
      completedAt: progress?.completedAt || null
    };
  });
  const completedCount = materials.filter((material) => material.completed).length;
  const availableMaterialCount = materials.length;

  return {
    courseId: String(course._id),
    completedCount,
    availableMaterialCount,
    unavailableMaterialCount,
    completionPercentage: availableMaterialCount
      ? Math.round((completedCount / availableMaterialCount) * 100)
      : null,
    materials
  };
};

const sendRouteError = (res, error, action) => {
  if (error.statusCode) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  console.error(`Course progress ${action} failed:`, error);
  return res.status(500).json({
    success: false,
    message: action === "retrieval"
      ? "Unable to retrieve course learning progress."
      : "Unable to update course learning progress."
  });
};

router.get("/:courseId", protect, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.courseId)) {
    return res.status(400).json({ success: false, message: "Invalid course ID." });
  }

  try {
    const context = await loadStudentCourse(req.user.id, req.params.courseId);
    const progress = await serializeCourseProgress(context);
    return res.json({ success: true, progress });
  } catch (error) {
    return sendRouteError(res, error, "retrieval");
  }
});

router.patch("/:courseId/materials/:materialId", protect, async (req, res) => {
  const { courseId, materialId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(courseId) ||
      !mongoose.Types.ObjectId.isValid(materialId)) {
    return res.status(400).json({ success: false, message: "Invalid course or material ID." });
  }

  const bodyKeys = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? Object.keys(req.body)
    : [];
  if (bodyKeys.length !== 1 || bodyKeys[0] !== "completed" ||
      typeof req.body.completed !== "boolean") {
    return res.status(400).json({
      success: false,
      message: "Provide only a boolean completed value."
    });
  }

  try {
    const { student, course } = await loadStudentCourse(req.user.id, courseId);
    const courseMaterial = await courseMaterialService.getCourseMaterial({
      course,
      user: student,
      materialId
    });
    if (!courseMaterial || !courseMaterial.available) {
      return res.status(404).json({ success: false, message: "Available course material not found." });
    }

    const filter = { student: student._id, material: courseMaterial.material._id };
    const update = {
      $set: {
        course: course._id,
        completed: req.body.completed,
        completedAt: req.body.completed ? new Date() : null
      },
      $setOnInsert: {
        student: student._id,
        material: courseMaterial.material._id
      }
    };

    let updated;
    try {
      updated = await CourseMaterialProgress.findOneAndUpdate(filter, update, {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      updated = await CourseMaterialProgress.findOneAndUpdate(filter, {
        $set: update.$set
      }, { new: true, runValidators: true });
      if (!updated) throw error;
    }
    if (!updated) {
      throw new Error("Course material progress could not be saved.");
    }

    const progress = await serializeCourseProgress({ student, course });
    return res.json({ success: true, progress });
  } catch (error) {
    return sendRouteError(res, error, "update");
  }
});

module.exports = router;
