const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const languageData = require("../config/ocrLanguageData.json");

const UPSTREAM_REPOSITORY = "https://github.com/tesseract-ocr/tessdata_fast";
const RAW_CONTENTS_BASE = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast";
const MODEL_FILENAME = "eng.traineddata";
const BACKEND_DIRECTORY = path.resolve(__dirname, "..");
const DATA_DIRECTORY = path.join(BACKEND_DIRECTORY, "tessdata");
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REVISION_PATTERN = /^[a-f0-9]{40}$/;

const validateManifest = (manifest) => {
  if (!manifest || manifest.upstreamRepository !== UPSTREAM_REPOSITORY) {
    throw new Error("OCR model manifest must use the official tessdata_fast repository.");
  }
  if (!REVISION_PATTERN.test(manifest.revision || "")) {
    throw new Error("OCR model manifest must pin a 40-character Git revision.");
  }
  if (manifest.filename !== MODEL_FILENAME) {
    throw new Error(`Only ${MODEL_FILENAME} may be provisioned.`);
  }
  if (!Number.isSafeInteger(manifest.sizeBytes) || manifest.sizeBytes <= 0) {
    throw new Error("OCR model manifest must provide a positive model size.");
  }
  if (!SHA256_PATTERN.test(manifest.sha256 || "")) {
    throw new Error("OCR model manifest must provide a lowercase SHA-256 digest.");
  }
};

const resolveModelPath = (directory, filename) => {
  if (filename !== MODEL_FILENAME || path.basename(filename) !== filename) {
    throw new Error(`Unsafe OCR model filename: ${filename}`);
  }
  const resolvedDirectory = path.resolve(directory);
  const modelPath = path.resolve(resolvedDirectory, filename);
  const relativePath = path.relative(resolvedDirectory, modelPath);
  if (relativePath !== filename || path.isAbsolute(relativePath)) {
    throw new Error(`OCR model path escapes its data directory: ${filename}`);
  }
  return modelPath;
};

const verifyChecksum = (data, expectedSha256) => {
  if (!SHA256_PATTERN.test(expectedSha256 || "")) {
    throw new Error("Expected OCR model SHA-256 must be a lowercase 64-character digest.");
  }
  if (!Buffer.isBuffer(data) && !(data instanceof Uint8Array)) {
    throw new TypeError("OCR model data must be a byte buffer.");
  }
  const actualSha256 = crypto.createHash("sha256").update(data).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(`OCR model SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}.`);
  }
  return actualSha256;
};

const getDownloadUrl = (manifest) => {
  validateManifest(manifest);
  return `${RAW_CONTENTS_BASE}/${manifest.revision}/${manifest.filename}`;
};

const existingModelIsValid = async (modelPath, manifest) => {
  let stats;
  try {
    stats = await fs.lstat(modelPath);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }

  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Existing OCR model path is not a regular file: ${modelPath}`);
  }

  const existingModel = await fs.readFile(modelPath);
  if (existingModel.length !== manifest.sizeBytes) {
    throw new Error(`Existing OCR model at ${modelPath} does not match the pinned size; it was not overwritten.`);
  }
  try {
    verifyChecksum(existingModel, manifest.sha256);
  } catch (error) {
    throw new Error(`Existing OCR model at ${modelPath} does not match the pinned checksum; it was not overwritten. ${error.message}`);
  }
  return true;
};

const downloadToTemporaryFile = async (fetchImpl, manifest, temporaryPath) => {
  const response = await fetchImpl(getDownloadUrl(manifest), {
    redirect: "error",
    signal: AbortSignal.timeout(60000)
  });
  if (!response || !response.ok) {
    const status = response ? `HTTP ${response.status}` : "no response";
    throw new Error(`Failed to download the pinned OCR model: ${status}.`);
  }
  if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") {
    throw new Error("OCR model download returned no readable response body.");
  }

  const handle = await fs.open(temporaryPath, "wx", 0o600);
  const hash = crypto.createHash("sha256");
  let size = 0;
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > manifest.sizeBytes) {
        throw new Error(`Downloaded OCR model exceeds the pinned size of ${manifest.sizeBytes} bytes.`);
      }
      hash.update(bytes);
      await handle.writeFile(bytes);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }

  if (size !== manifest.sizeBytes) {
    throw new Error(`Downloaded OCR model size mismatch: expected ${manifest.sizeBytes} bytes, got ${size}.`);
  }
  const actualSha256 = hash.digest("hex");
  if (actualSha256 !== manifest.sha256) {
    throw new Error(`OCR model SHA-256 mismatch: expected ${manifest.sha256}, got ${actualSha256}.`);
  }
};

const provisionOcrLanguageData = async ({
  fetchImpl = globalThis.fetch,
  dataDirectory = DATA_DIRECTORY,
  manifest = languageData
} = {}) => {
  validateManifest(manifest);
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required to provision the OCR model.");
  }

  const resolvedDirectory = path.resolve(dataDirectory);
  const modelPath = resolveModelPath(resolvedDirectory, manifest.filename);
  await fs.mkdir(resolvedDirectory, { recursive: true });
  const directoryStats = await fs.lstat(resolvedDirectory);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw new Error(`OCR model data path must be a real directory: ${resolvedDirectory}`);
  }

  if (await existingModelIsValid(modelPath, manifest)) {
    return { path: modelPath, alreadyPresent: true };
  }

  const temporaryPath = path.join(
    resolvedDirectory,
    `.${MODEL_FILENAME}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  try {
    await downloadToTemporaryFile(fetchImpl, manifest, temporaryPath);
    try {
      await fs.link(temporaryPath, modelPath);
    } catch (error) {
      if (error.code === "EEXIST") {
        throw new Error(`OCR model destination appeared during provisioning; it was not overwritten: ${modelPath}`);
      }
      throw error;
    }
    await fs.unlink(temporaryPath);
    return { path: modelPath, alreadyPresent: false };
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
};

const main = async () => {
  const result = await provisionOcrLanguageData();
  const status = result.alreadyPresent ? "already verified" : "provisioned and verified";
  console.log(`English OCR model ${status}: ${result.path}`);
};

if (require.main === module) {
  main().catch((error) => {
    console.error("OCR language-data provisioning failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  getDownloadUrl,
  provisionOcrLanguageData,
  resolveModelPath,
  validateManifest,
  verifyChecksum
};
