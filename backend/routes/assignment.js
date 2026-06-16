const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const Assignment = require("../models/Assignment");
const Submission = require("../models/Submission");
const protect = require("../config/middleware/authMiddleware");
const lecturerOnly = require("../config/middleware/lecturerOnly");
const adminOnly = require("../config/middleware/adminOnly");

console.log("📝 ASSIGNMENT ROUTES LOADED");

const uploadDir = path.join(__dirname, "../uploads/assignments");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage config for assignments
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// CREATE ASSIGNMENT (Lecturer/Admin only)
router.post("/", protect, lecturerOnly, async (req, res) => {
  try {
    const { title, description, course, type, instructions, dueDate, totalPoints, questionStructure, questions } = req.body;

    const assignment = await Assignment.create({
      title,
      description,
      course,
      type,
      instructions,
      dueDate,
      totalPoints: totalPoints || 100,
      questionStructure,
      questions,
      createdBy: req.user.id,
      publishedAt: new Date()
    });

    res.json({
      success: true,
      assignment
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// UPLOAD ASSIGNMENT ATTACHMENT
router.post("/:assignmentId/upload", protect, lecturerOnly, upload.single("file"), async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.assignmentId);
    
    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found"
      });
    }

    const fileExt = path.extname(req.file.originalname).toLowerCase();
    const fileType = {
      ".pdf": "pdf",
      ".docx": "docx",
      ".doc": "doc",
      ".png": "image",
      ".jpg": "image",
      ".jpeg": "image"
    }[fileExt] || "file";

    assignment.attachments.push({
      filename: req.file.originalname,
      fileUrl: `/uploads/assignments/${req.file.filename}`,
      fileType
    });

    await assignment.save();

    res.json({
      success: true,
      message: "File uploaded successfully",
      attachment: assignment.attachments[assignment.attachments.length - 1]
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// GET ASSIGNMENTS FOR A COURSE
router.get("/course/:courseId", protect, async (req, res) => {
  try {
    const assignments = await Assignment.find({
      course: req.params.courseId,
      visibleToStudents: true
    }).populate("createdBy", "name email");

    res.json({
      success: true,
      assignments
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// GET SINGLE ASSIGNMENT
router.get("/:id", protect, async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id)
      .populate("createdBy", "name email")
      .populate("course", "title");

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found"
      });
    }

    res.json({
      success: true,
      assignment
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// GET ASSIGNMENT WITH STUDENT'S SUBMISSION STATUS
router.get("/:id/student-view", protect, async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id)
      .populate("createdBy", "name email")
      .populate("course", "title");

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found"
      });
    }

    // Get student's submission
    const submission = await Submission.findOne({
      assignment: req.params.id,
      student: req.user.id
    });

    res.json({
      success: true,
      assignment,
      submission,
      submissionStatus: submission ? submission.status : "not-started",
      submittedAt: submission ? submission.submittedAt : null,
      score: submission ? submission.score : null
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// SUBMIT ASSIGNMENT (Student)
router.post("/:assignmentId/submit", protect, async (req, res) => {
  try {
    const { textSubmission, responses } = req.body;
    const assignmentId = req.params.assignmentId;

    const assignment = await Assignment.findById(assignmentId);
    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found"
      });
    }

    // Check if submission already exists
    let submission = await Submission.findOne({
      assignment: assignmentId,
      student: req.user.id
    });

    const now = new Date();
    const isLate = now > assignment.dueDate;

    if (!submission) {
      submission = await Submission.create({
        assignment: assignmentId,
        student: req.user.id,
        course: assignment.course,
        textSubmission,
        responses,
        status: "submitted",
        submittedAt: now,
        isLate,
        daysLate: isLate ? Math.ceil((now - assignment.dueDate) / (1000 * 60 * 60 * 24)) : 0
      });

      // Update assignment submission count
      assignment.totalSubmissions = (assignment.totalSubmissions || 0) + 1;
      await assignment.save();
    } else {
      submission.textSubmission = textSubmission;
      submission.responses = responses;
      submission.status = "submitted";
      submission.submittedAt = now;
      submission.isLate = isLate;
      submission.daysLate = isLate ? Math.ceil((now - assignment.dueDate) / (1000 * 60 * 60 * 24)) : 0;
      await submission.save();
    }

    res.json({
      success: true,
      message: "Assignment submitted successfully",
      submission
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// UPLOAD SUBMISSION FILE
router.post("/:assignmentId/submit-file", protect, upload.single("file"), async (req, res) => {
  try {
    const assignmentId = req.params.assignmentId;

    let submission = await Submission.findOne({
      assignment: assignmentId,
      student: req.user.id
    });

    if (!submission) {
      const assignment = await Assignment.findById(assignmentId);
      submission = await Submission.create({
        assignment: assignmentId,
        student: req.user.id,
        course: assignment.course,
        status: "draft"
      });
    }

    submission.submittedFiles.push({
      filename: req.file.originalname,
      fileUrl: `/uploads/assignments/${req.file.filename}`,
      fileType: path.extname(req.file.originalname).toLowerCase().slice(1)
    });

    await submission.save();

    res.json({
      success: true,
      message: "File uploaded successfully",
      submission
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// GET SUBMISSIONS FOR AN ASSIGNMENT (Lecturer/Admin)
router.get("/:assignmentId/submissions", protect, lecturerOnly, async (req, res) => {
  try {
    const submissions = await Submission.find({
      assignment: req.params.assignmentId
    })
      .populate("student", "name email")
      .sort({ submittedAt: -1 });

    res.json({
      success: true,
      submissions
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// GRADE SUBMISSION (Lecturer/Admin)
router.post("/:assignmentId/grade/:submissionId", protect, lecturerOnly, async (req, res) => {
  try {
    const { score, feedback, questionFeedback, grade } = req.body;

    const submission = await Submission.findById(req.params.submissionId);
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: "Submission not found"
      });
    }

    const assignment = await Assignment.findById(req.params.assignmentId);
    const maxScore = assignment.totalPoints;
    const percentage = (score / maxScore) * 100;

    submission.score = score;
    submission.maxScore = maxScore;
    submission.percentage = percentage;
    submission.grade = grade;
    submission.feedback = feedback;
    submission.questionFeedback = questionFeedback;
    submission.status = "graded";
    submission.gradedAt = new Date();
    submission.gradedBy = req.user.id;

    await submission.save();

    // Update assignment average score
    const allSubmissions = await Submission.find({
      assignment: req.params.assignmentId,
      status: "graded"
    });
    
    const totalScore = allSubmissions.reduce((sum, s) => sum + (s.score || 0), 0);
    assignment.averageScore = Math.round(totalScore / allSubmissions.length);
    await assignment.save();

    res.json({
      success: true,
      message: "Submission graded successfully",
      submission
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// GET STUDENT'S SUBMISSION
router.get("/:assignmentId/my-submission", protect, async (req, res) => {
  try {
    const submission = await Submission.findOne({
      assignment: req.params.assignmentId,
      student: req.user.id
    });

    res.json({
      success: true,
      submission
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// UPDATE ASSIGNMENT (Lecturer/Admin)
router.put("/:id", protect, lecturerOnly, async (req, res) => {
  try {
    const { title, description, instructions, dueDate, totalPoints, questionStructure, questions } = req.body;

    const assignment = await Assignment.findByIdAndUpdate(
      req.params.id,
      {
        title,
        description,
        instructions,
        dueDate,
        totalPoints,
        questionStructure,
        questions
      },
      { new: true }
    );

    res.json({
      success: true,
      assignment
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// DELETE ASSIGNMENT (Lecturer/Admin)
router.delete("/:id", protect, lecturerOnly, async (req, res) => {
  try {
    await Assignment.findByIdAndDelete(req.params.id);
    
    // Also delete all submissions for this assignment
    await Submission.deleteMany({ assignment: req.params.id });

    res.json({
      success: true,
      message: "Assignment deleted successfully"
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;
