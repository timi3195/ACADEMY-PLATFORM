const jwt = require("jsonwebtoken");
const { extractTokenFromHeader, verifyAccessToken } = require("../../utils/token");

/**
 * Main authentication middleware
 * Supports:
 * 1. Bearer token in Authorization header
 * 2. Access token in HTTP-only cookie (accessToken)
 */
const protect = (req, res, next) => {
  let token;

  // Priority 1: Check Authorization header (Bearer token)
  if (req.headers.authorization) {
    token = extractTokenFromHeader(req.headers.authorization);
  }

  // Priority 2: Check HTTP-only cookies
  if (!token && req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Not authorized. Please provide a token."
    });
  }

  try {
    // Verify and decode token
    const decoded = verifyAccessToken(token);

    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: "Invalid token or token expired"
      });
    }

    // Attach user to request
    req.user = decoded;
    req.token = token;
    next();

  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Token invalid or expired"
    });
  }
};

module.exports = protect;