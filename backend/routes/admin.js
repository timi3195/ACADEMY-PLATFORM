const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const crypto = require("crypto");
const protect = require("../config/middleware/authMiddleware");
const adminOnly = require("../config/middleware/adminOnly");
const { getAdminLecturerList } = require("../services/adminService");
const createRateLimiter = require("../utils/rateLimit");

const User = require("../models/User");
const Course = require("../models/course");
const Department = require("../models/Department");
const School = require("../models/School");
const Question = require("../models/Question");

const maskEmail = (email) => {
  if (typeof email !== "string" || !email.includes("@")) return null;
  const [localPart, ...domainParts] = email.split("@");
  return `${localPart.slice(0, 2)}*****@${domainParts.join("@")}`;
};

const rateLimitAccountDiagnostic = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxAttempts: 5,
  getKey: () => "account-diagnostic",
  message: "Too many diagnostic requests. Try again later."
});

const verifyAccountDiagnosticSecret = (req, res, next) => {
  const expectedSecret = process.env.ACCOUNT_DIAGNOSTIC_SECRET;
  const suppliedSecret = req.body?.secret;

  if (typeof expectedSecret !== "string" || typeof suppliedSecret !== "string") {
    return res.status(404).json({ success: false, message: "Not found." });
  }

  const suppliedBytes = Buffer.from(suppliedSecret, "utf8");
  const expectedBytes = Buffer.from(expectedSecret, "utf8");
  if (expectedBytes.length < 32) {
    return res.status(404).json({ success: false, message: "Not found." });
  }

  const suppliedDigest = crypto.createHash("sha256").update(suppliedBytes).digest();
  const expectedDigest = crypto.createHash("sha256").update(expectedBytes).digest();
  const digestMatches = crypto.timingSafeEqual(suppliedDigest, expectedDigest);
  const secretMatches = digestMatches && suppliedBytes.length === expectedBytes.length;

  if (!secretMatches) {
    return res.status(404).json({ success: false, message: "Not found." });
  }

  return next();
};

// TEMPORARY: Remove this endpoint and ACCOUNT_DIAGNOSTIC_SECRET after account recovery.
// The endpoint is disabled immediately when ACCOUNT_DIAGNOSTIC_SECRET is unset.
router.post("/account-diagnostic", verifyAccountDiagnosticSecret, rateLimitAccountDiagnostic, async (req, res) => {
  try {
    const [totalUsers, users] = await Promise.all([
      User.countDocuments({}),
      User.find({})
        .select("email role createdAt emailVerified -_id")
        .sort({ createdAt: 1 })
        .lean()
    ]);

    return res.json({
      success: true,
      database: mongoose.connection.name,
      totalUsers,
      users: users.map((user) => ({
        email: maskEmail(user.email),
        role: user.role || "unknown",
        registeredAt: user.createdAt || null,
        emailVerified: user.emailVerified === true
      }))
    });
  } catch {
    return res.status(503).json({
      success: false,
      message: "Account diagnostic is temporarily unavailable."
    });
  }
});

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

    const premiumUsers = await User.countDocuments({
      subscriptionType: { $in: ["premium", "basic"] }
    });

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalStudents,
        totalLecturers,
        totalCourses,
        totalQuestions,
        totalDepartments,
        premiumUsers,
        freeUsers: totalUsers - premiumUsers
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

module.exports = router;
