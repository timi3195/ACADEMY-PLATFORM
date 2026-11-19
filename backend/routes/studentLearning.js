const express = require("express");
const protect = require("../config/middleware/authMiddleware");
const studentLearningEvidenceService = require("../services/studentLearningEvidenceService");

const router = express.Router();

router.get("/recommendations", protect, async (req, res) => {
  try {
    const recommendations = await studentLearningEvidenceService.getStudentLearningRecommendations(
      req.user.id
    );
    const { evidenceFingerprint: _evidenceFingerprint, ...response } = recommendations;
    return res.json({ success: true, ...response });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error("Student learning recommendations failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load learning recommendations."
    });
  }
});

module.exports = router;
