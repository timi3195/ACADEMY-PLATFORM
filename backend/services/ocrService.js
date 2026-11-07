const fs = require("fs");
const path = require("path");
const { fileURLToPath } = require("url");
const tesseractVersion = require("tesseract.js/package.json").version;

const validateLocalLanguageData = () => {
  const configuredPath = process.env.TESSERACT_LANG_PATH;
  if (!configuredPath || /^https?:\/\//i.test(configuredPath)) return;

  const languageDirectory = configuredPath.startsWith("file://")
    ? fileURLToPath(configuredPath)
    : path.resolve(configuredPath);
  const cacheDirectory = path.resolve(process.env.TESSERACT_CACHE_PATH || ".");
  const languageFile = path.join(languageDirectory, "eng.traineddata.gz");
  const cachedLanguageFile = path.join(cacheDirectory, "eng.traineddata");
  if ((fs.existsSync(languageFile) && fs.statSync(languageFile).size > 0) ||
      (fs.existsSync(cachedLanguageFile) && fs.statSync(cachedLanguageFile).size > 0)) {
    return;
  }

  const error = new Error(
    "Local English OCR data is missing. Provide eng.traineddata.gz in TESSERACT_LANG_PATH or eng.traineddata in TESSERACT_CACHE_PATH."
  );
  error.code = "OCR_LANGUAGE_DATA_UNAVAILABLE";
  error.statusCode = 503;
  throw error;
};

const createTesseractProvider = (tesseract = require("tesseract.js")) => ({
  name: "tesseract.js",
  version: tesseractVersion,
  language: "eng",
  async recognizeImages(images, onPageResult = async () => {}) {
    validateLocalLanguageData();
    const { createWorker } = tesseract;
    const worker = await createWorker("eng", 1, {
      langPath: process.env.TESSERACT_LANG_PATH || undefined,
      cachePath: process.env.TESSERACT_CACHE_PATH || undefined,
      errorHandler: (error) => console.error("Tesseract worker operation failed:", error),
      gzip: true
    });
    const results = [];

    try {
      for (const image of images) {
        let data;
        try {
          ({ data } = await worker.recognize(image.buffer));
        } catch {
          data = null;
        }
        const result = data
          ? {
            imageId: image.imageId,
            text: String(data.text || "").trim(),
            confidence: Number.isFinite(data.confidence) ? data.confidence : null,
            provider: this.name,
            version: this.version,
            error: null
          }
          : {
            imageId: image.imageId,
            text: "",
            confidence: null,
            provider: this.name,
            version: this.version,
            error: "OCR could not read this image."
          };
        results.push(result);
        await onPageResult(result);
      }
    } finally {
      await worker.terminate();
    }
    return results;
  }
});

const tesseractProvider = createTesseractProvider();
const providers = new Map([[tesseractProvider.name, tesseractProvider]]);
const getProvider = () => {
  const providerName = process.env.OCR_PROVIDER || tesseractProvider.name;
  const provider = providers.get(providerName);
  if (!provider) {
    const error = new Error(`Configured OCR provider "${providerName}" is unavailable.`);
    error.statusCode = 503;
    throw error;
  }
  return provider;
};

module.exports = {
  recognizeImages: (...args) => getProvider().recognizeImages(...args),
  createTesseractProvider,
  getProviderInfo: () => {
    const provider = getProvider();
    return { provider: provider.name, version: provider.version, language: provider.language };
  }
};
