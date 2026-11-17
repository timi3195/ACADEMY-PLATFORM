 const express = require("express");
 const router = express.Router();
 const protect = require("../config/middleware/authMiddleware");
 const adminOnly = require("../config/middleware/adminOnly");
 const { getAdminLecturerList } = require("../services/adminService");
 const { classifyMongoConnectionError } = require("../utils/mongoConnection");
 const { logger } = require("../utils/logger");

 const User = require("../models/User");
 const Course = require("../models/course");
 const File = require("../models/File");
 const Department = require("../models/Department");
 const School = require("../models/School");
 const Question = require("../models/Question");

 const COURSE_MATERIAL_DIAGNOSTIC_STORAGE_KEY =
   "materials/6a7f568dbde058bf65575337/a2cb5112-5b44-4e30-b0db-725b40757417-Chapter1_Campus_Mesh_Network.docx";

 /**
  * MANAGE SCHOOLS (Admin only)
 */

// Create school
router.post("/schools", protect, adminOnly, async (req, res) => {
  try {
    const { name, description, code } = req.body;

    const school = await School.create({
      name,
      description,
      code
    });

    res.status(201).json({
      success: true,
      school
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// Get all schools
router.get("/schools", protect, async (req, res) => {
  try {
    const schools = await School.find().sort({ createdAt: -1 });

    res.json({
      success: true,
      schools
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * MANAGE DEPARTMENTS (Admin only)
 */

// Create department
router.post("/departments", protect, adminOnly, async (req, res) => {
  try {
    const { name, code, school, description } = req.body;

    if (!name || !code || !school) {
      return res.status(400).json({
        success: false,
        message: "Name, code, and school are required"
      });
    }

    const department = await Department.create({
      name,
      code,
      school,
      description
    });

    await department.populate("school", "name");

    res.status(201).json({
      success: true,
      department
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// Get departments by school
router.get("/departments/:schoolId", protect, async (req, res) => {
  try {
    const departments = await Department.find({ school: req.params.schoolId })
      .populate("school", "name")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      departments
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * MANAGE USERS (Admin only)
 */

// Promote user to lecturer or admin
router.put("/users/:userId/role", protect, adminOnly, async (req, res) => {
  try {
    const { role, department } = req.body;

    if (!["student", "lecturer", "admin"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role"
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { role, department },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      user
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// Get all users with filters
router.get("/users", protect, adminOnly, async (req, res) => {
  try {
    const { role, department } = req.query;
    const filter = {};

    if (role) filter.role = role;
    if (department) filter.department = department;

    const users = await User.find(filter)
      .populate("department", "name code")
      .sort({ createdAt: -1 })
      .select("-__v");

    res.json({
      success: true,
      count: users.length,
      users
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// Get all lecturer applications
router.get("/lecturers", protect, adminOnly, async (req, res) => {
  try {
    const { status } = req.query;
    const result = await getAdminLecturerList({ status });

    res.json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// Approve lecturer application
router.patch("/lecturers/:userId/approve", protect, adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Lecturer not found"
      });
    }

    user.role = "lecturer";
    user.lecturerStatus = "approved";
    user.lecturerApplication = {
      ...user.lecturerApplication,
      reviewedAt: new Date(),
      reviewedBy: req.user.id,
      approvedAt: new Date(),
      approvedBy: req.user.id,
      rejectedAt: null,
      rejectedBy: null,
      rejectionReason: ""
    };

    await user.save();

    res.json({
      success: true,
      message: "Lecturer approved successfully",
      user
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// Reject lecturer application
router.patch("/lecturers/:userId/reject", protect, adminOnly, async (req, res) => {
  try {
    const { reason } = req.body || {};
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Lecturer not found"
      });
    }

    user.lecturerStatus = "rejected";
    user.role = "lecturer";
    user.lecturerApplication = {
      ...user.lecturerApplication,
      reviewedAt: new Date(),
      reviewedBy: req.user.id,
      rejectedAt: new Date(),
      rejectedBy: req.user.id,
      rejectionReason: reason || "Application did not meet the platform requirements.",
      approvedAt: null,
      approvedBy: null
    };

    await user.save();

    res.json({
      success: true,
      message: "Lecturer application rejected",
      user
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * ANALYTICS (Admin only)
 */

// Get platform statistics
router.get("/analytics/stats", protect, adminOnly, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalStudents = await User.countDocuments({ role: "student" });
    const totalLecturers = await User.countDocuments({ role: "lecturer" });
    const totalCourses = await Course.countDocuments();
    const totalQuestions = await Question.countDocuments();
    const totalDepartments = await Department.countDocuments();

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalStudents,
        totalLecturers,
        totalCourses,
        totalQuestions,
        totalDepartments
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// Get department statistics
router.get("/analytics/departments", protect, adminOnly, async (req, res) => {
  try {
    const deptStats = await Department.aggregate([
      {
        $lookup: {
          from: "courses",
          localField: "_id",
          foreignField: "department",
          as: "courses"
        }
      },
      {
        $lookup: {
          from: "questions",
          localField: "_id",
          foreignField: "department",
          as: "questions"
        }
      },
      {
        $project: {
          name: 1,
          code: 1,
          courseCount: { $size: "$courses" },
          questionCount: { $size: "$questions" }
        }
      }
    ]);

    res.json({
      success: true,
      stats: deptStats
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// Temporary admin-only diagnostic; remove after production verification.
router.get("/diagnostics/course-material", protect, adminOnly, async (req, res) => {
  try {
    const [courseCodeMatch, courseTitleMatch, material] = await Promise.all([
      Course.exists({ code: "NCC221" }),
      Course.exists({ title: "Cloud Computing 4" }),
      File.findOne({ storageKey: COURSE_MATERIAL_DIAGNOSTIC_STORAGE_KEY })
        .select("courseCode course storageProvider storageStatus storageKey")
        .lean()
    ]);

    const courseReference =
      typeof material?.course === "string" ? material.course.trim() : "";
    const courseId = /^[a-f\d]{24}$/i.test(courseReference) ? courseReference : null;
    const referencedCourseResolves = courseId
      ? Boolean(await Course.exists({ _id: courseId }))
      : false;

    return res.json({
      success: true,
      courseCodeNCC221Exists: Boolean(courseCodeMatch),
      courseTitleCloudComputing4Exists: Boolean(courseTitleMatch),
      materialExists: Boolean(material),
      material: material
        ? {
            courseCode: material.courseCode || "",
            courseId,
            storageProvider: material.storageProvider || "",
            storageStatus: material.storageStatus || "",
            storageKey: material.storageKey || ""
          }
        : null,
      referencedCourseResolves
    });
  } catch (error) {
    logger.error("course_material_diagnostic_failed", {
      category: classifyMongoConnectionError(error)
    });
    return res.status(500).json({
      success: false,
      message: "Course-material diagnostic failed."
    });
  }
});

module.exports = router;
