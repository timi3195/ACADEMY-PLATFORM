const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const approvedManifest = require("../config/ocrLanguageData.json");
const { verifyLocalOcrModel } = require("../services/curriculumOcrModelVerification");

const generatedModel = Buffer.from("generated-test-language-data");
const manifest = {
  ...approvedManifest,
  sizeBytes: generatedModel.length,
  sha256: crypto.createHash("sha256").update(generatedModel).digest("hex")
};

const withDirectory = async (callback) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "curriculum-ocr-model-"));
  try {
    await callback(directory);
  } finally {
    try {
      await fs.chmod(path.join(directory, approvedManifest.filename), 0o600);
    } catch {}
    try {
      await fs.chmod(directory, 0o700);
    } catch {}
    await fs.rm(directory, { recursive: true, force: true });
  }
};

test("local OCR model verification checks the pinned size and hash", async () => {
  await withDirectory(async (directory) => {
    await fs.writeFile(path.join(directory, "eng.traineddata"), generatedModel);
    const result = await verifyLocalOcrModel({ dataDirectory: directory, manifest });
    assert.equal(result.available, true);
    assert.equal(result.dataDirectory, path.resolve(directory));
    if (process.platform !== "win32") {
      const directoryStats = await fs.stat(directory);
      const modelStats = await fs.stat(path.join(directory, approvedManifest.filename));
      assert.equal(directoryStats.mode & 0o222, 0);
      assert.equal(modelStats.mode & 0o222, 0);
    }
  });
});

test("missing, wrong-size, and wrong-hash models return safe unavailable results", async () => {
  await withDirectory(async (directory) => {
    assert.deepEqual(
      await verifyLocalOcrModel({ dataDirectory: directory, manifest }),
      { available: false, reason: "missing" }
    );
    await fs.writeFile(path.join(directory, "eng.traineddata"), Buffer.from("short"));
    assert.deepEqual(
      await verifyLocalOcrModel({ dataDirectory: directory, manifest }),
      { available: false, reason: "invalid_size" }
    );
    await fs.writeFile(path.join(directory, "eng.traineddata"), Buffer.alloc(generatedModel.length));
    assert.deepEqual(
      await verifyLocalOcrModel({ dataDirectory: directory, manifest }),
      { available: false, reason: "invalid_hash" }
    );
  });
});

test("symlinked or non-file model paths are rejected before they are read", async () => {
  await withDirectory(async (directory) => {
    const modelPath = path.join(path.resolve(directory), "eng.traineddata");
    const realFileSystem = fs;
    const fileSystem = {
      async lstat(candidate) {
        if (candidate === modelPath) {
          return {
            size: generatedModel.length,
            isFile: () => true,
            isSymbolicLink: () => true
          };
        }
        return realFileSystem.lstat(candidate);
      },
      async open() {
        throw new Error("A symlink must not be opened.");
      }
    };
    assert.deepEqual(
      await verifyLocalOcrModel({ dataDirectory: directory, manifest, fileSystem }),
      { available: false, reason: "invalid_file" }
    );
  });
});
