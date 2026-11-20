const crypto = require("crypto");
const fsConstants = require("fs").constants;
const fs = require("fs/promises");
const path = require("path");
const zlib = require("zlib");
const manifest = require("../config/ocrLanguageData.json");
const { verifyChecksum } = require("../scripts/provisionOcrLanguageData");
const storageService = require("./storageService");

const MODEL_DIRECTORY = path.resolve(__dirname, "..", "tessdata");

const verifyOcrModel = async () => {
  const configuredLanguagePath = process.env.TESSERACT_LANG_PATH;
  if (configuredLanguagePath && /^https?:\/\//i.test(configuredLanguagePath)) {
    throw new Error("The question extraction worker requires local Tesseract language data.");
  }

  const cacheDirectory = path.resolve(process.env.TESSERACT_CACHE_PATH || MODEL_DIRECTORY);
  if (!process.env.TESSERACT_CACHE_PATH) {
    process.env.TESSERACT_CACHE_PATH = cacheDirectory;
  }

  let model;
  if (configuredLanguagePath) {
    const languageDirectory = path.resolve(configuredLanguagePath);
    model = zlib.gunzipSync(await fs.readFile(path.join(languageDirectory, "eng.traineddata.gz")));
  } else {
    model = await fs.readFile(path.join(cacheDirectory, "eng.traineddata"));
  }
  if (model.length !== manifest.sizeBytes ||
      verifyChecksum(model, manifest.sha256) !== manifest.sha256) {
    throw new Error("The question extraction worker OCR model does not match the pinned English model.");
  }

  await fs.access(cacheDirectory, fsConstants.W_OK);
  const probe = path.join(cacheDirectory, `.worker-cache-check-${crypto.randomUUID()}`);
  try {
    await fs.writeFile(probe, Buffer.alloc(0), { flag: "wx", mode: 0o600 });
  } finally {
    await fs.unlink(probe).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
};

const verifyQuestionExtractionWorkerReadiness = async ({
  storage = storageService,
  verifyModel = verifyOcrModel
} = {}) => {
  await verifyModel();
  await storage.verifyWorkerStorage();
};

module.exports = {
  MODEL_DIRECTORY,
  verifyOcrModel,
  verifyQuestionExtractionWorkerReadiness
};
