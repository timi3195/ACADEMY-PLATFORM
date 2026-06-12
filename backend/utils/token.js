const jwt = require("jsonwebtoken");

/**
 * Generate JWT access token (short-lived)
 * @param {string} userId - User ID
 * @param {object} userData - Additional user data to embed
 * @returns {string} JWT token
 */
const generateAccessToken = (userId, userData = {}) => {
  const payload = {
    id: userId,
    email: userData.email,
    role: userData.role,
    type: "access"
  };

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: "15m" // Short-lived access token
  });
};

/**
 * Generate refresh token (long-lived)
 * @param {string} userId - User ID
 * @returns {string} JWT refresh token
 */
const generateRefreshToken = (userId) => {
  const payload = {
    id: userId,
    type: "refresh"
  };

  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, {
    expiresIn: "30d" // Long-lived refresh token
  });
};

/**
 * Verify access token
 * @param {string} token - JWT token to verify
 * @returns {object|null} Decoded token or null if invalid
 */
const verifyAccessToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== "access") {
      return null;
    }
    return decoded;
  } catch (err) {
    return null;
  }
};

/**
 * Verify refresh token
 * @param {string} token - JWT token to verify
 * @returns {object|null} Decoded token or null if invalid
 */
const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
    if (decoded.type !== "refresh") {
      return null;
    }
    return decoded;
  } catch (err) {
    return null;
  }
};

/**
 * Decode token without verification (for checking expiration, etc.)
 * @param {string} token - JWT token
 * @returns {object|null} Decoded payload or null if invalid
 */
const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (err) {
    return null;
  }
};

/**
 * Extract token from Authorization header
 * @param {string} authHeader - Authorization header (e.g., "Bearer token123")
 * @returns {string|null} Token or null if not found
 */
const extractTokenFromHeader = (authHeader) => {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.substring(7);
};

/**
 * Generate both access and refresh tokens
 * Returns object with both tokens for use in auth responses
 */
const generateTokenPair = (userId, userData = {}) => {
  return {
    accessToken: generateAccessToken(userId, userData),
    refreshToken: generateRefreshToken(userId)
  };
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  decodeToken,
  extractTokenFromHeader,
  generateTokenPair
};
