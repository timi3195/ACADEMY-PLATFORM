const crypto = require('crypto');

const SENSITIVE_KEYS = new Set([
  'password',
  'confirmPassword',
  'token',
  'authorization',
  'cookie',
  'secret',
  'apiKey',
  'accessToken',
  'refreshToken',
  'session'
]);

function isSensitiveKey(key) {
  const normalized = String(key || '').toLowerCase();
  return SENSITIVE_KEYS.has(normalized) || normalized.includes('password') || normalized.includes('token') || normalized.includes('secret') || normalized.includes('cookie') || normalized.includes('authorization');
}

function sanitizeForLog(value, parentKey = '', seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    if (isSensitiveKey(parentKey)) {
      return value.length > 0 ? '********' : value;
    }
    return value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, parentKey, seen));
  }

  const sanitized = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const nextKey = String(key || '');
    if (isSensitiveKey(nextKey)) {
      sanitized[key] = '********';
      continue;
    }

    sanitized[key] = sanitizeForLog(nestedValue, nextKey, seen);
  }

  return sanitized;
}

function buildRequestId(req) {
  if (!req) return crypto.randomUUID();
  req.id = req.id || crypto.randomUUID();
  return req.id;
}

function log(level, event, details = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details
  };

  console.log(JSON.stringify(payload));
}

const logger = {
  info(event, details = {}) {
    log('info', event, details);
  },
  warn(event, details = {}) {
    log('warn', event, details);
  },
  error(event, details = {}) {
    log('error', event, details);
  },
  requestLogger(req, res, next) {
    const start = Date.now();
    const requestId = buildRequestId(req);
    const requestBody = ['POST', 'PUT', 'PATCH'].includes(req.method) && req.body ? sanitizeForLog(req.body) : null;

    logger.info('request', {
      requestId,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip || req.socket?.remoteAddress || 'unknown',
      userId: req.user?.id || req.user?._id || null,
      userEmail: req.user?.email || null,
      body: requestBody && Object.keys(requestBody).length ? requestBody : null,
      query: req.query && Object.keys(req.query).length ? req.query : null
    });

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      logger.info('response', {
        requestId,
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
        userId: req.user?.id || req.user?._id || null,
        userEmail: req.user?.email || null,
        body: sanitizeForLog(body)
      });
      return originalJson(body);
    };

    res.on('finish', () => {
      if (!res.headersSent) {
        logger.info('response', {
          requestId,
          method: req.method,
          url: req.originalUrl,
          statusCode: res.statusCode,
          durationMs: Date.now() - start,
          userId: req.user?.id || req.user?._id || null,
          userEmail: req.user?.email || null
        });
      }
    });

    next();
  }
};

module.exports = {
  logger,
  sanitizeForLog,
  buildRequestId,
  isSensitiveKey
};
