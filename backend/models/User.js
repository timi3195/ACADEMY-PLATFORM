const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
  // Basic Info
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },

  // AUTHENTICATION FIELDS
  password: {
    type: String,
    default: null // null if Google OAuth, hashed string if email/password auth
  },
  googleId: {
    type: String,
    default: null
  },
  authProvider: {
    type: String,
    enum: ["email", "google"],
    default: "email"
  },

  // EMAIL VERIFICATION
  emailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: {
    type: String,
    default: null
  },
  emailVerificationExpires: {
    type: Date,
    default: null
  },

  // PASSWORD RESET
  resetPasswordToken: {
    type: String,
    default: null
  },
  resetPasswordExpires: {
    type: Date,
    default: null
  },

  // REFRESH TOKENS (for token rotation security)
  refreshTokens: [{
    token: String,
    createdAt: { type: Date, default: Date.now, expires: 2592000 } // 30 days TTL
  }],

  // SUBSCRIPTION & PLAN
  plan: {
    type: String,
    default: "free"
  },
  subscriptionType: {
    type: String,
    enum: ["free", "basic", "premium"],
    default: "free"
  },
  subscriptionSemester: {
    type: String,
    enum: ["2024-1", "2024-2", "2025-1", "2025-2", "2026-1", "2026-2"],
    default: null
  },
  subscriptionExpiresAt: {
    type: Date,
    default: null
  },

  // ROLE-BASED ACCESS CONTROL
  role: {
    type: String,
    enum: ["student", "lecturer", "admin"],
    default: "student"
  },

  // Link to department (for lecturers/admins and students)
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Department",
    default: null
  },
  yearOfStudy: {
    type: String,
    enum: ["ND1", "ND2", "HND1", "HND2"],
    default: null
  },

  // Track student progress
  coursesEnrolled: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course"
  }],
  quizzesAttempted: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "QuizSession"
  }],

  // SESSION & ACTIVITY
  lastLogin: {
    type: Date,
    default: null
  },
  devices: {
    type: [String],
    default: []
  },

  // AI FEATURE USAGE (for analytics & rate limiting)
  aiUsage: {
    messagesThisMonth: {
      type: Number,
      default: 0
    },
    notesProcessedThisMonth: {
      type: Number,
      default: 0
    },
    questionsExplainedThisMonth: {
      type: Number,
      default: 0
    },
    lastResetDate: {
      type: Date,
      default: Date.now
    }
  },

  // LEARNING PREFERENCES
  preferences: {
    preferredLearningStyle: {
      type: String,
      enum: ["visual", "textual", "mixed"],
      default: "mixed"
    },
    studyHoursPerDay: {
      type: Number,
      default: 2
    },
    targetGPA: {
      type: Number,
      default: 3.0
    },
    notificationSettings: {
      dailyReminders: {
        type: Boolean,
        default: true
      },
      performanceAlerts: {
        type: Boolean,
        default: true
      },
      newResourcesNotification: {
        type: Boolean,
        default: true
      }
    }
  },

  // SUBSCRIPTION FEATURES & LIMITS
  subscriptionFeatures: {
    aiChatMessages: {
      type: Number,
      default: 50 // Monthly limit for free tier
    },
    notesPerMonth: {
      type: Number,
      default: 5
    },
    learningPathsPerCourse: {
      type: Number,
      default: 1
    },
    analyticsAccess: {
      type: Boolean,
      default: false
    }
  }

}, { timestamps: true });

// INDEXES for fast queries (unique: true creates index automatically)
userSchema.index({ role: 1 });
userSchema.index({ department: 1 });
userSchema.index({ yearOfStudy: 1 });
userSchema.index({ emailVerificationToken: 1 });
userSchema.index({ resetPasswordToken: 1 });

// PRE-SAVE HOOK: Hash password before saving
userSchema.pre("save", async function() {
  // Only hash if password is modified and exists
  if (!this.isModified("password") || !this.password) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// METHOD: Compare password for login
userSchema.methods.comparePassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// METHOD: Generate email verification token
userSchema.methods.generateEmailVerificationToken = function() {
  const token = require("crypto").randomBytes(32).toString("hex");
  this.emailVerificationToken = token;
  this.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  return token;
};

// METHOD: Generate password reset token
userSchema.methods.generatePasswordResetToken = function() {
  const token = require("crypto").randomBytes(32).toString("hex");
  this.resetPasswordToken = token;
  this.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  return token;
};

// METHOD: Add refresh token to array (with rotation)
userSchema.methods.addRefreshToken = function(token) {
  // Keep only last 5 tokens (for multi-device support)
  if (this.refreshTokens.length >= 5) {
    this.refreshTokens.shift();
  }
  this.refreshTokens.push({ token });
};

// METHOD: Verify refresh token exists
userSchema.methods.hasRefreshToken = function(token) {
  return this.refreshTokens.some(rt => rt.token === token);
};

// METHOD: Remove specific refresh token (logout)
userSchema.methods.removeRefreshToken = function(token) {
  this.refreshTokens = this.refreshTokens.filter(rt => rt.token !== token);
};

// METHOD: Clear all refresh tokens (logout all devices)
userSchema.methods.clearAllRefreshTokens = function() {
  this.refreshTokens = [];
};

module.exports = mongoose.models.User || mongoose.model("User", userSchema);