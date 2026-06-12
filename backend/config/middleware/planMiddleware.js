const User = require("../../models/User");

const requirePremium = async (req, res, next) => {
  try {
    const userId = req.user.id; // from JWT middleware

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Accept either `plan` or `subscriptionType` for premium checks
    const isPremium = (user.plan && user.plan === 'premium') || (user.subscriptionType && user.subscriptionType === 'premium')
    const isAdmin = user.role === 'admin'
    if (!isPremium && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Premium access required"
      });
    }

    req.userData = user; 
    next();

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

module.exports = requirePremium;