const express = require("express");
const router = express.Router();
const Note = require("../models/note");
const protect = require("../config/middleware/authMiddleware");
const requirePremium = require("../config/middleware/planMiddleware");

console.log("NOTE ROUTES LOADED");

// CREATE NOTE (admin later)
router.post("/", async (req, res) => {
  try {
    const note = await Note.create(req.body);

    res.json({
      success: true,
      note
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// GET ALL NOTES
router.get("/", async (req, res) => {
  try {
    const notes = await Note.find().populate("course");

    res.json({
      success: true,
      notes
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// GET NOTES BY COURSE
router.get("/course/:courseId", protect, async (req, res) => {
  try {
    const notes = await Note.find({
      course: req.params.courseId
    });

    const user = req.user;

    // If user is free, filter premium notes
    const filteredNotes =
      user.plan === "premium"
        ? notes
        : notes.filter(note => note.isPremium === false);

    res.json({
      success: true,
      notes: filteredNotes
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;