const test = require("node:test");
const assert = require("node:assert/strict");
const {
  migrateAdminRoleIndex,
  supportsSameKeyPatternIndexes,
  readApplyFlag,
  formatSafeFailure
} = require("../scripts/migrate-admin-role-index");

const LEGACY_ROLE_INDEX = {
  name: "role_1",
  key: { role: 1 },
  v: 2
};
const ADMIN_ROLE_INDEX = {
  name: "unique_admin_role",
  key: { role: 1 },
  unique: true,
  partialFilterExpression: { role: "admin" },
  v: 2
};

const createMigrationHarness = ({ indexes = [], administrators = 0 } = {}) => {
  const calls = { listIndexes: 0, countDocuments: [], createIndex: [] };
  const User = {
    collection: {
      listIndexes() {
        calls.listIndexes += 1;
        return { toArray: async () => indexes };
      },
      async countDocuments(filter) {
        calls.countDocuments.push(filter);
        return administrators;
      },
      async createIndex(key, options) {
        calls.createIndex.push([key, options]);
        indexes.push({ ...options, key, v: 2 });
        return options.name;
      }
    }
  };
  return { calls, User, indexes };
};

test("supports same-key-pattern indexes only on MongoDB 5.0 or later", () => {
  assert.equal(supportsSameKeyPatternIndexes("5.0.0"), true);
  assert.equal(supportsSameKeyPatternIndexes("8.0.4"), true);
  assert.equal(supportsSameKeyPatternIndexes("4.4.29"), false);
  assert.equal(supportsSameKeyPatternIndexes(undefined), false);
});

test("migration explicitly requires --apply", () => {
  assert.doesNotThrow(() => readApplyFlag(["--apply"]));
  assert.throws(() => readApplyFlag([]), /Usage:/);
  assert.throws(() => readApplyFlag(["--dry-run"]), /Usage:/);
});

test("existing ordinary role_1 index is preserved while partial unique index is added", async () => {
  const harness = createMigrationHarness({ indexes: [LEGACY_ROLE_INDEX] });
  const result = await migrateAdminRoleIndex({
    connection: { name: "test" },
    User: harness.User,
    serverVersion: "8.0.0"
  });

  assert.deepEqual(result, { created: true });
  assert.equal(harness.indexes.includes(LEGACY_ROLE_INDEX), true);
  assert.deepEqual(harness.indexes[1], ADMIN_ROLE_INDEX);
  assert.deepEqual(harness.calls.countDocuments, [{ role: "admin" }]);
  assert.deepEqual(harness.calls.createIndex, [[
    { role: 1 },
    {
      name: "unique_admin_role",
      unique: true,
      partialFilterExpression: { role: "admin" }
    }
  ]]);
});

test("already-existing correct partial unique index is idempotently verified", async () => {
  const harness = createMigrationHarness({
    indexes: [LEGACY_ROLE_INDEX, ADMIN_ROLE_INDEX]
  });
  const result = await migrateAdminRoleIndex({
    connection: { name: "test" },
    User: harness.User,
    serverVersion: "8.0.0"
  });

  assert.deepEqual(result, { created: false });
  assert.deepEqual(harness.calls.countDocuments, []);
  assert.deepEqual(harness.calls.createIndex, []);
});

test("multiple administrators prevent index creation without account changes", async () => {
  const harness = createMigrationHarness({
    indexes: [LEGACY_ROLE_INDEX],
    administrators: 2
  });
  await assert.rejects(
    migrateAdminRoleIndex({
      connection: { name: "test" },
      User: harness.User,
      serverVersion: "8.0.0"
    }),
    /Administrator accounts already exist/
  );
  assert.deepEqual(harness.calls.createIndex, []);
});

test("unexpected role index configuration fails without changes", async () => {
  const unexpectedIndex = {
    name: "role_custom",
    key: { role: 1 },
    unique: false,
    sparse: true
  };
  const harness = createMigrationHarness({ indexes: [unexpectedIndex] });
  await assert.rejects(
    migrateAdminRoleIndex({
      connection: { name: "test" },
      User: harness.User,
      serverVersion: "8.0.0"
    }),
    /Unexpected role index configuration/
  );
  assert.deepEqual(harness.calls.countDocuments, []);
  assert.deepEqual(harness.calls.createIndex, []);
});

test("unsupported MongoDB versions fail before inspecting or changing indexes", async () => {
  const harness = createMigrationHarness({ indexes: [LEGACY_ROLE_INDEX] });
  await assert.rejects(
    migrateAdminRoleIndex({
      connection: { name: "test" },
      User: harness.User,
      serverVersion: "4.4.0"
    }),
    /MongoDB 5.0 or later/
  );
  assert.equal(harness.calls.listIndexes, 0);
  assert.deepEqual(harness.calls.createIndex, []);
});

test("index creation failures report their stage and safe category only", async () => {
  const harness = createMigrationHarness({ indexes: [LEGACY_ROLE_INDEX] });
  const sensitiveMessage =
    "mongodb+srv://operator:secret@private-host/db?token=reset-token admin@example.com";
  harness.User.collection.createIndex = async () => {
    const error = new Error(sensitiveMessage);
    error.code = 11000;
    throw error;
  };
  const stages = [];
  let failure;

  try {
    await migrateAdminRoleIndex({
      connection: { name: "test" },
      User: harness.User,
      serverVersion: "8.0.0",
      setStage: (stage) => stages.push(stage)
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure);
  assert.deepEqual(stages, [
    "database-verification",
    "version-check",
    "index-inspection",
    "admin-count",
    "index-creation"
  ]);
  const diagnostic = formatSafeFailure(stages.at(-1), failure);
  assert.match(diagnostic, /stage "index-creation"/);
  assert.match(diagnostic, /category: duplicate-key/);
  assert.match(diagnostic, /no automatic retry/i);
  assert.equal(diagnostic.includes(sensitiveMessage), false);
  assert.doesNotMatch(diagnostic, /operator|secret|private-host|reset-token|admin@example\.com/);
});

test("safe failure output classifies known failures without printing error details", () => {
  const sensitiveError = new Error(
    "mongodb://name:password@host/test?apiKey=secret account@example.com"
  );
  sensitiveError.code = 13;

  const diagnostic = formatSafeFailure("index-inspection", sensitiveError);
  assert.match(diagnostic, /stage "index-inspection"/);
  assert.match(diagnostic, /category: authorization/);
  assert.match(diagnostic, /required database and index permissions/);
  assert.doesNotMatch(diagnostic, /name|password|host|apiKey|secret|account@example\.com/);
});

test("safe failure output identifies unsupported versions and confirmation cancellation", () => {
  const unsupported = new Error("private server details");
  unsupported.code = "MIGRATION_UNSUPPORTED_VERSION";
  assert.match(
    formatSafeFailure("version-check", unsupported),
    /category: unsupported-version/
  );
  assert.match(
    formatSafeFailure("confirmation", new Error("anything private")),
    /category: cancelled/
  );
  assert.doesNotMatch(
    formatSafeFailure("version-check", unsupported),
    /private server details/
  );
});
