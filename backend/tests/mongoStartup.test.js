const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const express = require("express");
const request = require("supertest");
const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "test";
const app = require("../app");
if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = originalNodeEnv;
const {
  classifyMongoConnectionError,
  registerMongoConnectionEvents,
  isDatabaseReady,
  createHealthHandler
} = require("../utils/mongoConnection");
const { resolveSessionSecret } = require("../utils/sessionSecret");

const makeLogger = () => ({
  entries: [],
  info(event, details) { this.entries.push({ level: "info", event, details }); },
  warn(event, details) { this.entries.push({ level: "warn", event, details }); },
  error(event, details) { this.entries.push({ level: "error", event, details }); }
});

test("production requires a configured session secret", () => {
  assert.throws(
    () => resolveSessionSecret({ sessionSecret: undefined, nodeEnv: "production" }),
    /SESSION_SECRET must be configured in production/
  );
  assert.throws(
    () => resolveSessionSecret({ sessionSecret: "", nodeEnv: "production" }),
    /SESSION_SECRET must be configured in production/
  );
});

test("production rejects weak session secrets and accepts a sufficiently long secret", () => {
  assert.throws(
    () => resolveSessionSecret({ sessionSecret: "short", nodeEnv: "production" }),
    /at least 32 bytes/
  );
  const validSecret = "this-is-a-test-secret-with-at-least-32-bytes";
  assert.equal(
    resolveSessionSecret({ sessionSecret: validSecret, nodeEnv: "production" }) === validSecret,
    true
  );
  assert.doesNotMatch(
    resolveSessionSecret({ sessionSecret: undefined, nodeEnv: "test" }),
    /secretkey/
  );
});

test("startup refuses to listen when MONGO_URI is missing", async () => {
  const calls = [];
  const mongooseClient = {
    connection: { on() {} },
    async connect() { calls.push("connect"); }
  };
  const serverApp = { listen() { calls.push("listen"); } };
  const logger = makeLogger();

  await assert.rejects(
    app.startServer({
      serverApp,
      mongooseClient,
      mongoUri: " ",
      loggerInstance: logger
    }),
    /MongoDB URI is required/
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(logger.entries, [{
    level: "error",
    event: "mongodb_startup_failed",
    details: { category: "configuration" }
  }]);
});

test("initial MongoDB failure is sanitized and prevents the server from listening", async () => {
  const calls = [];
  const logger = makeLogger();
  const connectionError = new Error(
    "mongodb+srv://private-user:private-pass@private-host"
  );
  connectionError.name = "MongoServerSelectionError";
  connectionError.code = "ETIMEDOUT";
  const mongooseClient = {
    connection: { on() {} },
    async connect() { calls.push("connect"); throw connectionError; }
  };
  const serverApp = { listen() { calls.push("listen"); } };

  await assert.rejects(
    app.startServer({
      serverApp,
      mongooseClient,
      mongoUri: "mongodb://uri-is-not-logged",
      loggerInstance: logger
    }),
    /MongoDB initial connection failed/
  );
  assert.deepEqual(calls, ["connect"]);
  const output = JSON.stringify(logger.entries);
  assert.match(output, /timeout/);
  assert.doesNotMatch(output, /private-user|private-pass|private-host|uri-is-not-logged/);
});

test("server listens only after MongoDB connection succeeds", async () => {
  const calls = [];
  const mongooseClient = {
    connection: { on() {} },
    async connect() { calls.push("connect"); }
  };
  const serverApp = {
    listen(port, callback) {
      calls.push(["listen", port]);
      callback();
      return { listening: true };
    }
  };
  const server = await app.startServer({
    serverApp,
    mongooseClient,
    mongoUri: "mongodb://test-uri",
    port: 4321,
    afterDatabaseConnected: async () => calls.push("initialize"),
    loggerInstance: makeLogger()
  });

  assert.deepEqual(calls, ["connect", "initialize", ["listen", 4321]]);
  assert.deepEqual(server, { listening: true });
});

test("health endpoint reports database readiness accurately", async () => {
  const connection = { readyState: 0 };
  const healthApp = express();
  healthApp.get("/health", createHealthHandler(connection));

  const disconnectedResponse = await request(healthApp).get("/health");
  assert.equal(disconnectedResponse.status, 503);
  assert.equal(disconnectedResponse.body.status, "unhealthy");
  assert.equal(disconnectedResponse.body.database, "disconnected");

  connection.readyState = 1;
  assert.equal(isDatabaseReady(connection), true);
  const connectedResponse = await request(healthApp).get("/health");
  assert.equal(connectedResponse.status, 200);
  assert.equal(connectedResponse.body.status, "healthy");
  assert.equal(connectedResponse.body.database, "connected");

  connection.readyState = 0;
  const disconnectedAgainResponse = await request(healthApp).get("/health");
  assert.equal(disconnectedAgainResponse.status, 503);
  assert.equal(disconnectedAgainResponse.body.status, "unhealthy");
  assert.equal(disconnectedAgainResponse.body.database, "disconnected");
});

test("MongoDB lifecycle events are logged without raw errors", () => {
  const handlers = new Map();
  const logger = makeLogger();
  const connection = {
    on(event, handler) { handlers.set(event, handler); }
  };
  registerMongoConnectionEvents(connection, logger);

  handlers.get("connected")();
  handlers.get("disconnected")();
  handlers.get("reconnected")();
  handlers.get("error")(Object.assign(
    new Error("sensitive uri and credentials"),
    { code: 18 }
  ));

  assert.deepEqual(logger.entries.map(({ event }) => event), [
    "mongodb_connected",
    "mongodb_disconnected",
    "mongodb_reconnected",
    "mongodb_connection_error"
  ]);
  assert.match(JSON.stringify(logger.entries), /authentication/);
  assert.doesNotMatch(JSON.stringify(logger.entries), /sensitive uri|credentials/);
});

test("repeated startup calls register one set of connection event listeners", async () => {
  const connection = new EventEmitter();
  connection.readyState = 1;
  const logger = makeLogger();
  const mongooseClient = {
    connection,
    async connect() {}
  };
  const serverApp = { listen() {} };
  const options = {
    serverApp,
    mongooseClient,
    mongoUri: "mongodb://test-uri",
    afterDatabaseConnected: async () => {},
    loggerInstance: logger
  };

  await app.startServer(options);
  await app.startServer(options);

  for (const event of ["connected", "disconnected", "reconnected", "error"]) {
    assert.equal(connection.listenerCount(event), 1);
  }
  connection.emit("connected");
  assert.equal(
    logger.entries.filter(({ event }) => event === "mongodb_connected").length,
    1
  );
});

test("post-connection initialization failure stops services and disconnects Mongoose", async () => {
  const calls = [];
  const logger = makeLogger();
  const sensitiveMessage = "mongodb://private-user:private-password@private-host";
  const mongooseClient = {
    connection: {
      readyState: 1,
      on() {}
    },
    async connect() { calls.push("connect"); },
    async disconnect() {
      calls.push("disconnect");
      this.connection.readyState = 0;
    }
  };

  await assert.rejects(
    app.startServer({
      serverApp: { listen() { calls.push("listen"); } },
      mongooseClient,
      mongoUri: "mongodb://connection-value",
      afterDatabaseConnected: async () => {
        calls.push("initialize");
        throw new Error(sensitiveMessage);
      },
      stopBackgroundServices: () => calls.push("stop-services"),
      loggerInstance: logger
    }),
    /Application initialization failed/
  );

  assert.deepEqual(calls, ["connect", "initialize", "stop-services", "disconnect"]);
  assert.equal(mongooseClient.connection.readyState, 0);
  assert.doesNotMatch(JSON.stringify(logger.entries), /private-user|private-password|private-host|connection-value/);
});

test("MongoDB connection error classification uses safe categories", () => {
  assert.equal(
    classifyMongoConnectionError(Object.assign(new Error(), { code: 18 })),
    "authentication"
  );
  assert.equal(
    classifyMongoConnectionError(Object.assign(new Error(), { code: "ENOTFOUND" })),
    "dns"
  );
  assert.equal(
    classifyMongoConnectionError(Object.assign(new Error(), { code: "ECONNREFUSED" })),
    "network"
  );
  assert.equal(
    classifyMongoConnectionError(Object.assign(new Error(), { code: "ERR_TLS_CERT_ALTNAME_INVALID" })),
    "tls-certificate"
  );
  assert.equal(classifyMongoConnectionError(new Error("details")), "operation-failed");
});
