const test = require("node:test");
const assert = require("node:assert/strict");
const {
  inspectMongoUri,
  getDatabaseNameFromUri,
  normalizeTargetEmail,
  verifySingleAdminIndex,
  promoteVerifiedUser,
  readEmailArgument
} = require("../scripts/promote-admin");

const CORRECT_ADMIN_INDEX = {
  name: "unique_admin_role",
  key: { role: 1 },
  unique: true,
  partialFilterExpression: { role: "admin" }
};

const makeUserModel = ({
  user,
  adminCount = 0,
  indexes = [CORRECT_ADMIN_INDEX],
  updateOne
} = {}) => {
  const calls = { find: [], count: [], update: [] };
  return {
    calls,
    collection: {
      listIndexes() {
        return { toArray: async () => indexes };
      },
    },
    findOne(filter) {
      calls.find.push(filter);
      return {
        select(fields) {
          assert.equal(fields, "_id role emailVerified");
          return Promise.resolve(user || null);
        }
      };
    },
    async countDocuments(filter) {
      calls.count.push(filter);
      return adminCount;
    },
    async updateOne(...args) {
      calls.update.push(args);
      if (updateOne) return updateOne(...args);
      return { modifiedCount: 1 };
    }
  };
};

test("promotion refuses to proceed until the explicit uniqueness migration has run", async () => {
  const User = makeUserModel({ indexes: [] });
  await assert.rejects(
    promoteVerifiedUser({
      connection: { name: "test" },
      User,
      email: "owner@example.test",
      confirm: async () => true
    }),
    /uniqueness migration is required/
  );
  assert.deepEqual(User.calls.find, []);
  assert.deepEqual(User.calls.update, []);
});

test("promotion verifies an existing partial unique index", async () => {
  const User = makeUserModel();
  assert.equal(await verifySingleAdminIndex(User), "unique_admin_role");
});

test("production MongoDB URI must explicitly identify the test database", () => {
  assert.equal(
    getDatabaseNameFromUri("mongodb+srv://user:password@cluster.example/test?retryWrites=true"),
    "test"
  );
  assert.equal(
    getDatabaseNameFromUri("mongodb://host1:27017,host2:27017/test?replicaSet=rs0"),
    "test"
  );
  assert.throws(
    () => getDatabaseNameFromUri("mongodb://user:password@cluster.example/other"),
    /explicitly target the test database/
  );
  assert.throws(
    () => getDatabaseNameFromUri("mongodb://cluster.example/test?dbName=other"),
    /explicitly target the test database/
  );
});

test("MongoDB URI inspection supports both schemes and encoded credentials", () => {
  const uriStatuses = [
    inspectMongoUri("mongodb+srv://test%40user:p%3Ass%2Fword@cluster.example/test?retryWrites=true"),
    inspectMongoUri("mongodb://test%40user:p%3Ass%2Fword@host1:27017,host2:27017/test?replicaSet=rs0")
  ];

  for (const status of uriStatuses) {
    assert.deepEqual(status, {
      present: true,
      schemeSupported: true,
      databaseNameExtracted: true,
      databaseNameIsTest: true
    });
  }
});

test("MongoDB URI inspection safely reports invalid format and database conditions", () => {
  assert.deepEqual(inspectMongoUri(undefined), {
    present: false,
    schemeSupported: false,
    databaseNameExtracted: false,
    databaseNameIsTest: false
  });
  assert.deepEqual(inspectMongoUri("https://cluster.example/test"), {
    present: true,
    schemeSupported: false,
    databaseNameExtracted: false,
    databaseNameIsTest: false
  });
  assert.deepEqual(inspectMongoUri("mongodb://host.example/"), {
    present: true,
    schemeSupported: true,
    databaseNameExtracted: false,
    databaseNameIsTest: false
  });
  assert.deepEqual(inspectMongoUri("mongodb://host.example/other?dbName=test"), {
    present: true,
    schemeSupported: true,
    databaseNameExtracted: true,
    databaseNameIsTest: false
  });
  assert.deepEqual(inspectMongoUri("mongodb://host.example/test?dbName=other"), {
    present: true,
    schemeSupported: true,
    databaseNameExtracted: true,
    databaseNameIsTest: false
  });
  assert.deepEqual(inspectMongoUri("mongodb://host.example/%ZZ"), {
    present: true,
    schemeSupported: true,
    databaseNameExtracted: false,
    databaseNameIsTest: false
  });
});

test("requires an exact supplied target email argument", () => {
  assert.equal(normalizeTargetEmail("  Owner@Example.Test "), "owner@example.test");
  assert.equal(readEmailArgument(["--email", "owner@example.test"]), "owner@example.test");
  assert.throws(() => readEmailArgument([]), /Usage:/);
  assert.throws(() => normalizeTargetEmail("owner@example.test\n--email=other"), /exact target email/);
});

test("wrong connected database is rejected before any account query", async () => {
  const User = makeUserModel();
  await assert.rejects(
    promoteVerifiedUser({
      connection: { name: "other" },
      User,
      email: "owner@example.test",
      confirm: async () => true
    }),
    /Connected database must be test/
  );
  assert.deepEqual(User.calls.find, []);
  assert.deepEqual(User.calls.count, []);
  assert.deepEqual(User.calls.update, []);
});

test("missing or unverified target cannot be promoted", async () => {
  for (const user of [null, { _id: "user-1", role: "student", emailVerified: false }]) {
    const User = makeUserModel({ user });
    await assert.rejects(
      promoteVerifiedUser({
        connection: { name: "test" },
        User,
        email: "owner@example.test",
        confirm: async () => true
      })
    );
    assert.deepEqual(User.calls.update, []);
  }
});

test("existing administrator prevents any change", async () => {
  const User = makeUserModel({
    user: { _id: "user-1", role: "student", emailVerified: true },
    adminCount: 1
  });
  await assert.rejects(
    promoteVerifiedUser({
      connection: { name: "test" },
      User,
      email: "owner@example.test",
      confirm: async () => true
    }),
    /administrator already exists/
  );
  assert.deepEqual(User.calls.update, []);
});

test("explicit confirmation is required and successful promotion updates only role", async () => {
  const target = { _id: "user-1", role: "student", emailVerified: true };
  const User = makeUserModel({ user: target });
  await assert.rejects(
    promoteVerifiedUser({
      connection: { name: "test" },
      User,
      email: "owner@example.test",
      confirm: async () => false
    }),
    /not confirmed/
  );
  assert.deepEqual(User.calls.update, []);

  await promoteVerifiedUser({
    connection: { name: "test" },
    User,
    email: "Owner@Example.Test",
    confirm: async () => true
  });
  assert.deepEqual(User.calls.find, [
    { email: "owner@example.test" },
    { email: "owner@example.test" }
  ]);
  assert.deepEqual(User.calls.update, [[
    {
      _id: "user-1",
      email: "owner@example.test",
      emailVerified: true,
      role: "student"
    },
    { $set: { role: "admin" } },
    { runValidators: true, timestamps: false }
  ]]);
});

test("concurrent promotion losing the unique-index race fails without modifying its target", async () => {
  const promotedIds = new Set();
  let confirmationsReady = 0;
  let releaseConfirmations;
  const bothConfirmed = new Promise((resolve) => { releaseConfirmations = resolve; });
  const targets = new Map([
    ["owner-1@example.test", { _id: "user-1", role: "student", emailVerified: true }],
    ["owner-2@example.test", { _id: "user-2", role: "student", emailVerified: true }]
  ]);
  const calls = { updates: [] };
  const User = {
    collection: {
      listIndexes: () => ({
        toArray: async () => [{
          name: "unique_admin_role",
          key: { role: 1 },
          unique: true,
          partialFilterExpression: { role: "admin" }
        }]
      }),
      async createIndex() {
        throw new Error("Existing index should be reused.");
      }
    },
    findOne: (filter) => ({
      select: async () => targets.get(filter.email)
    }),
    countDocuments: async () => 0,
    async updateOne(filter) {
      calls.updates.push(filter);
      if (promotedIds.size > 0) {
        const duplicateKeyError = new Error("private MongoDB index details");
        duplicateKeyError.code = 11000;
        throw duplicateKeyError;
      }
      promotedIds.add(filter._id);
      targets.get(filter.email).role = "admin";
      return { modifiedCount: 1 };
    }
  };
  const confirm = async () => {
    confirmationsReady += 1;
    if (confirmationsReady === 2) releaseConfirmations();
    await bothConfirmed;
    return true;
  };

  const outcomes = await Promise.allSettled([
    promoteVerifiedUser({
      connection: { name: "test" },
      User,
      email: "owner-1@example.test",
      confirm
    }),
    promoteVerifiedUser({
      connection: { name: "test" },
      User,
      email: "owner-2@example.test",
      confirm
    })
  ]);

  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.match(rejected.reason.message, /created concurrently/);
  assert.ok(!rejected.reason.message.includes("private MongoDB"));
  assert.equal(promotedIds.size, 1);
  assert.equal(
    [...targets.values()].filter((target) => target.role === "admin").length,
    1
  );
  assert.equal(calls.updates.length, 2);
});
