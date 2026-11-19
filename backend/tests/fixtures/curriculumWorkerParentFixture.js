const { fork } = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");
const { createDocx } = require("../helpers/curriculumDocumentFixtures");
const { runCurriculumDocumentChild } = require("../../services/curriculumDocumentChildProcess");

process.once("message", async () => {
  const importId = "507f1f77bcf86cd799439019";
  const bytes = createDocx();
  const document = {
    provider: "local-disk",
    storageFilename: `curriculum-imports/${importId}/source.docx`,
    storageKey: "",
    status: "stored",
    originalFilename: "source.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: bytes.length,
    contentHash: crypto.createHash("sha256").update(bytes).digest("hex")
  };
  await runCurriculumDocumentChild({
    lease: { importId },
    document,
    bytes,
    dataDirectory: path.resolve(__dirname, "..", "..", "tessdata"),
    timeoutMs: 30_000,
    spawn(entrypoint, args, options) {
      const child = fork(entrypoint, args, options);
      if (process.connected) process.send({ childPid: child.pid });
      return child;
    }
  }).catch(() => {
    process.exitCode = 1;
  });
});
