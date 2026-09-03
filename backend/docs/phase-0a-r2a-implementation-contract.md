# Phase 0A-R2A Implementation Contract

Design-only. Resolves thirteen specific inconsistencies identified during independent review of
the *Phase 0A-R2 Gap Analysis — Review Correction*. That document's ten binding decisions and
overall direction are accepted; this contract makes the identity/access/document-security
schema design in M2 and M4 internally consistent and precise enough to actually implement.

**Branch:** `r2-design-review` (this document only; `backend-foundation`/`main` untouched)
**Parent for this analysis:** `backend-foundation` @ `9cdd8f3ec4167e33b94dd85340d1c46829a5ad87`
**Prior commit on this branch:** `bd11f6c490ff7f6e591ca268f3e485a26583af38`

---

## 1. Permission catalogue and access-package versioning

**Resolved design.** `UserPermissionGrant.permissionId` is a real FK to the existing `Permission`
table (Decision 4, already schema-approved — `Permission.key`, e.g. `"quality.release.execute"`,
is the one controlled vocabulary). No `moduleKey`/`action` string pair is added anywhere —
that would have duplicated `Permission.key` with a second, uncontrolled representation of the
same fact.

**New models:**
- `AccessPackage` — stable identity only: `id`, `name`, `description`, `createdAt`. Never joined
  at authorization-check time.
- `AccessPackageVersion` — `accessPackageVersionId` PK, `accessPackageId` FK, `versionNumber Int`,
  `createdById` FK, `createdAt`, `publishedAt` (nullable while draft). **Immutable after
  publication**: a `BEFORE UPDATE/DELETE` trigger rejects any change once `publishedAt IS NOT
  NULL` — the same conditional-immutability pattern already proven for `QualityHold`'s
  release-fact lock in Phase 0A-R1 (lock activates on a state transition, not from row creation).
  A draft version (`publishedAt IS NULL`) may be freely edited/deleted before publication.
- `AccessPackagePermissionTemplate` — `accessPackageVersionId` FK, `permissionId` FK,
  `scopeKind` (§2), `siteId`/`teamId` nullable per the same scope-consistency CHECK as
  `UserPermissionGrant`. Template rows for module/record permissions.
- `AccessPackageDocumentClassificationTemplate` — `accessPackageVersionId` FK, `classification`
  (§7's enum), `action` (`DocumentGrantAction`, §7). Template rows for document-classification
  defaults — added here because §7 removes the ordinal "clearance ceiling" a package could
  previously grant in one field; a package now templates explicit `(classification, action)`
  pairs instead, materializing into real `DocumentPermissionGrant`/`DocumentPermissionGrantAction`
  rows exactly like the module-permission templates do.
- `UserAccessPackageAssignment` — `userId` FK, `accessPackageVersionId` FK, `assignedById` FK,
  `reason`, `validFrom`, `validTo` nullable, `revokedAt` nullable, `revokedById` nullable,
  `createdAt`.

**Materialization and provenance.** Assigning a package version is a first-class event
(`UserAccessPackageAssignment` row), not a template read. It writes one `UserPermissionGrant` row
per `AccessPackagePermissionTemplate` row and one `DocumentPermissionGrant` (+
`DocumentPermissionGrantAction`) row per `AccessPackageDocumentClassificationTemplate` row, each
carrying `sourceAssignmentId` (a real FK to the `UserAccessPackageAssignment` that produced it —
not a loose pointer at the mutable template).

**Revocation scope.** Revoking one `UserAccessPackageAssignment` must revoke only the grants it
sourced. This is enforced, not merely conventional: a `BEFORE UPDATE` trigger on
`UserAccessPackageAssignment` — when `revokedAt` transitions from NULL to non-NULL — cascades
`revokedAt`/`revokedById` onto every `UserPermissionGrant` and `DocumentPermissionGrant` row whose
`sourceAssignmentId` matches, in the same statement. Grants from a *different* assignment (or
created ad-hoc, with `sourceAssignmentId IS NULL`) are untouched. This is a legitimate
cross-row-effect trigger, the same class of mechanism already used for the SafetyEvent
document-supersession check in Phase 0A-R1.

**Role/UserRole/RolePermission.** Stays fully separate — no non-drifting provenance design is
attempted here, and none is needed for R2A. `UserRole`/`RolePermission` (Decision 4, Phase 0A) is
an independent, pre-existing, **unscoped** authority path: it predates row-scope entirely and was
never designed to carry it. `UserPermissionGrant` is a second, independent, **scoped** authority
path. Both are checked in the effective-authorization algorithm (§2) as alternatives — a
permission is granted if *either* path yields it — rather than one being silently folded into or
deprecated by the other. Whether `Role`/`UserRole` should eventually be retired in favor of
package-only grants is a genuine Phase 0B+ product decision, not resolved here, and not needed to
be resolved for R2A's schema to be internally consistent.

---

## 2. Corrected ASSIGNED row-scope semantics

**Corrected `UserPermissionGrant` scope shape.** Two typed FK columns only: `siteId`, `teamId`.
`projectId`/`jobcardId` are removed entirely from this table — specific project/jobcard
authorization is never a property of a general grant; it flows exclusively through the existing
typed assignment tables from Decision 9 (`SupervisorProjectAssignment`,
`SupervisorJobcardAssignment`, `JobcardWorker`, `JobcardOperation.assignedUserId`).

`scopeKind{OWN,ASSIGNED,TEAM,SITE,COMPANY}` with a CHECK constraint:
- `OWN` / `ASSIGNED` / `COMPANY` ⇒ `siteId IS NULL AND teamId IS NULL`.
- `TEAM` ⇒ `teamId IS NOT NULL AND siteId IS NULL`.
- `SITE` ⇒ `siteId IS NOT NULL AND teamId IS NULL`.

No `scopeType`/`scopeId` polymorphic column exists anywhere in this design.

**What each scope kind means, precisely:**
- `OWN` — records where the target record's own designated "owner" field (module-specific, e.g.
  `Estimation.ownerId`) equals the authenticated user.
- `ASSIGNED` — records dynamically reachable through an approved typed assignment table for the
  authenticated user (`JobcardWorker`, `JobcardOperation.assignedUserId`,
  `SupervisorProjectAssignment`, `SupervisorJobcardAssignment`, and any future table of the same
  kind) — computed at query time by joining against those tables, never by a static FK stored on
  the grant.
- `TEAM` — the record's owning Team (resolved per-module — e.g. via the record's Project/Jobcard
  → Site → Team path, or a direct Team link where one exists) equals `grant.teamId`, **and** the
  requesting user currently holds an active `TeamMembership` in that team (defense in depth: the
  grant names a team, but the user must also currently belong to it).
- `SITE` — the record's Site equals `grant.siteId`.
- `COMPANY` — always passes.

**Effective-authorization algorithm** (server-computed, every request):
1. `User.approvalStatus = ACTIVE`. Otherwise deny immediately — this single check is also why a
   `SUSPENDED` user's retained historical grant rows are inert (§3): nothing downstream of this
   step is ever reached for a non-`ACTIVE` user.
2. The user holds the required `Permission` through an approved authority path: **either** (a) an
   active `UserRole` → `RolePermission` chain naming this `Permission.key` (unscoped — treated as
   `COMPANY` scope by definition, matching how Role/Permission has always behaved since Decision
   4, since no row-scope concept was ever attached to it), **or** (b) a currently-valid
   (`validFrom ≤ now ≤ validTo` or `validTo IS NULL`), non-revoked `UserPermissionGrant` naming
   this `Permission.key` (this path also supplies the scope used in step 3).
3. The requested record passes server-computed row scope per whichever grant(s) yielded the
   permission in step 2 (the five scope-kind rules above; the unscoped Role path is `COMPANY` and
   always passes this step).
4. For document operations specifically: the request must **additionally** pass document
   action/classification policy (§7) — module/record permission and document permission are two
   independent checks, both required, never substitutable for each other.
5. If the matching grant carries `requiresTrustedDevice` and/or `requiresMfa`
   (with an optional `stepUpMaxAgeSeconds` freshness window), the corresponding trusted-device
   (§11) and/or step-up MFA (§5) evidence must be present and current.
6. Otherwise: deny. Default-deny, no exceptions.

---

## 3. Database protection for pending users

**Triggers rejecting creation for `PENDING_APPROVAL`/`REJECTED` users**, each a `BEFORE INSERT`
trigger on the target table that looks up `NEW.userId`'s `User.approvalStatus` and raises an
exception if it is `PENDING_APPROVAL` or `REJECTED`:
- `UserRole`
- `UserPermissionGrant`
- `DocumentPermissionGrant`

**`UserSession` gets a broader trigger** — `BEFORE INSERT`, rejecting `PENDING_APPROVAL`,
`REJECTED`, **and** `SUSPENDED` (three states, not two) — matching the explicit requirement that
new sessions must be rejected for suspended users too, distinct from the three grant-adjacent
tables above (a `SUSPENDED` user's *existing* rows are retained, and an administrator may still
need to adjust their grants in preparation for reinstatement without that implying they can log
in).

**Activation requires `emailVerifiedAt`.** Same-row CHECK constraint on `User` — both columns
live on the same table, so this is directly CHECK-expressible, no trigger needed:
`CHECK (approvalStatus <> 'ACTIVE' OR emailVerifiedAt IS NOT NULL)`. A row cannot be `ACTIVE`
without a non-null `emailVerifiedAt`, enforced unconditionally at the database layer.

**`SUSPENDED` users:**
- Historical `UserRole`/`UserPermissionGrant`/`DocumentPermissionGrant` rows are **not** deleted
  or revoked by suspension itself — they remain as a factual record.
- They become unusable purely as a consequence of algorithm step 1 (§2): a non-`ACTIVE` user never
  reaches the grant-checking steps at all. No separate "mark grants unusable" mechanism is needed
  or added.
- Revoking active sessions on suspension is a Phase 0B **service-layer transaction** (flip
  `approvalStatus` to `SUSPENDED` and set `revokedAt` on every active `UserSession` for that user,
  atomically) — not a database trigger, since "suspend a user" is an application-initiated,
  multi-row operation, not a fact derivable from a single row's own state transition.
- New sessions are rejected by the `UserSession` trigger above.

**Database-enforced vs. Phase 0B tests — explicit split for this section:**
- *Database-enforced (R2A):* the `CHECK` rejects setting `approvalStatus='ACTIVE'` with a null
  `emailVerifiedAt`; the four triggers reject row creation for the disallowed states.
- *Phase 0B only:* that a suspension request actually revokes sessions transactionally; that the
  AuthGuard actually refuses a request carrying a suspended user's still-valid-looking session
  token.

---

## 4. Registration and email verification

**Corrected lifecycle** (replaces the ambiguous `requestedByEmail`-or-`requestedByUserId` design):
1. Registration creates a `User` row immediately, `approvalStatus = PENDING_APPROVAL`,
   `emailVerifiedAt = NULL`. There is no pre-account, email-only intermediate state.
2. `EmailVerificationToken` (new): `userId` FK (required — always a real, already-existing User),
   `tokenHash` (never the raw token), `expiresAt`, `consumedAt` nullable, `createdAt`. One-time
   use: consuming the token (service layer, one transaction) sets `consumedAt` on the token and
   `emailVerifiedAt` on the User together.
3. `AccessRequest.userId` is a **required** FK to that same real, already-existing `PENDING_APPROVAL`
   User — never an email string, never an either/or. `AccessRequest` records "this pending user is
   requesting access," full stop; it does not itself create or represent the user.
4. Admin approval is one transaction: `UPDATE User SET approvalStatus='ACTIVE'` (rejected by the
   §3 CHECK if `emailVerifiedAt` is still null — real enforcement, not merely a process step) +
   create the `UserAccessPackageAssignment` and its materialized grants (§1) +
   `UPDATE AccessRequest SET status='APPROVED', decidedById=..., decidedAt=now()`.

**Status/timestamp consistency constraints:**
- `AccessRequest`: `CHECK (status <> 'APPROVED' OR (decidedById IS NOT NULL AND decidedAt IS NOT
  NULL))` and `CHECK (status <> 'PENDING' OR (decidedById IS NULL AND decidedAt IS NULL))`.
- `UserInvitation`: gains `acceptedAt` (nullable — not present in the prior draft, needed for this
  check): `CHECK (status <> 'ACCEPTED' OR acceptedAt IS NOT NULL)`.
- `EmailVerificationToken`: self-consistent via the single `consumedAt` nullable timestamp; no
  separate status enum needed.
- `UserSession`: `CHECK (revokedAt IS NULL OR revokedAt >= createdAt)` — a basic temporal sanity
  constraint alongside the state-rejection trigger in §3.

---

## 5. Corrected MFA storage

A TOTP secret must be **reversible by the server** (it re-derives the expected code from the
secret at verification time) — a one-way hash cannot serve this purpose at all. Corrected design:

- `MfaEnrollment` — `userId` FK, `method{TOTP,WEBAUTHN}`, `status{ACTIVE,REVOKED}`, `revokedAt`
  nullable, `createdAt`.
- `MfaTotpCredential` (only for `method=TOTP`) — `mfaEnrollmentId` FK, `encryptedSecret` (bytes,
  encrypted via an application-managed key/KMS — never plaintext, never a one-way hash),
  `encryptionKeyVersion` (supports key rotation without invalidating existing enrollments),
  `createdAt`.
- `MfaWebAuthnCredential` (only for `method=WEBAUTHN`) — `mfaEnrollmentId` FK, `credentialId`,
  `publicKey` (bytes — genuinely safe to store in the clear; this is the point of public-key
  crypto, no secret is ever held server-side for this method), `signCount`, `attestationFormat`,
  `createdAt`.
- `MfaRecoveryCode` — `userId` FK, `codeHash` (one-way hash is *correct* here — a recovery code is
  a single-use bearer secret compared like a password, never re-derived), `usedAt` nullable,
  `createdAt`.

**MFA requirement, two independent levers:**
- `User.mfaRequired Boolean` — an administrator can mandate MFA for a specific user regardless of
  what they're doing.
- `UserPermissionGrant.requiresMfa Boolean` / `DocumentPermissionGrant.requiresMfa Boolean`, each
  with an optional `stepUpMaxAgeSeconds Int` — a specific sensitive grant can demand a *fresh*
  MFA check (verified within the last N seconds), not merely "MFA was done at some point this
  session."

**Absolute rule, restated:** plaintext is never stored for MFA secrets, invitation tokens, refresh
tokens, or document-open tokens (§8) — every one of these is hash-only or KMS-encrypted-only,
consistently, across this entire contract.

---

## 6. Reliable transactional outbox

`OutboxEvent`, corrected: `aggregateType`, `aggregateId`, `eventType`, `payload` (Json),
`idempotencyKey` (**unique** — the same logical event can never be enqueued twice, even if the
triggering service call is accidentally retried), `status{PENDING,PROCESSING,SENT,FAILED,
DEAD_LETTER}`, `attemptCount Int default 0`, `nextAttemptAt` (nullable, for backoff scheduling),
`lockedAt`/`lockedBy` (nullable — lets multiple dispatcher instances claim rows without
double-processing, a standard job-queue claim pattern), `processedAt` nullable, `lastError`
(nullable text), `createdAt`.

Note explicitly: unlike every append-only table elsewhere in this contract, `OutboxEvent` is
**intentionally mutable** (`status`/`attemptCount`/`lockedAt` all change over a row's life) — it
is a job queue, not an audit trail, and must not be built on the insert-only trigger pattern used
for SafetyEvent/AuditLog/DocumentAccessEvent/etc.

Dispatcher implementation (the process that reads `PENDING`/due-`nextAttemptAt` rows, sends the
actual email, and marks them `SENT` or backs off with `FAILED`+`nextAttemptAt`) is explicitly
Phase 0B+ — this section is schema only, sized to make a retry-safe, dedup-safe dispatcher
possible, not to build one.

---

## 7. Corrected document authorization and row-scope intersection

**The ordinal "clearance ceiling" is removed entirely.** `INTERNAL < CONFIDENTIAL < RESTRICTED <
NDA_LEGAL < SAFETY_CRITICAL` is not a safe linear ladder — a grant covering "up to RESTRICTED"
cannot correctly imply anything about NDA_LEGAL or SAFETY_CRITICAL, which carry qualitatively
different handling requirements (immutability, §9), not just "more" sensitivity. There is no
`documentClearance` field anywhere in this design. Access is always an explicit
`(documentId OR classification, action)` grant — never a numeric ceiling standing in for one.

**Final `DocumentPermissionGrant` shape:**
- `userId` FK (required, always a real user — never ambiguous, per the original correction).
- Exactly one of `documentId` (FK — a specific document version) or `classification` (enum — a
  classification-wide default) populated; CHECK-enforced.
- Actions via the normalized child table `DocumentPermissionGrantAction(grantId, action)`,
  `unique(grantId, action)`, `action` drawn from `DocumentGrantAction{VIEW_METADATA,PREVIEW,
  NATIVE_OPEN,DOWNLOAD,EDIT,NEW_VERSION,PRINT,SHARE,APPROVE,ARCHIVE,MANAGE_ACCESS}`.
- When `classification` is populated: `scopeKind{TEAM,SITE,COMPANY}` + matching `teamId`/`siteId`
  (same exactly-one-consistent-with-scopeKind CHECK as §2's module grants) — this is what
  prevents a classification grant from silently exposing every document of that classification
  company-wide. A document's Team/Site context for this check is resolved through its existing
  link tables (`DocumentProject`/`DocumentJobcard`/etc. → `Project.siteId`/`Jobcard.siteId`), not
  a direct field on `Document` itself. When `documentId` is populated instead, no scope columns
  are used — naming one exact document is already maximally specific.
- `sourceAssignmentId` nullable FK (§1) and/or `sourceAccessRequestId` nullable FK — provenance;
  an ad-hoc admin grant has neither.
- `validFrom`, `validTo` nullable, `grantedById`, `revokedAt`/`revokedById` nullable, `reason`.
- `requiresTrustedDevice Boolean`, `requiresMfa Boolean`, `stepUpMaxAgeSeconds` nullable (§5).

**Document access requires BOTH checks, always** — restated from §2 step 4: (a) ordinary
module/record permission on whatever the document is linked to, under current row scope, **and**
(b) a matching `DocumentPermissionGrant` action/classification grant. Neither substitutes for the
other.

---

## 8. Document derivatives and open tokens — one resolved design

**Chosen resolution: derivatives are immutable `Document` rows, not a separate model.** The prior
draft's `DocumentDerivative` as a standalone table is retired — it would have forced every
document-access table (`DocumentPermissionGrant`, `DocumentOpenToken`, `DocumentAccessEvent`) to
carry a second, parallel "or a derivative" target, doubling every exactly-one CHECK in this
contract for no structural benefit, since a derivative is, semantically, just another file with
its own storage/checksum/scan lifecycle — exactly what `Document` already models, with its
version-chain machinery already built and proven in Phase 0A-R1.

`Document` gains: `derivedFromDocumentId` (nullable self-FK — distinct from `previousVersionId`,
which means *supersedes*; this one means *was generated from*, e.g. a watermarked preview
generated from the original) and `derivativeKind` (nullable enum: null = an original file,
`WATERMARKED_PREVIEW` / `REDACTED_COPY` otherwise). A derivative goes through the identical
`uploadLifecycleStatus` clean-scan discipline as any other Document row.

**Consequence:** `DocumentPermissionGrant.documentId`, `DocumentOpenToken.documentId`, and
`DocumentAccessEvent`'s target are all just `documentId` — one FK, one column, everywhere. No dual
target type exists in this design at all.

**Final `DocumentOpenToken` shape:** `tokenHash` only (never the raw bearer value — same
discipline as every other token in this contract), `userId` FK, `documentId` FK (the exact
immutable version or derivative — both are Document rows), `action{OPEN,DOWNLOAD}`, `expiresAt`,
`consumedAt` nullable, `revokedAt` nullable, `trustedDeviceId` nullable FK, `stepUpVerifiedAt`
nullable (records *when* the fresh MFA check for this specific token happened, compared against
the authorizing grant's `stepUpMaxAgeSeconds`).

---

## 9. Immutable sensitive documents — restored

For `NDA_LEGAL` and `SAFETY_CRITICAL` documents, once `uploadLifecycleStatus = CLEAN` (and, where
the workflow requires it, `status = APPROVED`), the file's protected identity/content fields
become locked: `storageKey`, `checksum`, `classification`. A `BEFORE UPDATE` trigger on `Document`
rejects any change to these three columns once `OLD.classification IN ('NDA_LEGAL',
'SAFETY_CRITICAL') AND OLD.uploadLifecycleStatus = 'CLEAN'` — the same conditional-lock pattern as
`AccessPackageVersion` (§1) and `QualityHold`'s release-fact lock (Phase 0A-R1). This trivially
also satisfies "classification cannot be silently downgraded," since classification cannot change
*at all* once locked — the strictest reading, not merely a one-directional guard.

**The trigger explicitly permits exactly one further change on a locked row:** `supersededAt`
transitioning from `NULL` to a real timestamp. This is deliberate — supersession is the one
legitimate fact that must still be recordable on an otherwise-locked row, and it does not violate
the row's own immutability (the file content/identity never changes; only a "this has been
superseded" marker is added). Everything else stays rejected. A correction always creates a new
`Document` row via `previousVersionId` (existing pattern, unchanged); the old row's `supersededAt`
is set in the same transaction as the new row's insert.

Older versions of a document remain reachable only according to whatever `DocumentPermissionGrant`
rows apply to that specific `documentId` — no separate mechanism is needed, since access is always
per-version already (§7).

**Required negative database tests (added to R2A-3's scope, §13):**
- A locked document's `storageKey`/`checksum`/`classification` cannot be changed.
- A locked document's `supersededAt` *can* still be set (the one permitted transition).
- A non-`CLEAN` or non-`NDA_LEGAL`/`SAFETY_CRITICAL` document is unaffected by the lock (positive
  control).

---

## 10. DocumentAccessEvent completeness

Revised to record **both allowed and denied** attempts (the prior draft implicitly only covered
successful access): `documentId` FK, `userId` FK, `action` (`DocumentGrantAction`, reused),
`result{ALLOWED,DENIED}`, `denialReasonCode` nullable (e.g. `NO_GRANT`, `EXPIRED`,
`CLASSIFICATION_MISMATCH`, `DEVICE_UNTRUSTED`, `MFA_REQUIRED`), `tokenId` nullable FK →
`DocumentOpenToken`, `trustedDeviceId` nullable FK, `correlationId` (ties to the platform
foundation's request/correlation-ID work), `occurredAt`. Insert-only — the same `BEFORE UPDATE/
DELETE`-rejecting trigger pattern as `SafetyEvent`/`QualityRelease`/`AuditLog`.

---

## 11. Trusted-device evidence

Split into a stable-identity table and an append-only evidence log — consistent with this
contract's general preference for pairing a mutable current-state row with an immutable event
trail:

- `TrustedDevice` — `userId` FK, `deviceIdentifier` (stable — a hardware-backed key thumbprint or
  platform device identifier), `providerSubject` (the identity the attestation provider assigns to
  this device), `status{ACTIVE,REVOKED}`, `trustExpiresAt`, `lastSeenAt`, `revokedAt` nullable,
  `revokedById` nullable, `createdAt`.
- `DeviceAttestation` (append-only) — `trustedDeviceId` FK, `attestationProvider`
  (provider-neutral string, e.g. `"entra-id"` — no vendor is hardcoded, matching Decision 4 of the
  gap analysis), `evidenceHash` (a hash/reference to the attestation evidence — never the raw
  evidence or a secret), `attestedAt`, `createdAt`. Insert-only trigger, same pattern as
  `DocumentAccessEvent`.

Raw attestation secrets are never stored anywhere in this design — only `evidenceHash`.

---

## 12. Corrected R2A acceptance criteria

**This document does not claim runtime default-deny is proven by a schema-only phase.** The split
below is explicit and final for R2A:

**Provable by R2A database tests:**
- Field/target/scope consistency (every exactly-one/scope-kind CHECK in this contract).
- Append-only behavior (`DocumentAccessEvent`, `DeviceAttestation`, and the carried-over
  `SafetyEvent`/`QualityRelease`/`AuditLog` triggers).
- Token uniqueness (`tokenHash`/`idempotencyKey` unique constraints).
- Immutable protected records (§9's conditional lock, including that `supersededAt` remains
  settable).
- Pending/rejected-user grant and session rejection — **because** a DB trigger is implemented for
  it in this contract (§3), not merely asserted.
- Lifecycle timestamp consistency (§4's status-implies-timestamp CHECKs).

**Provable only by future Phase 0B service/e2e tests, not here:**
- HTTP 401/403 behavior.
- AuthGuard default-deny against live traffic.
- Real, current row-scope enforcement (the dynamic `ASSIGNED`/`TEAM`/`SITE` joins actually
  filtering query results correctly for a live request).
- Session rejection at the middleware layer.
- Step-up MFA challenge flow.
- Trusted-device enforcement against a live request.
- Suspension's transactional session revocation actually executing.

---

## 13. R2A split into bounded implementation passes

Each sub-pass is its own commit, its own migration, its own verification battery, and its own
independent-review stop — none proceeds until the previous one is reviewed and approved, exactly
as every prior Phase 0A-R1 pass and the R2 design documents have been gated.

### R2A-1 — User lifecycle, verification, sessions, MFA, Notification, Outbox

**Exact models & fields:** `User` (+ `approvalStatus`, + `emailVerifiedAt`, + `mfaRequired`, minus
`active` as an independent column — per the original gap-analysis correction);
`EmailVerificationToken`; `AccessRequest` (+ required `userId` FK, replacing the ambiguous
either/or); `UserInvitation` (+ `acceptedAt`); `UserSession`; `MfaEnrollment`;
`MfaTotpCredential`; `MfaWebAuthnCredential`; `MfaRecoveryCode`; `Notification`; `OutboxEvent`.

**Exact enums:** `UserApprovalStatus{PENDING_APPROVAL,ACTIVE,SUSPENDED,REJECTED}`,
`AccessRequestStatus{PENDING,APPROVED,REJECTED,EXPIRED}`,
`InvitationStatus{PENDING,ACCEPTED,EXPIRED,REVOKED}`, `MfaMethod{TOTP,WEBAUTHN}`,
`MfaEnrollmentStatus{ACTIVE,REVOKED}`, `OutboxEventStatus{PENDING,PROCESSING,SENT,FAILED,
DEAD_LETTER}`.

**FK & delete behaviour:** `onDelete: Restrict` throughout, consistent with the whole schema.

**CHECK constraints:** `User`: `approvalStatus='ACTIVE' ⇒ emailVerifiedAt IS NOT NULL`.
`AccessRequest`: status-implies-decidedBy/decidedAt (both directions). `UserInvitation`:
`status='ACCEPTED' ⇒ acceptedAt IS NOT NULL`. `UserSession`:
`revokedAt IS NULL OR revokedAt >= createdAt`.

**Unique / partial indexes:** `EmailVerificationToken.tokenHash`, `UserSession.refreshTokenHash`,
`UserInvitation.tokenHash`, `OutboxEvent.idempotencyKey`.

**Triggers:** `UserSession` `BEFORE INSERT` — reject `PENDING_APPROVAL`/`REJECTED`/`SUSPENDED`.

**Database tests:** activation blocked without `emailVerifiedAt` (CHECK violation); session
creation rejected for each of the three disallowed states (trigger, one test per state);
`idempotencyKey` uniqueness rejects a duplicate; every status-implies-timestamp CHECK rejects its
inconsistent case.

**Future Phase 0B tests:** real registration → verify → request → approve flow end-to-end; real
login issuing a session; real MFA enrollment/challenge; outbox dispatcher retry/backoff/dedup
behavior against a live queue.

**Dependencies:** none beyond the current, approved Phase 0A-R1 schema.

**Exact files expected to change:** `backend/prisma/schema.prisma`,
`backend/prisma/migrations/<ts>_init/migration.sql` (one evolved migration, consistent with every
prior pass), `backend/test/database-constraints.integration-spec.ts`, `backend/README.md`.

**Parent commit:** `backend-foundation` HEAD at the time R2A-1 begins (currently
`9cdd8f3ec4167e33b94dd85340d1c46829a5ad87`; will be re-verified immediately before any
implementation work starts, per the same pre-implementation discipline used for every prior pass).

**Go/no-go criteria:** all database tests above pass on two independently-created fresh
PostgreSQL databases plus an idempotent second `migrate deploy`; full lint/build/unit/e2e/
production-packaging-audit battery; independent review sign-off before R2A-2 begins.

### R2A-2 — Permission FK grants, access-package versions/assignments, corrected row scope

**Exact models & fields:** `AccessPackage`; `AccessPackageVersion`;
`AccessPackagePermissionTemplate`; `AccessPackageDocumentClassificationTemplate`;
`UserAccessPackageAssignment`; `UserPermissionGrant` (`permissionId` FK, `scopeKind`, `siteId`/
`teamId` only, `sourceAssignmentId`, `requiresMfa`, `stepUpMaxAgeSeconds`,
`requiresTrustedDevice`, `validFrom`/`validTo`/`revokedAt`/`revokedById`/`grantedById`/`reason`).

**Exact enums:** `GrantScopeKind{OWN,ASSIGNED,TEAM,SITE,COMPANY}`.

**FK & delete behaviour:** Restrict throughout.

**CHECK constraints:** `UserPermissionGrant` scope-kind-vs-FK consistency (§2's three-way rule);
`revokedAt`/`revokedById` set together or neither.

**Triggers:** `AccessPackageVersion` conditional immutability-after-publication;
`UserAccessPackageAssignment` revocation cascade onto sourced grants (§1);
`UserPermissionGrant`/`UserRole` `BEFORE INSERT` — reject `PENDING_APPROVAL`/`REJECTED` (§3,
implemented here since `UserPermissionGrant` is introduced in this pass).

**Database tests:** malformed scope-kind/FK combinations rejected (one test per invalid
combination); revoking an assignment cascades only to its own sourced grants, verified against a
second, untouched assignment's grants; a published `AccessPackageVersion` rejects UPDATE/DELETE; a
draft version accepts edits; grant creation rejected for a pending/rejected user.

**Future Phase 0B tests:** the full effective-authorization algorithm (§2) end-to-end, both the
Role-path and Grant-path branches; `ASSIGNED`-scope dynamic-join correctness verified per module
against real assignment-table data.

**Dependencies:** requires R2A-1 (real `User.approvalStatus`, real actor FKs for
`grantedById`/`assignedById`).

**Exact files expected to change:** same pattern as R2A-1.

**Parent commit:** R2A-1's own final, reviewed commit.

**Go/no-go criteria:** same bar as R2A-1, plus independent review before R2A-3 begins.

### R2A-3 — Document classification, grants, access requests/events, trusted devices

**Exact models & fields:** `Document` (+ `classification`, + `uploadLifecycleStatus`, +
`derivedFromDocumentId`, + `derivativeKind`); `DocumentPermissionGrant`;
`DocumentPermissionGrantAction`; `DocumentAccessRequest`; `DocumentAccessRequestAction`;
`DocumentAccessEvent`; `DocumentOpenToken`; `DocumentCheckout`; `TrustedDevice`;
`DeviceAttestation`.

**Exact enums:** `DocumentClassification{INTERNAL,CONFIDENTIAL,RESTRICTED,NDA_LEGAL,
SAFETY_CRITICAL}`, `DocumentGrantAction` (the eleven, §7), `DocumentAccessRequestStatus{PENDING,
APPROVED,REJECTED,EXPIRED,REVOKED}`, `UploadLifecycleStatus{UPLOADING,QUARANTINED,SCANNING,CLEAN,
REJECTED}`, `DocumentOpenTokenAction{OPEN,DOWNLOAD}`, `TrustedDeviceStatus{ACTIVE,REVOKED}`.

**FK & delete behaviour:** Restrict throughout; `DocumentOpenToken.documentId` is a single FK
(§8's resolved design — no dual target anywhere).

**CHECK constraints:** `DocumentPermissionGrant` exactly-one(`documentId`, `classification`);
`DocumentPermissionGrant` classification-scope-kind-vs-FK consistency (§7); `Document`
`previousVersionId`/`derivedFromDocumentId` self-reference guards (one-hop, per the existing
Document precedent).

**Triggers:** `DocumentAccessEvent` append-only; `Document` classification-lock (§9, permitting
only the `supersededAt` transition); `DocumentOpenToken` issuance requires
`Document.uploadLifecycleStatus = CLEAN` (cross-row, `BEFORE INSERT`); `DocumentPermissionGrant`/
`DocumentAccessRequest` `BEFORE INSERT` — reject grantee in `PENDING_APPROVAL`/`REJECTED`;
`DeviceAttestation` append-only.

**Database tests:** a locked `NDA_LEGAL`/`SAFETY_CRITICAL` `CLEAN` document rejects
storageKey/checksum/classification changes; the same document accepts a `supersededAt` transition;
a non-`CLEAN` document cannot have a `DocumentOpenToken` issued; `DocumentAccessEvent` records both
`ALLOWED` and `DENIED` rows and rejects UPDATE/DELETE; the exactly-one CHECK rejects both-populated
and neither-populated grants; a grant for a pending/rejected user is rejected.

**Future Phase 0B tests:** real classification+row-scope intersection enforcement against a live
request; real trusted-device/step-up enforcement; the real native-open/download token issuance and
consumption flow, including the Desktop Launcher handoff.

**Dependencies:** requires R2A-1 and R2A-2 (document grants reference real Users, real
Permissions, real assignments).

**Exact files expected to change:** same pattern as R2A-1/R2A-2.

**Parent commit:** R2A-2's own final, reviewed commit.

**Go/no-go criteria:** same bar as R2A-1/R2A-2. After R2A-3's independent review sign-off, R2A as
a whole is considered complete and ready for the next explicitly-authorized phase (R2B) — not
before.

---

## Exact Git state confirmation

- Branch: `backend-foundation` — unaffected by this document. HEAD:
  `9cdd8f3ec4167e33b94dd85340d1c46829a5ad87` (unchanged).
- `origin/main`: `6dc9de2a827d2902f5d14870ab8dc1560174832b` (unchanged, never merged into).
- This document is committed only to `r2-design-review`, as a **new** commit on top of the
  existing `bd11f6c490ff7f6e591ca268f3e485a26583af38` (the prior design commit is not amended).
- No `schema.prisma`, migration, application code, test, or package file is touched by this
  commit.
- R2A, R2B, R2C, M14, M15, and Phase 0B implementation were not started.
