# Phase 0A-R2A Implementation Contract

Design-only. This revision corrects eight further issues found on independent review of the prior
contract (commit `c17839c5bc0fca4616f83ebeb0e77f24578d3fdb`) — most critically, an algorithm error
that would have let a Worker/Supervisor role silently reach company-wide row access, violating
Decision 9. This document fully replaces the prior contract's content; nothing below should be
read as a diff against it.

**Branch:** `r2-design-review` (this document only; `backend-foundation`/`main` untouched)
**Parent for this analysis:** `backend-foundation` @ `9cdd8f3ec4167e33b94dd85340d1c46829a5ad87`
**Prior commits on this branch:** `bd11f6c490ff7f6e591ca268f3e485a26583af38`,
`c17839c5bc0fca4616f83ebeb0e77f24578d3fdb` (neither amended by this revision)

---

## 0. What this revision corrects

1. **CRITICAL** — the effective-authorization algorithm no longer treats `RolePermission` as
   implicit `COMPANY` scope. Row scope is now always separately, mandatorily resolved regardless
   of which path established permission eligibility.
2. Published-package immutability now covers the template child rows, not only the version
   header.
3. The R2A-2 → R2A-3 forward reference is removed: `AccessPackageDocumentClassificationTemplate`
   moves to R2A-3, alongside the model it targets.
4. Every R2A-1 model now has a complete, final field inventory — types, nullability, defaults,
   FKs, unique constraints, indexes, and lifecycle CHECKs.
5. MFA relational integrity (one TOTP credential per TOTP enrollment, many WebAuthn credentials
   with globally-unique IDs, no cross-method references) is now specified with real constraints.
6. The migration-strategy contradiction is resolved: one strategy, stated once, referenced
   everywhere.
7. Document-security edge cases (multi-linked documents, unlinked documents, derivative
   inheritance, provenance mutual exclusivity, a real cryptographic device identifier) are now
   each resolved with one explicit rule.
8. Acceptance-criteria test lists are expanded to cover every new constraint introduced by this
   revision.

---

## 1. CRITICAL — the corrected effective-authorization algorithm

**The error being corrected:** the prior contract said an unscoped `UserRole → RolePermission`
match should be "treated as `COMPANY` scope by definition." This is wrong and is withdrawn — it
would give any user whose Role includes a given Permission full company-wide row access to every
record that permission touches, the instant that Role is assigned, with no Decision-9 assignment
fact required at all. For a Workshop Worker or Supervisor role, that is a direct violation of
Decision 9's row-scope model.

**The fix separates two questions that were previously conflated:** *is this action in the user's
toolkit at all* (permission **eligibility**) is a different question from *which rows can they use
it on* (row **scope**), and the two must never be resolved by the same fact. `RolePermission` may
answer the first question. It never, by itself, answers the second.

### Corrected algorithm

1. `User.approvalStatus = ACTIVE`. Otherwise deny immediately.
2. **Permission eligibility.** The user is eligible for `Permission.key` if *either* (a) an active
   `UserRole → RolePermission` chain names it, *or* (b) a currently-valid, non-revoked
   `UserPermissionGrant` names it. If neither, deny — no scope check is even attempted.
3. **Row-scope resolution — mandatory, and independent of which path in step 2 supplied
   eligibility.** Compute the set of scope facts that apply to this user for this permission/
   module as the **union** of:
   - Every currently-valid, non-revoked `UserPermissionGrant` naming this permission, contributing
     its own `scopeKind` (`OWN`, `ASSIGNED`, `TEAM`+`teamId`, `SITE`+`siteId`, or `COMPANY`).
     **`COMPANY` is contributed *only* by an explicit `UserPermissionGrant` row with
     `scopeKind='COMPANY'` — never inferred from Role membership, and never inferred from
     unioning smaller scopes.**
   - The Decision-9 native assignment facts, **always** additionally consulted regardless of which
     path supplied eligibility: active `TeamMembership` rows (→ `TEAM` scope for that team);
     `SupervisorSiteAssignment` / `SupervisorTeamAssignment` / `SupervisorProjectAssignment` /
     `SupervisorJobcardAssignment` rows (→ `SITE` / `TEAM` / `ASSIGNED`-project /
     `ASSIGNED`-jobcard scope respectively); `JobcardWorker` / `JobcardOperation.assignedUserId`
     rows (→ `ASSIGNED` scope). This is exactly how a Workshop Worker or Supervisor's access is
     computed, and it applies whether their permission eligibility came from a Role or a grant —
     there is no separate "Role users get one algorithm, grant users get another."
   - **If this union is empty — no scope-granting fact exists at all for this user and this
     permission — deny, even though step 2 passed.** This is the specific fix: a Role granting
     eligibility with zero accompanying Decision-9 assignment facts and zero accompanying
     `UserPermissionGrant` now yields access to *no* rows, not every row.
   - Multiple roles and multiple grants each contribute their own scope fact to the same union —
     "multi-role results union allowed scopes" — but since `COMPANY` is only ever contributed by
     one specific, explicit grant row, no combination of smaller scopes (however many) can ever
     produce it by accident.
4. The requested record must match **at least one** scope fact from the step-3 union: `OWN` ⇒
   the record's owner field equals the user; `ASSIGNED` ⇒ the record is reachable through one of
   the listed assignment tables for this user; `TEAM` ⇒ the record's team is among the `TEAM`
   facts; `SITE` ⇒ the record's site is among the `SITE` facts; `COMPANY` ⇒ always matches, for any
   record, once contributed.
5. Document operations additionally require the document action/classification check (§6) —
   independent of, and required in addition to, steps 2–4.
6. If the winning grant(s) carry `requiresTrustedDevice` and/or `requiresMfa` (with an optional
   `stepUpMaxAgeSeconds` freshness window), the corresponding evidence (§4 of the prior contract's
   MFA design, §6 below for documents) must be present and current.
7. Otherwise: deny. Default-deny, no exceptions, in every branch above.

**This is the complete, final algorithm design for R2A** — not a placeholder and not deferred to a
Phase 0B product decision. What remains for Phase 0B is exclusively *executing* this
already-fully-specified algorithm against live HTTP requests (the AuthGuard implementation),
never *designing* it.

`RolePermission` retains a real, legitimate purpose under this design: a coarse "is this action
available to this role at all" gate, useful for UI feature-flagging and administrative bulk
assignment — but it is now structurally incapable of granting row access on its own, in every
case, for every role, without exception.

---

## 2. Published package immutability, including contents

**The gap being closed:** locking `AccessPackageVersion` alone left its child template rows
(`AccessPackagePermissionTemplate`, and — as of §3's split —
`AccessPackageDocumentClassificationTemplate`) freely insertable/editable/deletable after the
parent was marked published, silently changing what a "published, immutable" version actually
grants.

**Fix — per-child-table triggers, cross-row lookup to the parent:**

```sql
CREATE FUNCTION access_package_template_immutable() RETURNS TRIGGER AS $$
DECLARE parent_published_at timestamptz;
BEGIN
  SELECT "publishedAt" INTO parent_published_at
  FROM "AccessPackageVersion"
  WHERE "id" = COALESCE(NEW."accessPackageVersionId", OLD."accessPackageVersionId");

  IF parent_published_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot modify template rows of a published AccessPackageVersion (id=%)',
      COALESCE(NEW."accessPackageVersionId", OLD."accessPackageVersionId");
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
```

Attached as `BEFORE INSERT OR UPDATE OR DELETE` on `AccessPackagePermissionTemplate` in R2A-2, and
(per §3) additionally on `AccessPackageDocumentClassificationTemplate` when it is introduced in
R2A-3, reusing this same function.

**Additional constraints specified for `AccessPackageVersion`:**
- `@@unique([accessPackageId, versionNumber])` — no two versions of one package may share a
  version number.
- Publication lifecycle: `publishedAt` transitions exactly once, `NULL → non-NULL` (enforced by
  the existing conditional-immutability trigger from the prior contract, which already rejects any
  further change once `publishedAt IS NOT NULL` — this includes re-nulling it). Whether
  `versionNumber` values must be *gapless and sequential* per package is explicitly **not**
  database-enforced — that is a service-layer numbering concern, not a correctness invariant the
  database needs to guarantee; only *uniqueness* is a real invariant, and that is CHECK/unique
  enforced.

**`UserAccessPackageAssignment` consistency (restated precisely as CHECK constraints):**
- `CHECK ("revokedAt" IS NULL) = ("revokedById" IS NULL)` — together or neither.
- `CHECK ("revokedAt" IS NULL OR "revokedAt" >= "createdAt")`.
- `CHECK ("validTo" IS NULL OR "validTo" >= "validFrom")`.

**Source-assignment provenance constraint (`UserPermissionGrant`):** `sourceAssignmentId` is the
grant's only provenance field (unlike `DocumentPermissionGrant`, which has two — see §6's
mutual-exclusivity rule); no additional constraint is needed beyond the existing plain nullable FK.

---

## 3. R2A-2 / R2A-3 split corrected — no forward references

**The error being corrected:** the prior contract placed
`AccessPackageDocumentClassificationTemplate` in R2A-2 and described it materializing/revoking
`DocumentPermissionGrant` rows — but `DocumentPermissionGrant` is not introduced until R2A-3. No
migration or trigger may reference a table that does not yet exist at that point in the sequence.

**Fix:**
- **R2A-2** introduces `AccessPackagePermissionTemplate` and `UserPermissionGrant` only, for
  module/record permissions. Its assignment-revocation-cascade trigger touches
  **`UserPermissionGrant` alone** — it has nothing else to cascade to yet.
- **R2A-3** introduces `AccessPackageDocumentClassificationTemplate` alongside
  `DocumentPermissionGrant` (the model it targets), and **replaces** the R2A-2 cascade trigger
  function (`CREATE OR REPLACE FUNCTION`, same function name, same trigger object — no drop/
  recreate of the trigger itself is needed) so that its body additionally cascades revocation onto
  `DocumentPermissionGrant` rows sharing the same `sourceAssignmentId`. From R2A-3 onward, one
  `UserAccessPackageAssignment` revocation correctly cascades to both grant kinds it may have
  sourced; before R2A-3, it could only ever have sourced the one kind that existed.

**Materialization vs. revocation — which is database-enforced:** the *revocation cascade* is
database-enforced (a trigger, specified above) because it is simple, deterministic, and
safety-critical enough to warrant that guarantee regardless of which service code path triggers
it. **Materialization — reading an `AccessPackageVersion`'s template rows and writing the
resulting `UserPermissionGrant`/`DocumentPermissionGrant` rows when a package is first assigned —
is Phase 0B service-layer logic, not a database function, in this contract.** No database function
performing materialization is included or tested here; if a future revision chooses to add one, it
must be explicitly specified and tested as such, not silently assumed.

---

## 4. R2A-1 models — complete, implementation-exact field inventory

General rules applied uniformly across every model below unless stated otherwise: UUID primary
keys via `gen_random_uuid()`; `onDelete: Restrict` on every FK; every `*At` timestamp pair gets a
"later-than-creation" CHECK; every terminal/decided status gets a "status implies exactly these
fields are/aren't populated" CHECK, in both directions.

### `User` (extends the existing, already-approved Phase 0A-R1 model)

| Field | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | Uuid | no | `gen_random_uuid()` | existing |
| email | VarChar(254) | no | — | existing; case-insensitive unique index, unchanged |
| passwordHash | VarChar(255) | no | — | existing |
| fullName | VarChar(200) | no | — | existing |
| ~~active~~ | — | — | — | **removed** — superseded by `approvalStatus` |
| approvalStatus | UserApprovalStatus | no | `PENDING_APPROVAL` | new |
| emailVerifiedAt | Timestamptz | yes | — | new |
| mfaRequired | Boolean | no | `false` | new |
| createdAt | Timestamptz | no | `now()` | existing |
| updatedAt | Timestamptz | no | auto | existing |

CHECK: `"approvalStatus" <> 'ACTIVE' OR "emailVerifiedAt" IS NOT NULL`.
Index: `@@index([approvalStatus])`.

### `EmailVerificationToken`

| Field | Type | Nullable | Default |
|---|---|---|---|
| id | Uuid | no | `gen_random_uuid()` |
| userId | Uuid (FK → User) | no | — |
| tokenHash | VarChar(255) | no | — |
| expiresAt | Timestamptz | no | — |
| consumedAt | Timestamptz | yes | — |
| createdAt | Timestamptz | no | `now()` |

Unique: `tokenHash`. CHECK: `"expiresAt" > "createdAt"`;
`"consumedAt" IS NULL OR "consumedAt" >= "createdAt"`. Index: `@@index([userId])`.

### `AccessRequest`

| Field | Type | Nullable | Default |
|---|---|---|---|
| id | Uuid | no | `gen_random_uuid()` |
| userId | Uuid (FK → User) | no | — |
| justification | VarChar(1000) | no | — |
| status | AccessRequestStatus | no | `PENDING` |
| decidedById | Uuid (FK → User) | yes | — |
| decidedAt | Timestamptz | yes | — |
| createdAt | Timestamptz | no | `now()` |

CHECK: `"status" = 'PENDING' OR "status" = 'EXPIRED' OR ("decidedById" IS NOT NULL AND "decidedAt"
IS NOT NULL)` (APPROVED **and** REJECTED both require a decision actor and time — the prior
contract only stated this for APPROVED; corrected here). CHECK: `"status" NOT IN ('PENDING',
'EXPIRED') OR ("decidedById" IS NULL AND "decidedAt" IS NULL)` (PENDING and EXPIRED both have no
decision fields — EXPIRED means the request timed out with no decision ever made). CHECK:
`"decidedAt" IS NULL OR "decidedAt" >= "createdAt"`. Index: `@@index([userId])`,
`@@index([status])`.

### `UserInvitation`

| Field | Type | Nullable | Default |
|---|---|---|---|
| id | Uuid | no | `gen_random_uuid()` |
| invitedEmail | VarChar(254) | no | — |
| invitedById | Uuid (FK → User) | no | — |
| tokenHash | VarChar(255) | no | — |
| status | InvitationStatus | no | `PENDING` |
| expiresAt | Timestamptz | no | — |
| acceptedAt | Timestamptz | yes | — |
| revokedAt | Timestamptz | yes | — |
| revokedById | Uuid (FK → User) | yes | — |
| createdAt | Timestamptz | no | `now()` |

Unique: `tokenHash`. CHECK: `"expiresAt" > "createdAt"`. CHECK: `"status" = 'ACCEPTED' =
("acceptedAt" IS NOT NULL)` (bidirectional). CHECK: `"status" = 'REVOKED' = ("revokedAt" IS NOT
NULL AND "revokedById" IS NOT NULL)`. CHECK: `"status" IN ('PENDING','EXPIRED') = ("acceptedAt" IS
NULL AND "revokedAt" IS NULL)`. CHECK: `NOT ("acceptedAt" IS NOT NULL AND "revokedAt" IS NOT
NULL)` (mutually exclusive terminal outcomes). CHECK: `"acceptedAt" IS NULL OR "acceptedAt" >=
"createdAt"`. CHECK: `"revokedAt" IS NULL OR "revokedAt" >= "createdAt"`. Index:
`@@index([invitedEmail])`, `@@index([status])`.

### `UserSession`

| Field | Type | Nullable | Default |
|---|---|---|---|
| id | Uuid | no | `gen_random_uuid()` |
| userId | Uuid (FK → User) | no | — |
| refreshTokenHash | VarChar(255) | no | — |
| userAgent | VarChar(500) | yes | — |
| ipAddressHash | VarChar(255) | yes | — |
| expiresAt | Timestamptz | no | — |
| revokedAt | Timestamptz | yes | — |
| revokedById | Uuid (FK → User) | yes | — |
| createdAt | Timestamptz | no | `now()` |

Unique: `refreshTokenHash`. CHECK: `"expiresAt" > "createdAt"`; `"revokedAt" IS NULL OR
"revokedAt" >= "createdAt"`. **Deliberate deviation from the together-or-neither pattern used
elsewhere:** `revokedById` is *not* required whenever `revokedAt` is set — a session may be
auto-revoked by an automated process (e.g. anomaly detection, or a cascading suspension performed
under a service identity rather than one specific admin) with no individual human actor to record;
`revokedById`, when present, is best-effort attribution, not a completeness guarantee. This is
stated explicitly as an intentional exception, not an oversight, and applies to this table only —
every grant-revocation elsewhere in this contract (always administrator-initiated) keeps the
strict together-or-neither rule. Index: `@@index([userId])`, `@@index([expiresAt])`.

### `MfaEnrollment`

| Field | Type | Nullable | Default |
|---|---|---|---|
| id | Uuid | no | `gen_random_uuid()` |
| userId | Uuid (FK → User) | no | — |
| method | MfaMethod | no | — |
| status | MfaEnrollmentStatus | no | `ACTIVE` |
| revokedAt | Timestamptz | yes | — |
| revokedById | Uuid (FK → User) | yes | — |
| createdAt | Timestamptz | no | `now()` |

CHECK: `"status" = 'REVOKED' = ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL)`. CHECK:
`"revokedAt" IS NULL OR "revokedAt" >= "createdAt"`. Index: `@@index([userId, method])`.

### `MfaTotpCredential` — §5 relational-integrity detail below

| Field | Type | Nullable | Default |
|---|---|---|---|
| id | Uuid | no | `gen_random_uuid()` |
| mfaEnrollmentId | Uuid (FK → MfaEnrollment) | no | — |
| encryptedSecret | Bytes | no | — |
| encryptionKeyVersion | VarChar(50) | no | — |
| createdAt | Timestamptz | no | `now()` |

Unique: `mfaEnrollmentId` (exactly one TOTP credential per TOTP enrollment — see §5). CHECK:
`octet_length("encryptedSecret") > 0`. CHECK: `length(btrim("encryptionKeyVersion")) > 0`.

### `MfaWebAuthnCredential`

| Field | Type | Nullable | Default |
|---|---|---|---|
| id | Uuid | no | `gen_random_uuid()` |
| mfaEnrollmentId | Uuid (FK → MfaEnrollment) | no | — |
| credentialId | VarChar(500) | no | — |
| publicKey | Bytes | no | — |
| signCount | BigInt | no | `0` |
| attestationFormat | VarChar(100) | yes | — |
| createdAt | Timestamptz | no | `now()` |

Unique: `credentialId` (globally, across all users — see §5). CHECK: `octet_length("publicKey") >
0`. Index: `@@index([mfaEnrollmentId])`.

### `MfaRecoveryCode`

| Field | Type | Nullable | Default |
|---|---|---|---|
| id | Uuid | no | `gen_random_uuid()` |
| userId | Uuid (FK → User) | no | — |
| codeHash | VarChar(255) | no | — |
| usedAt | Timestamptz | yes | — |
| createdAt | Timestamptz | no | `now()` |

Unique: `codeHash`. CHECK: `"usedAt" IS NULL OR "usedAt" >= "createdAt"`. Index:
`@@index([userId])`. **Explicit limitation:** the database guarantees `codeHash` uniqueness and
that `usedAt` is a real, queryable fact, but it does not by itself prevent a race between two
concurrent redemption attempts of the same still-unused code — that requires a service-layer
transaction with row locking (`SELECT ... FOR UPDATE`) at verification time. Stated here rather
than implied as fully database-enforced.

### `Notification`

| Field | Type | Nullable | Default |
|---|---|---|---|
| id | Uuid | no | `gen_random_uuid()` |
| recipientUserId | Uuid (FK → User) | no | — |
| kind | VarChar(100) | no | — |
| payload | Json | no | `'{}'` |
| readAt | Timestamptz | yes | — |
| createdAt | Timestamptz | no | `now()` |

CHECK: `jsonb_typeof("payload") = 'object'` (same JSON-shape discipline as the R2 gap analysis).
CHECK: `"readAt" IS NULL OR "readAt" >= "createdAt"`. Index: `@@index([recipientUserId,
readAt])`.

### `OutboxEvent`

| Field | Type | Nullable | Default |
|---|---|---|---|
| id | Uuid | no | `gen_random_uuid()` |
| aggregateType | VarChar(100) | no | — |
| aggregateId | Uuid | no | — |
| eventType | VarChar(150) | no | — |
| payload | Json | no | — |
| idempotencyKey | VarChar(255) | no | — |
| status | OutboxEventStatus | no | `PENDING` |
| attemptCount | Int | no | `0` |
| nextAttemptAt | Timestamptz | yes | — |
| lockedAt | Timestamptz | yes | — |
| lockedBy | VarChar(200) | yes | — |
| processedAt | Timestamptz | yes | — |
| lastError | VarChar(2000) | yes | — |
| createdAt | Timestamptz | no | `now()` |

`aggregateType`/`aggregateId` are a label-only pair, deliberately reusing the same
explicitly-accepted polymorphic-label exception already approved for `AuditLog.entityType`/
`entityId` in Phase 0A-R1 — never a join, never an authorization input, generic by design since
Outbox spans every aggregate type in the system. `lockedBy` identifies a dispatcher *process*
instance, not a `User` — no FK. Unique: `idempotencyKey`. CHECK: `jsonb_typeof("payload") =
'object'`. CHECK: `"attemptCount" >= 0`. CHECK: `"status" = 'SENT' = ("processedAt" IS NOT
NULL)`. CHECK: `"status" = 'PENDING' OR "processedAt" IS NOT NULL OR "status" <> 'SENT'`
(equivalent restated: `status='PENDING' ⇒ processedAt IS NULL`). CHECK: `"processedAt" IS NULL OR
"processedAt" >= "createdAt"`. CHECK: `"lockedAt" IS NULL OR "lockedAt" >= "createdAt"`. Index:
`@@index([status, nextAttemptAt])`.

### Enums (R2A-1, final)

`UserApprovalStatus{PENDING_APPROVAL,ACTIVE,SUSPENDED,REJECTED}` ·
`AccessRequestStatus{PENDING,APPROVED,REJECTED,EXPIRED}` ·
`InvitationStatus{PENDING,ACCEPTED,EXPIRED,REVOKED}` · `MfaMethod{TOTP,WEBAUTHN}` ·
`MfaEnrollmentStatus{ACTIVE,REVOKED}` ·
`OutboxEventStatus{PENDING,PROCESSING,SENT,FAILED,DEAD_LETTER}`.

---

## 5. MFA relational integrity

- **One TOTP credential per TOTP enrollment:** `MfaTotpCredential.mfaEnrollmentId` is `@unique` — a
  plain unique constraint makes a second row for the same enrollment impossible.
- **Many WebAuthn credentials per WebAuthn enrollment, globally unique credential IDs:**
  `MfaWebAuthnCredential.mfaEnrollmentId` is a plain (non-unique) FK — many rows allowed;
  `credentialId` is `@unique` **globally** (not scoped per-enrollment), matching how WebAuthn
  credential IDs are actually meant to be unique across the whole system.
- **No cross-method references:** a `BEFORE INSERT` trigger on each of `MfaTotpCredential` and
  `MfaWebAuthnCredential` looks up the referenced `MfaEnrollment.method` and rejects the insert if
  it does not match (`MfaTotpCredential` requires `method = 'TOTP'`; `MfaWebAuthnCredential`
  requires `method = 'WEBAUTHN'`) — a cross-row check, hence a trigger rather than a CHECK.
- **Enrollment status/revokedAt consistency:** covered in §4's `MfaEnrollment` CHECK.
- **Recovery-code hash uniqueness/use-consistency:** covered in §4's `MfaRecoveryCode` spec,
  including the explicit note on what remains a service-layer concurrency concern.
- **`stepUpMaxAgeSeconds` positivity:** `UserPermissionGrant`/`DocumentPermissionGrant` CHECK:
  `"stepUpMaxAgeSeconds" IS NULL OR "stepUpMaxAgeSeconds" > 0`.
- **`encryptedSecret`/`encryptionKeyVersion` required and non-empty:** covered in §4's
  `MfaTotpCredential` CHECK (`octet_length > 0`, `length(btrim(...)) > 0`).
- **No plaintext secret anywhere:** `encryptedSecret` is KMS-encrypted bytes (§5 of the prior
  contract, unchanged); `MfaRecoveryCode.codeHash`, every `*tokenHash`/`refreshTokenHash` field in
  this contract, and `DocumentOpenToken.tokenHash` (§6) are all one-way hashes; `publicKey`
  (WebAuthn) is genuinely non-secret by design and is the one credential field correctly stored in
  the clear.

Negative database tests for all of the above are enumerated in §8, folded into R2A-1's test list.

---

## 6. Document-security edge semantics — resolved

**Provenance mutual exclusivity (`DocumentPermissionGrant`):**
`CHECK (NOT ("sourceAssignmentId" IS NOT NULL AND "sourceAccessRequestId" IS NOT NULL))` — at most
one of the two populated; both null means an audited ad-hoc administrator grant (still fully
attributed via `grantedById`/`reason`, just not sourced from a package assignment or an access
request).

**Validity/revocation consistency (`DocumentPermissionGrant`, restated as exact CHECKs, matching
§2's pattern for `UserAccessPackageAssignment`):** `("revokedAt" IS NULL) = ("revokedById" IS
NULL)`; `"revokedAt" IS NULL OR "revokedAt" >= "createdAt"`; `"validTo" IS NULL OR "validTo" >=
"validFrom"`.

**Documents linked to multiple records/sites/teams.** A document-access request is always
evaluated **in the context of one specific linked record** the requester names (e.g. "documents
for Project A"), and the §1 row-scope check runs against *that* record only. Passing the check for
one linked record never grants blanket access to the document merely because it happens to *also*
be linked to some other record the same document is attached to — each linked-record context is
checked independently. **When a request has no stated linked-record context at all** (a direct
`documentId` lookup), the system must resolve and check the row-scope policy against **every**
record the document is linked to, and deny by default unless **all** of them pass — a document is
never treated as generally accessible on the strength of a partial match.

**Unlinked documents.** A document with no rows in any `Document*` link table (`DocumentProject`,
`DocumentJobcard`, `DocumentCustomer`, etc.) has no linked-record row-scope check to run at all —
it can only ever be reached through a `documentId`-targeted `DocumentPermissionGrant`. A
classification-wide grant cannot authorize access to an unlinked document, since §1 step 5's
module/record permission check has no target to evaluate and correctly fails closed.

**Derivative inheritance — one explicit rule, chosen:** a derivative does **not** automatically
inherit grants from its source document via `derivedFromDocumentId`. There is no cascading
inheritance relation at all. What *does* apply uniformly is that a derivative is created with the
**same `classification`** as its source (a watermarked copy of a RESTRICTED document is still
RESTRICTED) — so a classification-wide grant that already covers that classification+scope
combination applies to the derivative exactly as it would to any other `Document` row of that
classification, simply because the derivative *is* a `Document` row. A grant scoped to the
source's specific `documentId`, however, does **not** extend to the derivative's own, different
`documentId` — it would need its own explicit grant.

**`DocumentOpenToken` — complete consistency:** gains an explicit `createdAt Timestamptz @default
(now())` (present in spirit before, not stated as a field). Unique: `tokenHash`. CHECK:
`"expiresAt" > "createdAt"`; `"consumedAt" IS NULL OR "consumedAt" >= "createdAt"`; `"revokedAt"
IS NULL OR "revokedAt" >= "createdAt"`; `NOT ("consumedAt" IS NOT NULL AND "revokedAt" IS NOT
NULL)` (mutually exclusive terminal states — a token that was successfully consumed cannot also be
separately revoked, and vice versa).

**`TrustedDevice` — a real cryptographic identifier, not a generic string.** The prior contract's
`deviceIdentifier` is replaced with `deviceKeyThumbprint VarChar(128)` — the SHA-256 (or
equivalent) thumbprint of the device's public key or platform certificate, `@unique` (globally —
two distinct devices should never collide), `CHECK (length("deviceKeyThumbprint") = 64)` (fixed
hex-encoded SHA-256 length; adjust the literal length if a different digest is chosen, but the
principle — a fixed-length, non-empty, verifiable hex string, not a free-text label — is the
requirement). All other fields from the prior contract's `TrustedDevice`/`DeviceAttestation`
design (`providerSubject`, `status`, `trustExpiresAt`, `lastSeenAt`, `revokedAt`/`revokedById`,
and the append-only `DeviceAttestation` evidence log with `evidenceHash`) are unchanged.

---

## 7. Migration strategy — one statement, stated once

**The contradiction being corrected:** the prior contract simultaneously said each sub-pass "has
its own migration" and that each evolves "the single `<timestamp>_init/migration.sql`" — those
cannot both be literally true as separate, cumulative migration files.

**The one strategy, matching exactly how every Phase 0A-R1 pass and both prior R2 design documents
were actually produced:** because `backend-foundation` remains unmerged and undeployed, **every
R2A sub-pass continues to evolve the same single initial migration file** — there is no second or
third migration file. Each sub-pass is still its own commit and its own independent-review stop;
what changes between sub-passes is the *schema.prisma* content and the regenerated migration SQL
appended to it, not the number of migration files. Only once the backend is actually deployed does
this project switch to genuinely additive, cumulative migrations — not before, and not within
R2A. This is the one and only migration statement in this contract; every sub-pass section below
references it rather than restating it.

---

## 8. Corrected R2A-1 / R2A-2 / R2A-3 sub-passes

### R2A-1 — User lifecycle, verification, sessions, MFA, Notification, Outbox

**Exact models & fields:** exactly the eleven models specified in full in §4, with the enums
listed there.

**FK & delete behaviour:** `onDelete: Restrict` throughout.

**CHECK constraints, unique/partial indexes, triggers:** exactly as specified per-model in §4 and
per-integrity-rule in §5 (MFA method-matching triggers).

**Migration implications:** per §7, one strategy — this evolves the single initial migration.
Removing `User.active` remains the one backward-incompatible change to an already-approved model.

**Database-enforceable acceptance tests (expanded per item 8 of this review):**
- `User` cannot become `ACTIVE` with a null `emailVerifiedAt` (CHECK).
- `UserSession` insert is rejected for `PENDING_APPROVAL`, `REJECTED`, and `SUSPENDED` users —
  three separate tests, one per state (trigger).
- `EmailVerificationToken`: `expiresAt <= createdAt` rejected; `consumedAt < createdAt` rejected;
  duplicate `tokenHash` rejected.
- `AccessRequest`: `APPROVED`/`REJECTED` without `decidedById`+`decidedAt` rejected; `PENDING`/
  `EXPIRED` *with* a decision actor/time rejected; `decidedAt < createdAt` rejected.
- `UserInvitation`: `ACCEPTED` without `acceptedAt` rejected; `REVOKED` without
  `revokedAt`+`revokedById` rejected; both `acceptedAt` and `revokedAt` set simultaneously
  rejected; each temporal-ordering CHECK rejected individually; duplicate `tokenHash` rejected.
- `UserSession`: `expiresAt <= createdAt` rejected; `revokedAt < createdAt` rejected; duplicate
  `refreshTokenHash` rejected.
- `MfaEnrollment`: `REVOKED` without `revokedAt`+`revokedById` rejected.
- `MfaTotpCredential`: a second row for the same `mfaEnrollmentId` rejected (unique); insert
  against a `WEBAUTHN`-method enrollment rejected (trigger); empty `encryptedSecret` rejected;
  empty `encryptionKeyVersion` rejected.
- `MfaWebAuthnCredential`: insert against a `TOTP`-method enrollment rejected (trigger); a second
  row with a duplicate `credentialId` (even under a different enrollment) rejected (global
  unique); empty `publicKey` rejected. A *second* WebAuthn credential for the *same* enrollment
  with a *different* `credentialId` **succeeds** (positive control proving the "many allowed"
  half of the rule).
- `MfaRecoveryCode`: duplicate `codeHash` rejected; `usedAt < createdAt` rejected.
- `UserPermissionGrant`/`DocumentPermissionGrant`: `stepUpMaxAgeSeconds <= 0` rejected (this test
  is deferred to R2A-2/R2A-3 respectively, where those tables are introduced, but the constraint
  itself is specified once here in §5).
- `Notification`: non-object `payload` rejected; `readAt < createdAt` rejected.
- `OutboxEvent`: duplicate `idempotencyKey` rejected; non-object `payload` rejected; negative
  `attemptCount` rejected; `status='SENT'` without `processedAt` rejected; `processedAt <
  createdAt` rejected.

**Future Phase 0B tests:** real registration → verify → request → approve flow end-to-end; real
login issuing a session; real MFA enrollment/challenge against both TOTP and WebAuthn; outbox
dispatcher retry/backoff/dedup behavior against a live queue.

**Dependencies:** none beyond the current, approved Phase 0A-R1 schema.

**Exact files expected to change:** `backend/prisma/schema.prisma`, the single evolved
`backend/prisma/migrations/<ts>_init/migration.sql` (§7), `backend/test/database-constraints.
integration-spec.ts`, `backend/README.md`.

**Parent commit:** `backend-foundation` HEAD, re-verified immediately before implementation begins
(currently `9cdd8f3ec4167e33b94dd85340d1c46829a5ad87`).

**Go/no-go criteria:** every test above passes on two independently-created fresh PostgreSQL
databases plus an idempotent second `migrate deploy`; full lint/build/unit/e2e/
production-packaging-audit battery; independent review sign-off before R2A-2 begins.

### R2A-2 — Permission FK grants, access-package versions/assignments, corrected row scope

**Exact models & fields:** `AccessPackage`; `AccessPackageVersion` (+ `@@unique([accessPackageId,
versionNumber])`, §2); `AccessPackagePermissionTemplate` (module/record permission templates
**only** — `AccessPackageDocumentClassificationTemplate` moved to R2A-3, §3);
`UserAccessPackageAssignment` (+ the three CHECK constraints from §2); `UserPermissionGrant`
(`permissionId` FK — §1 of the prior contract, unchanged; `scopeKind`; `siteId`/`teamId` only;
`sourceAssignmentId`; `requiresMfa`; `stepUpMaxAgeSeconds` with the `> 0` CHECK from §5;
`requiresTrustedDevice`; `validFrom`/`validTo`/`revokedAt`/`revokedById`/`grantedById`/`reason`).

**Exact enums:** `GrantScopeKind{OWN,ASSIGNED,TEAM,SITE,COMPANY}`.

**FK & delete behaviour:** Restrict throughout.

**CHECK constraints:** `UserPermissionGrant` scope-kind-vs-FK consistency (three-way rule,
unchanged from the prior contract); `stepUpMaxAgeSeconds > 0` when present; `revokedAt`/
`revokedById` together or neither.

**Triggers:** `AccessPackageVersion` conditional immutability-after-publication (unchanged);
`AccessPackagePermissionTemplate` published-parent lock (§2, new); `UserAccessPackageAssignment`
revocation cascade — **`UserPermissionGrant` only** at this stage (§3); `UserPermissionGrant`/
`UserRole` `BEFORE INSERT` reject `PENDING_APPROVAL`/`REJECTED`.

**Database tests:** malformed scope-kind/FK combinations rejected (one test per invalid
combination); `stepUpMaxAgeSeconds <= 0` rejected; revoking an assignment cascades only to its own
sourced `UserPermissionGrant` rows, verified against a second, untouched assignment's grants; a
published `AccessPackageVersion` rejects UPDATE/DELETE; its published child template rows also
reject INSERT/UPDATE/DELETE (§2, new test); a draft version and its (still-draft) template rows
accept edits; grant creation rejected for a pending/rejected user; duplicate `(accessPackageId,
versionNumber)` rejected.

**Future Phase 0B tests:** the full corrected effective-authorization algorithm (§1) end-to-end,
including the specific regression case this revision exists to prevent — a user whose *only*
authority path is a Role containing a given permission, with zero Decision-9 assignment facts and
zero `UserPermissionGrant` rows, must be denied access to every record, not granted access to all
of them.

**Dependencies:** requires R2A-1.

**Exact files expected to change:** per §7's one migration strategy — same evolved
`schema.prisma`/migration.sql, extended integration-spec.ts, README.md additions.

**Parent commit:** R2A-1's own final, reviewed commit.

**Go/no-go criteria:** same bar as R2A-1, plus independent review before R2A-3 begins.

### R2A-3 — Document classification, grants, access requests/events, trusted devices

**Exact models & fields:** `Document` (+ `classification`, `uploadLifecycleStatus`,
`derivedFromDocumentId`, `derivativeKind`); `AccessPackageDocumentClassificationTemplate` (moved
here per §3); `DocumentPermissionGrant` (+ the provenance-mutual-exclusivity and validity/
revocation CHECKs from §6); `DocumentPermissionGrantAction`; `DocumentAccessRequest`;
`DocumentAccessRequestAction`; `DocumentAccessEvent`; `DocumentOpenToken` (+ `createdAt` and the
consistency CHECKs from §6); `DocumentCheckout`; `TrustedDevice` (with `deviceKeyThumbprint` per
§6); `DeviceAttestation`.

**Exact enums:** `DocumentClassification{INTERNAL,CONFIDENTIAL,RESTRICTED,NDA_LEGAL,
SAFETY_CRITICAL}`, `DocumentGrantAction` (the eleven, unchanged), `DocumentAccessRequestStatus`,
`UploadLifecycleStatus`, `DocumentOpenTokenAction`, `TrustedDeviceStatus`.

**FK & delete behaviour:** Restrict throughout; `DocumentOpenToken.documentId` single FK
(unchanged, §8 of the prior contract).

**CHECK constraints:** `DocumentPermissionGrant` exactly-one(`documentId`,`classification`);
provenance mutual exclusivity (§6); validity/revocation consistency (§6); classification-scope-
kind-vs-FK consistency; `stepUpMaxAgeSeconds > 0` when present; `Document`
`previousVersionId`/`derivedFromDocumentId` one-hop self-reference guards; `TrustedDevice.
deviceKeyThumbprint` fixed-length CHECK (§6); `DocumentOpenToken` full consistency set (§6).

**Triggers:** `DocumentAccessEvent` append-only (now recording both `ALLOWED` and `DENIED`, §10 of
the prior contract, unchanged); `Document` classification-lock permitting only the `supersededAt`
transition (unchanged); `DocumentOpenToken` issuance requires `uploadLifecycleStatus = CLEAN`
(cross-row, unchanged); `DocumentPermissionGrant`/`DocumentAccessRequest` `BEFORE INSERT` reject a
grantee in `PENDING_APPROVAL`/`REJECTED`; `DeviceAttestation` append-only;
`AccessPackageDocumentClassificationTemplate` published-parent lock (§2's pattern, reused); the
`UserAccessPackageAssignment` revocation-cascade function **replaced** (`CREATE OR REPLACE`, same
function/trigger) to additionally cascade onto `DocumentPermissionGrant` (§3).

**Database tests:** every test listed in the prior contract's §9/§10/§11 test lists (locked-
document field rejection with `supersededAt` still permitted; token-issuance-requires-CLEAN;
`DocumentAccessEvent` records both outcomes and rejects UPDATE/DELETE; grant exactly-one CHECK) —
**plus**, new for this revision: provenance mutual-exclusivity rejected when both source fields
are populated; `DocumentOpenToken`'s mutually-exclusive-terminal-state CHECK rejected when both
`consumedAt` and `revokedAt` are set; `TrustedDevice.deviceKeyThumbprint` wrong-length value
rejected; duplicate `deviceKeyThumbprint` across two different `TrustedDevice` rows rejected;
`AccessPackageDocumentClassificationTemplate` published-parent lock rejects INSERT/UPDATE/DELETE
once its version is published; the replaced revocation-cascade function correctly cascades to
*both* `UserPermissionGrant` and `DocumentPermissionGrant` rows sharing one `sourceAssignmentId`,
verified against a second, untouched assignment's rows of each kind.

**Future Phase 0B tests:** real classification+row-scope intersection enforcement against a live
request, including the multi-linked-document and unlinked-document rules from §6; real trusted-
device/step-up enforcement; the real native-open/download token issuance and consumption flow,
including the Desktop Launcher handoff; the derivative-inheritance rule from §6 verified against a
live request (classification-wide grant reaches a derivative; document-specific grant on the
source does not).

**Dependencies:** requires R2A-1 and R2A-2.

**Exact files expected to change:** per §7 — same evolved schema.prisma/migration.sql, extended
integration-spec.ts, README.md additions.

**Parent commit:** R2A-2's own final, reviewed commit.

**Go/no-go criteria:** same bar as R2A-1/R2A-2. After R2A-3's independent review sign-off, R2A as
a whole is complete and ready for the next explicitly-authorized phase — not before.

---

## 9. Internal-contradiction and forward-reference re-read

Performed against this revision specifically:
- §1's algorithm is referenced, not restated, everywhere else it matters (§8's R2A-2 future-tests
  entry) — no second, conflicting description of it exists in this document.
- §3's split is reflected consistently in §8: R2A-2's model list, trigger list, and test list all
  omit `AccessPackageDocumentClassificationTemplate`/`DocumentPermissionGrant`; R2A-3's model list
  introduces both together with the replaced trigger function that references them.
- §7's one migration statement is referenced (not restated) from all three sub-passes in §8.
- Every model introduced in §4/§6 appears in exactly one sub-pass's "exact models & fields" list
  in §8, with no model referenced by an earlier sub-pass's triggers/CHECKs before its own
  introduction.
- No open product decision remains that blocks starting R2A-1: §1's algorithm, §3's split, §6's
  derivative/multi-link/unlinked-document rules, and §7's migration strategy were the four
  previously-ambiguous points, and each now has exactly one stated design.

**No unresolved architecture decision remains that is required to start R2A-1.**

---

## Exact Git state confirmation

- Branch: `backend-foundation` — unaffected by this document. HEAD:
  `9cdd8f3ec4167e33b94dd85340d1c46829a5ad87` (unchanged).
- `origin/main`: `6dc9de2a827d2902f5d14870ab8dc1560174832b` (unchanged, never merged into).
- This document is committed only to `r2-design-review`, as a **new** commit on top of
  `c17839c5bc0fca4616f83ebeb0e77f24578d3fdb` (which is not amended); the branch's full history
  remains `9cdd8f3` → `bd11f6c` → `c17839c` → (this commit).
- No `schema.prisma`, migration, application code, test, or package file is touched by this
  commit.
- R2A-1, R2A-2, R2A-3, R2B, R2C, M14, M15, and Phase 0B implementation were not started.
