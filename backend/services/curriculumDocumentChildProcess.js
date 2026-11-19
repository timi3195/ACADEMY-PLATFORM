const { fork } = require("node:child_process");
const path = require("node:path");
const limits = require("../config/curriculumExtractionLimits");

const CHILD_ENTRYPOINT = path.resolve(__dirname, "curriculumDocumentChild.js");
const TERMINATION_GRACE_MS = 1_000;
const CHILD_ERROR_CODES = new Set([
  "WORKER_OUTPUT_INVALID",
  "CHILD_PROCESS_FAILED",
  "PROCESSING_TIMEOUT",
  "OCR_FAILED",
  "TEXT_EXTRACTION_FAILED",
  "INTERNAL_PROCESSING_ERROR"
]);
const RESULT_STATUSES = new Set(["succeeded", "partially_succeeded", "failed"]);
const EXTRACTION_METHODS = new Set(["pdf_text", "docx_text", "pdf_text_ocr"]);
const SEGMENT_METHODS = new Set(["pdf_text", "docx_text", "ocr"]);
const DIAGNOSTICS = new Map([
  ["FILE_TYPE_UNSUPPORTED", "The uploaded document type is not supported."],
  ["TEXT_EXTRACTION_FAILED", "Text could not be extracted from the document."],
  ["OCR_FAILED", "Text could not be read from the scanned document."],
  ["OCR_MODEL_UNAVAILABLE", "The verified local English OCR model is unavailable. Verify the pinned model installation."],
  ["PDF_RENDER_BOUNDS", "PDF page rendered within configured OCR limits."],
  ["PROCESSING_TIMEOUT", "Document processing timed out."],
  ["INTERNAL_PROCESSING_ERROR", "Document processing could not be completed."]
]);

const childEnvironment = (dataDirectory, sourceEnvironment = process.env) => {
  const environment = {};
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "LANG"]) {
    if (sourceEnvironment[key]) environment[key] = sourceEnvironment[key];
  }
  environment.NODE_ENV = "production";
  environment.TESSERACT_LANG_PATH = dataDirectory;
  environment.TESSERACT_CACHE_PATH = dataDirectory;
  return environment;
};

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const validateChildResult = (result, mimeType) => {
  if (!isPlainObject(result) ||
      Object.keys(result).some((key) => ![
        "status",
        "extractionMethod",
        "segments",
        "ocrCandidatePages",
        "diagnostics"
      ].includes(key)) ||
      !RESULT_STATUSES.has(result.status) ||
      !EXTRACTION_METHODS.has(result.extractionMethod) ||
      !Array.isArray(result.segments) ||
      !Array.isArray(result.ocrCandidatePages) ||
      !Array.isArray(result.diagnostics) ||
      result.diagnostics.length > limits.maxDiagnostics ||
      !limits.isExtractedSegmentsWithinLimits(result.segments)) {
    return false;
  }

  const seenPages = new Set();
  for (const page of result.ocrCandidatePages) {
    if (!limits.isPdfPageCountWithinLimit(page) || seenPages.has(page)) return false;
    seenPages.add(page);
  }
  for (const segment of result.segments) {
    if (!isPlainObject(segment) ||
        Object.keys(segment).some((key) => ![
          "text",
          "page",
          "locator",
          "extractionMethod",
          "confidence"
        ].includes(key)) ||
        typeof segment.text !== "string" ||
        !segment.text ||
        (segment.page !== null &&
          (!Number.isInteger(segment.page) || segment.page < 1 || segment.page > limits.maxPdfPages)) ||
        typeof segment.locator !== "string" ||
        !segment.locator ||
        segment.locator.length > 200 ||
        !SEGMENT_METHODS.has(segment.extractionMethod) ||
        (segment.confidence !== undefined &&
          segment.confidence !== null &&
          (!Number.isFinite(segment.confidence) ||
            segment.confidence < 0 ||
            segment.confidence > 1))) {
      return false;
    }
  }
  for (const diagnostic of result.diagnostics) {
    if (!isPlainObject(diagnostic) ||
        Object.keys(diagnostic).some((key) =>
          !["stage", "code", "message", "page", "width", "height", "effectiveDpi"].includes(key)) ||
        diagnostic.stage !== "extraction" ||
        !DIAGNOSTICS.has(diagnostic.code) ||
        diagnostic.message !== DIAGNOSTICS.get(diagnostic.code)) {
      return false;
    }
    if (diagnostic.code === "PDF_RENDER_BOUNDS") {
      if (!limits.isPdfPageCountWithinLimit(diagnostic.page) ||
          !limits.isRenderedPageWithinLimits(diagnostic.width, diagnostic.height) ||
          !Number.isFinite(diagnostic.effectiveDpi) ||
          diagnostic.effectiveDpi <= 0 ||
          diagnostic.effectiveDpi > 150) {
        return false;
      }
    } else if (["page", "width", "height", "effectiveDpi"].some((key) =>
      Object.prototype.hasOwnProperty.call(diagnostic, key))) {
      return false;
    }
  }
  if (result.ocrCandidatePages.length && result.status !== "partially_succeeded") return false;
  if (result.status === "failed" &&
      (result.segments.length !== 0 || result.diagnostics.length === 0)) return false;
  if (mimeType === "application/pdf") {
    return ["pdf_text", "pdf_text_ocr"].includes(result.extractionMethod) &&
      result.segments.every((segment) => segment.extractionMethod !== "docx_text");
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return result.extractionMethod === "docx_text" &&
      result.status !== "partially_succeeded" &&
      result.ocrCandidatePages.length === 0 &&
      result.segments.every((segment) =>
        segment.extractionMethod === "docx_text" && segment.page === null);
  }
  return false;
};

const createChildError = (code) => {
  const error = new Error(code);
  error.code = code;
  return error;
};

const runCurriculumDocumentChild = ({
  lease,
  document,
  bytes,
  dataDirectory,
  timeoutMs = limits.maxDocumentProcessingMs,
  maxOutputBytes = limits.maxChildOutputBytes,
  childEntrypoint = CHILD_ENTRYPOINT,
  childArgs = [],
  sourceEnvironment = process.env,
  spawn = fork,
  signal
} = {}) => new Promise((resolve, reject) => {
  if (!Buffer.isBuffer(bytes) ||
      bytes.length < 1 ||
      bytes.length > limits.maxUploadBytes ||
      !document ||
      !dataDirectory ||
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0 ||
      !Number.isFinite(maxOutputBytes) ||
      maxOutputBytes <= 0) {
    reject(createChildError("WORKER_OUTPUT_INVALID"));
    return;
  }
  const hardTimeoutMs = Math.min(timeoutMs, limits.maxDocumentProcessingMs);
  const outputLimitBytes = Math.min(maxOutputBytes, limits.maxChildOutputBytes);

  const child = spawn(childEntrypoint, childArgs, {
    cwd: path.resolve(__dirname, ".."),
    env: childEnvironment(dataDirectory, sourceEnvironment),
    execArgv: [`--max-old-space-size=${limits.maxChildMemoryMb}`],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    detached: process.platform === "linux"
  });
  let timer;
  let terminationTimer;
  let message;
  let invalidOutput = false;
  let timedOut = false;
  let aborted = false;
  let terminating = false;
  let settled = false;
  const finish = (error, value) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (terminationTimer) clearTimeout(terminationTimer);
    if (signal) signal.removeEventListener("abort", onAbort);
    if (error) reject(error);
    else resolve(value);
  };
  const isRunning = () => child.exitCode === null && child.signalCode === null;
  const signalChild = (signalName) => {
    if (process.platform === "linux" && child.pid) {
      try {
        process.kill(-child.pid, signalName);
        return;
      } catch (error) {
        if (error?.code === "ESRCH") return;
      }
    }
    if (isRunning()) child.kill(signalName);
  };
  const finishAfterTermination = () => {
    if (timedOut) finish(createChildError("PROCESSING_TIMEOUT"));
    else if (aborted) finish(createChildError("CHILD_PROCESS_FAILED"));
    else if (invalidOutput) finish(createChildError("WORKER_OUTPUT_INVALID"));
    else finish(createChildError("CHILD_PROCESS_FAILED"));
  };
  const terminate = () => {
    if (terminating) return;
    terminating = true;
    signalChild("SIGTERM");
    terminationTimer = setTimeout(() => {
      signalChild("SIGKILL");
      if (!isRunning()) finishAfterTermination();
    }, TERMINATION_GRACE_MS);
    terminationTimer.unref?.();
  };
  const onAbort = () => {
    aborted = true;
    terminate();
  };

  if (signal?.aborted) {
    onAbort();
  } else if (signal) {
    signal.addEventListener("abort", onAbort, { once: true });
  }
  timer = setTimeout(() => {
    timedOut = true;
    terminate();
  }, hardTimeoutMs);

  child.on("message", (value) => {
    if (message !== undefined) {
      message = null;
      invalidOutput = true;
      terminate();
      return;
    }
    message = value;
    let outputBytes;
    try {
      outputBytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    } catch {
      outputBytes = outputLimitBytes + 1;
    }
    if (outputBytes > outputLimitBytes) {
      message = null;
      invalidOutput = true;
      terminate();
    }
  });
  child.once("error", () => {
    message = null;
    invalidOutput = true;
    terminate();
    if (child.pid === undefined) finish(createChildError("CHILD_PROCESS_FAILED"));
  });
  child.once("exit", (code) => {
    if (terminating) {
      if (process.platform === "linux" && child.pid) {
        try {
          process.kill(-child.pid, 0);
          return;
        } catch (error) {
          if (error?.code !== "ESRCH") return;
        }
      }
      finishAfterTermination();
      return;
    }
    const messageKeys = isPlainObject(message) ? Object.keys(message) : [];
    if (timedOut) {
      finish(createChildError("PROCESSING_TIMEOUT"));
    } else if (aborted) {
      finish(createChildError("CHILD_PROCESS_FAILED"));
    } else if (invalidOutput) {
      finish(createChildError("WORKER_OUTPUT_INVALID"));
    } else if (code !== 0) {
      finish(createChildError("CHILD_PROCESS_FAILED"));
    } else if (!message) {
      finish(createChildError("CHILD_PROCESS_FAILED"));
    } else if (Buffer.byteLength(JSON.stringify(message), "utf8") > outputLimitBytes) {
      finish(createChildError("WORKER_OUTPUT_INVALID"));
    } else if (message.ok === false &&
        messageKeys.length === 2 &&
        messageKeys.includes("ok") &&
        messageKeys.includes("errorCode") &&
        CHILD_ERROR_CODES.has(message.errorCode)) {
      finish(createChildError(message.errorCode));
    } else if (message.ok !== true ||
        messageKeys.length !== 2 ||
        !messageKeys.includes("ok") ||
        !messageKeys.includes("result") ||
        !validateChildResult(message.result, document?.mimeType)) {
      finish(createChildError("WORKER_OUTPUT_INVALID"));
    } else {
      finish(null, message.result);
    }
  });

  if (!aborted) {
    child.send({
      importId: String(lease.importId),
      document,
      bytesBase64: bytes.toString("base64"),
      dataDirectory
    }, (error) => {
      if (error) {
        message = null;
        terminate();
      }
    });
  }
});

module.exports = {
  CHILD_ENTRYPOINT,
  TERMINATION_GRACE_MS,
  childEnvironment,
  runCurriculumDocumentChild,
  validateChildResult
};
