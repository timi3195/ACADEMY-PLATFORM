const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');

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
const verifyWorkerStorage = async () => {
  if (process.env.NODE_ENV === 'production' && getStorageProvider() !== OBJECT_PROVIDER) {
    const error = new Error('Production question extraction workers require durable object storage');
    error.statusCode = 503;
    throw error;
  }
  if (getStorageProvider() === OBJECT_PROVIDER) {
    if (!isObjectStorageConfigured()) {
      const error = new Error('Object storage is not configured for the question extraction worker');
      error.statusCode = 503;
      throw error;
    }
    await client().send(new HeadBucketCommand({ Bucket: process.env.STORAGE_BUCKET }));
    return;
  }

  const directory = getUploadDir();
  await fs.promises.access(directory, fs.constants.W_OK);
  const probe = path.join(directory, `.question-extraction-worker-${crypto.randomUUID()}.tmp`);
  try {
    await fs.promises.writeFile(probe, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
  } finally {
    await fs.promises.unlink(probe).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
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
const isSafeCurriculumStorageReference = ({ importId, provider, storageFilename = '', storageKey = '', mimeType }) => {
  if (!/^[a-f0-9]{24}$/i.test(String(importId || ''))) return false;
  const extension = mimeType === 'application/pdf'
    ? '.pdf'
    : mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ? '.docx'
      : null;
  if (!extension) return false;
  const matchesNamespace = (value) => {
    if (typeof value !== 'string' || value.includes('\\') || /[\u0000-\u001f]/.test(value)) return false;
    if (value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
    const segments = value.split('/');
    return segments.length === 3 &&
      segments[0] === 'curriculum-imports' &&
      segments[1].toLowerCase() === String(importId).toLowerCase() &&
      /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/.test(segments[2]) &&
      segments[2].toLowerCase().endsWith(extension);
  };
  if (provider === LOCAL_PROVIDER) return matchesNamespace(storageFilename) && storageKey === '';
  if (provider === OBJECT_PROVIDER) return matchesNamespace(storageKey) && storageFilename === '';
  return false;
};
const storePrivateCurriculumDocument = async ({
  file,
  importId,
  originalFilename,
  mimeType,
  size,
  contentHash
}) => {
  if (!file?.path ||
      !/^[a-f0-9]{24}$/i.test(String(importId || '')) ||
      typeof contentHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(contentHash) ||
      !Number.isInteger(size) ||
      !isSafeCurriculumOriginalFilename(originalFilename)) {
    const error = new Error('Invalid private curriculum document metadata');
    error.statusCode = 400;
    throw error;
  }
  const extension = mimeType === 'application/pdf'
    ? '.pdf'
    : mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ? '.docx'
      : null;
  if (!extension || path.extname(originalFilename).toLowerCase() !== extension) {
    const error = new Error('Invalid private curriculum document type');
    error.statusCode = 400;
    throw error;
  }

  const sanitizedName = safeFilename(originalFilename).replace(/\.\./g, '-');
  const storageFilename = sanitizedName.toLowerCase().endsWith(extension)
    ? sanitizedName
    : `curriculum-document${extension}`;
  const storageName = `${crypto.randomUUID()}-${storageFilename}`;
  const storagePath = `curriculum-imports/${String(importId)}/${storageName}`;
  if (getStorageProvider() === OBJECT_PROVIDER) {
    try {
      await client().send(new PutObjectCommand({
        Bucket: process.env.STORAGE_BUCKET,
        Key: storagePath,
        Body: fs.createReadStream(file.path),
        ContentType: mimeType
      }));
      await client().send(new HeadObjectCommand({
        Bucket: process.env.STORAGE_BUCKET,
        Key: storagePath
      }));
    } catch {
      try {
        await client().send(new DeleteObjectCommand({
          Bucket: process.env.STORAGE_BUCKET,
          Key: storagePath
        }));
      } catch {
        const error = new Error('Private curriculum storage cleanup failed');
        error.statusCode = 500;
        throw error;
      }
      const error = new Error('Private curriculum document storage failed');
      error.statusCode = 503;
      throw error;
    }
    return {
      provider: OBJECT_PROVIDER,
      storageFilename: '',
      storageKey: storagePath,
      status: 'stored',
      originalFilename,
      mimeType,
      size,
      contentHash
    };
  }

  const destination = resolveStoragePath(storagePath);
  if (!destination) {
    const error = new Error('Invalid private curriculum storage path');
    error.statusCode = 400;
    throw error;
  }
  const namespaceDirectory = path.dirname(path.dirname(destination));
  const privateDirectory = path.dirname(destination);
  await ensurePrivateCurriculumDirectory(namespaceDirectory);
  await ensurePrivateCurriculumDirectory(privateDirectory);
  try {
    await fs.promises.copyFile(file.path, destination, fs.constants.COPYFILE_EXCL);
  } catch (copyError) {
    if (copyError.code !== 'EEXIST') {
      try {
        await fs.promises.unlink(destination);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          const error = new Error('Private curriculum storage cleanup failed');
          error.statusCode = 500;
          throw error;
        }
      }
    }
    const storageError = new Error('Private curriculum document storage failed');
    storageError.statusCode = 503;
    throw storageError;
  }
  try {
    await fs.promises.chmod(destination, 0o600);
  } catch {
    try {
      await fs.promises.unlink(destination);
    } catch {
      const cleanupError = new Error('Private curriculum storage cleanup failed');
      cleanupError.statusCode = 500;
      throw cleanupError;
    }
    const storageError = new Error('Private curriculum document storage failed');
    storageError.statusCode = 503;
    throw storageError;
  }
  return {
    provider: LOCAL_PROVIDER,
    storageFilename: storagePath,
    storageKey: '',
    status: 'stored',
    originalFilename,
    mimeType,
    size,
    contentHash
  };
};
const isSafeCurriculumOriginalFilename = (name) =>
  typeof name === 'string' &&
  name.length > 0 &&
  name.length <= 255 &&
  !/[\u0000-\u001f\u007f/\\]/.test(name) &&
  name !== '.' &&
  name !== '..' &&
  path.basename(name) === name &&
  path.win32.basename(name) === name;
const ensurePrivateCurriculumDirectory = async (directory) => {
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
  const details = await fs.promises.lstat(directory);
  if (details.isSymbolicLink() || !details.isDirectory()) {
    const error = new Error('Invalid private curriculum storage directory');
    error.statusCode = 400;
    throw error;
  }
  await fs.promises.chmod(directory, 0o700);
};
const resolvePrivateCurriculumLocalFile = async (document, importId) => {
  if (!isSafeCurriculumStorageReference({
    importId,
    provider: LOCAL_PROVIDER,
    storageFilename: document?.storageFilename,
    storageKey: document?.storageKey,
    mimeType: document?.mimeType
  })) return null;
  const resolved = resolveStoragePath(document.storageFilename);
  if (!resolved) return null;
  const baseDirectory = path.resolve(getUploadDir());
  const relative = path.relative(baseDirectory, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  const namespaceDirectory = path.join(baseDirectory, 'curriculum-imports');
  const importDirectory = path.join(namespaceDirectory, String(importId));
  try {
    const [namespace, importFolder, file] = await Promise.all([
      fs.promises.lstat(namespaceDirectory),
      fs.promises.lstat(importDirectory),
      fs.promises.lstat(resolved)
    ]);
    if (namespace.isSymbolicLink() || !namespace.isDirectory() ||
        importFolder.isSymbolicLink() || !importFolder.isDirectory() ||
        file.isSymbolicLink() || !file.isFile()) return null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  return resolved;
};
const getPrivateCurriculumDocumentStream = async ({ document, importId }) => {
  if (!isSafeCurriculumStorageReference({
    importId,
    provider: document?.provider,
    storageFilename: document?.storageFilename,
    storageKey: document?.storageKey,
    mimeType: document?.mimeType
  })) {
    const error = new Error('Private curriculum document not found');
    error.statusCode = 404;
    throw error;
  }
  if (document.provider === LOCAL_PROVIDER &&
      !await resolvePrivateCurriculumLocalFile(document, importId)) {
    const error = new Error('Private curriculum document not found');
    error.statusCode = 404;
    throw error;
  }
  return getObjectReadStream({
    storageProvider: document.provider,
    storageFilename: document.storageFilename,
    storageKey: document.storageKey
  });
};
const deletePrivateCurriculumDocument = async ({ document, importId }) => {
  if (!isSafeCurriculumStorageReference({
    importId,
    provider: document?.provider,
    storageFilename: document?.storageFilename,
    storageKey: document?.storageKey,
    mimeType: document?.mimeType
  })) {
    const error = new Error('Invalid private curriculum storage reference');
    error.statusCode = 400;
    throw error;
  }
  if (document.provider === LOCAL_PROVIDER) {
    const localPath = await resolvePrivateCurriculumLocalFile(document, importId);
    if (localPath) await fs.promises.unlink(localPath);
    return;
  }
  return deleteObject({
    storageProvider: document.provider,
    storageFilename: document.storageFilename,
    storageKey: document.storageKey
  });
};
const getStorageDiagnostics = ({ fileId, storageFilename, storageKey, storageProvider }) => ({ provider: storageProvider || getStorageProvider(), fileId, storageFilename, storageKey: storageKey || null, configured: getStorageProvider() !== OBJECT_PROVIDER || isObjectStorageConfigured() });

module.exports = {
  LOCAL_PROVIDER,
  OBJECT_PROVIDER,
  getUploadDir,
  getStorageProvider,
  isObjectStorageConfigured,
  verifyWorkerStorage,
  resolveStoragePath,
  getLegacyUploadFilename,
  generateStorageKey,
  uploadUploadedFile,
  storePrivateQuestionImage,
  getObjectReadStream,
  deleteObject,
  isSafeCurriculumStorageReference,
  storePrivateCurriculumDocument,
  getPrivateCurriculumDocumentStream,
  deletePrivateCurriculumDocument,
  getStorageDiagnostics,
  safeFilename
};
