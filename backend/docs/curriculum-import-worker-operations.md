# Curriculum import worker operations

## Required MongoDB indexes

`CurriculumImport` declares these worker indexes with `autoIndex: false` so a
worker startup cannot create indexes automatically:

- `curriculum_import_pending_claim`: supports the queued-job eligibility filter
  and oldest-upload ordering.
- `curriculum_import_lease_recovery`: supports processing-lease expiry scans.

`autoIndex: false` applies to every index declared by this model, including its
pre-existing identity, version, status, uploader, and content-hash indexes.
Those existing indexes must be retained and verified through the normal
authorized database-operations process; this remediation does not inspect or
recreate them.

Before deploying the query changes, an authorized database operator should
inspect the existing `curriculumimports` indexes and create equivalent indexes
if they are absent. Do not drop or replace existing indexes as part of this
change. Example commands, to be run only after review against the target
database:

```javascript
db.curriculumimports.createIndex(
  {
    status: 1,
    extractionStatus: 1,
    "document.status": 1,
    "document.mimeType": 1,
    "extractionJob.requestedAt": 1,
    "extractionJob.nextAttemptAt": 1,
    uploadedAt: 1,
    _id: 1
  },
  { name: "curriculum_import_pending_claim" }
);

db.curriculumimports.createIndex(
  {
    status: 1,
    extractionStatus: 1,
    "extractionJob.requestedAt": 1,
    "extractionJob.leaseExpiresAt": 1,
    "extractionJob.attempt": 1
  },
  { name: "curriculum_import_lease_recovery" }
);
```

The recovery index is compatible with `recoverExpiredLeases` and
`finalizeExpiredLeases`, which filter on `status`, `extractionStatus`,
`extractionJob.requestedAt`, `extractionJob.attempt`, and
`extractionJob.leaseExpiresAt`. The field name is `leaseExpiresAt` in the
schema and all recovery queries.

The worker-lock collection uses MongoDB's built-in unique `_id` index; no
additional lock index is required. No index inspection, creation, or migration
was performed for this change. Existing and proposed indexes must be compared
before applying these commands to avoid redundant indexes.

There is no destructive data migration. On its next normal claim/recovery
cycle, the worker marks malformed or inconsistent processing records as a
safe terminal failure and clears their lease fields. This is not a substitute
for an operator's review of existing records.

Lease filters and updates use MongoDB aggregation expressions and update
pipelines; the target server must support update pipelines (MongoDB 4.2 or
newer). Verify the actual server version and driver compatibility before
deployment. No database connection was made to determine the deployed version.

## Process resource limits

The child uses `--max-old-space-size=256`, which limits V8 old-space only. It
does not cap total RSS, PDF.js allocations, native canvas memory, or other
external buffers. Rendered-page dimensions and pixel count are bounded, but
there is no per-child OS memory limit in this repository.

No Docker, Render, or other deployment resource configuration is present in
this repository. The intended Linux deployment's cgroup/container memory
ceiling therefore cannot be determined here. A deployment owner must approve
and configure an appropriate container/process memory limit before claiming
that total child memory is bounded. No deployment setting or resource budget
was changed.

## Child-process behavior and platform limitations

On Linux, the child is started in its own process group. Timeout and
cancellation send `SIGTERM` to the group, then `SIGKILL` after a one-second
grace period. The child exits on IPC disconnect and monitors the parent PID as
a fallback; a separate watchdog thread also checks parent liveness and kills
the child process if the parent disappears while the main event loop is busy.
PDF and Tesseract processing run in that child; Tesseract.js uses a worker
thread rather than a separate OS process in this path. The watchdog is not
equivalent to a kernel parent-death signal, but does not depend on the main
JavaScript event loop being responsive.

On Windows development hosts, process-group signaling is not used; termination
targets the direct child. Node signal handling and parent-PID behavior differ
from Linux, and filesystem mode bits cannot guarantee an immutable OCR model.
The child is not an OS sandbox: it runs with the worker's filesystem and
network permissions.

## OCR model files

On POSIX systems, verification removes write bits from the model file and its
data directory before opening and hashing the model. The child repeats the
size, type, symlink, and SHA-256 verification immediately before Tesseract
initialization. Windows does not provide equivalent protection through
portable Node mode bits; a path-replacement race remains. POSIX permissions
also cannot prevent a same-identity process from changing permissions or
renaming the directory through a writable parent. A read-only,
deployment-owned model mount is stronger protection where available.
