const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");
const session = require("express-session");
require("dotenv").config({ path: path.resolve(__dirname, '.env') });
const passport = require("./config/middleware/passport");
const app = express();
const questionRoutes = require("./routes/question");
const protect = require("./config/middleware/authMiddleware");
const courseRoutes = require("./routes/course");
const noteRoutes = require("./routes/note");
const searchRoutes = require("./routes/search");



const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  /vercel\.app$/, // Allow all Vercel URLs
  /netlify\.app$/, // Allow Netlify URLs
  'https://academy-platform.vercel.app'
].filter(Boolean)

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.some(allowed => {
      if (allowed instanceof RegExp) return allowed.test(origin)
      return origin === allowed
    })) {
      callback(null, true)
    } else {
      console.warn(`🚨 CORS blocked origin: ${origin}`)
      callback(null, true) // Allow anyway but log it - change to false to strictly block
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
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
app.use((req,res,next)=>{
  console.log('REQ', req.method, req.url);
  next();
});
app.use(express.json());
app.use("/uploads", express.static("uploads"));
app.use(express.urlencoded({ extended: true }));

// handle malformed JSON body errors gracefully
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, message: 'Invalid JSON payload' });
  }
  next(err);
});
console.log("MOUNTING /api/courses");
app.use("/api/courses", courseRoutes);
app.use("/api/notes", noteRoutes);
// Ensure question routes are mounted after body-parsing middleware
app.use("/api/questions", questionRoutes);

// Mount search routes
console.log("🔍 MOUNTING /api/search");
app.use("/api/search", searchRoutes);



const fileRoutes = require("./routes/file");
console.log("MOUNTING /api/files");
app.use("/api/files", fileRoutes.router);

const aiRoutes = require("./routes/ai");
console.log("MOUNTING /api/ai");
app.use("/api/ai", aiRoutes);

const analyticsRoutes = require("./routes/analytics");
console.log("MOUNTING /api/analytics");
app.use("/api/analytics", analyticsRoutes);

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
app.use("/api/payment", paymentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/departments", departmentRoutes);

// Connect MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB Connected Successfully")
    // Auto-seed departments if empty
    autoSeedDepartments()
  })
  .catch((err) => console.log("❌ MongoDB Error:", err));

/**
 * Auto-seed departments if database is empty
 */
async function autoSeedDepartments() {
  try {
    const Department = require("./models/Department");
    const School = require("./models/School");
    
    const departmentCount = await Department.countDocuments();
    
    if (departmentCount > 0) {
      console.log(`📚 Database already has ${departmentCount} departments`);
      return;
    }
    
    console.log('🌱 Seeding departments...');
    
    // Create or get default school
    let school = await School.findOne({ code: 'DEFAULT' });
    if (!school) {
      school = await School.create({
        name: 'Default Polytechnic',
        code: 'DEFAULT',
        description: 'Default school for departments'
      });
      console.log('✅ Created default school');
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

    const createdDepartments = await Department.insertMany(
      departments.map(dept => ({
        ...dept,
        school: school._id
      }))
    );

    console.log(`✅ Seeded ${createdDepartments.length} departments:`);
    createdDepartments.forEach(dept => {
      console.log(`   - ${dept.name} (${dept.code})`);
    });
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;