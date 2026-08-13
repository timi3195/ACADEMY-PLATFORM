/* Safe, idempotent migration. Run only after configuring object storage:
 * node scripts/migrateLocalFilesToObjectStorage.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const File = require('../models/File');
const storage = require('../services/storageService');

async function migrate() {
  if (storage.getStorageProvider() !== storage.OBJECT_PROVIDER || !storage.isObjectStorageConfigured()) {
    throw new Error('Configure STORAGE_PROVIDER=object-storage and the backend storage credentials before migrating.');
  }
  await mongoose.connect(process.env.MONGO_URI);
  const summary = { migrated: 0, skipped: 0, missing: 0, failed: 0 };
  const records = await File.find({ $or: [{ storageProvider: storage.LOCAL_PROVIDER }, { storageProvider: { $exists: false } }] });
  for (const record of records) {
    const localPath = storage.resolveStoragePath(record.storageFilename);
    if (!localPath || !fs.existsSync(localPath)) {
      record.storageStatus = 'missing'; await record.save(); summary.missing++; continue;
    }
    try {
      const staged = { path: localPath, filename: record.storageFilename, originalname: record.originalFilename || record.originalName || path.basename(localPath), mimetype: record.mimeType || 'application/octet-stream', size: fs.statSync(localPath).size };
      // uploadUploadedFile removes staged files, so use a stream-compatible temporary copy only if needed.
      const key = storage.generateStorageKey({ materialId: record._id, originalFilename: staged.originalname });
      const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
      const client = new S3Client({ region: process.env.STORAGE_REGION || 'auto', endpoint: process.env.STORAGE_ENDPOINT || undefined, forcePathStyle: Boolean(process.env.STORAGE_ENDPOINT), credentials: { accessKeyId: process.env.STORAGE_ACCESS_KEY_ID, secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY } });
      await client.send(new PutObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: key, Body: fs.createReadStream(localPath), ContentType: staged.mimetype }));
      await client.send(new HeadObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: key }));
      record.storageProvider = storage.OBJECT_PROVIDER; record.storageKey = key; record.storageStatus = 'migrated'; record.originalFilename = staged.originalname; record.mimeType = staged.mimetype; record.size = staged.size;
      await record.save(); summary.migrated++;
    } catch (_) { record.storageStatus = 'failed'; await record.save(); summary.failed++; }
  }
  console.log(`Migrated: ${summary.migrated}\nSkipped: ${summary.skipped}\nMissing locally: ${summary.missing}\nFailed: ${summary.failed}`);
  await mongoose.disconnect();
}
migrate().catch((error) => { console.error(error.message); process.exitCode = 1; });
