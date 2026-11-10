#!/usr/bin/env node

const path = require("node:path");
const {
  ADMIN_ROLE_INDEX_KEY,
  ADMIN_ROLE_INDEX_OPTIONS,
  getRoleIndexes,
  isLegacyRoleIndex,
  isSingleAdminIndex
} = require("../utils/adminRoleIndex");
const {
  TARGET_DATABASE,
  getDatabaseNameFromUri
} = require("./promote-admin");

const supportsSameKeyPatternIndexes = (version) => {
  const match = typeof version === "string" && version.match(/^(\d+)\.(\d+)/);
  return Boolean(match && (Number(match[1]) > 5 ||
    (Number(match[1]) === 5 && Number(match[2]) >= 0)));
};

const migrateAdminRoleIndex = async ({ connection, User, serverVersion }) => {
  if (connection?.name !== TARGET_DATABASE) {
    throw new Error(`Connected database must be ${TARGET_DATABASE}.`);
  }
  if (!supportsSameKeyPatternIndexes(serverVersion)) {
    throw new Error("MongoDB 5.0 or later is required for this index migration.");
  }

  const collection = User?.collection;
  if (!collection || typeof collection.listIndexes !== "function" ||
      typeof collection.createIndex !== "function" ||
      typeof collection.countDocuments !== "function") {
    throw new Error("Unable to safely inspect the user collection indexes.");
  }

  const indexes = await collection.listIndexes().toArray();
  const roleIndexes = getRoleIndexes(indexes);
  const correctIndex = roleIndexes.find(isSingleAdminIndex);
  const unexpectedIndexes = roleIndexes.filter((index) =>
    !isSingleAdminIndex(index) && !isLegacyRoleIndex(index)
  );
  if (unexpectedIndexes.length > 0) {
    throw new Error("Unexpected role index configuration; no migration was performed.");
  }
  if (correctIndex) return { created: false };

  const administratorCount = await collection.countDocuments({ role: "admin" });
  if (administratorCount !== 0) {
    throw new Error("Administrator accounts already exist; no migration was performed.");
  }

  try {
    await collection.createIndex(ADMIN_ROLE_INDEX_KEY, ADMIN_ROLE_INDEX_OPTIONS);
  } catch {
    throw new Error("Unable to create the administrator uniqueness index; no account data was changed.");
  }

  const migratedIndexes = await collection.listIndexes().toArray();
  const verifiedIndex = getRoleIndexes(migratedIndexes).find(isSingleAdminIndex);
  if (!verifiedIndex) {
    throw new Error("Unable to verify the administrator uniqueness index.");
  }

  return { created: true };
};

const readApplyFlag = (args) => {
  const remaining = args.filter((arg) => arg !== "--");
  if (remaining.length !== 1 || remaining[0] !== "--apply") {
    throw new Error("Usage: node scripts/migrate-admin-role-index.js --apply");
  }
};

const main = async () => {
  require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
  const mongoose = require("mongoose");
  const User = require("../models/User");

  try {
    readApplyFlag(process.argv.slice(2));
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) throw new Error("MONGO_URI is not configured.");
    getDatabaseNameFromUri(mongoUri);
    await mongoose.connect(mongoUri);

    if (mongoose.connection.name !== TARGET_DATABASE) {
      throw new Error(`Connected database must be ${TARGET_DATABASE}.`);
    }

    const buildInfo = await mongoose.connection.db.admin().command({ buildInfo: 1 });
    const readline = require("node:readline/promises");
    const terminal = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    let confirmed;
    try {
      confirmed = (await terminal.question(
        "This will create only the admin uniqueness index. Type CREATE INDEX to continue: "
      )).trim() === "CREATE INDEX";
    } finally {
      terminal.close();
    }
    if (!confirmed) throw new Error("Migration was cancelled.");

    const result = await migrateAdminRoleIndex({
      connection: mongoose.connection,
      User,
      serverVersion: buildInfo.version
    });
    console.log(result.created
      ? "Administrator uniqueness index created and verified."
      : "Administrator uniqueness index already exists and was verified.");
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
};

if (require.main === module) {
  main().catch(() => {
    console.error("Index migration failed or was cancelled. No account data was modified.");
    process.exitCode = 1;
  });
}

module.exports = {
  supportsSameKeyPatternIndexes,
  migrateAdminRoleIndex,
  readApplyFlag
};
