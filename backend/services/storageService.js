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
  const baseDir = path.resolve(getUploadDir());
  const resolved = path.resolve(baseDir, filename);
  const relative = path.relative(baseDir, resolved);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    ? resolved
    : null;
};
const getLegacyUploadFilename = (fileUrl) => {
  if (typeof fileUrl !== 'string') return null;
  let parsedUrl;
  try {
    parsedUrl = new URL(fileUrl, 'http://localhost');
  } catch {
    return null;
  }
  if (parsedUrl.origin !== 'http://localhost') return null;

  const match = parsedUrl.pathname.match(/^\/uploads\/([^/]+)$/);
  if (!match) return null;
  let filename;
  try {
    filename = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\') ||
      filename.includes(':') || path.basename(filename) !== filename || path.win32.basename(filename) !== filename) {
    return null;
  }
  return filename;
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
const storePrivateQuestionImage = async ({ buffer, batchId, imageId, extension, mimeType, originalName }) => {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Image content is unavailable');
  if (!/^[a-f0-9]{24}$/i.test(String(batchId)) || !/^[a-f0-9]{24}$/i.test(String(imageId))) {
    throw new Error('Invalid private image identifier');
  }
  const normalizedExtension = String(extension || '').toLowerCase().replace(/^\./, '');
  if (!['jpg', 'jpeg', 'png'].includes(normalizedExtension)) throw new Error('Unsupported private image type');

  const storageKey = `question-extractions/${batchId}/${imageId}.${normalizedExtension}`;
  if (getStorageProvider() === OBJECT_PROVIDER) {
    try {
      await client().send(new PutObjectCommand({
        Bucket: process.env.STORAGE_BUCKET,
        Key: storageKey,
        Body: buffer,
        ContentType: mimeType
      }));
      await client().send(new HeadObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: storageKey }));
    } catch (error) {
      try {
        await client().send(new DeleteObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: storageKey }));
      } catch (cleanupError) {
        console.error('Failed to clean up incomplete private image storage:', cleanupError.message);
      }
      throw error;
    }
    return {
      storageProvider: OBJECT_PROVIDER,
      storageKey,
      originalName: safeFilename(originalName),
      mimeType,
      size: buffer.length,
      storageStatus: 'migrated'
    };
  }

  const storageFilename = storageKey;
  const localPath = resolveStoragePath(storageFilename);
  if (!localPath) throw new Error('Invalid private image storage path');
  await fs.promises.mkdir(path.dirname(localPath), { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(localPath, buffer, { flag: 'wx', mode: 0o600 });
  return {
    storageProvider: LOCAL_PROVIDER,
    storageFilename,
    originalName: safeFilename(originalName),
    mimeType,
    size: buffer.length,
    storageStatus: 'pending'
  };
};
const getObjectReadStream = async (record) => {
  if (record.storageProvider !== OBJECT_PROVIDER) {
    const storageFilename = record.storageFilename || getLegacyUploadFilename(record.fileUrl);
    const local = resolveStoragePath(storageFilename);
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

module.exports = { LOCAL_PROVIDER, OBJECT_PROVIDER, getUploadDir, getStorageProvider, isObjectStorageConfigured, resolveStoragePath, generateStorageKey, uploadUploadedFile, storePrivateQuestionImage, getObjectReadStream, deleteObject, getStorageDiagnostics, safeFilename };
