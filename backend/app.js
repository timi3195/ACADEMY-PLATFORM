const express = require("express");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const path = require("path");
const { configureCors } = require("./config/cors");
require("dotenv").config({ path: path.resolve(__dirname, '.env') });
const {
  classifyMongoConnectionError,
  registerMongoConnectionEvents,
  isDatabaseReady,
  createHealthHandler
} = require("./utils/mongoConnection");

process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && /url\.parse\(\)/i.test(warning.message)) {
    return;
  }
  console.warn(warning.stack || warning);
});

const passport = require("./config/middleware/passport");
const { logger } = require("./utils/logger");
const app = express();
const questionRoutes = require("./routes/question");
const quizSessionRoutes = require("./routes/quizSession");
const quizSessionService = require("./services/quizSessionService");
const questionExtractionRoutes = require("./routes/questionExtraction");
const protect = require("./config/middleware/authMiddleware");
const courseRoutes = require("./routes/course");
const noteRoutes = require("./routes/note");
const searchRoutes = require("./routes/search");



configureCors(app);
app.use(cookieParser());
app.use(passport.initialize());
app.use(express.json({ limit: '10mb' }));

app.use(logger.requestLogger);

// Middleware to serve PDFs inline instead of forcing download
app.use((req, res, next) => {
  // Check if request is for a PDF file
  if (req.path.endsWith('.pdf')) {
    res.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
    res.setHeader('Content-Type', 'application/pdf');
  }
  next();
});

// Keep legacy cover-image URLs working while protecting private upload files.
const fileRoutes = require("./routes/file");
app.use("/uploads", fileRoutes.legacyUploadsRouter);
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// handle malformed JSON body errors gracefully
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, message: 'Invalid JSON payload' });
  }
  next(err);
});
app.use("/api/courses", courseRoutes);
app.use("/api/course-progress", require("./routes/courseProgress"));
app.use("/api/student-learning", require("./routes/studentLearning"));
app.use("/api/notes", noteRoutes);
// Ensure question routes are mounted after body-parsing middleware
app.use("/api/questions", questionRoutes);
app.use("/api/quiz", quizSessionRoutes);
app.use("/api/question-extractions", questionExtractionRoutes);

// Mount search routes
app.use("/api/search", searchRoutes);

app.use("/api/files", fileRoutes.router);

const aiRoutes = require("./routes/ai");
app.use("/api/ai", aiRoutes);

const analyticsRoutes = require("./routes/analytics");
app.use("/api/analytics", analyticsRoutes);

const adminContentRoutes = require("./routes/lecturer");
app.use("/api/admin/content", adminContentRoutes);

app.get("/api/protected", protect, (req, res) => {
  res.json({
    message: "You accessed protected data",
    user: req.user
  });
});

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const adminRoutes = require("./routes/admin");
const departmentRoutes = require("./routes/departments");

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/departments", departmentRoutes);

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "AI Academic Platform API is running...",
    version: "1.0.0",
    timestamp: new Date().toISOString()
  });  
});

app.get("/health", createHealthHandler(mongoose.connection));
const PORT = process.env.PORT || 5000;

const startServer = async ({
  serverApp = app,
  mongooseClient = mongoose,
  mongoUri = process.env.MONGO_URI,
  port = PORT,
  afterDatabaseConnected = async () => {
    quizSessionService.startExpiryWorker();
  },
  stopBackgroundServices = () => quizSessionService.stopExpiryWorker(),
  loggerInstance = logger
} = {}) => {
  if (typeof mongoUri !== "string" || mongoUri.trim().length === 0) {
    loggerInstance.error("mongodb_startup_failed", { category: "configuration" });
    throw new Error("MongoDB URI is required to start the server.");
  }

  registerMongoConnectionEvents(mongooseClient.connection, loggerInstance);
  let connected = false;
  let cleanupPromise;
  const cleanupAfterFailure = () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      try {
        await stopBackgroundServices();
      } catch (error) {
        loggerInstance.error("startup_service_cleanup_failed", {
          category: classifyMongoConnectionError(error)
        });
      }
      if (connected && mongooseClient.connection.readyState !== 0) {
        try {
          await mongooseClient.disconnect();
        } catch (error) {
          loggerInstance.error("startup_database_cleanup_failed", {
            category: classifyMongoConnectionError(error)
          });
        }
      }
    })();
    return cleanupPromise;
  };

  try {
    await mongooseClient.connect(mongoUri);
    connected = true;
    await afterDatabaseConnected();

    const server = serverApp.listen(port, () => {
      loggerInstance.info("server_listening", { port });
    });
    if (typeof server?.on === "function") {
      server.on("error", (error) => {
        loggerInstance.error("server_listen_failed", {
          category: classifyMongoConnectionError(error)
        });
        cleanupAfterFailure().finally(() => { process.exitCode = 1; });
      });
    }
    return server;
  } catch (error) {
    loggerInstance.error(
      connected ? "server_initialization_failed" : "mongodb_initial_connection_failed",
      {
        category: classifyMongoConnectionError(error)
      }
    );
    if (connected) await cleanupAfterFailure();
    throw new Error(connected
      ? "Application initialization failed."
      : "MongoDB initial connection failed.");
  }
};

if (require.main === module) {
  startServer().catch(() => {
    logger.error("server_start_failed", { category: "startup-failed" });
    process.exitCode = 1;
  });
}

app.startServer = startServer;
app.isDatabaseReady = isDatabaseReady;
module.exports = app;
