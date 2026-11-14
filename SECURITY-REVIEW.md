# Targeted Security Review: File Access and Paystack

**Scope:** Read-only review of backend file access/storage and Paystack payment flows. No files or database records were changed during the investigation. No tests were executed.

## Findings

### Medium — Course membership can be bypassed for uploaded course files

- **Confidence:** 9/10
- **Affected routes:** `POST /api/files/upload`, `GET /api/files/view/:id`, `GET /api/files/download/:id`
- **Relevant code:** `backend/routes/file.js` (upload and streaming access paths), `backend/models/File.js` (`course` is a `String`), and `backend/services/materialAccessService.js` (`loadMaterial` and course membership checks).
- **Issue:** The upload route stores the course title in `File.course`. The access path attempts to populate that value as a Course document, but a title string cannot be populated as a course reference. Course membership checks consequently lack the department/level information needed to reject students outside the course. Authenticated students who obtain the file ID can therefore stream eligible public, unpaid materials uploaded for another course.
- **Boundaries:** This does not establish unauthenticated access. The reviewed private-file ownership and paid-material transaction checks remain in place.
- **Recommended correction:** Resolve the stored course title to an actual course before authorizing access, or use a course reference for authorization. Fail closed if course membership cannot be determined. Do not broaden access to other courses.
- **Missing regression coverage:** Exercise both streaming routes with the real File schema and access service, using an authenticated student outside the material's course.

### Low — Local-disk file persistence depends on deployment configuration

- **Confidence:** Configuration-dependent
- **Relevant code:** `backend/services/storageService.js`; `backend/OBJECT_STORAGE_RENDER.md`; `backend/scripts/migrateLocalFilesToObjectStorage.js`.
- **Issue:** Storage defaults to local disk unless object storage is configured. Render's local filesystem is ephemeral, so local files may disappear after a restart or redeploy. A `pending` storage status and empty `storageKey` are normal for local-disk records; neither alone demonstrates an authorization or migration failure. The reviewed migration script handles `File` records, so legacy local past-question files may still depend on local disk.
- **Recommended correction:** Confirm production uses configured durable object storage and migrate legacy files as needed. Add tests for missing local files, missing object keys, and migration coverage. Do not treat the pending marker itself as a security defect.

## File access and URL observations

- File view/download routes require authentication and use backend access checks.
- Private file ownership restrictions and successful-purchase checks for paid materials were present on the reviewed streaming paths.
- Marketplace responses may expose storage keys as object identifiers. The reviewed routes do not return public object URLs or presigned URLs; storage keys are not credentials.
- The legacy upload route serves qualifying public cover images without authentication; other reviewed legacy file access requires authentication and ownership checks.

## Paystack review

No confirmed payment-forgery, old-reference reuse, duplicate activation, or unpaid premium-access vulnerability was identified.

- `backend/routes/payments.js`: `/initialize` determines plan pricing server-side; `/verify/:reference` verifies through Paystack and checks the transaction owner; `/webhook` validates the Paystack signature and payment fields.
- `backend/services/paymentIntegrityService.js`: transaction references are claimed atomically, and duplicate processing is handled idempotently.
- Subscription activation follows validated successful payment; premium access checks subscription expiry.

Existing coverage in `backend/tests/paystackPaymentSecurity.test.js` includes server-side pricing, ownership, payment validation, duplicate verification and webhook delivery, signature checks, and concurrency.

**Additional focused test opportunity:** Add coverage for successful material-purchase webhooks, duplicate delivery, and reference/material mismatch.

## Priorities

1. **Medium:** Fix the course-membership bypass for uploaded course materials and add route-level regression tests.
2. **Low/configuration-dependent:** Ensure durable object storage is configured in production and account for legacy local files.
3. **Paystack:** No code correction recommended based on this review; add the material-webhook test cases noted above.
