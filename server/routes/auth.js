const express = require("express");
const passport = require("passport");
const User = require("../models/User");
const Department = require("../models/Department");
const protect = require("../config/middleware/authMiddleware");
const { generateTokenPair, generateAccessToken, verifyRefreshToken } = require("../utils/token");
const { sendVerificationEmail, sendPasswordResetEmail, sendSubscriptionConfirmation } = require("../utils/email");
const crypto = require("crypto");

const router = express.Router();

console.log("AUTH ROUTE LOADED");

// ==================== UTILITY FUNCTIONS ====================

/**
 * Set secure HTTP-only cookie for refresh token
 */
const setRefreshTokenCookie = (res, refreshToken) => {
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true, // Prevents XSS attacks
    secure: process.env.NODE_ENV === "production", // HTTPS only in production
    sameSite: "strict", // CSRF protection
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  });
};

/**
 * Set secure HTTP-only cookie for access token (optional, can also use Bearer)
 */
const setAccessTokenCookie = (res, accessToken) => {
  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 15 * 60 * 1000 // 15 minutes
  });
};

/**
 * Clear auth cookies
 */
const clearAuthCookies = (res) => {
  res.clearCookie("refreshToken");
  res.clearCookie("accessToken");
};

// ==================== PUBLIC ROUTES ====================

/**
 * POST /api/auth/register
 * Register a new user with email and password
 */
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, confirmPassword, department, yearOfStudy } = req.body;

    // Validation
    if (!name || !email || !password || !department || !yearOfStudy) {
      return res.status(400).json({
        success: false,
        message: "Please provide name, email, password, department, and year of study"
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match"
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters"
      });
    }

    const validYears = ["ND1", "ND2", "HND1", "HND2"];
    if (!validYears.includes(yearOfStudy)) {
      return res.status(400).json({
        success: false,
        message: "Invalid year of study"
      });
    }

    const departmentRecord = await Department.findById(department);
    if (!departmentRecord) {
      return res.status(400).json({
        success: false,
        message: "Selected department is not valid"
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Email already registered. Please login or use a different email."
      });
    }

    // Create new user
    const user = new User({
      name,
      email: email.toLowerCase(),
      password,
      authProvider: "email",
      department: departmentRecord._id,
      yearOfStudy
    });

    // In development, auto-verify email for testing
    if (process.env.NODE_ENV === "development") {
      user.emailVerified = true;
    } else {
      // Generate email verification token (production only)
      user.generateEmailVerificationToken();
    }

    await user.save();

    // Send verification email only in production, but do not block registration response
    if (process.env.NODE_ENV !== "development") {
      sendVerificationEmail(user.email, user.emailVerificationToken, user.name)
        .then((result) => {
          if (!result.success) {
            console.error("Verification email dispatch failed:", result.error);
          } else {
            console.log("Verification email dispatched:", result.messageId);
          }
        })
        .catch((error) => {
          console.error("Verification email dispatch error:", error);
        });
    }

    return res.status(201).json({
      success: true,
      message: process.env.NODE_ENV === "development" 
        ? "Registration successful! Your email is auto-verified in development mode."
        : "Registration successful! Please check your email to verify your account.",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified
      }
    });

  } catch (error) {
    console.error("Registration error:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/auth/login
 * Login with email and password
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and password"
      });
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user || !user.password) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials"
      });
    }

    // Compare password
    const isPasswordCorrect = await user.comparePassword(password);
    if (!isPasswordCorrect) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials"
      });
    }

    // Check if email is verified
    if (!user.emailVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email before logging in"
      });
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokenPair(user._id, {
      email: user.email,
      role: user.role
    });

    // Save refresh token to user
    user.addRefreshToken(refreshToken);
    user.lastLogin = new Date();
    await user.save();

    // Set cookies
    setRefreshTokenCookie(res, refreshToken);

    // If rememberMe is true, also set access token cookie
    if (rememberMe) {
      setAccessTokenCookie(res, accessToken);
    }

    await user.populate("department", "name code")

    return res.json({
      success: true,
      message: "Login successful",
      accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        plan: user.plan,
        subscriptionType: user.subscriptionType,
        subscriptionExpiresAt: user.subscriptionExpiresAt,
        department: user.department,
        yearOfStudy: user.yearOfStudy
      }
    });

  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/auth/verify-email
 * Verify email with token
 */
router.post("/verify-email", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Verification token is required"
      });
    }

    // Find user with token
    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification token"
      });
    }

    // Mark email as verified
    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;

    await user.save();

    return res.json({
      success: true,
      message: "Email verified successfully. You can now login."
    });

  } catch (error) {
    console.error("Email verification error:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/auth/send-verification-email
 * Resend verification email
 */
router.post("/send-verification-email", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified"
      });
    }

    // Generate new verification token
    const verificationToken = user.generateEmailVerificationToken();
    await user.save();

    // Send email
    await sendVerificationEmail(user.email, verificationToken, user.name);

    return res.json({
      success: true,
      message: "Verification email sent. Please check your inbox."
    });

  } catch (error) {
    console.error("Send verification email error:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/auth/forgot-password
 * Request password reset
 */
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // Don't reveal whether email exists (security best practice)
      return res.json({
        success: true,
        message: "If an account with this email exists, a password reset link has been sent."
      });
    }

    // Generate reset token
    const resetToken = user.generatePasswordResetToken();
    await user.save();

    // Send email in the background so the API response is not blocked by email latency
    sendPasswordResetEmail(user.email, resetToken, user.name)
      .then((result) => {
        if (!result.success) {
          console.error("Password reset email dispatch failed:", result.error);
        } else {
          console.log("Password reset email dispatched:", result.messageId);
        }
      })
      .catch((error) => {
        console.error("Password reset email dispatch error:", error);
      });

    return res.json({
      success: true,
      message: "If an account with this email exists, a password reset link has been sent."
    });

  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/auth/reset-password
 * Reset password with token
 */
router.post("/reset-password", async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: "Token and password are required"
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match"
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters"
      });
    }

    // Find user with valid reset token
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token"
      });
    }

    // Update password
    user.password = password;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;

    await user.save();

    // Clear all refresh tokens (log out all devices)
    user.clearAllRefreshTokens();
    await user.save();

    clearAuthCookies(res);

    return res.json({
      success: true,
      message: "Password reset successful. Please login with your new password."
    });

  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post("/refresh", async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token not found"
      });
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        message: "Invalid or expired refresh token"
      });
    }

    // Find user and check if token exists
    const user = await User.findById(decoded.id);
    if (!user || !user.hasRefreshToken(refreshToken)) {
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        message: "Refresh token not found or invalid"
      });
    }

    await user.populate("department", "name code")

    // Generate new access token
    const newAccessToken = generateAccessToken(user._id, {
      email: user.email,
      role: user.role
    });

    return res.json({
      success: true,
      accessToken: newAccessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        plan: user.plan,
        subscriptionType: user.subscriptionType,
        subscriptionExpiresAt: user.subscriptionExpiresAt,
        department: user.department,
        yearOfStudy: user.yearOfStudy
      }
    });

  } catch (error) {
    console.error("Refresh token error:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ==================== PROTECTED ROUTES ====================

/**
 * GET /api/auth/me
 * Get current user profile
 */
router.get("/me", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate("department", "name code")
      .select("-password -refreshTokens -emailVerificationToken -resetPasswordToken");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    return res.json({
      success: true,
      user
    });

  } catch (error) {
    console.error("Get user error:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout user (single device)
 */
router.post("/logout", protect, async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    // Remove refresh token from user
    const user = await User.findById(req.user.id);
    if (user && refreshToken) {
      user.removeRefreshToken(refreshToken);
      await user.save();
    }

    clearAuthCookies(res);

    return res.json({
      success: true,
      message: "Logged out successfully"
    });

  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/auth/logout-all
 * Logout from all devices
 */
router.post("/logout-all", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    // Clear all refresh tokens
    user.clearAllRefreshTokens();
    await user.save();

    clearAuthCookies(res);

    return res.json({
      success: true,
      message: "Logged out from all devices"
    });

  } catch (error) {
    console.error("Logout all error:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/auth/change-password
 * Change password for logged-in user
 */
router.post("/change-password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required"
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "New passwords do not match"
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters"
      });
    }

    const user = await User.findById(req.user.id);

    if (!user.password) {
      return res.status(400).json({
        success: false,
        message: "This account uses Google OAuth. Password change not available."
      });
    }

    // Verify current password
    const isCurrentPasswordCorrect = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordCorrect) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect"
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    return res.json({
      success: true,
      message: "Password changed successfully"
    });

  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ==================== GOOGLE OAUTH ROUTES ====================

/**
 * GET /api/auth/google
 * Start Google OAuth flow
 */
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"]
  })
);

/**
 * GET /api/auth/google/callback
 * Google OAuth callback
 */
router.get(
  "/google/callback",
  (req, res, next) => {
    passport.authenticate("google", {
      session: false,
      failureRedirect: process.env.FRONTEND_URL + "/login?error=auth_failed"
    })(req, res, next);
  },
  async (req, res) => {
    try {
      // User already created/found by Passport strategy
      const user = req.user;

      if (!user) {
        throw new Error("User not found after authentication");
      }

      // Generate tokens
      const { accessToken, refreshToken } = generateTokenPair(user._id, {
        email: user.email,
        role: user.role
      });

      // Save refresh token to user
      user.addRefreshToken(refreshToken);
      user.lastLogin = new Date();
      user.emailVerified = true; // Google verified emails are already verified
      await user.save();

      // Set refresh token cookie
      setRefreshTokenCookie(res, refreshToken);

      // Redirect to frontend with tokens
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      res.redirect(
        `${frontendUrl}/oauth-callback?accessToken=${accessToken}&userId=${user._id}`
      );

    } catch (error) {
      console.error("Google OAuth callback error:", error);
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(error.message)}`);
    }
  }
);

// ==================== HEALTH CHECK ====================

/**
 * GET /api/auth/status
 * Health check for auth service
 */
router.get("/status", (req, res) => {
  res.json({
    success: true,
    message: "Auth service is running",
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /api/auth/test-email
 * Test email sending (Admin/Debug only)
 */
router.post("/test-email", protect, async (req, res) => {
  try {
    // Only allow admins or in development
    if (req.user.role !== 'admin' && process.env.NODE_ENV !== 'development') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can test email'
      });
    }

    const { email } = req.body;
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Send test email
    const result = await sendPasswordResetEmail(email, 'TEST-TOKEN-12345', 'Test User');
    
    return res.json({
      success: result.success,
      message: result.success ? 'Test email sent successfully' : 'Failed to send test email',
      details: {
        messageId: result.messageId,
        skipped: result.skipped,
        error: result.error
      },
      config: {
        smtpConfigured: !!(process.env.SMTP_HOST && process.env.SMTP_USER),
        nodeEnv: process.env.NODE_ENV,
        emailSkipped: process.env.SKIP_EMAIL_IN_DEV === 'true'
      }
    });
  } catch (error) {
    console.error('Test email error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error sending test email: ' + error.message
    });
  }
});

module.exports = router;