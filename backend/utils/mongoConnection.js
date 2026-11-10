const registeredConnections = new WeakSet();

const getErrorSignals = (error) => {
  const signals = [];
  const seen = new Set();
  const pending = [{ error, depth: 0 }];

  while (pending.length > 0) {
    const current = pending.pop();
    const value = current.error;
    if (!value || typeof value !== "object" || seen.has(value) || current.depth > 4) continue;
    seen.add(value);
    signals.push({ code: value.code, codeName: value.codeName, name: value.name });

    for (const key of ["cause", "reason"]) {
      if (value[key] && typeof value[key] === "object") {
        pending.push({ error: value[key], depth: current.depth + 1 });
      }
    }

    if (value.servers instanceof Map) {
      for (const server of value.servers.values()) {
        if (server?.error && typeof server.error === "object") {
          pending.push({ error: server.error, depth: current.depth + 1 });
        }
      }
    }
  }

  return signals;
};

const classifyMongoConnectionError = (error) => {
  const signals = getErrorSignals(error);
  const hasCode = (...codes) => signals.some(({ code }) => codes.includes(code));
  const hasName = (...names) => signals.some(({ name }) => names.includes(name));
  const hasCodeName = (...names) => signals.some(({ codeName }) => names.includes(codeName));

  if (hasCode(18) || hasCodeName("AuthenticationFailed")) return "authentication";
  if (hasCode(13) || hasCodeName("Unauthorized")) return "authorization";
  if (hasCode("ENOTFOUND", "EAI_AGAIN", "ENODATA", "ESERVFAIL")) return "dns";
  if (hasCode("ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "ECONNRESET")) return "network";
  if (hasCode("ETIMEDOUT", "ETIME") ||
      hasName("MongoNetworkTimeoutError", "MongoTimeoutError")) return "timeout";
  if (signals.some(({ code }) =>
    typeof code === "string" &&
    /^(?:ERR_TLS_|ERR_SSL_|CERT_|SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE)/.test(code)
  )) return "tls-certificate";
  if (hasName("MongoServerSelectionError")) return "server-selection";
  return "operation-failed";
};

const registerMongoConnectionEvents = (connection, logger) => {
  if (!connection || (typeof connection !== "object" && typeof connection !== "function")) {
    throw new TypeError("A MongoDB connection is required.");
  }
  if (registeredConnections.has(connection)) return false;
  registeredConnections.add(connection);

  connection.on("connected", () => logger.info("mongodb_connected"));
  connection.on("disconnected", () => logger.warn("mongodb_disconnected"));
  connection.on("reconnected", () => logger.info("mongodb_reconnected"));
  connection.on("error", (error) => {
    logger.error("mongodb_connection_error", {
      category: classifyMongoConnectionError(error)
    });
  });
  return true;
};

const isDatabaseReady = (connection) => connection?.readyState === 1;

const createHealthHandler = (connection) => (req, res) => {
  const ready = isDatabaseReady(connection);
  return res.status(ready ? 200 : 503).json({
    success: ready,
    status: ready ? "healthy" : "unhealthy",
    database: ready ? "connected" : "disconnected",
    timestamp: new Date().toISOString()
  });
};

module.exports = {
  classifyMongoConnectionError,
  registerMongoConnectionEvents,
  isDatabaseReady,
  createHealthHandler
};
