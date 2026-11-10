#!/usr/bin/env node

const path = require("node:path");
const { isSingleAdminIndex } = require("../utils/adminRoleIndex");

const TARGET_DATABASE = "test";

const inspectMongoUri = (uri) => {
  const present = typeof uri === "string" && uri.length > 0;
  const schemeSupported = present && /^mongodb(?:\+srv)?:\/\//.test(uri);
  const match = schemeSupported &&
    uri.match(/^mongodb(?:\+srv)?:\/\/[^/?#]+\/([^/?#]*)(?:\?([^#]*))?$/);
  let databaseName;
  let databaseNameExtracted = false;
  let databaseNameIsTest = false;

  if (match) {
    try {
      databaseName = decodeURIComponent(match[1]);
      databaseNameExtracted = databaseName.length > 0;
      const queryDatabases = new URLSearchParams(match[2] || "").getAll("dbName");
      databaseNameIsTest = databaseName === TARGET_DATABASE &&
        queryDatabases.every((queryDatabase) => queryDatabase === TARGET_DATABASE);
    } catch {
      databaseNameExtracted = false;
      databaseNameIsTest = false;
    }
  }

  return {
    present,
    schemeSupported,
    databaseNameExtracted,
    databaseNameIsTest
  };
};

const getDatabaseNameFromUri = (uri) => {
  const diagnostic = inspectMongoUri(uri);
  if (!diagnostic.present) {
    throw new Error("MONGO_URI must be a valid MongoDB URI.");
  }
  if (!diagnostic.schemeSupported || !diagnostic.databaseNameExtracted) {
    throw new Error("MONGO_URI must be a valid MongoDB URI with an explicit database.");
  }
  if (!diagnostic.databaseNameIsTest) {
    throw new Error(`MONGO_URI must explicitly target the ${TARGET_DATABASE} database.`);
  }

  return TARGET_DATABASE;
};

const normalizeTargetEmail = (email) => {
  if (typeof email !== "string" || !email.trim() || /[\r\n]/.test(email)) {
    throw new Error("Provide the exact target email using --email.");
  }
  return email.trim().toLowerCase();
};

const verifySingleAdminIndex = async (User) => {
  const collection = User?.collection;
  if (!collection || typeof collection.listIndexes !== "function") {
    throw new Error("Unable to verify the administrator uniqueness constraint.");
  }

  const indexes = await collection.listIndexes().toArray();
  const matchingIndex = indexes.find(isSingleAdminIndex);
  if (matchingIndex) return matchingIndex.name;
  throw new Error("Administrator uniqueness migration is required before promotion.");
};

const promoteVerifiedUser = async ({ connection, User, email, confirm }) => {
  if (connection?.name !== TARGET_DATABASE) {
    throw new Error(`Connected database must be ${TARGET_DATABASE}.`);
  }

  await verifySingleAdminIndex(User);
  const targetEmail = normalizeTargetEmail(email);
  const targetUser = await User.findOne({ email: targetEmail })
    .select("_id role emailVerified");

  if (!targetUser) {
    throw new Error("No matching account was found.");
  }
  if (targetUser.emailVerified !== true) {
    throw new Error("The matching account is not verified.");
  }

  const adminCount = await User.countDocuments({ role: "admin" });
  if (adminCount !== 0) {
    throw new Error("An administrator already exists; no changes were made.");
  }

  if (typeof confirm !== "function" || !(await confirm())) {
    throw new Error("Promotion was not confirmed; no changes were made.");
  }

  let result;
  try {
    result = await User.updateOne(
      {
        _id: targetUser._id,
        email: targetEmail,
        emailVerified: true,
        role: targetUser.role
      },
      { $set: { role: "admin" } },
      { runValidators: true, timestamps: false }
    );
  } catch (error) {
    if (error?.code === 11000) {
      throw new Error("Another administrator was created concurrently; no changes were made.");
    }
    throw error;
  }

  if (result.modifiedCount !== 1) {
    throw new Error("The account changed during promotion; no role change was confirmed.");
  }
};

const readEmailArgument = (args) => {
  const allowedArgs = args.filter((arg) => arg !== "--");
  if (allowedArgs.length !== 2 || allowedArgs[0] !== "--email") {
    throw new Error('Usage: npm run promote-admin -- --email "<exact-email>"');
  }
  return normalizeTargetEmail(allowedArgs[1]);
};

const main = async () => {
  require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
  const mongoose = require("mongoose");
  const User = require("../models/User");

  try {
    const email = readEmailArgument(process.argv.slice(2));
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error("MONGO_URI is not configured.");
    }

    getDatabaseNameFromUri(mongoUri);
    await mongoose.connect(mongoUri);

    if (mongoose.connection.name !== TARGET_DATABASE) {
      throw new Error(`Connected database must be ${TARGET_DATABASE}.`);
    }

    console.log("Connected to the intended database.");
    await promoteVerifiedUser({
      connection: mongoose.connection,
      User,
      email,
      confirm: async () => {
        const readline = require("node:readline/promises");
        const terminal = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        try {
          return (await terminal.question("Type PROMOTE to confirm this one-time role change: ")).trim() === "PROMOTE";
        } finally {
          terminal.close();
        }
      }
    });

    console.log("The verified account role was changed to administrator.");
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
};

if (require.main === module) {
  main().catch(() => {
    console.error("Promotion failed or was cancelled. No credentials or account details were displayed.");
    process.exitCode = 1;
  });
}

module.exports = {
  TARGET_DATABASE,
  inspectMongoUri,
  getDatabaseNameFromUri,
  normalizeTargetEmail,
  verifySingleAdminIndex,
  isSingleAdminIndex,
  promoteVerifiedUser,
  readEmailArgument
};
