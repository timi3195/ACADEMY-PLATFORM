# Persistent object storage on Render

Render's local filesystem is ephemeral. Configure a private S3-compatible bucket and these backend-only variables:

```
STORAGE_PROVIDER=object-storage
STORAGE_BUCKET=...
STORAGE_REGION=...
STORAGE_ENDPOINT=... # optional for AWS S3
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
```

Do not prefix these with `VITE_`, expose them to the frontend, or make the bucket public. The backend remains the authorization boundary and streams objects through `/api/files/view/:id` and `/api/files/download/:id`.

After deploying with those variables, run `node scripts/migrateLocalFilesToObjectStorage.js` only from an environment that can access both MongoDB, the configured bucket, and the legacy local files. The script is idempotent and marks unavailable local files as `missing`; it does not fabricate recovery or delete legacy files.
