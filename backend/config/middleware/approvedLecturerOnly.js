const User = require("../../models/User");

// Payment configuration belongs exclusively to the authenticated approved lecturer.
module.exports = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const lecturer = await User.findById(req.user.id).select("role lecturerStatus").lean();
    if (!lecturer || lecturer.role !== "lecturer" || lecturer.lecturerStatus !== "approved") {
      return res.status(403).json({ success: false, message: "Approved lecturer access only" });
    }

    next();
  } catch (error) {
    next(error);
  }
};
