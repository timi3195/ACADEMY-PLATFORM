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
  inspectMongoUri,
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

const getErrorSignals = (error) => {
  const signals = [];
  const visited = new Set();
  const pending = [{ value: error, depth: 0 }];

  while (pending.length > 0) {
    const { value, depth } = pending.pop();
    if (!value || typeof value !== "object" || visited.has(value) || depth > 5) continue;
    visited.add(value);

    signals.push({
      code: value.code,
      codeName: value.codeName,
      name: value.name
    });

    for (const property of ["cause", "reason", "error"]) {
      if (value[property] && typeof value[property] === "object") {
        pending.push({ value: value[property], depth: depth + 1 });
      }
    }

    const servers = value.servers;
    if (servers instanceof Map) {
      for (const server of servers.values()) {
        if (server?.error && typeof server.error === "object") {
          pending.push({ value: server.error, depth: depth + 1 });
        }
      }
    }
  }

  return signals;
};

const getSafeErrorCategory = (stage, error) => {
  const signals = getErrorSignals(error);
  const hasCode = (...codes) => signals.some(({ code }) => codes.includes(code));
  const hasCodeName = (...names) => signals.some(({ codeName }) => names.includes(codeName));
  const hasName = (...names) => signals.some(({ name }) => names.includes(name));
  const hasTlsSignal = signals.some(({ code }) =>
    typeof code === "string" &&
    (/^(?:ERR_TLS_|ERR_SSL_|CERT_|SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE)/.test(code))
  );

  if (hasCode("MIGRATION_UNSUPPORTED_VERSION")) return "unsupported-version";
  if (hasCode("MIGRATION_INVALID_URI")) return "invalid-uri";
  if (hasCode(18) || hasCodeName("AuthenticationFailed")) return "authentication";
  if (hasCode(13) || hasCodeName("Unauthorized")) return "authorization";
  if (hasCode(11000) || hasCodeName("DuplicateKey")) return "duplicate-key";
  if (hasCode(85, 86, 67) ||
      hasCodeName("IndexOptionsConflict", "IndexKeySpecsConflict", "CannotCreateIndex")) {
    return "index-conflict";
  }
  if (hasTlsSignal) return "tls-certificate";
  if (hasCode(
    "ENOTFOUND",
    "EAI_AGAIN",
    "ENODATA",
    "ESERVFAIL",
    "ECANCELLED",
    "ERR_DNS"
  )) return "dns-srv";
  if (hasCode("ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "ECONNRESET")) {
    return "network-unreachable";
  }
  if (hasCode("ETIMEDOUT", "ETIME") ||
      hasName("MongoNetworkTimeoutError", "MongoTimeoutError")) return "connection-timeout";
  if (stage === "database-connection" && hasName("MongoServerSelectionError")) {
    return "server-selection";
  }
  if (stage === "confirmation") return "cancelled";
  if (stage === "database-connection") return "unknown-connection-failure";
  return "operation-failed";
};

const formatMongoUriDiagnostic = (diagnostic) =>
  `MONGO_URI checks: present=${diagnostic.present ? "yes" : "no"}, ` +
  `scheme-supported=${diagnostic.schemeSupported ? "yes" : "no"}, ` +
  `database-extracted=${diagnostic.databaseNameExtracted ? "yes" : "no"}, ` +
  `database-is-test=${diagnostic.databaseNameIsTest ? "yes" : "no"}.`;

const formatSafeFailure = (stage, error, mongoUriDiagnostic) => {
  const safeStage = EXECUTION_STAGES.includes(stage) ? stage : "environment-loading";
  const category = getSafeErrorCategory(safeStage, error);
  const suggestions = {
    authentication: "Check the database user's authentication configuration.",
    authorization: "Check that the database user has the required database and index permissions.",
    "dns-srv": "Check the Atlas hostname and DNS/SRV resolution from this environment.",
    "network-unreachable": "Check outbound network access and the Atlas network access list.",
    "connection-timeout": "Check network access and Atlas availability, then retry only after review.",
    "tls-certificate": "Check the runtime's TLS certificates and the system clock.",
    "server-selection": "Check Atlas availability, network access, and connection settings.",
    "invalid-uri": "Check that MONGO_URI is a valid MongoDB URI targeting the required database.",
    "unknown-connection-failure": "Review the connection configuration and network access without sharing the URI.",
    "unsupported-version": "Use MongoDB 5.0 or later for this migration.",
    "index-conflict": "Review the existing role indexes; do not remove or replace indexes automatically.",
    "duplicate-key": "Review administrator-role uniqueness before retrying; no automatic retry was attempted.",
    cancelled: "Run the command interactively and enter the exact confirmation text.",
    "operation-failed": "Review the database configuration and existing index state before retrying."
  };
  const failureMessage =
    `Index migration failed at stage "${safeStage}" (category: ${category}). ` +
    suggestions[category];
  if (category === "invalid-uri" && mongoUriDiagnostic) {
    return `${failureMessage} ${formatMongoUriDiagnostic(mongoUriDiagnostic)}`;
  }
  return failureMessage;
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
  let mongoUriDiagnostic;
  try {
    require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

    stage = "argument-validation";
    readApplyFlag(process.argv.slice(2));

    mongoose = require("mongoose");
    const User = require("../models/User");

    stage = "database-connection";
    const mongoUri = process.env.MONGO_URI;
    mongoUriDiagnostic = inspectMongoUri(mongoUri);
    if (!mongoUriDiagnostic.present) {
      throw createMigrationError("MONGO_URI is not configured.", "MIGRATION_INVALID_URI");
    }
    if (!mongoUriDiagnostic.schemeSupported ||
        !mongoUriDiagnostic.databaseNameExtracted ||
        !mongoUriDiagnostic.databaseNameIsTest) {
      throw createMigrationError("MONGO_URI is invalid for this migration.", "MIGRATION_INVALID_URI");
    }
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
    failure = { stage, error, mongoUriDiagnostic };
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
    console.error(formatSafeFailure(
      failure.stage,
      failure.error,
      failure.mongoUriDiagnostic
    ));
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
  formatSafeFailure,
  formatMongoUriDiagnostic
};
