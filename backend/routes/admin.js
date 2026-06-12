const express = require("express");
const router = express.Router();
const protect = require("../config/middleware/authMiddleware");
const adminOnly = require("../config/middleware/adminOnly");

const User = require("../models/User");
const Course = require("../models/course");
const Department = require("../models/Department");
const School = require("../models/School");
const Question = require("../models/Question");

console.log("🛡️ ADMIN ROUTES LOADED");

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
