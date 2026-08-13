const express = require("express");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const path = require("path");
const session = require("express-session");
const { configureCors } = require("./config/cors");
require("dotenv").config({ path: path.resolve(__dirname, '.env') });

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
const protect = require("./config/middleware/authMiddleware");
const courseRoutes = require("./routes/course");
const noteRoutes = require("./routes/note");
const searchRoutes = require("./routes/search");



configureCors(app);
app.use(cookieParser());
app.use(
  session({
    secret: "secretkey",
    resave: false,
    saveUninitialized: false
  })
);

app.use(passport.initialize());
app.use(passport.session());
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

// Serve uploads for backward compatibility with existing files
// New files use protected endpoint: /api/files/download/:filename
app.use("/uploads", express.static("uploads"));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// handle malformed JSON body errors gracefully
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, message: 'Invalid JSON payload' });
  }
  next(err);
});
app.use("/api/courses", courseRoutes);
app.use("/api/notes", noteRoutes);
// Ensure question routes are mounted after body-parsing middleware
app.use("/api/questions", questionRoutes);

// Mount search routes
app.use("/api/search", searchRoutes);

const fileRoutes = require("./routes/file");
app.use("/api/files", fileRoutes.router);

const marketplaceRoutes = require("./routes/marketplace");
app.use("/api/marketplace", marketplaceRoutes);

const aiRoutes = require("./routes/ai");
app.use("/api/ai", aiRoutes);

const analyticsRoutes = require("./routes/analytics");
app.use("/api/analytics", analyticsRoutes);

const lecturerRoutes = require("./routes/lecturer");
app.use("/api/lecturer", lecturerRoutes);

const libraryRoutes = require("./routes/library");
app.use("/api/library", libraryRoutes);

const purchaseRoutes = require("./routes/purchase");
app.use("/api/purchase", purchaseRoutes);

app.get("/api/protected", protect, (req, res) => {
  res.json({
    message: "You accessed protected data",
    user: req.user
  });
});

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const paymentRoutes = require("./routes/payments");
const adminRoutes = require("./routes/admin");
const departmentRoutes = require("./routes/departments");

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/departments", departmentRoutes);

// Connect MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    autoSeedDepartments()
  })
  .catch((err) => console.error("MongoDB connection error:", err));

/**
 * Auto-seed departments if database is empty
 */
async function autoSeedDepartments() {
  try {
    const Department = require("./models/Department");
    const School = require("./models/School");
    
    const departmentCount = await Department.countDocuments();
    
    if (departmentCount > 0) {
      return;
    }
    
    // Create or get default school
    let school = await School.findOne({ code: 'DEFAULT' });
    if (!school) {
      school = await School.create({
        name: 'Default Polytechnic',
        code: 'DEFAULT',
        description: 'Default school for departments'
      });
    }

    // Sample departments
    const departments = [
      { name: 'Computer Science', code: 'CSC', description: 'Computer Science and Technology' },
      { name: 'Civil Engineering', code: 'CVE', description: 'Civil Engineering' },
      { name: 'Electrical Engineering', code: 'ELE', description: 'Electrical Engineering' },
      { name: 'Mechanical Engineering', code: 'MEC', description: 'Mechanical Engineering' },
      { name: 'Business Administration', code: 'BUA', description: 'Business Administration' },
      { name: 'Accounting', code: 'ACC', description: 'Accounting' },
      { name: 'Public Administration', code: 'PAD', description: 'Public Administration' },
      { name: 'Mass Communication', code: 'MAS', description: 'Mass Communication' }
    ];

    await Department.insertMany(
      departments.map(dept => ({
        ...dept,
        school: school._id
      }))
    );
  } catch (error) {
    console.warn('⚠️ Auto-seed error (non-blocking):', error.message);
  }
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "AI Academic Platform API is running...",
    version: "1.0.0",
    timestamp: new Date().toISOString()
  });  
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString()
  });
});
const PORT = process.env.PORT || 5000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  }).on('error', (err) => {
    console.error('Server failed to start:', err.message);
    process.exit(1);
  });
}

module.exports = app;