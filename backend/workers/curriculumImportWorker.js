const mongoose = require("mongoose");
const { runCurriculumImportWorker } = require("../services/curriculumImportWorker");

const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());

const main = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error("Worker database configuration is unavailable.");
  }
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    await runCurriculumImportWorker({ signal: controller.signal });
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  const code = typeof error?.code === "string" ? error.code : "WORKER_START_FAILED";
  console.error("Curriculum import worker stopped:", code);
  process.exitCode = 1;
});
