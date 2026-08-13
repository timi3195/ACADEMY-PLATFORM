const fs = require('fs');
const path = require('path');

const getUploadDir = () => {
  const configuredDir = process.env.FILE_STORAGE_DIR || process.env.UPLOAD_DIR;
  const baseDir = configuredDir ? path.resolve(configuredDir) : path.join(__dirname, '../uploads');

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  return baseDir;
};

const resolveStoragePath = (storageFilename) => {
  if (!storageFilename) return null;

  if (path.isAbsolute(storageFilename)) {
    return storageFilename;
  }

  return path.join(getUploadDir(), storageFilename);
};

const fileExists = (storageFilename) => {
  const resolvedPath = resolveStoragePath(storageFilename);
  return Boolean(resolvedPath && fs.existsSync(resolvedPath));
};

const getStorageProvider = () => {
  if (process.env.AWS_S3_BUCKET || process.env.S3_BUCKET) return 's3';
  if (process.env.CLOUDINARY_CLOUD_NAME) return 'cloudinary';
  if (process.env.SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY) return 'supabase';
  return 'local-disk';
};

const getStorageDiagnostics = ({ fileId, storageFilename }) => {
  const uploadDir = getUploadDir();
  const resolvedPath = resolveStoragePath(storageFilename);

  return {
    provider: getStorageProvider(),
    uploadDir,
    resolvedPath,
    fileId,
    storageFilename,
    exists: Boolean(resolvedPath && fs.existsSync(resolvedPath))
  };
};

const getFileReadStream = (storageFilename) => {
  const resolvedPath = resolveStoragePath(storageFilename);

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return null;
  }

  return fs.createReadStream(resolvedPath);
};

module.exports = {
  getUploadDir,
  resolveStoragePath,
  fileExists,
  getStorageProvider,
  getStorageDiagnostics,
  getFileReadStream
};
