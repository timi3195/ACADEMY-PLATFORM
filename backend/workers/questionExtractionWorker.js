const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const { verifyQuestionExtractionWorkerReadiness } = require("../services/questionExtractionWorkerReadiness");
const { runQuestionExtractionWorker } = require("../services/questionExtractionJobService");

const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());

const main = async () => {
  if (typeof process.env.MONGO_URI !== "string" || !process.env.MONGO_URI.trim()) {
    const error = new Error("Worker database configuration is unavailable.");
    error.code = "WORKER_DATABASE_NOT_CONFIGURED";
    throw error;
  }

  await verifyQuestionExtractionWorkerReadiness();
  await mongoose.connect(process.env.MONGO_URI);
  try {
    await runQuestionExtractionWorker({ signal: controller.signal });
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  main().catch((error) => {
    const code = typeof error?.code === "string" ? error.code : "WORKER_START_FAILED";
    console.error("Question extraction worker stopped:", code);
    process.exitCode = 1;
  });
}

module.exports = { main, controller };
