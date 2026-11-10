const crypto = require("node:crypto");

const MIN_SESSION_SECRET_BYTES = 32;

const resolveSessionSecret = ({
  sessionSecret = process.env.SESSION_SECRET,
  nodeEnv = process.env.NODE_ENV
} = {}) => {
  if (nodeEnv === "production") {
    if (typeof sessionSecret !== "string" || sessionSecret.length === 0) {
      throw new Error("SESSION_SECRET must be configured in production.");
    }
    if (Buffer.byteLength(sessionSecret, "utf8") < MIN_SESSION_SECRET_BYTES) {
      throw new Error("SESSION_SECRET must be at least 32 bytes in production.");
    }
    return sessionSecret;
  }

  return typeof sessionSecret === "string" && sessionSecret.length > 0
    ? sessionSecret
    : crypto.randomBytes(MIN_SESSION_SECRET_BYTES).toString("hex");
};

module.exports = {
  MIN_SESSION_SECRET_BYTES,
  resolveSessionSecret
};
