const { extractTokenFromHeader, verifyAccessToken } = require('../../utils/token');

/**
 * Optional authentication middleware.
 * If a valid Bearer token or cookie accessToken is present, attach `req.user`.
 * Otherwise, continue without error (no 401).
 */
const optionalAuth = (req, res, next) => {
  try {
    let token = null;
    if (req.headers.authorization) token = extractTokenFromHeader(req.headers.authorization);
    if (!token && req.cookies && req.cookies.accessToken) token = req.cookies.accessToken;

    if (!token) {
      return next();
    }

    const decoded = verifyAccessToken(token);
    if (decoded) {
      req.user = decoded;
      req.token = token;
    }
  } catch (err) {
    // Ignore token errors here — optional auth should not block the request
  }
  return next();
};

module.exports = optionalAuth;
