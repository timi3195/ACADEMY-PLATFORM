const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Note = require("../models/note");
const Course = require("../models/course");
const User = require("../models/User");
const protect = require("../config/middleware/authMiddleware");
const {
  canAccessCourse,
  getAccessibleCourseFilter
} = require("../services/courseMembershipService");

router.post("/", protect, async (req, res) => {
  try {
    const { title, content, course: courseId } = req.body || {};
    if (!title || !content || !mongoose.Types.ObjectId.isValid(String(courseId || ""))) {
      return res.status(400).json({
        success: false,
        message: "A title, content, and valid course ID are required."
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({ success: false, message: "Authenticated user not found." });
    }
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ success: false, message: "Course not found." });
    }
    if (!canAccessCourse(user, course)) {
      return res.status(403).json({ success: false, message: "You do not have access to this course." });
    }

    const note = await Note.create({
      title: String(title).trim(),
      content: String(content).trim(),
      course: courseId,
    });

    return res.status(201).json({ success: true, note });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({ success: false, message: "Authenticated user not found." });
    }

    const courseFilter = getAccessibleCourseFilter(user);
    const courseIds = user.role === "admin"
      ? null
      : (await Course.find(courseFilter).select("_id").lean()).map((course) => course._id);
    const notes = await Note.find(courseIds ? { course: { $in: courseIds } } : {})
      .populate("course");

    return res.json({ success: true, notes });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/course/:courseId", protect, async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ success: false, message: "Invalid course ID." });
    }

    const [user, course] = await Promise.all([
      User.findById(req.user.id),
      Course.findById(courseId)
    ]);
    if (!user) {
      return res.status(401).json({ success: false, message: "Authenticated user not found." });
    }
    if (!course) {
      return res.status(404).json({ success: false, message: "Course not found." });
    }
    if (!canAccessCourse(user, course)) {
      return res.status(403).json({ success: false, message: "You do not have access to this course." });
    }

    const notes = await Note.find({ course: courseId });
    return res.json({ success: true, notes });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
