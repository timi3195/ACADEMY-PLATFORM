#!/usr/bin/env node

/**
 * Promote User to Admin - Utility Script
 * 
 * Usage: node promote-admin.js <email> [role] [department]
 * 
 * Examples:
 *   node promote-admin.js admin@example.com admin
 *   node promote-admin.js lecturer@example.com lecturer
 *   node promote-admin.js user@example.com student
 */

const mongoose = require("mongoose");
require("dotenv").config();

// Import User model
const User = require("../models/User");

const VALID_ROLES = ["student", "lecturer", "admin"];

async function promoteUser() {
  const email = process.argv[2];
  const role = process.argv[3] || "admin";

  // Validate inputs
  if (!email) {
    console.error("❌ Error: Email is required");
    console.log("\nUsage: node promote-admin.js <email> [role]");
    console.log("Example: node promote-admin.js user@example.com admin");
    process.exit(1);
  }

  if (!VALID_ROLES.includes(role)) {
    console.error(`❌ Error: Invalid role "${role}"`);
    console.log(`Valid roles: ${VALID_ROLES.join(", ")}`);
    process.exit(1);
  }

  try {
    // Connect to MongoDB
    console.log("🔗 Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");

    // Find user by email
    console.log(`\n🔍 Looking for user: ${email}`);
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      console.error(`❌ Error: User with email "${email}" not found`);
      process.exit(1);
    }

    console.log(`✅ Found user: ${user.name} (${user.email})`);
    console.log(`   Current role: ${user.role}`);
    console.log(`   Current plan: ${user.plan}`);

    // Check if already has the role
    if (user.role === role) {
      console.log(`\n⚠️  User is already a ${role}`);
      process.exit(0);
    }

    // Update user role
    console.log(`\n⏳ Updating role to "${role}"...`);
    user.role = role;
    
    // If promoting to lecturer or admin, and they don't have a department set, mention it
    if ((role === "lecturer" || role === "admin") && !user.department) {
      console.log(`   ℹ️  Note: No department assigned. Assign later via admin panel if needed.`);
    }

    await user.save();
    console.log(`✅ User successfully promoted to "${role}"`);

    // Display updated user info
    console.log(`\n📋 Updated User Info:`);
    console.log(`   Name: ${user.name}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Role: ${user.role}`);
    console.log(`   Plan: ${user.plan}`);
    console.log(`   Verified: ${user.emailVerified ? "Yes" : "No"}`);

    await mongoose.connection.close();
    console.log(`\n✅ Done! Connection closed.`);

  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

// Run the script
promoteUser();

