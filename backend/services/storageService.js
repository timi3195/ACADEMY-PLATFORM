const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const LOCAL_PROVIDER = 'local-disk';
const OBJECT_PROVIDER = 'object-storage';

const getUploadDir = () => {
  const configuredDir = process.env.FILE_STORAGE_DIR || process.env.UPLOAD_DIR;
  const baseDir = configuredDir ? path.resolve(configuredDir) : path.join(__dirname, '../uploads');
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
  return baseDir;
};

const getStorageProvider = () => process.env.STORAGE_PROVIDER === OBJECT_PROVIDER ? OBJECT_PROVIDER : LOCAL_PROVIDER;
const isObjectStorageConfigured = () => Boolean(process.env.STORAGE_BUCKET && process.env.STORAGE_ACCESS_KEY_ID && process.env.STORAGE_SECRET_ACCESS_KEY);
const client = () => {
  if (!isObjectStorageConfigured()) {
    const error = new Error('Object storage is not configured'); error.statusCode = 503; throw error;
  }
  return new S3Client({ region: process.env.STORAGE_REGION || 'auto', endpoint: process.env.STORAGE_ENDPOINT || undefined,
    forcePathStyle: Boolean(process.env.STORAGE_ENDPOINT), credentials: { accessKeyId: process.env.STORAGE_ACCESS_KEY_ID, secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY } });
};

const safeFilename = (name = 'file') => path.basename(String(name)).replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^\.+/, '') || 'file';
const generateStorageKey = ({ materialId, originalFilename }) => {
  if (!materialId) throw new Error('A material id is required to generate a storage key');
  return `materials/${String(materialId)}/${crypto.randomUUID()}-${safeFilename(originalFilename)}`;
};
const resolveStoragePath = (filename) => {
  if (!filename || path.isAbsolute(filename) || filename.includes('..')) return null;
  const resolved = path.resolve(getUploadDir(), filename);
  return resolved.startsWith(getUploadDir()) ? resolved : null;
};
const removeLocalUpload = (file) => { if (file?.path) fs.promises.unlink(file.path).catch(() => {}); };

const uploadUploadedFile = async ({ file, materialId, kind = 'materials' }) => {
  if (!file?.path) throw new Error('Uploaded file is unavailable');
  if (getStorageProvider() !== OBJECT_PROVIDER) return { storageProvider: LOCAL_PROVIDER, storageFilename: file.filename, originalName: file.originalname, mimeType: file.mimetype, size: file.size, storageStatus: 'pending' };
  const key = generateStorageKey({ materialId, originalFilename: file.originalname }).replace(/^materials\//, `${kind}/`);
  try {
    await client().send(new PutObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: key, Body: fs.createReadStream(file.path), ContentType: file.mimetype }));
    await client().send(new HeadObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: key }));
    return { storageProvider: OBJECT_PROVIDER, storageKey: key, originalName: file.originalname, mimeType: file.mimetype, size: file.size, storageStatus: 'migrated', storageFilename: file.filename };
  } finally { removeLocalUpload(file); }
};
const getObjectReadStream = async (record) => {
  if (record.storageProvider !== OBJECT_PROVIDER) {
    const local = resolveStoragePath(record.storageFilename);
    if (!local || !fs.existsSync(local)) { const e = new Error('File missing from local storage'); e.statusCode = 404; throw e; }
    return fs.createReadStream(local);
  }
  if (!record.storageKey || record.storageKey.includes('..') || path.isAbsolute(record.storageKey)) { const e = new Error('Invalid storage key'); e.statusCode = 400; throw e; }
  try { const response = await client().send(new GetObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: record.storageKey })); return response.Body; }
  catch (error) { if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NoSuchKey') { error.statusCode = 404; error.message = 'File missing from object storage'; } throw error; }
};
const deleteObject = async (record) => {
  if (record.storageProvider === OBJECT_PROVIDER && record.storageKey) await client().send(new DeleteObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: record.storageKey }));
  else { const local = resolveStoragePath(record.storageFilename); if (local && fs.existsSync(local)) await fs.promises.unlink(local); }
};
const getStorageDiagnostics = ({ fileId, storageFilename, storageKey, storageProvider }) => ({ provider: storageProvider || getStorageProvider(), fileId, storageFilename, storageKey: storageKey || null, configured: getStorageProvider() !== OBJECT_PROVIDER || isObjectStorageConfigured() });

module.exports = { LOCAL_PROVIDER, OBJECT_PROVIDER, getUploadDir, getStorageProvider, isObjectStorageConfigured, resolveStoragePath, generateStorageKey, uploadUploadedFile, getObjectReadStream, deleteObject, getStorageDiagnostics, safeFilename };
