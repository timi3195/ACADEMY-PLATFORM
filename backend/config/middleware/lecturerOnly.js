const User = require("../../models/User");

const lecturerOnly = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required"
      });
    }

    if (req.user.role !== "lecturer" && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Lecturer/Admin access only"
      });
    }

    if (req.user.role === "lecturer") {
      const user = await User.findById(req.user.id).select("role lecturerStatus lecturerApplication");

      if (!user || user.role !== "lecturer") {
        return res.status(403).json({
          success: false,
          message: "Your lecturer access has not been approved."
        });
      }

      if (user.lecturerStatus !== "approved") {
        const message = user.lecturerStatus === "rejected"
          ? "Your lecturer application was rejected. Please contact the administrator for review."
          : "Your lecturer application is pending approval. Please wait for admin review.";

        return res.status(403).json({
          success: false,
          message
        });
      }
    }

    next();
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

module.exports = lecturerOnly;
