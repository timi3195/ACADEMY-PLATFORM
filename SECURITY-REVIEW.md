# Targeted Security Review: File Access and Paystack

**Scope:** Read-only review of backend file access/storage and Paystack payment flows. No application code or database records were changed during the investigations.

## Findings

### Medium — Course membership can be bypassed for uploaded course files (remediated)

- **Confidence:** 9/10
- **Affected routes:** `POST /api/files/upload`, `GET /api/files/view/:id`, `GET /api/files/download/:id`
- **Relevant code:** `backend/routes/file.js` (upload and streaming access paths), `backend/models/File.js` (`course` is a `String`), and `backend/services/materialAccessService.js` (`loadMaterial` and course membership checks).
- **Issue:** The upload route stores the course title in `File.course`. The access path attempts to populate that value as a Course document, but a title string cannot be populated as a course reference. Course membership checks consequently lack the department/level information needed to reject students outside the course. Authenticated students who obtain the file ID can therefore stream eligible public, unpaid materials uploaded for another course.
- **Boundaries:** This does not establish unauthenticated access. The reviewed private-file ownership and paid-material transaction checks remain in place.
- **Recommended correction:** Resolve the stored course title to an actual course before authorizing access, or use a course reference for authorization. Fail closed if course membership cannot be determined. Do not broaden access to other courses.
- **Missing regression coverage:** Exercise both streaming routes with the real File schema and access service, using an authenticated student outside the material's course.
- **Resolution:** New course uploads now retain the uniquely constrained course code. Legacy course uploads resolve by exact title, department, level, and semester, and are denied if the course or department match is missing or ambiguous. View and download use the same material access service. Regression coverage is in `backend/tests/fileCourseMembershipSecurity.test.js`.

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

No confirmed payment-forgery, old-reference reuse, duplicate activation, or unpaid material-access vulnerability was identified.

- `backend/services/marketplaceService.js`, `initializePurchase` and `verifyPurchase`: the server calculates the expected material charge, creates a pending transaction bound to the authenticated user and material, and verifies the reference with Paystack before completion.
- `backend/services/paymentIntegrityService.js`, `claimPendingTransaction` and `validatePaystackPayment`: verification checks the expected transaction/reference, successful Paystack status, amount in minor units, currency and customer email when supplied. Conditional transaction claims prevent concurrent verification or webhook delivery from completing the same transaction twice.
- `backend/routes/payments.js`, `POST /webhook`: validates the SHA-512 signature against the raw request body using a timing-safe comparison. Only successful charge events proceed to payment validation.
- `backend/services/materialAccessService.js`, `userHasPurchasedMaterial` and `canViewMaterial`: paid file access requires a successful transaction matching the user and material, and both view and download use the same access decision.

### Low — Refund/reversal entitlement revocation is unverified

- **Confidence:** 7/10; conditional on refunds or reversals being supported operationally.
- **Relevant code:** `backend/routes/payments.js`, `/webhook`; `backend/services/materialAccessService.js`, `userHasPurchasedMaterial`.
- **Issue:** The webhook path handles `charge.success` but no refund/reversal entitlement-revocation flow was found. A transaction that remains `status: "success"` continues to satisfy the material purchase check.
- **Recommended correction:** If refunds or reversals are supported, process their verified events and revoke or invalidate the corresponding entitlement. Otherwise, document the operational policy. Add tests asserting refunded/reversed purchases cannot view or download materials if such events are in scope.

Focused tests in `backend/tests/marketplacePaymentSecurity.test.js`, `backend/tests/paystackPaymentSecurity.test.js`, and `backend/tests/fileCourseMembershipSecurity.test.js` were reported as passing: **78 tests, 0 failures**. Coverage includes server-side pricing, user/material binding, amount and currency validation, signature checks, duplicate/retry handling, concurrency, and file-access entitlement checks.

**Configuration risk:** The deployment must provide the Paystack secret and expected currency through protected configuration. No secret values were inspected or included in this report.

## Priorities

1. **Medium (remediated):** Course-membership checks for uploaded course materials.
2. **Low/configuration-dependent:** Ensure durable object storage is configured in production and account for legacy local files.
3. **Low/conditional:** Confirm whether refund/reversal processing is operationally supported; if so, add verified event handling and entitlement tests.
