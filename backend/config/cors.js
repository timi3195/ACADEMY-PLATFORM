const cors = require('cors');

const getAllowedOrigins = () => {
  const configuredOrigins = String(process.env.FRONTEND_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origins = [
    process.env.FRONTEND_URL,
    process.env.VERCEL_FRONTEND_URL,
    ...configuredOrigins,
    'https://academy-platform-lac-five.vercel.app',
    'https://academy-platform.vercel.app',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000'
  ].filter(Boolean);

  return [...new Set(origins)];
};

const configureCors = (app) => {
  const allowedOrigins = getAllowedOrigins();

  const corsOptions = {
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204
  };

  app.use(cors(corsOptions));
  app.options(/.*/, cors(corsOptions));
};

module.exports = {
  getAllowedOrigins,
  configureCors
};
