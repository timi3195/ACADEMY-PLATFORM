const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const fs = require("fs");
const {
  verifyOcrModel,
  verifyQuestionExtractionWorkerReadiness
} = require("../services/questionExtractionWorkerReadiness");

test("worker refuses to start when the pinned local OCR model is unavailable", async () => {
  const originalCachePath = process.env.TESSERACT_CACHE_PATH;
  const originalLanguagePath = process.env.TESSERACT_LANG_PATH;
  const missingDirectory = path.join(os.tmpdir(), `missing-question-ocr-${process.pid}`);
  process.env.TESSERACT_CACHE_PATH = missingDirectory;
  delete process.env.TESSERACT_LANG_PATH;
  try {
    await assert.rejects(verifyOcrModel());
  } finally {
    if (originalCachePath === undefined) delete process.env.TESSERACT_CACHE_PATH;
    else process.env.TESSERACT_CACHE_PATH = originalCachePath;
    if (originalLanguagePath === undefined) delete process.env.TESSERACT_LANG_PATH;
    else process.env.TESSERACT_LANG_PATH = originalLanguagePath;
    if (fs.existsSync(missingDirectory)) fs.rmSync(missingDirectory, { recursive: true, force: true });
  }
});

test("worker verifies storage access before it can begin polling", async () => {
  let storageChecked = false;
  await assert.rejects(verifyQuestionExtractionWorkerReadiness({
    verifyModel: async () => {},
    storage: {
      verifyWorkerStorage: async () => {
        storageChecked = true;
        throw new Error("storage unavailable");
      }
    }
  }), /storage unavailable/);
  assert.equal(storageChecked, true);
});
