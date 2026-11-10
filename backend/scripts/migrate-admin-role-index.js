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

const EXECUTION_STAGES = [
  "environment-loading",
  "argument-validation",
  "database-connection",
  "database-verification",
  "version-check",
  "confirmation",
  "index-inspection",
  "admin-count",
  "index-creation",
  "index-verification",
  "disconnect"
];

const createMigrationError = (message, code) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const getSafeErrorCategory = (stage, error) => {
  const code = error?.code;
  const codeName = error?.codeName;
  const name = error?.name;

  if (code === "MIGRATION_UNSUPPORTED_VERSION") return "unsupported-version";
  if (code === 18 || codeName === "AuthenticationFailed") return "authentication";
  if (code === 13 || codeName === "Unauthorized") return "authorization";
  if (code === 11000 || codeName === "DuplicateKey") return "duplicate-key";
  if ([85, 86, 67].includes(code) ||
      ["IndexOptionsConflict", "IndexKeySpecsConflict", "CannotCreateIndex"].includes(codeName)) {
    return "index-conflict";
  }
  if ([
    "MongoNetworkError",
    "MongoNetworkTimeoutError",
    "MongoServerSelectionError"
  ].includes(name) || ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND"].includes(code)) {
    return "network";
  }
  if (stage === "confirmation") return "cancelled";
  return "operation-failed";
};

const formatSafeFailure = (stage, error) => {
  const safeStage = EXECUTION_STAGES.includes(stage) ? stage : "environment-loading";
  const category = getSafeErrorCategory(safeStage, error);
  const suggestions = {
    authentication: "Check the database user's authentication configuration.",
    authorization: "Check that the database user has the required database and index permissions.",
    network: "Check database network access and connectivity, then try again.",
    "unsupported-version": "Use MongoDB 5.0 or later for this migration.",
    "index-conflict": "Review the existing role indexes; do not remove or replace indexes automatically.",
    "duplicate-key": "Review administrator-role uniqueness before retrying; no automatic retry was attempted.",
    cancelled: "Run the command interactively and enter the exact confirmation text.",
    "operation-failed": "Review the database configuration and existing index state before retrying."
  };
  return `Index migration failed at stage "${safeStage}" (category: ${category}). ` +
    suggestions[category];
};

const supportsSameKeyPatternIndexes = (version) => {
  const match = typeof version === "string" && version.match(/^(\d+)\.(\d+)/);
  return Boolean(match && (Number(match[1]) > 5 ||
    (Number(match[1]) === 5 && Number(match[2]) >= 0)));
};

const migrateAdminRoleIndex = async ({ connection, User, serverVersion, setStage = () => {} }) => {
  setStage("database-verification");
  if (connection?.name !== TARGET_DATABASE) {
    throw new Error(`Connected database must be ${TARGET_DATABASE}.`);
  }
  setStage("version-check");
  if (!supportsSameKeyPatternIndexes(serverVersion)) {
    throw createMigrationError(
      "MongoDB 5.0 or later is required for this index migration.",
      "MIGRATION_UNSUPPORTED_VERSION"
    );
  }

  setStage("index-inspection");
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

  setStage("admin-count");
  const administratorCount = await collection.countDocuments({ role: "admin" });
  if (administratorCount !== 0) {
    throw new Error("Administrator accounts already exist; no migration was performed.");
  }

  setStage("index-creation");
  await collection.createIndex(ADMIN_ROLE_INDEX_KEY, ADMIN_ROLE_INDEX_OPTIONS);

  setStage("index-verification");
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
  let stage = "environment-loading";
  let mongoose;
  let failure;
  try {
    require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

    stage = "argument-validation";
    readApplyFlag(process.argv.slice(2));

    mongoose = require("mongoose");
    const User = require("../models/User");

    stage = "database-connection";
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) throw new Error("MONGO_URI is not configured.");
    getDatabaseNameFromUri(mongoUri);
    await mongoose.connect(mongoUri);

    stage = "database-verification";
    if (mongoose.connection.name !== TARGET_DATABASE) {
      throw new Error(`Connected database must be ${TARGET_DATABASE}.`);
    }

    stage = "version-check";
    const buildInfo = await mongoose.connection.db.admin().command({ buildInfo: 1 });
    if (!supportsSameKeyPatternIndexes(buildInfo.version)) {
      throw createMigrationError(
        "MongoDB 5.0 or later is required for this index migration.",
        "MIGRATION_UNSUPPORTED_VERSION"
      );
    }

    stage = "confirmation";
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
      serverVersion: buildInfo.version,
      setStage: (currentStage) => { stage = currentStage; }
    });
    console.log(result.created
      ? "Administrator uniqueness index created and verified."
      : "Administrator uniqueness index already exists and was verified.");
  } catch (error) {
    failure = { stage, error };
  } finally {
    if (mongoose?.connection.readyState !== 0) {
      stage = "disconnect";
      try {
        await mongoose.disconnect();
      } catch (error) {
        if (!failure) failure = { stage, error };
      }
    }
  }

  if (failure) {
    console.error(formatSafeFailure(failure.stage, failure.error));
    process.exitCode = 1;
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(formatSafeFailure("environment-loading", error));
    process.exitCode = 1;
  });
}

module.exports = {
  supportsSameKeyPatternIndexes,
  migrateAdminRoleIndex,
  readApplyFlag,
  getSafeErrorCategory,
  formatSafeFailure
};
