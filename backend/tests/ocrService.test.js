const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createTesseractProvider } = require("../services/ocrService");

test("local Tesseract provider returns normalized page text and confidence", async () => {
  let terminated = false;
  let workerOptions;
  const provider = createTesseractProvider({
    createWorker: async (_language, _oem, options) => {
      workerOptions = options;
      return {
      recognize: async () => ({ data: { text: "Question text", confidence: 87 } }),
      terminate: async () => { terminated = true; }
      };
    }
  });
  const results = await provider.recognizeImages([
    { imageId: "image-1", buffer: Buffer.from("image") }
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].text, "Question text");
  assert.equal(results[0].confidence, 87);
  assert.equal(results[0].provider, "tesseract.js");
  assert.equal(terminated, true);
  assert.equal(workerOptions.gzip, true);
  assert.equal(typeof workerOptions.errorHandler, "function");
});

test("unreadable image results are surfaced instead of silently discarded", async () => {
  const provider = createTesseractProvider({
    createWorker: async () => ({
      recognize: async () => { throw new Error("Unreadable"); },
      terminate: async () => {}
    })
  });
  const results = await provider.recognizeImages([
    { imageId: "image-2", buffer: Buffer.from("image") }
  ]);
  assert.equal(results[0].text, "");
  assert.ok(results[0].error);
});

test("missing configured local language data fails promptly with a retryable setup error", async () => {
  const originalLanguagePath = process.env.TESSERACT_LANG_PATH;
  const originalCachePath = process.env.TESSERACT_CACHE_PATH;
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "academy-ocr-missing-language-"));
  process.env.TESSERACT_LANG_PATH = path.join(temporaryDirectory, "missing-language");
  process.env.TESSERACT_CACHE_PATH = path.join(temporaryDirectory, "empty-cache");

  try {
    await assert.rejects(
      createTesseractProvider().recognizeImages([]),
      (error) => error.code === "OCR_LANGUAGE_DATA_UNAVAILABLE" && error.statusCode === 503 &&
        /eng\.traineddata\.gz/.test(error.message)
    );
  } finally {
    if (originalLanguagePath === undefined) delete process.env.TESSERACT_LANG_PATH;
    else process.env.TESSERACT_LANG_PATH = originalLanguagePath;
    if (originalCachePath === undefined) delete process.env.TESSERACT_CACHE_PATH;
    else process.env.TESSERACT_CACHE_PATH = originalCachePath;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
