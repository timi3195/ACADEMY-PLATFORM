const User = require("../../models/User");

const requirePremium = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required"
      });
    }

    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const isPremium = (user.plan && user.plan === 'premium') || (user.subscriptionType && user.subscriptionType === 'premium');
    const isAdmin = user.role === 'admin';
    if (!isPremium && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Premium access required"
      });
    }

    req.userData = user;
    return next();
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

module.exports = requirePremium;