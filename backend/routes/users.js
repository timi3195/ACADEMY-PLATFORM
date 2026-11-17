const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const User = require("../models/User");
const Course = require("../models/course");
const Department = require("../models/Department");
const protect = require("../config/middleware/authMiddleware");
const adminOnly = require("../config/middleware/adminOnly");

const getAuthenticatedUserId = (req) => req?.user?.id || req?.user?._id || null;

const sanitizeUserRecord = (userRecord) => {
  if (!userRecord) return null;
  const source = userRecord.toObject ? userRecord.toObject() : { ...userRecord };

  delete source.password;
  delete source.refreshTokens;
  delete source.emailVerificationToken;
  delete source.emailVerificationExpires;
  delete source.resetPasswordToken;
  delete source.resetPasswordExpires;
  delete source.plan;
  delete source.subscriptionType;
  delete source.subscriptionSemester;
  delete source.subscriptionExpiresAt;
  delete source.subscriptionFeatures;
  delete source.paystackPayment;
  delete source.bankDetails;
  delete source.marketplaceSuspended;
  delete source.__v;

  return source;
};

const isValidUserId = (value) => !!value && mongoose.Types.ObjectId.isValid(String(value));

const canAccessUserRecord = (req, targetUserId) => {
  if (!req?.user) return false;
  if (req.user.role === "admin") return true;

  const authenticatedUserId = getAuthenticatedUserId(req);
  return Boolean(authenticatedUserId && String(authenticatedUserId) === String(targetUserId));
};

const selfEditableFields = new Set([
  "name",
  "matricNumber",
  "yearOfStudy",
  "semester",
  "preferences",
  "bio"
]);

const forbiddenUserFields = new Set([
  "password",
  "role",
  "plan",
  "subscriptionType",
  "subscriptionSemester",
  "subscriptionExpiresAt",
  "lecturerStatus",
  "lecturerProfile",
  "lecturerApplication",
  "marketplaceSuspended",
  "bankDetails",
  "paystackPayment",
  "emailVerified",
  "emailVerificationToken",
  "emailVerificationExpires",
  "resetPasswordToken",
  "resetPasswordExpires",
  "refreshTokens",
  "googleId",
  "authProvider",
  "lastLogin",
  "devices",
  "aiUsage",
  "subscriptionFeatures",
  "department",
  "coursesEnrolled",
  "quizzesAttempted"
]);

const filterSelfUpdatePayload = (payload = {}) => {
  const sanitized = {};

  Object.keys(payload).forEach((key) => {
    if (selfEditableFields.has(key) && payload[key] !== undefined && payload[key] !== null) {
      sanitized[key] = payload[key];
      return;
    }

    if (!forbiddenUserFields.has(key) && !key.startsWith("_")) {
      sanitized[key] = payload[key];
    }
  });

  return sanitized;
};

router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const { name, email, devices } = req.body || {};

    if (!name || !email) {
      return res.status(400).json({ success: false, message: "Name and email are required." });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "User already exists." });
    }

    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      devices
    });

    return res.status(201).json({ success: true, user: sanitizeUserRecord(user) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/", protect, adminOnly, async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).lean();
    return res.json({
      success: true,
      users: users.map((user) => sanitizeUserRecord(user))
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/:id", protect, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidUserId(id)) {
      return res.status(400).json({ success: false, message: "Invalid user id." });
    }

    if (!canAccessUserRecord(req, id)) {
      return res.status(403).json({ success: false, message: "You are not allowed to view this user profile." });
    }

    const user = await User.findById(id).select("-password -refreshTokens -emailVerificationToken -resetPasswordToken -emailVerificationExpires -resetPasswordExpires");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    return res.json({ success: true, user: sanitizeUserRecord(user) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.put("/:id", protect, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidUserId(id)) {
      return res.status(400).json({ success: false, message: "Invalid user id." });
    }

    if (!canAccessUserRecord(req, id)) {
      return res.status(403).json({ success: false, message: "You are not allowed to update this user profile." });
    }

    const existingUser = await User.findById(id);
    if (!existingUser) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const updates = req.user.role === "admin"
      ? { ...req.body }
      : filterSelfUpdatePayload(req.body);

    if (
      req.user.role === "admin" &&
      Object.prototype.hasOwnProperty.call(req.body || {}, "department") &&
      req.body.department != null
    ) {
      const departmentId = String(req.body.department);
      if (!mongoose.Types.ObjectId.isValid(departmentId)) {
        return res.status(400).json({ success: false, message: "Department ID is invalid." });
      }

      const department = await Department.findById(departmentId).select("_id").lean();
      if (!department) {
        return res.status(400).json({ success: false, message: "Department does not exist." });
      }

      updates.department = department._id;
    }

    if (
      req.user.role === "admin" &&
      Object.prototype.hasOwnProperty.call(req.body || {}, "coursesEnrolled")
    ) {
      if (existingUser.role !== "student" || !Array.isArray(req.body.coursesEnrolled)) {
        return res.status(400).json({
          success: false,
          message: "Course enrollment must be an array assigned to a student."
        });
      }

      const courseIds = [...new Set(req.body.coursesEnrolled.map((courseId) => String(courseId)))];
      if (courseIds.some((courseId) => !mongoose.Types.ObjectId.isValid(courseId))) {
        return res.status(400).json({ success: false, message: "Course enrollment contains an invalid course ID." });
      }

      const existingCourses = await Course.find({ _id: { $in: courseIds } }).select("_id").lean();
      if (existingCourses.length !== courseIds.length) {
        return res.status(400).json({ success: false, message: "Course enrollment contains an unknown course ID." });
      }

      updates.coursesEnrolled = courseIds;
    }

    Object.keys(updates).forEach((key) => {
      if (forbiddenUserFields.has(key) && !(
        req.user.role === "admin" &&
        ["coursesEnrolled", "department"].includes(key)
      )) {
        delete updates[key];
      }
    });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid profile updates provided." });
    }

    Object.assign(existingUser, updates);
    await existingUser.save();

    return res.json({ success: true, user: sanitizeUserRecord(existingUser) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidUserId(id)) {
      return res.status(400).json({ success: false, message: "Invalid user id." });
    }

    const user = await User.findByIdAndDelete(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    return res.json({ success: true, message: "User deleted successfully." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
