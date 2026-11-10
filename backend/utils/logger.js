const crypto = require('crypto');

const SENSITIVE_KEYS = new Set([
  'password',
  'pass',
  'confirmpassword',
  'token',
  'authorization',
  'auth',
  'credential',
  'privatekey',
  'accesskey',
  'cookie',
  'secret',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'session'
]);

function isSensitiveKey(key) {
  const normalized = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEYS.has(normalized) || normalized.includes('password') || normalized.includes('pass') || normalized.includes('token') || normalized.includes('secret') || normalized.includes('cookie') || normalized.includes('authorization') || normalized.includes('auth') || normalized.includes('credential') || normalized.includes('privatekey') || normalized.includes('accesskey') || normalized.includes('email') || normalized.includes('apikey');
}

function sanitizeForLog(value, parentKey = '', seen = new WeakSet(), depth = 0) {
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

  if (depth > 6) {
    return '[Truncated]';
  }

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, parentKey, seen, depth + 1));
  }

  const sanitized = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const nextKey = String(key || '');

    if (nextKey === '$__' || nextKey === '_doc' || nextKey === '$isNew' || nextKey === 'skipId' || nextKey === 'selected' || nextKey === 'exclude' || nextKey === 'wasPopulated' || nextKey === 'parent') {
      continue;
    }

    if (isSensitiveKey(nextKey)) {
      sanitized[key] = '********';
      continue;
    }

    sanitized[key] = sanitizeForLog(nestedValue, nextKey, seen, depth + 1);
  }

  return sanitized;
}

function buildRequestId(req) {
  if (!req) return crypto.randomUUID();
  req.id = req.id || crypto.randomUUID();
  return req.id;
}

function sanitizeUrlForLog(value) {
  try {
    const url = new URL(String(value || ''), 'http://localhost');
    for (const key of new Set(url.searchParams.keys())) {
      if (isSensitiveKey(key)) {
        url.searchParams.set(key, '********');
      }
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '[redacted URL]';
  }
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
      url: sanitizeUrlForLog(req.originalUrl),
      ip: req.ip || req.socket?.remoteAddress || 'unknown',
      userId: req.user?.id || req.user?._id || null,
      userEmail: req.user?.email || null,
      body: requestBody && Object.keys(requestBody).length ? requestBody : null,
      query: req.query && Object.keys(req.query).length ? sanitizeForLog(req.query) : null
    });

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      logger.info('response', {
        requestId,
        method: req.method,
        url: sanitizeUrlForLog(req.originalUrl),
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
          url: sanitizeUrlForLog(req.originalUrl),
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
  sanitizeUrlForLog,
  buildRequestId,
  isSensitiveKey
};
