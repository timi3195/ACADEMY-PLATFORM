const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsConstants = require("node:fs").constants;
const path = require("node:path");
const languageData = require("../config/ocrLanguageData.json");
const {
  resolveModelPath,
  validateManifest
} = require("../scripts/provisionOcrLanguageData");

const DATA_DIRECTORY = path.resolve(__dirname, "..", "tessdata");

const makeReadOnly = async (handle, stats) => {
  if (process.platform === "win32") return;
  const writableBits = stats.mode & 0o222;
  if (writableBits) {
    await handle.chmod(stats.mode & 0o555);
  }
};

const verifyLocalOcrModel = async ({
  dataDirectory = DATA_DIRECTORY,
  manifest = languageData,
  fileSystem = fs
} = {}) => {
  let handle;
  let directoryHandle;
  try {
    validateManifest(manifest);
    const resolvedDirectory = path.resolve(dataDirectory);
    const directoryStats = await fileSystem.lstat(resolvedDirectory);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      return { available: false, reason: "invalid_directory" };
    }

    const modelPath = resolveModelPath(resolvedDirectory, manifest.filename);
    const fileStats = await fileSystem.lstat(modelPath);
    if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
      return { available: false, reason: "invalid_file" };
    }
    if (fileStats.size !== manifest.sizeBytes) {
      return { available: false, reason: "invalid_size" };
    }

    const noFollow = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
    if (process.platform !== "win32") {
      const directoryFlags = fsConstants.O_RDONLY |
        (typeof fsConstants.O_DIRECTORY === "number" ? fsConstants.O_DIRECTORY : 0) |
        noFollow;
      directoryHandle = await fileSystem.open(resolvedDirectory, directoryFlags);
      const openedDirectoryStats = await directoryHandle.stat();
      if (!openedDirectoryStats.isDirectory() ||
          openedDirectoryStats.dev !== directoryStats.dev ||
          openedDirectoryStats.ino !== directoryStats.ino) {
        return { available: false, reason: "directory_changed" };
      }
    }

    handle = await fileSystem.open(modelPath, fsConstants.O_RDONLY | noFollow);
    const openedStats = await handle.stat();
    if (!openedStats.isFile() ||
        openedStats.size !== manifest.sizeBytes ||
        openedStats.dev !== fileStats.dev ||
        openedStats.ino !== fileStats.ino) {
      return { available: false, reason: "file_changed" };
    }
    await makeReadOnly(handle, openedStats);
    if (directoryHandle) await makeReadOnly(directoryHandle, directoryStats);
    const bytes = await handle.readFile();
    if (bytes.length !== manifest.sizeBytes) {
      return { available: false, reason: "invalid_size" };
    }
    const finalDirectoryStats = await fileSystem.lstat(resolvedDirectory);
    const finalFileStats = await fileSystem.lstat(modelPath);
    if (!finalDirectoryStats.isDirectory() ||
        finalDirectoryStats.isSymbolicLink() ||
        !finalFileStats.isFile() ||
        finalFileStats.isSymbolicLink() ||
        finalFileStats.size !== manifest.sizeBytes ||
        (process.platform !== "win32" &&
          ((finalDirectoryStats.mode & 0o222) !== 0 ||
           (finalFileStats.mode & 0o222) !== 0)) ||
        finalFileStats.dev !== openedStats.dev ||
        finalFileStats.ino !== openedStats.ino) {
      return { available: false, reason: "file_changed" };
    }
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (digest !== manifest.sha256) {
      return { available: false, reason: "invalid_hash" };
    }
    return { available: true, dataDirectory: resolvedDirectory };
  } catch (error) {
    if (error?.code === "ENOENT") return { available: false, reason: "missing" };
    if (error?.code === "ELOOP" || error?.code === "EACCES" || error?.code === "EPERM") {
      return { available: false, reason: "unreadable" };
    }
    return { available: false, reason: "verification_failed" };
  } finally {
    if (handle) await handle.close();
    if (directoryHandle) await directoryHandle.close();
  }
};

module.exports = {
  DATA_DIRECTORY,
  verifyLocalOcrModel
};
