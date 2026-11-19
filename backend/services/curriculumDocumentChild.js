const { Readable } = require("node:stream");
const { Worker } = require("node:worker_threads");
const limits = require("../config/curriculumExtractionLimits");
const { extractCurriculumDocument } = require("./curriculumDocumentExtractionService");
const { extractPdfOcr } = require("./curriculumDocumentOcrService");

const send = (message) => new Promise((resolve, reject) => {
  if (typeof process.send !== "function") {
    reject(new Error("Child process IPC is unavailable."));
    return;
  }
  process.send(message, (error) => error ? reject(error) : resolve());
});

const isValidRequest = (request) => {
  if (!request ||
      typeof request !== "object" ||
      Array.isArray(request) ||
      Object.keys(request).some((key) =>
        !["importId", "document", "bytesBase64", "dataDirectory"].includes(key)) ||
      !/^[a-f0-9]{24}$/i.test(request.importId || "") ||
      typeof request.bytesBase64 !== "string" ||
      request.bytesBase64.length > Math.ceil(limits.maxUploadBytes / 3) * 4 ||
      !request.dataDirectory ||
      request.dataDirectory !== process.env.TESSERACT_LANG_PATH ||
      request.dataDirectory !== process.env.TESSERACT_CACHE_PATH) {
    return false;
  }
  return request.document &&
    typeof request.document === "object" &&
    !Array.isArray(request.document);
};

const processRequest = async (request) => {
  if (!isValidRequest(request)) {
    await send({ ok: false, errorCode: "WORKER_OUTPUT_INVALID" });
    return;
  }
  const bytes = Buffer.from(request.bytesBase64, "base64");
  if (bytes.length < 1 ||
      bytes.length > limits.maxUploadBytes ||
      bytes.toString("base64") !== request.bytesBase64) {
    await send({ ok: false, errorCode: "WORKER_OUTPUT_INVALID" });
    return;
  }

  const storage = {
    getPrivateCurriculumDocumentStream: async () => Readable.from([bytes])
  };
  let result = await extractCurriculumDocument({
    importId: request.importId,
    document: request.document,
    storage
  });
  if (request.document.mimeType === "application/pdf" &&
      result.ocrCandidatePages.length &&
      result.status !== "failed") {
    result = await extractPdfOcr({
      bytes,
      extraction: result,
      dataDirectory: request.dataDirectory
    });
  }

  const serializedSize = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (serializedSize > limits.maxChildOutputBytes) {
    await send({ ok: false, errorCode: "WORKER_OUTPUT_INVALID" });
    return;
  }
  await send({ ok: true, result });
};

let responseCompleted = false;
const parentPid = process.ppid;
let parentMonitor;
const parentDeathWatchdog = new Worker(`
  const { workerData } = require("node:worker_threads");
  const interval = setInterval(() => {
    if (process.ppid !== workerData.parentPid) {
      process.kill(workerData.childPid, "SIGKILL");
      clearInterval(interval);
      return;
    }
    try {
      process.kill(workerData.parentPid, 0);
    } catch (error) {
      if (error.code === "ESRCH") {
        process.kill(workerData.childPid, "SIGKILL");
        clearInterval(interval);
      }
    }
  }, 250);
  interval.unref();
`, {
  eval: true,
  workerData: { parentPid, childPid: process.pid }
});
parentDeathWatchdog.unref();
parentDeathWatchdog.on("error", () => process.exit(1));
const terminateForMissingParent = () => {
  if (responseCompleted) return;
  if (parentMonitor) clearInterval(parentMonitor);
  parentDeathWatchdog.terminate().catch(() => {});
  process.exit(1);
};
const isParentAlive = () => {
  if (!process.connected || process.ppid !== parentPid) return false;
  try {
    process.kill(parentPid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
};

process.once("disconnect", terminateForMissingParent);
process.once("SIGTERM", terminateForMissingParent);
process.once("SIGINT", terminateForMissingParent);
parentMonitor = setInterval(() => {
  if (!isParentAlive()) terminateForMissingParent();
}, 250);
parentMonitor.unref?.();

process.once("message", (request) => {
  processRequest(request)
    .catch(async () => {
      try {
        await send({ ok: false, errorCode: "CHILD_PROCESS_FAILED" });
      } catch {
        process.exitCode = 1;
      }
    })
    .finally(() => {
      responseCompleted = true;
      if (parentMonitor) clearInterval(parentMonitor);
      parentDeathWatchdog.terminate().catch(() => {});
      if (process.connected) process.disconnect();
    });
});
