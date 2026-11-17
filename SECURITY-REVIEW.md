# Security Review: Free Student Access and Deferred Commerce

**Scope:** Final review of the free-student-access policy, course membership enforcement, disabled commerce paths, and related educational feature access.

## Current release scope: free student access

The current HND release defers Paystack payments, subscriptions, paid material purchases, lecturer marketplace sales, and marketplace commerce. Students do not need a purchase or premium entitlement to view or download otherwise eligible learning materials. Authentication, course membership, publication/visibility, ownership, administrator, and deleted-material checks remain required.

Student course membership is determined only by admin-managed course IDs in `User.coursesEnrolled`. Editable department, year, and semester profile fields do not grant access. Administrators assign existing course IDs through `PUT /api/users/:id` and the Admin Panel's **Student Access** tab. Students with no assigned course IDs are denied course-scoped access until an administrator assigns them.

Commerce initialization, purchase creation/verification, marketplace selling, and paid-material operations are disabled by the backend. The signed Paystack webhook is acknowledged without creating purchases or changing entitlements; invalid signatures are rejected. Paystack and marketplace implementations are retained for possible post-submission activation, but **must receive a fresh security review and approval before any commerce endpoint or webhook processing is re-enabled**.

## Findings

### Medium — Course access previously relied on editable academic profile fields (remediated)

- **Confidence:** 9/10
- **Affected routes:** Course listing/detail, course file listing/view/download, question/AI/CBT access, search, and course-scoped notes.
- **Relevant code:** `backend/services/courseMembershipService.js`, `backend/services/materialAccessService.js`, `backend/services/questionAccessService.js`, `backend/routes/users.js`, and `backend/routes/file.js`.
- **Issue:** Earlier access checks inferred membership from profile fields students could edit. This could make profile data act as an authorization grant and caused inconsistent access decisions across educational routes.
- **Resolution:** Access checks now use `coursesEnrolled` IDs assigned by an administrator. The admin update route validates that IDs belong to existing courses, and self-service profile updates cannot assign them. Material view and download use the same access decision. The Admin Panel now provides an assignment workflow. Regression coverage includes membership service, enrollment assignment, file access, questions, AI, CBT, and frontend course filtering.
- **Deployment requirement:** Backfill the existing students' authorized course IDs before release. Do not derive the backfill from self-reported academic profile fields without an independent trusted roster.

### Medium — Some educational features retained premium-only middleware (remediated)

- **Confidence:** 9/10
- **Affected routes:** CBT session routes, AI note upload/learning-path generation, course performance analytics, and course notes.
- **Relevant code:** `backend/routes/quizSession.js`, `backend/routes/ai.js`, `backend/routes/analytics.js`, and `backend/routes/note.js`.
- **Issue:** Premium-plan checks continued to block otherwise authorized students from educational features after commerce was deferred. The old notes routes also returned notes without course authorization.
- **Resolution:** Payment-plan middleware was removed from these educational routes while authentication and course-membership checks remain. CBT examination behavior was not changed. AI note upload and analytics now check course access; notes are listed and created only for accessible courses, and legacy premium-marked course notes are available without payment.

### Low — Local-disk file persistence depends on deployment configuration

- **Confidence:** Configuration-dependent
- **Relevant code:** `backend/services/storageService.js`; `backend/OBJECT_STORAGE_RENDER.md`; `backend/scripts/migrateLocalFilesToObjectStorage.js`.
- **Issue:** Storage defaults to local disk unless object storage is configured. Render's local filesystem is ephemeral, so local files may disappear after a restart or redeploy. A `pending` storage status and empty `storageKey` are normal for local-disk records; neither alone demonstrates an authorization or migration failure. The reviewed migration script handles `File` records, so legacy local past-question files may still depend on local disk.
- **Recommended correction:** Confirm production uses configured durable object storage and migrate legacy files as needed. Add tests for missing local files, missing object keys, and migration coverage. Do not treat the pending marker itself as a security defect.

## File access and URL observations

- File view/download routes require authentication and use backend course access checks.
- Course materials are free for authorized students; purchase or subscription state is not an entitlement requirement.
- Private file ownership restrictions remain in place. Successful-purchase checks described in the historical Paystack review are no longer required for student access in the current release.
- Marketplace responses may expose storage keys as object identifiers. The reviewed routes do not return public object URLs or presigned URLs; storage keys are not credentials.
- The legacy upload route serves qualifying public cover images without authentication; other reviewed legacy file access requires authentication and ownership checks.

## Historical Paystack implementation review (commerce disabled in this release)

The following describes retained implementation, not active current-release behavior. No confirmed payment-forgery, old-reference reuse, duplicate activation, or unpaid material-access vulnerability was identified in the earlier review.

- `backend/services/marketplaceService.js`, `initializePurchase` and `verifyPurchase`: the server calculates the expected material charge, creates a pending transaction bound to the authenticated user and material, and verifies the reference with Paystack before completion.
- `backend/services/paymentIntegrityService.js`, `claimPendingTransaction` and `validatePaystackPayment`: verification checks the expected transaction/reference, successful Paystack status, amount in minor units, currency and customer email when supplied. Conditional transaction claims prevent concurrent verification or webhook delivery from completing the same transaction twice.
- `backend/routes/payments.js`, `POST /webhook`: validates the SHA-512 signature against the raw request body using a timing-safe comparison. Only successful charge events proceed to payment validation.
- `backend/services/materialAccessService.js`, `userHasPurchasedMaterial` and `canViewMaterial`: paid file access requires a successful transaction matching the user and material, and both view and download use the same access decision.

### Low — Refund/reversal entitlement revocation is unverified

- **Confidence:** 7/10; conditional on refunds or reversals being supported operationally.
- **Relevant code:** `backend/routes/payments.js`, `/webhook`; `backend/services/materialAccessService.js`, `userHasPurchasedMaterial`.
- **Issue:** The webhook path handles `charge.success` but no refund/reversal entitlement-revocation flow was found. A transaction that remains `status: "success"` continues to satisfy the material purchase check.
- **Recommended correction:** If refunds or reversals are supported, process their verified events and revoke or invalidate the corresponding entitlement. Otherwise, document the operational policy. Add tests asserting refunded/reversed purchases cannot view or download materials if such events are in scope.

Earlier focused tests in `backend/tests/marketplacePaymentSecurity.test.js`, `backend/tests/paystackPaymentSecurity.test.js`, and `backend/tests/fileCourseMembershipSecurity.test.js` were reported as passing: **78 tests, 0 failures**. Those historical tests covered server-side pricing, user/material binding, amount and currency validation, signature checks, duplicate/retry handling, concurrency, and the then-active file-access entitlement checks. Current-release regressions separately verify that commerce routes are disabled and valid webhooks do not grant entitlements.

**Future re-enablement risk:** Paystack secrets and currency configuration are not required for the current free-only release. If commerce is considered later, the deployment must use protected configuration and undergo fresh security review before activation. No secret values were inspected or included in this report.

## Priorities

1. **Medium (remediated):** Use admin-managed course IDs consistently for course and resource authorization; assign existing student enrollments before deployment.
2. **Low/configuration-dependent:** Ensure durable object storage is configured in production and account for legacy local files.
3. **Deferred commerce:** Do not re-enable payment, purchase, or selling flows without fresh review and approval; refund/reversal handling remains a future commerce requirement.
