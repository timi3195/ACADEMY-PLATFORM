const test = require("node:test");
const assert = require("node:assert/strict");
const {
  APPLY_CONFIRMATION,
  APPROVED_MONGO_HOSTS,
  DEPARTMENTS,
  SCHOOL_NAME,
  STAGING_DATABASE_NAME,
  STAGING_ENV_PATH,
  buildConfigurationPlan,
  classifyMongoError,
  connectToStagingDatabase,
  configureStagingDns,
  getStagingMongoUri,
  loadStagingMongoUri,
  parseArguments,
  runWithDatabasePhase,
  runConfiguration,
  safeErrorSummary,
  validateStagingMongoUri
} = require("../scripts/configure-yabatech-school-of-technology");

const validStagingUri =
  "mongodb://ac-4xahgcu-shard-00-00.vjwitxs.mongodb.net:27017/academy_platform_staging";

const copy = (value) => JSON.parse(JSON.stringify(value));

const makeSchool = (id, name = SCHOOL_NAME, extra = {}) => ({
  _id: id,
  name,
  description: "",
  ...extra
});

const makeDepartment = (id, specification, school = "school-1", extra = {}) => ({
  _id: id,
  name: specification.name,
  code: specification.code,
  school,
  description: "Existing description",
  ...extra
});

function createModel(initialRecords = [], { failOnCreateCall = 0 } = {}) {
  const records = copy(initialRecords);
  let createCalls = 0;
  return {
    records,
    get createCalls() {
      return createCalls;
    },
    find() {
      let querySession;
      const query = {
        session(session) {
          querySession = session;
          return query;
        },
        lean() {
          return query;
        },
        async exec() {
          if (querySession) assert.ok(querySession);
          return copy(records);
        }
      };
      return query;
    },
    async create(documents, options = {}) {
      assert.ok(options.session);
      createCalls += 1;
      if (createCalls === failOnCreateCall) {
        throw new Error("simulated insert failure");
      }
      const created = documents.map((document, index) => ({
        ...copy(document),
        _id: `${this.modelName || "record"}-${createCalls}-${index + 1}`
      }));
      records.push(...created);
      return created;
    }
  };
}

function makeModels({ schools = [], departments = [], failDepartmentCreate = 0 } = {}) {
  const SchoolModel = createModel(schools);
  SchoolModel.modelName = "school";
  const DepartmentModel = createModel(departments, {
    failOnCreateCall: failDepartmentCreate
  });
  DepartmentModel.modelName = "department";

  const mongooseClient = {
    sessionsStarted: 0,
    async startSession() {
      this.sessionsStarted += 1;
      return {
        async withTransaction(callback) {
          const schoolSnapshot = copy(SchoolModel.records);
          const departmentSnapshot = copy(DepartmentModel.records);
          try {
            return await callback();
          } catch (error) {
            SchoolModel.records.splice(0, SchoolModel.records.length, ...schoolSnapshot);
            DepartmentModel.records.splice(0, DepartmentModel.records.length, ...departmentSnapshot);
            throw error;
          }
        },
        async endSession() {}
      };
    }
  };

  return { SchoolModel, DepartmentModel, mongooseClient };
}

test("staging URI is required even when MONGO_URI is present", () => {
  assert.throws(
    () => getStagingMongoUri({ MONGO_URI: validStagingUri }),
    /STAGING_MONGO_URI is required/
  );
  assert.throws(() => getStagingMongoUri({}), /STAGING_MONGO_URI is required/);
});

test("CLI loads only the dedicated staging environment file", () => {
  let loadedPath;
  const uri = loadStagingMongoUri({
    environment: { STAGING_MONGO_URI: validStagingUri },
    dotenv: {
      config(options) {
        loadedPath = options.path;
        return { parsed: {} };
      }
    }
  });
  assert.equal(loadedPath, STAGING_ENV_PATH);
  assert.equal(uri, validStagingUri);
});

test("URI validation rejects malformed and unsupported MongoDB URIs", () => {
  assert.throws(() => validateStagingMongoUri("https://example.com/db"));
  assert.throws(() => validateStagingMongoUri("mongodb://host-without-db"));
  assert.throws(() => validateStagingMongoUri(
    "mongodb://user%ZZ@ac-4xahgcu-shard-00-00.vjwitxs.mongodb.net/academy_platform_staging"
  ));
  assert.throws(() => validateStagingMongoUri(" "));
});

test("URI validation rejects a database other than the staging database", () => {
  assert.throws(
    () => validateStagingMongoUri(validStagingUri.replace(
      STAGING_DATABASE_NAME,
      "test"
    )),
    new RegExp(STAGING_DATABASE_NAME)
  );
  assert.throws(
    () => validateStagingMongoUri(`${validStagingUri}?DBNAME=test`),
    new RegExp(STAGING_DATABASE_NAME)
  );
});

test("URI validation rejects staging database URIs on unapproved hosts", () => {
  const uri = "mongodb://unapproved.example.com/academy_platform_staging";
  assert.throws(
    () => validateStagingMongoUri(uri),
    /unapproved MongoDB host/
  );
});

test("approved Atlas cluster hosts and exact database name pass validation", () => {
  const srvUri = "mongodb+srv://ac-4xahgcu.vjwitxs.mongodb.net/academy_platform_staging";
  const validatedSrvUri = validateStagingMongoUri(srvUri);
  assert.equal(validatedSrvUri.databaseName, STAGING_DATABASE_NAME);
  assert.deepEqual(validatedSrvUri.hosts, ["ac-4xahgcu.vjwitxs.mongodb.net"]);

  const shardUri = [
    "mongodb://",
    "ac-4xahgcu-shard-00-00.vjwitxs.mongodb.net:27017,",
    "ac-4xahgcu-shard-00-01.vjwitxs.mongodb.net:27017,",
    "ac-4xahgcu-shard-00-02.vjwitxs.mongodb.net:27017/",
    "academy_platform_staging"
  ].join("");
  const validatedShardUri = validateStagingMongoUri(shardUri);
  assert.equal(validatedShardUri.databaseName, STAGING_DATABASE_NAME);
  assert.equal(validatedShardUri.hosts.length, 3);
  assert.ok(validatedShardUri.hosts.every((host) => APPROVED_MONGO_HOSTS.has(host)));
});

test("the Atlas Drivers hostname is approved only for the staging database", () => {
  const uri = "mongodb+srv://db101.vjwitxs.mongodb.net/academy_platform_staging";
  const validated = validateStagingMongoUri(uri);
  assert.deepEqual(validated.hosts, ["db101.vjwitxs.mongodb.net"]);
  assert.equal(validated.databaseName, STAGING_DATABASE_NAME);

  assert.throws(
    () => validateStagingMongoUri(uri.replace(
      STAGING_DATABASE_NAME,
      "test"
    )),
    new RegExp(STAGING_DATABASE_NAME)
  );
});

test("MongoDB connect is not called until URI validation succeeds", async () => {
  const calls = [];
  const mongooseClient = {
    async connect(...args) {
      calls.push(args);
    }
  };
  await assert.rejects(
    connectToStagingDatabase(
      "mongodb://unapproved.example.com/academy_platform_staging",
      mongooseClient
    )
  );
  assert.deepEqual(calls, []);

  await connectToStagingDatabase(validStagingUri, mongooseClient);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], { dbName: STAGING_DATABASE_NAME });
});

test("staging DNS uses system configuration by default and only accepts a staging override", () => {
  const calls = [];
  const dnsModule = {
    getServers() {
      return ["127.0.0.1"];
    },
    setServers(servers) {
      calls.push(servers);
    }
  };

  assert.deepEqual(configureStagingDns({}, dnsModule), { mode: "system" });
  assert.deepEqual(
    configureStagingDns({ MONGO_URI: "production-uri" }, dnsModule),
    { mode: "system" }
  );
  assert.deepEqual(calls, []);

  assert.deepEqual(
    configureStagingDns({ STAGING_DNS_SERVERS: "192.168.100.1,2001:4860:4860::8888" }, dnsModule),
    { mode: "override" }
  );
  assert.deepEqual(calls, [["192.168.100.1", "2001:4860:4860::8888"]]);
});

test("staging DNS rejects invalid override values without exposing them", () => {
  const calls = [];
  assert.throws(
    () => configureStagingDns(
      { STAGING_DNS_SERVERS: "private-dns-value" },
      { setServers: (servers) => calls.push(servers) }
    ),
    /STAGING_DNS_SERVERS must contain/
  );
  assert.deepEqual(calls, []);
});

test("staging DNS override is applied before a successful MongoDB SRV resolution", async () => {
  const events = [];
  const srvRecords = [
    { name: "atlas-a.vjwitxs.mongodb.net", port: 27017 },
    { name: "atlas-b.vjwitxs.mongodb.net", port: 27017 },
    { name: "atlas-c.vjwitxs.mongodb.net", port: 27017 }
  ];
  const dnsModule = {
    setServers(servers) {
      events.push(["setServers", servers]);
    },
    promises: {
      async resolve(hostname, recordType) {
        events.push(["resolve", hostname, recordType]);
        return srvRecords;
      }
    }
  };
  const mongooseClient = {
    async connect(uri, options) {
      const records = await dnsModule.promises.resolve(
        "_mongodb._tcp.db101.vjwitxs.mongodb.net",
        "SRV"
      );
      assert.deepEqual(records, srvRecords);
      events.push(["connect", uri, options]);
    }
  };

  await connectToStagingDatabase(
    "mongodb+srv://db101.vjwitxs.mongodb.net/academy_platform_staging",
    mongooseClient,
    {
      environment: { STAGING_DNS_SERVERS: "192.168.100.1" },
      dnsModule
    }
  );
  assert.equal(events[0][0], "setServers");
  assert.deepEqual(events[1], [
    "resolve",
    "_mongodb._tcp.db101.vjwitxs.mongodb.net",
    "SRV"
  ]);
  assert.equal(events[2][0], "connect");
  assert.deepEqual(events[2][2], { dbName: STAGING_DATABASE_NAME });
});

test("DNS/SRV failures are categorized without exposing raw resolver errors", async () => {
  const dnsModule = {
    setServers() {},
    promises: {
      async resolve() {
        throw Object.assign(
          new Error("querySrv ECONNREFUSED private-resolver"),
          { code: "ECONNREFUSED" }
        );
      }
    }
  };
  const mongooseClient = {
    async connect() {
      await dnsModule.promises.resolve(
        "_mongodb._tcp.db101.vjwitxs.mongodb.net",
        "SRV"
      );
    }
  };

  await assert.rejects(
    runWithDatabasePhase(
      "connection",
      () => connectToStagingDatabase(
        "mongodb+srv://db101.vjwitxs.mongodb.net/academy_platform_staging",
        mongooseClient,
        {
          environment: { STAGING_DNS_SERVERS: "192.168.100.1" },
          dnsModule
        }
      )
    ),
    (error) => {
      const summary = safeErrorSummary(error);
      assert.match(summary, /^connection failed: DNS\/SRV resolution failure/);
      assert.match(summary, /code ECONNREFUSED/);
      assert.doesNotMatch(summary, /private-resolver|db101|academy_platform_staging/);
      return true;
    }
  );
});

test("MongoDB errors receive safe diagnostic categories and sanitized names/codes", () => {
  const cases = [
    {
      error: Object.assign(new Error("Authentication failed for private-user"), {
        name: "MongoServerError",
        code: 18
      }),
      category: "Authentication failure",
      errorName: "MongoServerError",
      code: 18
    },
    {
      error: Object.assign(new Error("not authorized on academy_platform_staging to execute find"), {
        name: "MongoServerError",
        code: 13
      }),
      category: "Database authorization failure",
      code: 13
    },
    {
      error: Object.assign(new Error("IP address is not on the access list: secret-host"), {
        name: "MongoServerSelectionError"
      }),
      category: "Network/IP access restriction"
    },
    {
      error: Object.assign(new Error("Server selection timed out"), {
        name: "MongoServerSelectionError",
        cause: Object.assign(new Error("querySrv ENOTFOUND private-host"), {
          name: "MongoNetworkError",
          code: "ENOTFOUND"
        })
      }),
      category: "DNS/SRV resolution failure",
      errorName: "MongoNetworkError",
      code: "ENOTFOUND"
    },
    {
      error: Object.assign(new Error("TLS certificate failure for private-host"), {
        code: "ERR_TLS_CERT_ALTNAME_INVALID"
      }),
      category: "TLS/SSL failure",
      code: "ERR_TLS_CERT_ALTNAME_INVALID"
    },
    {
      error: Object.assign(new Error("Server selection timed out"), {
        name: "MongoServerSelectionError"
      }),
      category: "Server selection timeout"
    }
  ];

  for (const { error, category, errorName, code } of cases) {
    const result = classifyMongoError(error);
    assert.equal(result.category, category);
    if (errorName) assert.equal(result.errorName, errorName);
    if (code !== undefined) assert.equal(result.code, code);
    assert.doesNotMatch(JSON.stringify(result), /private-user|private-host|secret-host|academy_platform_staging/);
  }
});

test("CLI error summaries omit raw messages and sanitize unknown error metadata", () => {
  const error = Object.assign(
    new Error("mongodb://private-user:private-password@private-host/private-db"),
    {
      name: "private-name",
      code: "private-code"
    }
  );
  const summary = safeErrorSummary(error);
  assert.match(summary, /Unclassified MongoDB failure/);
  assert.match(summary, /\(Error\)/);
  assert.doesNotMatch(
    summary,
    /private-user|private-password|private-host|private-db|private-name|private-code|mongodb:/
  );
});

test("CLI error summaries identify connection and later database-read failures", async () => {
  const connectionCause = Object.assign(
    new Error("querySrv ENOTFOUND private-host"),
    { name: "MongoNetworkError", code: "ENOTFOUND" }
  );
  await assert.rejects(
    runWithDatabasePhase("connection", async () => {
      throw connectionCause;
    }),
    (error) => {
      const summary = safeErrorSummary(error);
      assert.match(summary, /^connection failed: DNS\/SRV resolution failure/);
      assert.match(summary, /MongoNetworkError, code ENOTFOUND/);
      assert.doesNotMatch(summary, /private-host/);
      return true;
    }
  );

  const readCause = Object.assign(
    new Error("not authorized on academy_platform_staging to execute find"),
    { name: "MongoServerError", code: 13 }
  );
  await assert.rejects(
    runWithDatabasePhase("database read", async () => {
      throw readCause;
    }),
    (error) => {
      const summary = safeErrorSummary(error);
      assert.match(summary, /^database read failed: Database authorization failure/);
      assert.match(summary, /MongoServerError, code 13/);
      assert.doesNotMatch(summary, /academy_platform_staging/);
      return true;
    }
  );
});

test("school matching normalizes whitespace and case", () => {
  const plan = buildConfigurationPlan(
    [makeSchool("school-1", "  SCHOOL   OF Technology ")],
    []
  );
  assert.equal(plan.school.action, "reuse");
  assert.equal(plan.school.id, "school-1");
  assert.equal(plan.conflicts.length, 0);
});

test("department is reused only when normalized name, code, and School all match", () => {
  const department = makeDepartment("department-1", DEPARTMENTS[0]);
  const plan = buildConfigurationPlan([makeSchool("school-1")], [department]);
  assert.equal(plan.departments[0].action, "reuse");
  assert.equal(plan.departments[0].id, "department-1");
});

test("duplicate normalized School names are reported as conflicts", () => {
  const plan = buildConfigurationPlan([
    makeSchool("school-1"),
    makeSchool("school-2", " school of technology ")
  ], []);
  assert.equal(plan.school.action, "conflict");
  assert.equal(plan.conflicts[0].type, "duplicate_school_name");
});

test("duplicate normalized department names are reported", () => {
  const specification = DEPARTMENTS[0];
  const plan = buildConfigurationPlan([makeSchool("school-1")], [
    makeDepartment("department-1", specification),
    makeDepartment("department-2", specification, "school-1", {
      code: "MANUAL-CODE"
    })
  ]);
  assert.equal(plan.departments[0].action, "conflict");
  assert.equal(plan.conflicts[0].type, "department_identity_conflict");
});

test("a matching code with a different name is reported as a code conflict", () => {
  const plan = buildConfigurationPlan([makeSchool("school-1")], [
    makeDepartment("department-1", DEPARTMENTS[0], "school-1", {
      name: "Existing department"
    })
  ]);
  assert.equal(plan.departments[0].action, "conflict");
  assert.equal(plan.conflicts[0].type, "department_identity_conflict");
});

test("a matching department assigned to another School is not moved or reused", () => {
  const plan = buildConfigurationPlan([makeSchool("school-1")], [
    makeDepartment("department-1", DEPARTMENTS[0], "other-school")
  ]);
  assert.equal(plan.departments[0].action, "conflict");
  assert.equal(plan.conflicts[0].type, "department_school_conflict");
});

test("dry-run reports creation plans without writing", async () => {
  const models = makeModels();
  const result = await runConfiguration(models);
  assert.equal(result.applied, false);
  assert.equal(result.school.action, "create");
  assert.equal(result.departments.filter((item) => item.action === "create").length, 7);
  assert.equal(result.summary.departmentsPlannedCreate, 7);
  assert.equal(result.summary.departmentsCreated, 0);
  assert.equal(models.SchoolModel.createCalls, 0);
  assert.equal(models.DepartmentModel.createCalls, 0);
  assert.equal(models.mongooseClient.sessionsStarted, 0);
});

test("apply mode refuses a missing confirmation before starting a session", async () => {
  const models = makeModels();
  await assert.rejects(
    runConfiguration({ ...models, apply: true }),
    new RegExp(APPLY_CONFIRMATION)
  );
  assert.equal(models.mongooseClient.sessionsStarted, 0);
  assert.equal(models.SchoolModel.createCalls, 0);
});

test("apply creates only missing records after full preflight", async () => {
  const models = makeModels();
  const result = await runConfiguration({
    ...models,
    apply: true,
    confirmation: APPLY_CONFIRMATION
  });
  assert.equal(result.applied, true);
  assert.equal(result.summary.schoolCreated, true);
  assert.equal(result.summary.departmentsCreated, 7);
  assert.equal(models.SchoolModel.records.length, 1);
  assert.equal(models.DepartmentModel.records.length, 7);
  assert.ok(models.DepartmentModel.records.every(
    (department) => department.school === result.school.id
  ));
});

test("apply creates nothing when preflight finds any record conflict", async () => {
  const conflictingDepartment = makeDepartment(
    "department-1",
    DEPARTMENTS[0],
    "school-1",
    { name: "Manually configured department" }
  );
  const models = makeModels({
    schools: [makeSchool("school-1")],
    departments: [conflictingDepartment]
  });
  const result = await runConfiguration({
    ...models,
    apply: true,
    confirmation: APPLY_CONFIRMATION
  });
  assert.equal(result.applied, false);
  assert.equal(result.conflicts.length, 1);
  assert.equal(models.SchoolModel.createCalls, 0);
  assert.equal(models.DepartmentModel.createCalls, 0);
  assert.equal(models.DepartmentModel.records.length, 1);
});

test("apply reuses existing records without overwriting fields", async () => {
  const school = makeSchool("school-1", SCHOOL_NAME, {
    description: "Keep this description",
    code: "MANUAL-SCHOOL-CODE"
  });
  const departments = DEPARTMENTS.map((specification, index) =>
    makeDepartment(`department-${index + 1}`, specification, "school-1", {
      description: `Keep department ${index + 1}`
    })
  );
  const models = makeModels({ schools: [school], departments });
  const beforeSchools = copy(models.SchoolModel.records);
  const beforeDepartments = copy(models.DepartmentModel.records);
  const result = await runConfiguration({
    ...models,
    apply: true,
    confirmation: APPLY_CONFIRMATION
  });
  assert.equal(result.applied, true);
  assert.equal(result.summary.schoolReused, true);
  assert.equal(result.summary.departmentsReused, 7);
  assert.deepEqual(models.SchoolModel.records, beforeSchools);
  assert.deepEqual(models.DepartmentModel.records, beforeDepartments);
  assert.equal(models.SchoolModel.createCalls, 0);
  assert.equal(models.DepartmentModel.createCalls, 0);
});

test("transaction rollback prevents an unreported partial configuration", async () => {
  const models = makeModels({ failDepartmentCreate: 2 });
  await assert.rejects(
    runConfiguration({
      ...models,
      apply: true,
      confirmation: APPLY_CONFIRMATION
    }),
    /simulated insert failure/
  );
  assert.equal(models.SchoolModel.records.length, 0);
  assert.equal(models.DepartmentModel.records.length, 0);
});

test("argument parser requires the exact apply confirmation", () => {
  assert.throws(() => parseArguments(["--apply"]), new RegExp(APPLY_CONFIRMATION));
  assert.equal(
    parseArguments(["--apply", "--confirm", APPLY_CONFIRMATION]).apply,
    true
  );
});
