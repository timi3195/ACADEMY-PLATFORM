const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  getDownloadUrl,
  provisionOcrLanguageData,
  resolveModelPath,
  validateManifest,
  verifyChecksum
} = require("../scripts/provisionOcrLanguageData");

const repository = "https://github.com/tesseract-ocr/tessdata_fast";
const digest = (data) => crypto.createHash("sha256").update(data).digest("hex");

const makeManifest = (data, overrides = {}) => ({
  upstreamRepository: repository,
  revision: "a".repeat(40),
  filename: "eng.traineddata",
  sizeBytes: data.length,
  sha256: digest(data),
  ...overrides
});

const withTemporaryDirectory = async (callback) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "academy-ocr-data-"));
  try {
    await callback(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
};

test("checksum verification accepts exact bytes and rejects mismatches", () => {
  const data = Buffer.from("trained English model");
  assert.equal(verifyChecksum(data, digest(data)), digest(data));
  assert.throws(() => verifyChecksum(data, digest(Buffer.from("different model"))), /SHA-256 mismatch/);
  assert.throws(() => verifyChecksum(data, "not-a-digest"), /64-character digest/);
});

test("provisions only the pinned model and leaves a verified existing model untouched", async () => {
  await withTemporaryDirectory(async (directory) => {
    const data = Buffer.from("a test model");
    const manifest = makeManifest(data);
    let downloadCount = 0;
    const fetchImpl = async (url, options) => {
      downloadCount += 1;
      assert.equal(url, `${repository.replace("github.com", "raw.githubusercontent.com")}/${manifest.revision}/${manifest.filename}`);
      assert.equal(options.redirect, "error");
      return new Response(data);
    };

    const first = await provisionOcrLanguageData({ fetchImpl, dataDirectory: directory, manifest });
    assert.equal(first.alreadyPresent, false);
    assert.deepEqual(await fs.readFile(first.path), data);

    const second = await provisionOcrLanguageData({
      fetchImpl: async () => { throw new Error("A verified model should not be downloaded again."); },
      dataDirectory: directory,
      manifest
    });
    assert.equal(second.alreadyPresent, true);
    assert.equal(downloadCount, 1);
    assert.deepEqual(await fs.readdir(directory), ["eng.traineddata"]);
  });
});

test("rejects a manifest that could select another repository, revision, or filename", () => {
  const data = Buffer.from("model");
  const manifest = makeManifest(data);
  assert.doesNotThrow(() => validateManifest(manifest));
  assert.throws(() => getDownloadUrl({ ...manifest, filename: "../other-file" }), /Only eng\.traineddata/);
  assert.throws(() => getDownloadUrl({ ...manifest, upstreamRepository: "https://example.com/model" }), /official tessdata_fast/);
  assert.throws(() => getDownloadUrl({ ...manifest, revision: "main" }), /40-character Git revision/);
});

test("rejects unsafe output filenames", async () => {
  await withTemporaryDirectory(async (directory) => {
    assert.throws(() => resolveModelPath(directory, "../eng.traineddata"), /Unsafe OCR model filename/);
    assert.throws(() => resolveModelPath(directory, "..\\eng.traineddata"), /Unsafe OCR model filename/);
  });
});

test("checksum failure removes the temporary download and does not create a model", async () => {
  await withTemporaryDirectory(async (directory) => {
    const expected = Buffer.from("expected");
    const received = Buffer.from("received");
    assert.equal(expected.length, received.length);
    const manifest = makeManifest(expected);

    await assert.rejects(
      provisionOcrLanguageData({
        fetchImpl: async () => new Response(received),
        dataDirectory: directory,
        manifest
      }),
      /SHA-256 mismatch/
    );
    assert.deepEqual(await fs.readdir(directory), []);
  });
});

test("download interruption cleans its temporary file", async () => {
  await withTemporaryDirectory(async (directory) => {
    const data = Buffer.from("complete model");
    const manifest = makeManifest(data);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from("partial"));
        controller.error(new Error("connection interrupted"));
      }
    });

    await assert.rejects(
      provisionOcrLanguageData({
        fetchImpl: async () => new Response(body),
        dataDirectory: directory,
        manifest
      }),
      /connection interrupted/
    );
    assert.deepEqual(await fs.readdir(directory), []);
  });
});

test("refuses to overwrite an existing model with a different checksum", async () => {
  await withTemporaryDirectory(async (directory) => {
    const existing = Buffer.from("existing model");
    const expected = Buffer.from("new model");
    const modelPath = path.join(directory, "eng.traineddata");
    await fs.writeFile(modelPath, existing);

    await assert.rejects(
      provisionOcrLanguageData({
        fetchImpl: async () => { throw new Error("Must not fetch over an existing unverified file."); },
        dataDirectory: directory,
        manifest: makeManifest(expected)
      }),
      /it was not overwritten/
    );
    assert.deepEqual(await fs.readFile(modelPath), existing);
    assert.deepEqual(await fs.readdir(directory), ["eng.traineddata"]);
  });
});
