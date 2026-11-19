const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const limits = require("../config/curriculumExtractionLimits");
const { createCanvas } = require("@napi-rs/canvas");
const ocrService = require("../services/curriculumDocumentOcrService");
const childProcess = require("../services/curriculumDocumentChildProcess");
const { createDocx, createPdf } = require("./helpers/curriculumDocumentFixtures");

const fixture = path.resolve(__dirname, "fixtures", "curriculumWorkerChildFixture.js");
const parentFixture = path.resolve(__dirname, "fixtures", "curriculumWorkerParentFixture.js");
const baseInput = {
  lease: { importId: "507f1f77bcf86cd799439019" },
  document: {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  },
  bytes: Buffer.from("generated child input"),
  dataDirectory: path.resolve(__dirname, "..", "tessdata")
};

test("child process accepts only bounded, schema-valid extraction output", async () => {
  const result = await childProcess.runCurriculumDocumentChild({
    ...baseInput,
    childEntrypoint: fixture,
    childArgs: ["success"],
    timeoutMs: 5000
  });
  assert.deepEqual(result, {
    status: "succeeded",
    extractionMethod: "docx_text",
    segments: [],
    ocrCandidatePages: [],
    diagnostics: []
  });
  assert.equal(childProcess.validateChildResult(result, baseInput.document.mimeType), true);
});

test("production child exits after in-memory DOCX extraction without persistence", async () => {
  const importId = "507f1f77bcf86cd799439019";
  const documentBytes = createDocx();
  const document = {
    provider: "local-disk",
    storageFilename: `curriculum-imports/${importId}/source.docx`,
    storageKey: "",
    status: "stored",
    originalFilename: "source.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: documentBytes.length,
    contentHash: crypto.createHash("sha256").update(documentBytes).digest("hex")
  };
  const result = await childProcess.runCurriculumDocumentChild({
    lease: { importId },
    document,
    bytes: documentBytes,
    dataDirectory: path.resolve(__dirname, "..", "tessdata"),
    timeoutMs: 10_000
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.segments[0].text, "Curriculum fixture");
  assert.equal(result.segments[0].extractionMethod, "docx_text");
});

test("child failure and crash return safe errors", async () => {
  await assert.rejects(
    childProcess.runCurriculumDocumentChild({
      ...baseInput,
      childEntrypoint: fixture,
      childArgs: ["failure"],
      timeoutMs: 5000
    }),
    { code: "CHILD_PROCESS_FAILED" }
  );
  await assert.rejects(
    childProcess.runCurriculumDocumentChild({
      ...baseInput,
      childEntrypoint: fixture,
      childArgs: ["crash"],
      timeoutMs: 5000
    }),
    { code: "CHILD_PROCESS_FAILED" }
  );
});

test("child spawn errors fail promptly instead of waiting for the hard timeout", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.send = () => {};
  child.kill = () => true;
  await assert.rejects(
    childProcess.runCurriculumDocumentChild({
      ...baseInput,
      timeoutMs: 5000,
      spawn: () => {
        process.nextTick(() => child.emit("error", new Error("spawn failed")));
        return child;
      }
    }),
    { code: "CHILD_PROCESS_FAILED" }
  );
});

test("child timeout kills the process and malformed or oversized output is rejected", async () => {
  let timedOutChildPid;
  await assert.rejects(
    childProcess.runCurriculumDocumentChild({
      ...baseInput,
      childEntrypoint: fixture,
      childArgs: ["ignore-termination"],
      timeoutMs: 150,
      spawn(entrypoint, args, options) {
        const { fork } = require("node:child_process");
        const child = fork(entrypoint, args, options);
        timedOutChildPid = child.pid;
        return child;
      }
    }),
    { code: "PROCESSING_TIMEOUT" }
  );
  assert.throws(() => process.kill(timedOutChildPid, 0), { code: "ESRCH" });
  await assert.rejects(
    childProcess.runCurriculumDocumentChild({
      ...baseInput,
      childEntrypoint: fixture,
      childArgs: ["malformed"],
      timeoutMs: 5000
    }),
    { code: "WORKER_OUTPUT_INVALID" }
  );
  await assert.rejects(
    childProcess.runCurriculumDocumentChild({
      ...baseInput,
      childEntrypoint: fixture,
      childArgs: ["oversized"],
      timeoutMs: 5000
    }),
    { code: "WORKER_OUTPUT_INVALID" }
  );
});

test("child exits when its parent disconnects during processing", async () => {
  const { fork } = require("node:child_process");
  const parent = fork(parentFixture, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  let childPid;
  const parentExit = new Promise((resolve) => parent.once("exit", resolve));
  try {
    const childPidPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Processor child did not start.")), 5000);
      parent.once("message", (message) => {
        clearTimeout(timer);
        resolve(message.childPid);
      });
      parent.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    parent.send({});
    childPid = await childPidPromise;
    parent.kill("SIGKILL");
    await parentExit;

    const deadline = Date.now() + 5000;
    let childAlive = true;
    while (Date.now() < deadline) {
      try {
        process.kill(childPid, 0);
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (error) {
        if (error.code === "ESRCH") {
          childAlive = false;
          break;
        }
        throw error;
      }
    }
    assert.equal(childAlive, false);
  } finally {
    if (parent.exitCode === null && parent.signalCode === null) parent.kill("SIGKILL");
    if (childPid) {
      try {
        process.kill(childPid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
});

test("child receives only allowlisted environment and strict memory/output caps", async () => {
  let spawnOptions;
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.send = (_message, callback) => {
    process.nextTick(() => {
      child.emit("message", {
        ok: true,
        result: {
          status: "succeeded",
          extractionMethod: "docx_text",
          segments: [],
          ocrCandidatePages: [],
          diagnostics: []
        }
      });
      child.exitCode = 0;
      child.emit("exit", 0, null);
      callback();
    });
  };
  child.kill = () => {
    child.signalCode = "SIGKILL";
    return true;
  };

  const result = await childProcess.runCurriculumDocumentChild({
    ...baseInput,
    timeoutMs: limits.maxDocumentProcessingMs * 2,
    maxOutputBytes: limits.maxChildOutputBytes * 2,
    sourceEnvironment: {
      PATH: "system-path",
      SystemRoot: "system-root",
      MONGODB_URI: "must-not-be-forwarded",
      TESSERACT_LANG_PATH: "must-not-be-trusted"
    },
    spawn: (_entrypoint, _args, options) => {
      spawnOptions = options;
      return child;
    }
  });

  assert.equal(result.status, "succeeded");
  assert.equal(spawnOptions.env.MONGODB_URI, undefined);
  assert.equal(spawnOptions.env.TESSERACT_LANG_PATH, baseInput.dataDirectory);
  assert.equal(spawnOptions.env.TESSERACT_CACHE_PATH, baseInput.dataDirectory);
  assert.equal(spawnOptions.execArgv[0], `--max-old-space-size=${limits.maxChildMemoryMb}`);
  assert.equal(spawnOptions.env.NODE_OPTIONS, undefined);
  assert.equal(spawnOptions.detached, process.platform === "linux");
});

test("Tesseract options pin local language, cache, worker, and core paths", () => {
  const options = ocrService.createTesseractOptions(baseInput.dataDirectory);
  assert.equal(options.langPath, baseInput.dataDirectory);
  assert.equal(options.cachePath, baseInput.dataDirectory);
  assert.equal(options.cacheMethod, "none");
  assert.equal(options.gzip, false);
  assert.equal(path.isAbsolute(options.workerPath), true);
  assert.equal(path.isAbsolute(options.corePath), true);
});

test("PDF rendering reports the final bounded dimensions and rejects unrenderable dimensions", () => {
  const page = {
    getViewport({ scale }) {
      return { width: 100_000 * scale, height: 60_000 * scale };
    }
  };
  const viewport = ocrService.createBoundedOcrViewport(page);
  assert.equal(limits.isRenderedPageWithinLimits(viewport.width, viewport.height), true);
  assert.ok(viewport.effectiveDpi <= 150);
  assert.equal(viewport.width, Math.ceil(viewport.viewport.width));
  assert.equal(viewport.height, Math.ceil(viewport.viewport.height));

  assert.throws(() => ocrService.createBoundedOcrViewport({
    getViewport({ scale }) {
      return { width: 0.1 * scale, height: 72 * scale };
    }
  }), /minimum renderable size/);
});

test("PDF OCR renders one bounded page at a time and stores plain OCR text", async () => {
  const bytes = createPdf({ pages: [{ items: [] }] });
  let createdCanvas;
  let recognized = 0;
  let terminated = false;
  const initializationOrder = [];
  const result = await ocrService.extractPdfOcr({
    bytes,
    extraction: {
      status: "partially_succeeded",
      extractionMethod: "pdf_text",
      segments: [],
      ocrCandidatePages: [1],
      diagnostics: []
    },
    dataDirectory: baseInput.dataDirectory,
    canvasModule: {
      createCanvas(width, height) {
        assert.equal(createdCanvas, undefined);
        assert.equal(limits.isRenderedPageWithinLimits(width, height), true);
        createdCanvas = createCanvas(width, height);
        return createdCanvas;
      }
    },
    verifyModel: async ({ dataDirectory }) => {
      initializationOrder.push("verify");
      return { available: true, dataDirectory };
    },
    tesseractModule: {
      async createWorker(language, concurrency, options) {
        initializationOrder.push("tesseract");
        assert.equal(language, "eng");
        assert.equal(concurrency, 1);
        assert.equal(options.langPath, baseInput.dataDirectory);
        return {
          async recognize(image) {
            recognized += 1;
            assert.equal(Buffer.isBuffer(image), true);
            assert.equal(image.readUInt32BE(0), 0x89504e47);
            return { data: { text: "Recognized generated text", confidence: 91 } };
          },
          async terminate() {
            terminated = true;
          }
        };
      }
    }
  });

  assert.equal(recognized, 1);
  assert.deepEqual(initializationOrder, ["verify", "tesseract"]);
  assert.equal(terminated, true);
  assert.equal(createdCanvas.width, 0);
  assert.equal(createdCanvas.height, 0);
  assert.equal(result.diagnostics[0].code, "PDF_RENDER_BOUNDS");
  assert.ok(result.diagnostics[0].width * result.diagnostics[0].height <= limits.maxRenderedPagePixels);
  assert.ok(result.diagnostics[0].effectiveDpi <= 150);
  assert.ok(result.diagnostics[0].effectiveDpi < 150);
  assert.equal(childProcess.validateChildResult(result, "application/pdf"), true);
  assert.deepEqual(result.ocrCandidatePages, []);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.segments[0], {
    text: "Recognized generated text",
    page: 1,
    locator: "page:1;ocr",
    extractionMethod: "ocr",
    confidence: 0.91
  });
});

test("OCR model verification in the child prevents Tesseract fallback", async () => {
  const bytes = createPdf({ pages: [{ items: [] }] });
  let tesseractCalls = 0;
  const extraction = {
    status: "partially_succeeded",
    extractionMethod: "pdf_text",
    segments: [],
    ocrCandidatePages: [1],
    diagnostics: []
  };
  const result = await ocrService.extractPdfOcr({
    bytes,
    extraction,
    dataDirectory: baseInput.dataDirectory,
    verifyModel: async () => ({ available: false, reason: "invalid_hash" }),
    tesseractModule: {
      async createWorker() {
        tesseractCalls += 1;
        throw new Error("Tesseract must not load an unverified model.");
      }
    }
  });
  assert.equal(tesseractCalls, 0);
  assert.deepEqual(result.ocrCandidatePages, [1]);
  assert.equal(result.status, "partially_succeeded");
  assert.equal(result.diagnostics[0].code, "OCR_MODEL_UNAVAILABLE");
});
