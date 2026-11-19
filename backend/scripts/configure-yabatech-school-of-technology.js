const path = require("node:path");
const dns = require("node:dns");
const { isIP } = require("node:net");
const mongoose = require("mongoose");
const School = require("../models/School");
const Department = require("../models/Department");

const SCHOOL_NAME = "School of Technology";
const SCHOOL_DESCRIPTION = "Academic division of Yaba College of Technology (YABATECH), Lagos, Nigeria.";
const APPLY_CONFIRMATION = "YABATECH-SCHOOL-OF-TECHNOLOGY";
const STAGING_DATABASE_NAME = "academy_platform_staging";
const STAGING_ENV_PATH = path.resolve(__dirname, "..", ".env.staging");
const APPROVED_MONGO_HOSTS = new Set([
  "db101.vjwitxs.mongodb.net",
  "ac-4xahgcu.vjwitxs.mongodb.net",
  "ac-4xahgcu-shard-00-00.vjwitxs.mongodb.net",
  "ac-4xahgcu-shard-00-01.vjwitxs.mongodb.net",
  "ac-4xahgcu-shard-00-02.vjwitxs.mongodb.net"
]);
const SAFE_MONGO_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENODATA",
  "ESERVFAIL",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ECONNABORTED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_TLS_HANDSHAKE_TIMEOUT",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR",
  "ERR_SSL_UNSUPPORTED_PROTOCOL",
  "ERR_SSL_CERTIFICATE_VERIFY_FAILED"
]);
const SAFE_MONGO_ERROR_NAMES = new Set([
  "MongoServerSelectionError",
  "MongoNetworkError",
  "MongoNetworkTimeoutError",
  "MongoServerError",
  "MongoParseError",
  "MongoRuntimeError",
  "MongoOperationTimeoutError",
  "MongoTopologyClosedError",
  "MongooseError",
  "SafeConfigurationError",
  "Error",
  "TypeError",
  "RangeError"
]);

const DEPARTMENTS = Object.freeze([
  Object.freeze({ name: "Agricultural Technology", code: "YCT-SOT-AGRICULTURAL-TECH" }),
  Object.freeze({ name: "Computer Technology", code: "YCT-SOT-COMPUTER-TECH" }),
  Object.freeze({ name: "Food Technology", code: "YCT-SOT-FOOD-TECH" }),
  Object.freeze({ name: "Hospitality Management", code: "YCT-SOT-HOSPITALITY" }),
  Object.freeze({ name: "Leisure & Tourism Management", code: "YCT-SOT-LEISURE-TOURISM" }),
  Object.freeze({ name: "Nutrition & Dietetics", code: "YCT-SOT-NUTRITION-DIETETICS" }),
  Object.freeze({ name: "Polymer & Textile Technology", code: "YCT-SOT-POLYMER-TEXTILE" })
]);

class SafeConfigurationError extends Error {}

class DatabaseOperationError extends Error {
  constructor(phase, cause) {
    super();
    this.name = "DatabaseOperationError";
    this.phase = phase;
    this.cause = cause;
  }
}

function getStagingMongoUri(environment = process.env) {
  const uri = environment.STAGING_MONGO_URI;
  if (typeof uri !== "string" || uri.trim().length === 0) {
    throw new SafeConfigurationError(
      "STAGING_MONGO_URI is required in backend/.env.staging or the process environment."
    );
  }
  return uri.trim();
}

function loadStagingMongoUri({
  environment = process.env,
  dotenv = require("dotenv")
} = {}) {
  const result = dotenv.config({ path: STAGING_ENV_PATH });
  if (result && result.error && result.error.code !== "ENOENT") {
    throw new SafeConfigurationError("Unable to load backend/.env.staging.");
  }
  return getStagingMongoUri(environment);
}

function parseMongoHosts(authority, protocol) {
  const atIndex = authority.lastIndexOf("@");
  if (
    (atIndex === 0) ||
    (atIndex !== -1 && authority.indexOf("@") !== atIndex)
  ) {
    throw new SafeConfigurationError("STAGING_MONGO_URI is malformed.");
  }

  const hostList = atIndex === -1 ? authority : authority.slice(atIndex + 1);
  const entries = hostList.split(",");
  if (!hostList || (protocol === "mongodb+srv" && entries.length !== 1)) {
    throw new SafeConfigurationError("STAGING_MONGO_URI is malformed.");
  }

  return entries.map((entry) => {
    if (!entry || entry.startsWith("[") || (entry.match(/:/g) || []).length > 1) {
      throw new SafeConfigurationError("STAGING_MONGO_URI is malformed.");
    }

    const separator = entry.indexOf(":");
    const hostname = separator === -1 ? entry : entry.slice(0, separator);
    const port = separator === -1 ? "" : entry.slice(separator + 1);
    if (
      !hostname ||
      (separator !== -1 &&
        (protocol === "mongodb+srv" || !/^\d+$/.test(port) || Number(port) !== 27017))
    ) {
      throw new SafeConfigurationError("STAGING_MONGO_URI is malformed.");
    }

    const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
    if (!APPROVED_MONGO_HOSTS.has(normalizedHostname)) {
      throw new SafeConfigurationError("STAGING_MONGO_URI uses an unapproved MongoDB host.");
    }
    return normalizedHostname;
  });
}

function validateStagingMongoUri(uri) {
  if (
    typeof uri !== "string" ||
    uri.trim().length === 0 ||
    /\s/.test(uri) ||
    /%(?![0-9a-f]{2})/i.test(uri)
  ) {
    throw new SafeConfigurationError("STAGING_MONGO_URI is missing or malformed.");
  }

  const match = /^(?<protocol>mongodb(?:\+srv)?):\/\/(?<authority>[^/?#]+)\/(?<database>[^/?#]+)(?:\?(?<query>[^#]*))?$/i.exec(uri);
  if (!match) {
    throw new SafeConfigurationError("STAGING_MONGO_URI must be a supported MongoDB URI with a database name.");
  }

  const protocol = match.groups.protocol.toLowerCase();
  const hosts = parseMongoHosts(match.groups.authority, protocol);
  let databaseName;
  try {
    databaseName = decodeURIComponent(match.groups.database);
  } catch {
    throw new SafeConfigurationError("STAGING_MONGO_URI has a malformed database name.");
  }
  if (databaseName !== STAGING_DATABASE_NAME) {
    throw new SafeConfigurationError(
      `STAGING_MONGO_URI must target database ${STAGING_DATABASE_NAME}.`
    );
  }

  if (match.groups.query !== undefined) {
    const queryParameters = new URLSearchParams(match.groups.query);
    const databaseOverrides = [...queryParameters.entries()]
      .filter(([name]) => name.toLowerCase() === "dbname")
      .map(([, value]) => value);
    if (databaseOverrides.length > 0) {
      if (databaseOverrides.length !== 1 || databaseOverrides[0] !== STAGING_DATABASE_NAME) {
        throw new SafeConfigurationError(
          `STAGING_MONGO_URI must target database ${STAGING_DATABASE_NAME}.`
        );
      }
    }
  }

  return { protocol, hosts, databaseName };
}

function configureStagingDns(environment = process.env, dnsModule = dns) {
  const configuredServers = environment.STAGING_DNS_SERVERS;
  if (configuredServers === undefined || configuredServers === "") {
    return { mode: "system" };
  }
  if (typeof configuredServers !== "string") {
    throw new SafeConfigurationError(
      "STAGING_DNS_SERVERS must contain one to four comma-separated IP addresses."
    );
  }
  if (configuredServers.trim() === "") return { mode: "system" };

  const servers = configuredServers.split(",").map((server) => server.trim());
  if (
    servers.length === 0 ||
    servers.length > 4 ||
    servers.some((server) => isIP(server) === 0)
  ) {
    throw new SafeConfigurationError(
      "STAGING_DNS_SERVERS must contain one to four comma-separated IP addresses."
    );
  }

  try {
    dnsModule.setServers(servers);
  } catch {
    throw new SafeConfigurationError("Unable to apply STAGING_DNS_SERVERS.");
  }
  return { mode: "override" };
}

async function connectToStagingDatabase(
  uri,
  mongooseClient = mongoose,
  { environment = process.env, dnsModule = dns } = {}
) {
  validateStagingMongoUri(uri);
  configureStagingDns(environment, dnsModule);
  await mongooseClient.connect(uri, { dbName: STAGING_DATABASE_NAME });
}

const normalizeName = (value) => typeof value === "string"
  ? value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase()
  : "";

const normalizeCode = (value) => typeof value === "string"
  ? value.normalize("NFC").trim().toUpperCase()
  : "";

const idOf = (value) => {
  const id = value && typeof value === "object" ? value._id : value;
  return id == null ? "" : String(id);
};

const summarizeSchool = (school) => ({
  id: idOf(school._id),
  name: school.name,
  code: school.code || ""
});

const summarizeDepartment = (department) => ({
  id: idOf(department._id),
  name: department.name,
  code: department.code,
  schoolId: idOf(department.school)
});

const makeConflict = (type, subject, message, records = []) => ({
  type,
  subject,
  message,
  records
});

function buildConfigurationPlan(schools, departments) {
  const conflicts = [];
  const schoolMatches = schools.filter(
    (school) => normalizeName(school.name) === normalizeName(SCHOOL_NAME)
  );
  let school;
  let targetSchoolId = "";
  let schoolCanBeCreated = false;

  if (schoolMatches.length > 1) {
    school = { action: "conflict", records: schoolMatches.map(summarizeSchool) };
    conflicts.push(makeConflict(
      "duplicate_school_name",
      SCHOOL_NAME,
      "Multiple Schools have the normalized target name.",
      school.records
    ));
  } else if (schoolMatches.length === 1) {
    const [match] = schoolMatches;
    targetSchoolId = idOf(match._id);
    school = { action: "reuse", ...summarizeSchool(match) };
  } else {
    schoolCanBeCreated = true;
    school = { action: "create", name: SCHOOL_NAME };
  }

  const plannedDepartments = DEPARTMENTS.map((specification) => {
    const nameMatches = departments.filter(
      (department) => normalizeName(department.name) === normalizeName(specification.name)
    );
    const codeMatches = departments.filter(
      (department) => normalizeCode(department.code) === normalizeCode(specification.code)
    );
    const candidates = [...new Map(
      [...nameMatches, ...codeMatches].map((department) => [
        idOf(department._id),
        department
      ])
    ).values()];

    if (school.action === "conflict") {
      return {
        ...specification,
        action: "blocked",
        reason: "The target School is ambiguous.",
        records: candidates.map(summarizeDepartment)
      };
    }

    if (candidates.length === 0) {
      return { ...specification, action: "create" };
    }

    if (schoolCanBeCreated) {
      const records = candidates.map(summarizeDepartment);
      conflicts.push(makeConflict(
        "department_match_without_target_school",
        specification.name,
        "A matching department name or code exists, but no target School record exists to establish its relationship.",
        records
      ));
      return { ...specification, action: "conflict", records };
    }

    const exactNameMatches = nameMatches.filter(
      (department) => normalizeCode(department.code) === normalizeCode(specification.code)
    );
    const exactIdentityMatches = exactNameMatches.filter(
      (department) => idOf(department.school) === targetSchoolId
    );

    if (
      nameMatches.length === 1 &&
      codeMatches.length === 1 &&
      exactNameMatches.length === 1 &&
      exactIdentityMatches.length === 1 &&
      idOf(nameMatches[0]._id) === idOf(codeMatches[0]._id)
    ) {
      return {
        ...specification,
        action: "reuse",
        ...summarizeDepartment(exactIdentityMatches[0])
      };
    }

    const records = candidates.map(summarizeDepartment);
    const hasOtherSchool = candidates.some(
      (department) => idOf(department.school) !== targetSchoolId
    );
    conflicts.push(makeConflict(
      hasOtherSchool ? "department_school_conflict" : "department_identity_conflict",
      specification.name,
      hasOtherSchool
        ? "A matching department name or code is associated with a different School."
        : "A matching department name or code exists, but its identity is not unambiguous.",
      records
    ));
    return { ...specification, action: "conflict", records };
  });

  return {
    school,
    departments: plannedDepartments,
    conflicts,
    applied: false
  };
}

async function findAll(Model, session) {
  let query = Model.find({});
  if (session) query = query.session(session);
  return query.lean().exec();
}

function withSummary(plan, applied) {
  const departmentsPlannedCreate = plan.departments.filter((item) => item.action === "create").length;
  const departmentsPlannedReuse = plan.departments.filter((item) => item.action === "reuse").length;
  return {
    ...plan,
    applied,
    summary: {
      schoolPlannedAction: plan.school.action,
      departmentsPlannedCreate,
      departmentsPlannedReuse,
      schoolCreated: applied && plan.school.action === "create",
      schoolReused: applied && plan.school.action === "reuse",
      departmentsCreated: applied ? departmentsPlannedCreate : 0,
      departmentsReused: applied ? departmentsPlannedReuse : 0
    }
  };
}

async function runConfiguration({
  SchoolModel = School,
  DepartmentModel = Department,
  mongooseClient = mongoose,
  apply = false,
  confirmation
} = {}) {
  if (apply && confirmation !== APPLY_CONFIRMATION) {
    throw new SafeConfigurationError(`Apply mode requires --confirm ${APPLY_CONFIRMATION}.`);
  }

  if (!apply) {
    const [schools, departments] = await Promise.all([
      findAll(SchoolModel),
      findAll(DepartmentModel)
    ]);
    return withSummary(buildConfigurationPlan(schools, departments), false);
  }

  const session = await mongooseClient.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const [schools, departments] = await Promise.all([
        findAll(SchoolModel, session),
        findAll(DepartmentModel, session)
      ]);
      const plan = buildConfigurationPlan(schools, departments);

      if (plan.conflicts.length > 0) {
        result = withSummary(plan, false);
        return;
      }

      let schoolId = plan.school.id;
      if (plan.school.action === "create") {
        const [createdSchool] = await SchoolModel.create([{
          name: SCHOOL_NAME,
          description: SCHOOL_DESCRIPTION
        }], { session });
        schoolId = idOf(createdSchool._id);
        plan.school = {
          action: "create",
          id: schoolId,
          name: SCHOOL_NAME
        };
      }

      for (const plannedDepartment of plan.departments) {
        if (plannedDepartment.action !== "create") continue;
        const [createdDepartment] = await DepartmentModel.create([{
          name: plannedDepartment.name,
          code: plannedDepartment.code,
          school: schoolId
        }], { session });
        plannedDepartment.id = idOf(createdDepartment._id);
        plannedDepartment.schoolId = schoolId;
      }

      result = withSummary(plan, true);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function parseArguments(argumentsList) {
  const options = { apply: false, confirmation: "", help: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--apply") {
      options.apply = true;
    } else if (argument === "--confirm") {
      options.confirmation = argumentsList[index + 1] || "";
      index += 1;
    } else if (argument.startsWith("--confirm=")) {
      options.confirmation = argument.slice("--confirm=".length);
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new SafeConfigurationError("Unknown command-line option.");
    }
  }
  if (options.apply && options.confirmation !== APPLY_CONFIRMATION) {
    throw new SafeConfigurationError(`Apply mode requires --confirm ${APPLY_CONFIRMATION}.`);
  }
  return options;
}

function collectErrorChain(error) {
  const nodes = [];
  const pending = [{ value: error, depth: 0 }];
  const seen = new Set();
  while (pending.length > 0 && nodes.length < 32) {
    const { value, depth } = pending.shift();
    if (!value || typeof value !== "object" || seen.has(value) || depth > 6) continue;
    seen.add(value);
    nodes.push(value);

    for (const property of ["cause", "reason", "originalError", "error", "err"]) {
      if (value[property] && typeof value[property] === "object") {
        pending.push({ value: value[property], depth: depth + 1 });
      }
    }

    for (const property of ["errors", "servers"]) {
      const collection = value[property];
      if (collection instanceof Map) {
        for (const nested of collection.values()) {
          if (nested && typeof nested === "object") {
            pending.push({ value: nested, depth: depth + 1 });
          }
        }
      } else if (Array.isArray(collection)) {
        for (const nested of collection) {
          if (nested && typeof nested === "object") {
            pending.push({ value: nested, depth: depth + 1 });
          }
        }
      }
    }
  }
  return nodes;
}

function safeErrorName(error) {
  return SAFE_MONGO_ERROR_NAMES.has(error && error.name) ? error.name : "Error";
}

function safeErrorCode(error) {
  if (Number.isInteger(error && error.code) && error.code >= 0 && error.code <= 99999) {
    return error.code;
  }
  return SAFE_MONGO_ERROR_CODES.has(error && error.code) ? error.code : null;
}

function classifyMongoError(error) {
  const nodes = collectErrorChain(error);
  const messages = nodes.map((node) =>
    typeof node.message === "string" ? node.message : ""
  );
  const combinedMessage = messages.join("\n");
  const hasCode = (code) => nodes.some((node) => node.code === code);
  const hasCodeName = (codeName) => nodes.some((node) => node.codeName === codeName);
  const hasName = (name) => nodes.some((node) => node.name === name);
  const matches = (pattern) => pattern.test(combinedMessage);
  let category;
  let diagnostic;
  let evidence;

  if (
    hasCode(13) ||
    hasCodeName("Unauthorized") ||
    matches(/not authorized on .* to execute|not authorized to access (?:the )?database|unauthorized/i)
  ) {
    category = "Database authorization failure";
    diagnostic = "The staging user may lack required authorization for the staging database.";
    evidence = nodes.find((node) =>
      node.code === 13 ||
      node.codeName === "Unauthorized" ||
      /not authorized on .* to execute|not authorized to access (?:the )?database|unauthorized/i.test(node.message || "")
    );
  } else if (
    hasCode(18) ||
    hasCodeName("AuthenticationFailed") ||
    matches(/authentication failed|bad auth|auth failed/i)
  ) {
    category = "Authentication failure";
    diagnostic = "MongoDB rejected authentication for the configured staging user.";
    evidence = nodes.find((node) =>
      node.code === 18 ||
      node.codeName === "AuthenticationFailed" ||
      /authentication failed|bad auth|auth failed/i.test(node.message || "")
    );
  } else if (
    matches(/ip address.*(?:access list|whitelist|allowlist|not.*allowed)|(?:access list|whitelist|allowlist).*ip address|not authorized to access this resource/i)
  ) {
    category = "Network/IP access restriction";
    diagnostic = "The runner's network or IP address may not be allowed to reach the cluster.";
    evidence = nodes.find((node) =>
      /ip address.*(?:access list|whitelist|allowlist|not.*allowed)|(?:access list|whitelist|allowlist).*ip address|not authorized to access this resource/i.test(node.message || "")
    );
  } else if (
    nodes.some((node) => SAFE_MONGO_ERROR_CODES.has(node.code) && (
      String(node.code).startsWith("ERR_TLS_") ||
      String(node.code).startsWith("ERR_SSL_") ||
      String(node.code).startsWith("CERT_") ||
      String(node.code).startsWith("DEPTH_") ||
      String(node.code).startsWith("SELF_SIGNED_") ||
      String(node.code).startsWith("UNABLE_TO_VERIFY_")
    )) ||
    matches(/\b(?:tls|ssl|certificate|certification)\b/i)
  ) {
    category = "TLS/SSL failure";
    diagnostic = "A secure TLS connection to the MongoDB cluster could not be established.";
    evidence = nodes.find((node) =>
      (typeof node.code === "string" && (
        node.code.startsWith("ERR_TLS_") ||
        node.code.startsWith("ERR_SSL_") ||
        node.code.startsWith("CERT_") ||
        node.code.startsWith("DEPTH_") ||
        node.code.startsWith("SELF_SIGNED_") ||
        node.code.startsWith("UNABLE_TO_VERIFY_")
      )) ||
      /\b(?:tls|ssl|certificate|certification)\b/i.test(node.message || "")
    );
  } else if (
    nodes.some((node) => ["ENOTFOUND", "EAI_AGAIN", "ENODATA", "ESERVFAIL"].includes(node.code)) ||
    matches(/querysrv|querytxt|getaddrinfo|enotfound|eai_again|dns.*(?:fail|error|not found)/i)
  ) {
    category = "DNS/SRV resolution failure";
    diagnostic = "The MongoDB hostname or SRV records could not be resolved.";
    evidence = nodes.find((node) =>
      ["ENOTFOUND", "EAI_AGAIN", "ENODATA", "ESERVFAIL"].includes(node.code) ||
      /querysrv|querytxt|getaddrinfo|enotfound|eai_again|dns.*(?:fail|error|not found)/i.test(node.message || "")
    );
  } else if (
    hasName("MongoServerSelectionError") ||
    hasCode("ETIMEDOUT") ||
    matches(/server selection timed out|timed out while waiting for server selection/i)
  ) {
    category = "Server selection timeout";
    diagnostic = "No eligible MongoDB server was selected before the timeout.";
    evidence = nodes.find((node) =>
      node.name === "MongoServerSelectionError" ||
      node.code === "ETIMEDOUT" ||
      /server selection timed out|timed out while waiting for server selection/i.test(node.message || "")
    );
  } else if (
    nodes.some((node) => ["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "ECONNABORTED"].includes(node.code))
  ) {
    category = "Network/connectivity failure";
    diagnostic = "A network connection to the MongoDB cluster could not be established.";
    evidence = nodes.find((node) =>
      ["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "ECONNABORTED"].includes(node.code)
    );
  } else {
    category = "Unclassified MongoDB failure";
    diagnostic = "The MongoDB operation failed without a recognized safe diagnostic category.";
    evidence = nodes[0];
  }

  const source = evidence || nodes[0] || {};
  return {
    category,
    errorName: safeErrorName(source),
    code: safeErrorCode(source),
    diagnostic
  };
}

function safeErrorSummary(error) {
  if (error instanceof SafeConfigurationError) {
    return `Configuration error (SafeConfigurationError): ${error.message}`;
  }
  const operationError = error instanceof DatabaseOperationError;
  const result = classifyMongoError(operationError ? error.cause : error);
  const code = result.code === null ? "" : `, code ${result.code}`;
  const phase = operationError ? `${error.phase} failed: ` : "";
  return `${phase}${result.category} (${result.errorName}${code}): ${result.diagnostic}`;
}

async function runWithDatabasePhase(phase, operation) {
  try {
    return await operation();
  } catch (error) {
    throw new DatabaseOperationError(phase, error);
  }
}

async function main(argumentsList = process.argv.slice(2)) {
  const options = parseArguments(argumentsList);
  if (options.help) {
    process.stdout.write(
      "Dry-run: npm run configure:yabatech-school-of-technology\n" +
      `Apply:   npm run configure:yabatech-school-of-technology -- --apply --confirm ${APPLY_CONFIRMATION}\n` +
      "Optional staging DNS override: STAGING_DNS_SERVERS=<comma-separated IP addresses> (default: system DNS).\n"
    );
    return;
  }

  const stagingMongoUri = loadStagingMongoUri();
  await runWithDatabasePhase(
    "connection",
    () => connectToStagingDatabase(stagingMongoUri)
  );
  try {
    const result = await runWithDatabasePhase(
      "database read",
      () => runConfiguration({
        apply: options.apply,
        confirmation: options.confirmation
      })
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.conflicts.length > 0) process.exitCode = 1;
  } finally {
    await runWithDatabasePhase("connection cleanup", () => mongoose.disconnect());
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`YABATECH configuration failed: ${safeErrorSummary(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  APPLY_CONFIRMATION,
  APPROVED_MONGO_HOSTS,
  DEPARTMENTS,
  SCHOOL_NAME,
  STAGING_DATABASE_NAME,
  STAGING_ENV_PATH,
  buildConfigurationPlan,
  classifyMongoError,
  configureStagingDns,
  connectToStagingDatabase,
  getStagingMongoUri,
  loadStagingMongoUri,
  normalizeCode,
  normalizeName,
  parseArguments,
  runWithDatabasePhase,
  runConfiguration,
  safeErrorSummary,
  validateStagingMongoUri
};
