# Phase 0A-R2A Implementation Contract

Design-only. The prior revision (commit `20a814edd07fddd32c55eaad43a25981d46b63d5`) fixed the two
remaining MFA integrity bypasses, and the MFA architecture and trigger design themselves are now
approved. That revision's independent review found two of its R2A-1 acceptance-test *descriptions*
— not the triggers or schema they test — were internally impossible fixtures; this revision
corrects only those two test descriptions. No architecture, trigger, CHECK, or field changes from
any prior revision are touched.

**Branch:** `r2-design-review` (this document only; `backend-foundation`/`main` untouched)
**Parent for this analysis:** `backend-foundation` @ `9cdd8f3ec4167e33b94dd85340d1c46829a5ad87`
**Prior commits on this branch:** `bd11f6c490ff7f6e591ca268f3e485a26583af38`,
`c17839c5bc0fca4616f83ebeb0e77f24578d3fdb`, `626324b6b1c25da23591ada454e0f2d4c09b0457`,
`a963958503d91ac2dbef07f76c36d7b6ba2cd1ad`, `20a814edd07fddd32c55eaad43a25981d46b63d5`
(none amended by this revision)

---

## 0. What this revision corrects

**Two R2A-1 acceptance-test fixtures in §8, both internally impossible as previously written —
the underlying triggers and CHECKs they test are unchanged and approved:**

1. **The concurrency-test fixture** described connection A deleting a credential from an already
   `ACTIVE` enrollment while connection B concurrently performed `PENDING_SETUP → ACTIVE` on that
   *same* enrollment — impossible, since one row cannot be `ACTIVE` (per A's framing) and mid-
   `PENDING_SETUP → ACTIVE` (per B's framing) at once, and the delete-guard trigger would already
   unconditionally reject deleting a credential from a genuinely `ACTIVE` enrollment regardless of
   concurrency, leaving nothing for the two transactions to actually race over. Corrected to the
   only scenario both transactions can legitimately contend over — both starting from
   `PENDING_SETUP`, with commit and rollback variants for each of the two symmetric orderings — and
   restated correctly how `lock_timeout` may and may not be used to demonstrate blocking (a
   lock-timeout failure aborts that transaction; the same statement does not later resume on its
   own once the lock frees).
2. **The same-status revocation-immutability test** described an `ACTIVE → ACTIVE` update that
   changes a revocation field — impossible, since §4's state-shape CHECK already requires an
   `ACTIVE` row's `revokedAt`/`revokedById` to both be `NULL`, leaving nothing non-null to change
   in that scenario. Corrected to `REVOKED → REVOKED`, the only same-status case where the
   revocation fields are actually populated and therefore can be tested for immutability, with an
   `ACTIVE → ACTIVE` value-preserving update kept as the positive control.

**Everything else is carried forward unchanged:** the CRITICAL row-scope/eligibility decoupling
(§1); the corrected published-template trigger (§2); the R2A-2/R2A-3 split (§3); the lifecycle/
EXPIRED/document-link/token/`OutboxEvent` fixes (§4, §6); the full MFA trigger design — creation
constraint, transition guard, credential immutability, delete guards, locking protocol (§5); the
migration strategy (§7).

Both corrected fixtures have been re-checked against how PostgreSQL actually evaluates the
triggers and CHECKs they exercise, including the transaction-abort behavior of a `lock_timeout`
failure (§9 documents this).

---

## 1. CRITICAL — the effective-authorization algorithm (unchanged from the prior revision)

Carried forward verbatim; not touched by this revision's 7 items.

1. `User.approvalStatus = ACTIVE`. Otherwise deny immediately.
2. **Permission eligibility.** The user is eligible for `Permission.key` if *either* (a) an active
   `UserRole → RolePermission` chain names it, *or* (b) a currently-valid, non-revoked
   `UserPermissionGrant` names it. If neither, deny — no scope check is even attempted.
3. **Row-scope resolution — mandatory, and independent of which path in step 2 supplied
   eligibility.** Compute the set of scope facts that apply to this user for this permission/
   module as the **union** of: every currently-valid, non-revoked `UserPermissionGrant` naming
   this permission (contributing `OWN`/`ASSIGNED`/`TEAM`+`teamId`/`SITE`+`siteId`/`COMPANY` —
   `COMPANY` **only** from an explicit grant row, never inferred); plus the Decision-9 native
   assignment facts, **always** additionally consulted regardless of which path supplied
   eligibility (`TeamMembership` → `TEAM`; `SupervisorSiteAssignment` /
   `SupervisorTeamAssignment` / `SupervisorProjectAssignment` / `SupervisorJobcardAssignment` →
   `SITE`/`TEAM`/`ASSIGNED`-project/`ASSIGNED`-jobcard; `JobcardWorker` /
   `JobcardOperation.assignedUserId` → `ASSIGNED`). **If this union is empty, deny — even though
   step 2 passed.** A Role granting eligibility with zero accompanying scope facts yields access to
   *no* rows, not every row.
4. The requested record must match **at least one** scope fact from the step-3 union.
5. Document operations additionally require the document action/classification/link check (§6) —
   independent of, and required in addition to, steps 2–4.
6. If the winning grant(s) carry `requiresTrustedDevice` and/or `requiresMfa` (with an optional
   `stepUpMaxAgeSeconds` freshness window), the corresponding evidence must be present and
   current.
7. Otherwise: deny. Default-deny, no exceptions, in every branch above.

`RolePermission` retains a real, legitimate purpose: a coarse "is this action available to this
role at all" gate for UI feature-flagging and administrative bulk assignment — but it is
structurally incapable of granting row access on its own.

---

## 2. Published package immutability — corrected trigger (item 4 fix)

**The bug, exactly:** the prior trigger computed
`COALESCE(NEW."accessPackageVersionId", OLD."accessPackageVersionId")` and used that single value
to decide whether to block the write. On `UPDATE`, `COALESCE` always resolves to `NEW` (it is
never `NULL` on an `UPDATE`), so the trigger only ever checked whether the row's **new** parent
version was published. A template row belonging to a **published** version could be `UPDATE`d to
point `accessPackageVersionId` at a **draft** version instead — the trigger would look up the
draft's `publishedAt` (`NULL`), find nothing wrong, and allow it. The row silently leaves the
published version, changing what that "immutable, published" version actually grants, with no
error raised. The same asymmetry works in reverse: a draft row could be moved *into* a published
version's content without being caught either, if the check only looked at one side.

**The fix — check `OLD`'s parent on `UPDATE`/`DELETE` and `NEW`'s parent on `INSERT`/`UPDATE`,
independently, using `TG_OP`:**

```sql
CREATE FUNCTION access_package_template_immutable() RETURNS TRIGGER AS $$
DECLARE old_parent_published_at timestamptz;
DECLARE new_parent_published_at timestamptz;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "publishedAt" INTO old_parent_published_at
    FROM "AccessPackageVersion" WHERE "id" = OLD."accessPackageVersionId";
    IF old_parent_published_at IS NOT NULL THEN
      RAISE EXCEPTION
        'Cannot modify or remove a template row belonging to published AccessPackageVersion %',
        OLD."accessPackageVersionId";
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "publishedAt" INTO new_parent_published_at
    FROM "AccessPackageVersion" WHERE "id" = NEW."accessPackageVersionId";
    IF new_parent_published_at IS NOT NULL THEN
      RAISE EXCEPTION
        'Cannot insert or move a template row into published AccessPackageVersion %',
        NEW."accessPackageVersionId";
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
```

On an `UPDATE` that changes `accessPackageVersionId`, **both** branches now run: the row is
rejected if *either* its old parent was published (blocking "move out of a published version") or
its new parent is published (blocking "move into a published version"), closing both directions of
the bypass at once. On a plain `UPDATE` that leaves `accessPackageVersionId` unchanged, `OLD` and
`NEW` name the same parent, so both branches evaluate the same lookup — equivalent to the original
single-parent check, with no behavior change for that case.

Attached as `BEFORE INSERT OR UPDATE OR DELETE` on `AccessPackagePermissionTemplate` in R2A-2, and
(per §3) additionally on `AccessPackageDocumentClassificationTemplate` when introduced in R2A-3,
reusing this same function — unchanged from the prior revision's reuse pattern, only the function
body is corrected.

**Additional constraints on `AccessPackageVersion` (unchanged from the prior revision):**
`@@unique([accessPackageId, versionNumber])`; `publishedAt` transitions exactly once
(`NULL → non-NULL`, enforced by the pre-existing conditional-immutability trigger);
`versionNumber` gaplessness is explicitly a service-layer numbering concern, not a database
invariant — only uniqueness is enforced.

**`UserAccessPackageAssignment` consistency (unchanged — audited and confirmed safe, see §9):**
`CHECK (("revokedAt" IS NULL) = ("revokedById" IS NULL))`;
`CHECK ("revokedAt" IS NULL OR "revokedAt" >= "createdAt")`;
`CHECK ("validTo" IS NULL OR "validTo" >= "validFrom")`.

---

## 3. R2A-2 / R2A-3 split (unchanged from the prior revision)

Carried forward verbatim; not touched by this revision's 7 items.

- **R2A-2** introduces `AccessPackagePermissionTemplate` and `UserPermissionGrant` only. Its
  assignment-revocation-cascade trigger touches `UserPermissionGrant` alone.
- **R2A-3** introduces `AccessPackageDocumentClassificationTemplate` alongside
  `DocumentPermissionGrant`, and **replaces** the R2A-2 cascade trigger function
  (`CREATE OR REPLACE FUNCTION`, same function/trigger object) so its body additionally cascades
  onto `DocumentPermissionGrant` rows sharing the same `sourceAssignmentId`.
- Materialization (reading templates, writing grant rows) remains Phase 0B service-layer logic,
  not a database function; only the revocation cascade is database-enforced.

---

## 4. R2A-1 models — complete, corrected field inventory

General rules unchanged: UUID primary keys via `gen_random_uuid()`; `onDelete: Restrict` on every
FK; every `*At` timestamp pair gets a "later-than-creation" CHECK; every status/lifecycle field
gets an explicit, mutually exclusive, per-value state-shape CHECK — **never** a
`status = 'X' = (boolean expression)` equality (§9 explains exactly why that form is unsafe and
audits every CHECK in this document against it).

### `User` (unchanged from the prior revision)

| Field | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | Uuid | no | `gen_random_uuid()` | existing |
| email | VarChar(254) | no | — | existing; case-insensitive unique index |
| passwordHash | VarChar(255) | no | — | existing |
| fullName | VarChar(200) | no | — | existing |
| approvalStatus | UserApprovalStatus | no | `PENDING_APPROVAL` | new |
| emailVerifiedAt | Timestamptz | yes | — | new |
| mfaRequired | Boolean | no | `false` | new |
| createdAt | Timestamptz | no | `now()` | existing |
| updatedAt | Timestamptz | no | auto | existing |

CHECK: `"approvalStatus" <> 'ACTIVE' OR "emailVerifiedAt" IS NOT NULL`.
Index: `@@index([approvalStatus])`.

### `EmailVerificationToken` (one new CHECK — item 2)

| Field | Type | Nullable | Default |
|---|---|---|---|
| id | Uuid | no | `gen_random_uuid()` |
| userId | Uuid (FK → User) | no | — |
| tokenHash | VarChar(255) | no | — |
| expiresAt | Timestamptz | no | — |
| consumedAt | Timestamptz | yes | — |
| createdAt | Timestamptz | no | `now()` |

Unique: `tokenHash`. CHECK: `"expiresAt" > "createdAt"`. CHECK: `"consumedAt" IS NULL OR
"consumedAt" >= "createdAt"`. **CHECK (new):** `"consumedAt" IS NULL OR "consumedAt" <=
"expiresAt"` — a token cannot be recorded as consumed after its own expiry. This table has no
`revoked*` concept, so "cannot have been expired or revoked" reduces to this one ordering CHECK;
no additional field is needed. Index: `@@index([userId])`.

### `AccessRequest` (item 2: real EXPIRED time fact; item 1: unified shape CHECK)

**Decision (item 2), applied identically to `UserInvitation` below:** keep a stored `EXPIRED`
status, but give it a durable time fact — a required `expiresAt` deadline set at creation, and a
terminal `expiredAt` populated only at the moment a row is actually transitioned to `EXPIRED`.
This is chosen over deriving expiry live from `expiresAt < now()` because every other terminal
fact in this schema (`QualityHold.releasedAt`, `SafetyEvent`, `AccessRequest.decidedAt` itself) is
an explicit, recorded fact rather than something recomputed at read time — a stored `EXPIRED`
status with no timestamp backing it was the actual defect, not the choice to store status at all.
**The transition itself — `PENDING → EXPIRED` once `expiresAt` has passed — is Phase 0B
service-layer logic** (a scheduled sweep or a lazy check-on-read that issues a real `UPDATE ...
SET status='EXPIRED', "expiredAt"=now()`), exactly as `QualityHold` release and `AccessRequest`
decisions are real, actor-driven writes, not something the database does spontaneously. There is
no trigger that ages a row into `EXPIRED` on its own — Postgres CHECK/trigger evaluation happens
only at write time and has no notion of "time has passed since the last write."

| Field | Type | Nullable | Default |
|---|---|---|---|
| id | Uuid | no | `gen_random_uuid()` |
| userId | Uuid (FK → User) | no | — |
| justification | VarChar(1000) | no | — |
| status | AccessRequestStatus | no | `PENDING` |
| expiresAt | Timestamptz | no | — | *(new)* |
| expiredAt | Timestamptz | yes | — | *(new)* |
| decidedById | Uuid (FK → User) | yes | — |
| decidedAt | Timestamptz | yes | — |
| createdAt | Timestamptz | no | `now()` |

**Unified state-shape CHECK (replaces the prior two-CHECK form — see §9 for why this
consolidation was made even though the old two-CHECK form was independently correct):**

```sql
CHECK (
  ("status" = 'PENDING'  AND "decidedById" IS NULL     AND "decidedAt" IS NULL     AND "expiredAt" IS NULL)
  OR ("status" = 'APPROVED' AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL AND "expiredAt" IS NULL)
  OR ("status" = 'REJECTED' AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL AND "expiredAt" IS NULL)
  OR ("status" = 'EXPIRED'  AND "decidedById" IS NULL     AND "decidedAt" IS NULL     AND "expiredAt" IS NOT NULL)
)
```

Plus: `"expiresAt" > "createdAt"`; `"expiredAt" IS NULL OR "expiredAt" >= "expiresAt"` (a row
cannot be marked expired before its own deadline); `"decidedAt" IS NULL OR "decidedAt" >=
"createdAt"`. **Deliberately not added:** a `decidedAt <= expiresAt` ordering CHECK. An
administrator may legitimately decide a request after its nominal deadline has passed (their
action should win over a not-yet-run expiry sweep); this is not a gap, because the four-branch
shape CHECK above already makes `APPROVED`/`REJECTED` and `EXPIRED` mutually exclusive by
`status` — a decided request can never simultaneously carry the `EXPIRED` shape, structurally,
with no extra ordering rule needed. Index: `@@index([userId])`, `@@index([status])`,
`@@index([expiresAt])` *(new — supports the Phase 0B expiry sweep)*.

### `UserInvitation` (item 1: unified 4-state shape CHECK; item 2: terminal `expiredAt`)

| Field | Type | Nullable | Default |
|---|---|---|---|
| id | Uuid | no | `gen_random_uuid()` |
| invitedEmail | VarChar(254) | no | — |
| invitedById | Uuid (FK → User) | no | — |
| tokenHash | VarChar(255) | no | — |
| status | InvitationStatus | no | `PENDING` |
| expiresAt | Timestamptz | no | — |
| expiredAt | Timestamptz | yes | — | *(new)* |
| acceptedAt | Timestamptz | yes | — |
| revokedAt | Timestamptz | yes | — |
| revokedById | Uuid (FK → User) | yes | — |
| createdAt | Timestamptz | no | `now()` |

**The bug being fixed:** the prior CHECK `"status" = 'ACCEPTED' = ("acceptedAt" IS NOT NULL)` (and
the analogous one for `REVOKED`) is a boolean equality of two independently-evaluated booleans.
For a row with `status = 'PENDING'` and `acceptedAt` populated (garbage), the left side is `FALSE`
and — since `acceptedAt IS NOT NULL` is `TRUE` — the right side is `TRUE`. `FALSE = TRUE` is
`FALSE`, so *that* specific malformed row is correctly rejected. But the true gap was the
`REVOKED` CHECK combined with an `ACCEPTED`-status row: `status = 'ACCEPTED'`, `revokedAt`
populated, `revokedById` left `NULL`. The `REVOKED` CHECK reads `"status" = 'REVOKED' =
("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL)`: left side `FALSE` (status is
`ACCEPTED`, not `REVOKED`); right side `"revokedAt" IS NOT NULL` (`TRUE`) `AND` `"revokedById" IS
NOT NULL` (`FALSE`) = `FALSE`. `FALSE = FALSE` is `TRUE` — the CHECK **passes**, silently
accepting an `ACCEPTED` row carrying a half-populated, contradictory `revokedAt`. Whenever the
right-hand `AND` can be independently driven `FALSE` by a partial-null combination, it can
coincidentally match a `FALSE` left-hand side and slip through — this is the exact defect named in
this round's review.

**Fix — one exhaustive, mutually exclusive, per-status shape CHECK, each branch fully specifying
every field's null-ness (no `AND`-of-conditions is ever compared against an unrelated boolean):**

```sql
CHECK (
  ("status" = 'PENDING'  AND "acceptedAt" IS NULL     AND "revokedAt" IS NULL     AND "revokedById" IS NULL     AND "expiredAt" IS NULL)
  OR ("status" = 'ACCEPTED' AND "acceptedAt" IS NOT NULL AND "revokedAt" IS NULL     AND "revokedById" IS NULL     AND "expiredAt" IS NULL)
  OR ("status" = 'REVOKED'  AND "acceptedAt" IS NULL     AND "revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL AND "expiredAt" IS NULL)
  OR ("status" = 'EXPIRED'  AND "acceptedAt" IS NULL     AND "revokedAt" IS NULL     AND "revokedById" IS NULL     AND "expiredAt" IS NOT NULL)
)
```

Every branch is a pure conjunction of `IS [NOT] NULL` tests naming every one of the four outcome
fields, ORed across an exhaustive set of the four possible `status` values — there is no
comparison of one field's shape against an unrelated field's shape, so no partial-null
coincidence is possible (§9 traces this through PostgreSQL's evaluation explicitly).

Plus: `"expiresAt" > "createdAt"`; `"acceptedAt" IS NULL OR "acceptedAt" >= "createdAt"`.
**CHECK (new, item 2):** `"acceptedAt" IS NULL OR "acceptedAt" <= "expiresAt"` — an invitation
cannot be recorded as accepted after its own expiry. `"expiredAt" IS NULL OR "expiredAt" >=
"expiresAt"`; `"revokedAt" IS NULL OR "revokedAt" >= "createdAt"`. Unique: `tokenHash`. Index:
`@@index([invitedEmail])`, `@@index([status])`, `@@index([expiresAt])` *(new)*.

### `UserSession` (item 1: the previously-prose-only rule is now a real CHECK)

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

**The gap being closed:** the prior revision described this table's asymmetric revocation rule
(an automated revocation may set `revokedAt` with no `revokedById`, but a `revokedById` must never
exist without `revokedAt`) only in prose — no actual CHECK enforced it, so the invariant was not
database-guaranteed at all. **CHECK (new):** `"revokedById" IS NULL OR "revokedAt" IS NOT NULL`.
This is intentionally *not* the together-or-neither pattern used elsewhere: it permits
`revokedAt` alone (system-initiated revocation, no human actor) but forbids `revokedById` alone
(an actor can never be recorded without the timestamp it acted at) — the one legitimate asymmetry
in this document, stated once here and not repeated elsewhere. Unique: `refreshTokenHash`. CHECK:
`"expiresAt" > "createdAt"`; `"revokedAt" IS NULL OR "revokedAt" >= "createdAt"`. Index:
`@@index([userId])`, `@@index([expiresAt])`.

### `MfaEnrollment` (item 1 shape fix + item 3 lifecycle — see §5 for the full activation design)

| Field | Type | Nullable | Default |
|---|---|---|---|
| id | Uuid | no | `gen_random_uuid()` |
| userId | Uuid (FK → User) | no | — |
| method | MfaMethod | no | — |
| status | MfaEnrollmentStatus | no | `PENDING_SETUP` | *(default changed — was `ACTIVE`)* |
| revokedAt | Timestamptz | yes | — |
| revokedById | Uuid (FK → User) | yes | — |
| createdAt | Timestamptz | no | `now()` |

**The same equality-CHECK bug as `UserInvitation`, confirmed present here too:** the prior CHECK
`"status" = 'REVOKED' = ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL)` accepted a
non-`REVOKED` row with `revokedAt` set and `revokedById` left `NULL` (left side `FALSE`; right
side `TRUE AND FALSE = FALSE`; `FALSE = FALSE = TRUE` → passes). This is the literal example the
review named.

**Fix:**

```sql
CHECK (
  ("status" IN ('PENDING_SETUP', 'ACTIVE') AND "revokedAt" IS NULL AND "revokedById" IS NULL)
  OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL)
)
```

`PENDING_SETUP` and `ACTIVE` share an identical shape on this axis (neither is revoked), so they
are combined in one branch via `IN (...)`; this remains exhaustive and mutually exclusive across
all three enum values. Plus: `"revokedAt" IS NULL OR "revokedAt" >= "createdAt"`. Index:
`@@index([userId, method])`. The full status transition graph, activation gate, and creation
constraint are specified in §5.

### `MfaTotpCredential` (§5 for the transition graph, immutability, and delete-guard triggers)

| Field | Type | Nullable | Default |
|---|---|---|---|
| id | Uuid | no | `gen_random_uuid()` |
| mfaEnrollmentId | Uuid (FK → MfaEnrollment) | no | — |
| encryptedSecret | Bytes | no | — |
| encryptionKeyVersion | VarChar(50) | no | — |
| createdAt | Timestamptz | no | `now()` |

Unique: `mfaEnrollmentId` (at most one row per enrollment — §5 explains why this alone is
insufficient and what closes the gap). CHECK: `octet_length("encryptedSecret") > 0`. CHECK:
`length(btrim("encryptionKeyVersion")) > 0`.

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

Unique: `credentialId` (globally). CHECK: `octet_length("publicKey") > 0`. Index:
`@@index([mfaEnrollmentId])`.

### `MfaRecoveryCode` (unchanged)

| Field | Type | Nullable | Default |
|---|---|---|---|
| id | Uuid | no | `gen_random_uuid()` |
| userId | Uuid (FK → User) | no | — |
| codeHash | VarChar(255) | no | — |
| usedAt | Timestamptz | yes | — |
| createdAt | Timestamptz | no | `now()` |

Unique: `codeHash`. CHECK: `"usedAt" IS NULL OR "usedAt" >= "createdAt"`. Index:
`@@index([userId])`. True single-use-under-concurrency remains an explicitly Phase 0B
service-layer concern (§6 gives the exact pattern, now also applied to `DocumentOpenToken`).

### `Notification` (unchanged)

| Field | Type | Nullable | Default |
|---|---|---|---|
| id | Uuid | no | `gen_random_uuid()` |
| recipientUserId | Uuid (FK → User) | no | — |
| kind | VarChar(100) | no | — |
| payload | Json | no | `'{}'` |
| readAt | Timestamptz | yes | — |
| createdAt | Timestamptz | no | `now()` |

CHECK: `jsonb_typeof("payload") = 'object'`. CHECK: `"readAt" IS NULL OR "readAt" >= "createdAt"`.
Index: `@@index([recipientUserId, readAt])`.

### `OutboxEvent` (item 7: exhaustive per-status shape CHECK, new `deadLetteredAt` field)

**The bug being fixed:** the prior design had two `SENT`-related CHECKs where the second was, as
the review states, effectively redundant with the first, and no shape was defined at all for
`PENDING`, `PROCESSING`, `FAILED`, or `DEAD_LETTER` — so, for example, a `PROCESSING` row could
have `lockedBy` set with `lockedAt` left `NULL`, or a `FAILED` row could exist with no
`lastError` and no retry timing.

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
| deadLetteredAt | Timestamptz | yes | — | *(new)* |
| createdAt | Timestamptz | no | `now()` |

`aggregateType`/`aggregateId` remain the same label-only pair reusing the pre-approved `AuditLog`
polymorphic-label exception — unchanged. `lockedBy` identifies a dispatcher process, not a `User`
— no FK, unchanged.

**Fix — one exhaustive, mutually exclusive, per-status shape CHECK covering all five statuses:**

```sql
CHECK (
  ("status" = 'PENDING'
    AND "lockedAt" IS NULL AND "lockedBy" IS NULL
    AND "processedAt" IS NULL AND "deadLetteredAt" IS NULL
    AND "lastError" IS NULL AND "nextAttemptAt" IS NULL)
  OR ("status" = 'PROCESSING'
    AND "lockedAt" IS NOT NULL AND "lockedBy" IS NOT NULL
    AND "processedAt" IS NULL AND "deadLetteredAt" IS NULL)
  OR ("status" = 'SENT'
    AND "processedAt" IS NOT NULL
    AND "lockedAt" IS NULL AND "lockedBy" IS NULL
    AND "deadLetteredAt" IS NULL AND "lastError" IS NULL)
  OR ("status" = 'FAILED'
    AND "lastError" IS NOT NULL AND "nextAttemptAt" IS NOT NULL
    AND "lockedAt" IS NULL AND "lockedBy" IS NULL
    AND "processedAt" IS NULL AND "deadLetteredAt" IS NULL)
  OR ("status" = 'DEAD_LETTER'
    AND "lastError" IS NOT NULL AND "deadLetteredAt" IS NOT NULL
    AND "nextAttemptAt" IS NULL
    AND "lockedAt" IS NULL AND "lockedBy" IS NULL AND "processedAt" IS NULL)
)
```

`PROCESSING` deliberately does not constrain `lastError` either way — a retry after a prior
failure legitimately carries the previous attempt's error forward as diagnostic history while the
new attempt is in flight; forcing it `NULL` on every re-entry into `PROCESSING` would destroy that
history for no correctness benefit. `SENT` **does** force `lastError IS NULL`: a successfully
delivered event should not display a stale error from an earlier failed attempt.

**"`lockedAt` and `lockedBy` together or neither" is not restated as a separate CHECK** — it is
already structurally guaranteed by the shape CHECK above: the only branch requiring either of them
non-`NULL` (`PROCESSING`) requires *both*, and every other branch requires *both* `NULL`; no branch
permits exactly one being set. Adding a second, independent CHECK for the same fact would be
redundant, not additional safety — consistent with this document's standing preference against
constraints that duplicate an already-total invariant.

Plus (unchanged): `jsonb_typeof("payload") = 'object'`; `"attemptCount" >= 0`; `"processedAt" IS
NULL OR "processedAt" >= "createdAt"`; `"lockedAt" IS NULL OR "lockedAt" >= "createdAt"`.
**CHECK (new):** `"deadLetteredAt" IS NULL OR "deadLetteredAt" >= "createdAt"`; `"nextAttemptAt"
IS NULL OR "nextAttemptAt" >= "createdAt"`. Unique: `idempotencyKey`. Index: `@@index([status,
nextAttemptAt])`.

### Enums (R2A-1, final for this revision)

`UserApprovalStatus{PENDING_APPROVAL,ACTIVE,SUSPENDED,REJECTED}` ·
`AccessRequestStatus{PENDING,APPROVED,REJECTED,EXPIRED}` (unchanged membership) ·
`InvitationStatus{PENDING,ACCEPTED,EXPIRED,REVOKED}` (unchanged membership) ·
`MfaMethod{TOTP,WEBAUTHN}` ·
`MfaEnrollmentStatus{PENDING_SETUP,ACTIVE,REVOKED}` *(gains `PENDING_SETUP` — item 3)* ·
`OutboxEventStatus{PENDING,PROCESSING,SENT,FAILED,DEAD_LETTER}` (unchanged membership).

---

## 5. MFA relational integrity and activation lifecycle

This revision closes two bypasses, makes the transition graph explicit, and adds a
concurrency-locking protocol.

**The two bypasses being fixed, exactly:**
- **Direct-ACTIVE-insert.** Every trigger in the prior revision that protected the "`ACTIVE`
  requires a credential" invariant fired on `UPDATE` only. A plain `INSERT INTO "MfaEnrollment"
  ("userId", "method", "status", ...) VALUES (..., 'ACTIVE', ...)` never passes through an
  `UPDATE` at all — `OLD` doesn't exist for an `INSERT` — so no trigger ever ran, and a
  zero-credential `ACTIVE` enrollment could be created in one statement.
- **Credential reassignment.** The prior method-matching trigger fired on `BEFORE INSERT OR
  UPDATE` and, on `UPDATE`, re-validated the credential's method against its (possibly just
  changed) `mfaEnrollmentId`. That validates *compatibility*, not *stability* — it happily allowed
  `UPDATE "MfaTotpCredential" SET "mfaEnrollmentId" = <a different TOTP enrollment's id> WHERE id =
  ...`, silently detaching the credential from its original enrollment. If that original
  enrollment was `ACTIVE`, it was left with zero credentials — and the delete-guard trigger from
  the prior revision never fired, because no row was deleted; it was re-parented.

**Both are closed by tightening what is allowed to happen at each statement type, rather than by
re-validating after the fact:** an `MfaEnrollment` may only ever be *inserted* as `PENDING_SETUP`
(new `BEFORE INSERT` trigger, below); once a credential row exists, its `mfaEnrollmentId` may never
be *changed* by any `UPDATE`, to any target, compatible or not (new `BEFORE UPDATE` trigger, per
credential table, below) — the only way to detach a credential from its enrollment is to `DELETE`
it, which the existing delete-guards already gate.

**Lifecycle (unchanged from the prior revision, now database-enforced end to end rather than only
at the `UPDATE` step):** every `MfaEnrollment` is created as `PENDING_SETUP`. Credential rows may
be created — or, for WebAuthn, added — while the enrollment is in either `PENDING_SETUP` or already
`ACTIVE`; there is no restriction requiring credential creation to happen only during setup, since
legitimately adding a second WebAuthn security key to an already-active enrollment is a normal,
desirable operation, and TOTP's own `@unique` constraint already makes a second TOTP row impossible
regardless of enrollment status. What is gated is the **transition into `ACTIVE`**, **direct
creation as anything other than `PENDING_SETUP`**, and every path that could **remove or detach**
the credential(s) an `ACTIVE` enrollment depends on.

### The explicit `MfaEnrollment` status transition graph

**Allowed:** `PENDING_SETUP → ACTIVE` (gated on a matching credential existing); `PENDING_SETUP →
REVOKED`; `ACTIVE → REVOKED`; a same-status update, but only if `revokedAt` and `revokedById` are
both left unchanged (protects `REVOKED`'s evidentiary fields — `revokedAt`/`revokedById` — from
being silently rewritten by a later update that doesn't change `status`).
**Rejected:** `ACTIVE → PENDING_SETUP` (no legitimate reason to step backward); every transition
*out of* `REVOKED` (revocation is terminal — re-enrollment means creating a new `MfaEnrollment`
row, never reviving an old one); direct creation as anything other than `PENDING_SETUP` (the
direct-ACTIVE-insert bypass this revision closes, generalized to reject direct creation as
`REVOKED` too, which is equally illegitimate).

**1. Creation constraint (`BEFORE INSERT` on `MfaEnrollment` — new, closes the direct-insert
bypass):**

```sql
CREATE FUNCTION mfa_enrollment_insert_must_be_pending_setup() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" <> 'PENDING_SETUP' THEN
    RAISE EXCEPTION
      'MfaEnrollment must be created with status = PENDING_SETUP (got %)', NEW."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- BEFORE INSERT ON "MfaEnrollment"
```

This is unconditional — no field combination on the inserted row changes the outcome. Whatever
else the row carries (`revokedAt`/`revokedById` set or unset, either `method`), `status <>
'PENDING_SETUP'` alone is sufficient to reject it, which is also why no INSERT-time credential
check is needed here: a `PENDING_SETUP` row can never carry `ACTIVE`'s obligations at the moment
it is created. (A caller cannot route around this by pre-creating a credential row first and
pointing it at a not-yet-existing enrollment id either — `MfaTotpCredential.mfaEnrollmentId` and
`MfaWebAuthnCredential.mfaEnrollmentId` are immediate, non-deferrable foreign keys, so the
credential insert would itself fail with a foreign-key violation before the enrollment row exists;
the enrollment row must exist first, and by the time it does, this trigger has already forced its
`status` to `PENDING_SETUP`.)

**2. Transition guard (`BEFORE UPDATE` on `MfaEnrollment` — replaces the prior revision's two
separate triggers, `mfa_enrollment_method_immutable` and
`mfa_enrollment_activation_requires_credential`, with one function that is the sole authority over
every `UPDATE`-time invariant on this table, including the explicit transition whitelist):**

```sql
CREATE FUNCTION mfa_enrollment_transition_guard() RETURNS TRIGGER AS $$
DECLARE credential_count int;
BEGIN
  IF NEW."method" <> OLD."method" THEN
    RAISE EXCEPTION 'MfaEnrollment.method is immutable (id=%)', OLD."id";
  END IF;

  IF NEW."status" = OLD."status" THEN
    IF NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt"
       OR NEW."revokedById" IS DISTINCT FROM OLD."revokedById" THEN
      RAISE EXCEPTION
        'MfaEnrollment revocation facts are immutable once set (id=%)', OLD."id";
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'PENDING_SETUP' AND NEW."status" = 'ACTIVE' THEN
    IF NEW."method" = 'TOTP' THEN
      SELECT count(*) INTO credential_count
      FROM "MfaTotpCredential" WHERE "mfaEnrollmentId" = NEW."id";
    ELSE
      SELECT count(*) INTO credential_count
      FROM "MfaWebAuthnCredential" WHERE "mfaEnrollmentId" = NEW."id";
    END IF;
    IF credential_count < 1 THEN
      RAISE EXCEPTION
        'Cannot activate MfaEnrollment % without at least one matching credential', NEW."id";
    END IF;
    RETURN NEW;
  ELSIF OLD."status" = 'PENDING_SETUP' AND NEW."status" = 'REVOKED' THEN
    RETURN NEW;
  ELSIF OLD."status" = 'ACTIVE' AND NEW."status" = 'REVOKED' THEN
    RETURN NEW;
  ELSE
    RAISE EXCEPTION
      'Illegal MfaEnrollment status transition % -> % (id=%)', OLD."status", NEW."status", NEW."id";
  END IF;
END;
$$ LANGUAGE plpgsql;
-- BEFORE UPDATE ON "MfaEnrollment"
```

Method immutability runs first and unconditionally, exactly as in the prior revision. The
same-status branch now additionally rejects a same-status update that changes `revokedAt`/
`revokedById` — a `REVOKED` row's revocation facts can never be quietly rewritten by a later,
status-preserving update, matching this project's standing append-only-evidence discipline
elsewhere (`SafetyEvent`, `QualityHold`). Every differing-status update is checked against the
explicit three-pair whitelist; anything not named — `ACTIVE → PENDING_SETUP`, any `OLD.status =
'REVOKED'` row with a different `NEW.status`, or any other combination — falls to the final `ELSE`
and is rejected. `PENDING_SETUP → ACTIVE` is the only pair that additionally re-checks credentials,
exactly as the prior revision's activation gate did; because `MfaTotpCredential.mfaEnrollmentId` is
unique, `credential_count >= 1` for TOTP means exactly 1.

**3. Credential method-matching — INSERT only now (the prior revision's UPDATE-side re-check is
retired, not merely narrowed, because item 2 below now makes `mfaEnrollmentId` unconditionally
immutable — a strictly stronger guarantee that supersedes it):**

```sql
CREATE FUNCTION mfa_totp_credential_method_check() RETURNS TRIGGER AS $$
DECLARE enrollment_method "MfaMethod";
DECLARE enrollment_status "MfaEnrollmentStatus";
BEGIN
  SELECT "method", "status" INTO enrollment_method, enrollment_status
  FROM "MfaEnrollment" WHERE "id" = NEW."mfaEnrollmentId" FOR UPDATE;
  IF enrollment_method IS DISTINCT FROM 'TOTP' THEN
    RAISE EXCEPTION 'MfaTotpCredential.mfaEnrollmentId must reference a TOTP MfaEnrollment';
  END IF;
  IF enrollment_status = 'REVOKED' THEN
    RAISE EXCEPTION 'Cannot attach a credential to a REVOKED MfaEnrollment';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- BEFORE INSERT ON "MfaTotpCredential" (mirrored for MfaWebAuthnCredential, checking
-- method = 'WEBAUTHN'). The FOR UPDATE clause is the concurrency-locking protocol — see below.
```

**4. Credential parent immutability (`BEFORE UPDATE` on each credential table — new; this is the
"safest design" fix for the reassignment bypass, per the review's own framing: unconditional
immutability, not re-validated compatibility):**

```sql
CREATE FUNCTION mfa_totp_credential_parent_immutable() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."mfaEnrollmentId" IS DISTINCT FROM OLD."mfaEnrollmentId" THEN
    RAISE EXCEPTION 'MfaTotpCredential.mfaEnrollmentId is immutable (id=%)', OLD."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- BEFORE UPDATE ON "MfaTotpCredential" (mirrored for MfaWebAuthnCredential)
```

This rejects re-pointing `mfaEnrollmentId` to *any* other enrollment — including one of the
correct method — closing the exact scenario the review names for all four combinations (TOTP →
another TOTP enrollment, TOTP → WebAuthn, WebAuthn → another WebAuthn enrollment, WebAuthn → TOTP)
with one unconditional check, rather than four cases of "is the destination compatible." Every
other field on the row — `signCount`, `attestationFormat` on `MfaWebAuthnCredential`;
`encryptedSecret`, `encryptionKeyVersion` on `MfaTotpCredential` — is untouched by this trigger and
remains freely updatable, since the `IF` only inspects `mfaEnrollmentId`. Credential replacement
is now only possible through the approved lifecycle: create a new credential row (subject to the
method-match/uniqueness rules above) and, if the old one must go, delete it (subject to the
delete-guards below) — never by re-parenting the existing row.

**5. Delete guards (unchanged in logic from the prior revision; the `SELECT` each performs is now
part of the concurrency-locking protocol below):**

```sql
CREATE FUNCTION mfa_totp_credential_delete_guard() RETURNS TRIGGER AS $$
DECLARE enrollment_status "MfaEnrollmentStatus";
BEGIN
  SELECT "status" INTO enrollment_status
  FROM "MfaEnrollment" WHERE "id" = OLD."mfaEnrollmentId" FOR UPDATE;
  IF enrollment_status = 'ACTIVE' THEN
    RAISE EXCEPTION
      'Cannot delete the credential of an ACTIVE TOTP MfaEnrollment; revoke it first';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
-- BEFORE DELETE ON "MfaTotpCredential"

CREATE FUNCTION mfa_webauthn_credential_delete_guard() RETURNS TRIGGER AS $$
DECLARE enrollment_status "MfaEnrollmentStatus";
DECLARE remaining_count int;
BEGIN
  SELECT "status" INTO enrollment_status
  FROM "MfaEnrollment" WHERE "id" = OLD."mfaEnrollmentId" FOR UPDATE;
  IF enrollment_status = 'ACTIVE' THEN
    SELECT count(*) INTO remaining_count FROM "MfaWebAuthnCredential"
      WHERE "mfaEnrollmentId" = OLD."mfaEnrollmentId" AND "id" <> OLD."id";
    IF remaining_count < 1 THEN
      RAISE EXCEPTION
        'Cannot delete the last credential of an ACTIVE WebAuthn MfaEnrollment; revoke it first';
    END IF;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
-- BEFORE DELETE ON "MfaWebAuthnCredential"
```

TOTP's guard is unconditional on delete-while-`ACTIVE`; WebAuthn's guard only blocks deleting the
*last remaining* credential, correctly allowing removal of one of several while keeping others.
With `mfaEnrollmentId` now immutable (item 4), deletion is the *only* remaining way a credential
can leave an enrollment, which is exactly why these guards — and the locking protocol below — are
the last line of defense for the "`ACTIVE` requires a credential" invariant.

### Concurrency-locking protocol

New. Makes the invariant safe under real concurrent access, not just under a single serial
writer.

**The race being closed:** every check above reasons from a plain `SELECT` unless stated otherwise
— and a plain `SELECT` inside a trigger takes no row lock. Under PostgreSQL's default `READ
COMMITTED` isolation, two concurrent transactions can each read a pre-commit snapshot of the
other's target row, both find their own precondition satisfied, and both commit — leaving the
database in a state neither transaction individually would have produced. Concretely: transaction
T1 activates an enrollment (its `BEFORE UPDATE` transition guard counts 1 credential, decides to
proceed) while transaction T2 concurrently deletes that same, sole credential (its delete guard
reads the enrollment's status as still `PENDING_SETUP`, since T1 hasn't committed `ACTIVE` yet, and
allows the delete). If both commit, the enrollment ends up `ACTIVE` with zero credentials — the
exact outcome every trigger above exists to prevent, reached anyway because the two checks never
knew about each other.

**The fix — every trigger above that reads across tables now serializes on the `MfaEnrollment`
row itself, using `SELECT ... FOR UPDATE`:**
- The transition guard (item 2) needs no explicit lock of its own: it is a `BEFORE UPDATE` trigger
  *on* `MfaEnrollment`, so the `UPDATE` statement that fires it already holds PostgreSQL's normal
  row-level write lock on that exact enrollment row for the rest of the transaction — this is what
  every other operation below serializes against.
- The credential method-check trigger (item 3, `INSERT`-only) and both delete-guard triggers
  (item 5) each now explicitly `SELECT ... FOR UPDATE` the parent `MfaEnrollment` row before
  reading its `status`/`method`. If a concurrent activation `UPDATE` is already in flight, this
  blocks until that transaction commits or rolls back, then reads the now-final, committed status
  — never a stale pre-commit value. Symmetrically, if the credential-side transaction acquires the
  lock first, the concurrent activation `UPDATE` blocks (an `UPDATE` must itself acquire that same
  row lock to proceed) until the credential-side transaction resolves, and only then evaluates the
  credential count — which by then correctly reflects whatever the credential-side transaction did.
- Re-running the race above with this fix in place: whichever of T1 (activation) or T2 (deletion)
  reaches the `MfaEnrollment` row first — T1 via its own `UPDATE`, T2 via its guard's explicit
  `FOR UPDATE` — forces the other to wait for it to fully commit or roll back before proceeding.
  There is no interleaving left in which both read a pre-commit snapshot of the other.
- **No deadlock is possible under this protocol:** every one of these triggers acquires at most one
  lock, and always on the same single row (the `MfaEnrollment` row named by
  `mfaEnrollmentId`/`id`) — no trigger anywhere in this design locks a credential row and then
  waits on an enrollment lock held by a second transaction that is itself waiting on a credential
  lock the first transaction holds. A single lock target per transaction path cannot form a wait
  cycle.
- **Why credential `INSERT` is included even though adding a credential can only help the
  "at-least-one" invariant, never hurt it:** the `FOR UPDATE` there protects a different, smaller
  race — a credential being inserted at the same moment its target enrollment is concurrently being
  revoked (`ACTIVE → REVOKED`). Without the lock, the insert's plain read of `status` could observe
  a stale `ACTIVE` value and attach a new credential to an enrollment that has, by the time both
  transactions commit, already become `REVOKED`.

Positive and negative tests for every path above — including two database-level tests that
actually exercise this locking under real concurrency — are enumerated in §8's R2A-1 test list.
A broader concurrency/load test remains a Phase 0B concern (also listed in §8); the two tests here
are the ones that can be deterministically proven with two ordinary database connections and are
therefore included now, at R2A-1, rather than deferred.

**Other MFA integrity facts (unchanged from the prior revision):** `stepUpMaxAgeSeconds > 0` when
present, on both `UserPermissionGrant` and `DocumentPermissionGrant`; `encryptedSecret`/
`encryptionKeyVersion` non-empty CHECKs; `MfaRecoveryCode` hash uniqueness with the explicit,
honest note that true single-use-under-concurrency needs a Phase 0B atomic update (§6 states the
exact pattern); no plaintext secret anywhere (`encryptedSecret` is KMS-encrypted, `codeHash`/every
`*tokenHash` field is one-way-hashed, WebAuthn `publicKey` is correctly stored in the clear).

---

## 6. Document-security edge semantics — corrected (items 5 and 6)

### Multi-linked and unlinked documents (item 5 — replaces the two-path rule)

**The flaw being fixed:** the prior rule let a request routed through *one* permitted linked
record (e.g., "documents for Project A", where the user has row-scope on Project A) succeed even
when the same physical document was *also* linked to a different record the user cannot see (e.g.,
a Customer file, or a second Project the user has no scope on). Once the underlying bytes are
returned to the requester, which "route" they used to ask for them is irrelevant — they now hold
the whole document, including whatever the inaccessible link would have protected. Restricting the
*full* deny-by-default rule to only the context-free lookup path, while allowing a single
permissive contextual link to unlock the same bytes through a different path, was the leak.

**The corrected rule — one path, applied to every document access regardless of how it is
routed:**
- Enumerate **every** current typed link the document has (`DocumentProject`, `DocumentJobcard`,
  `DocumentCustomer`, and any other `Document*` link table), regardless of which one the request
  named as its starting point.
- Every linked record must independently pass its own module permission **and** row scope (§1) for
  the requesting user.
- **One permissive link never overrides another inaccessible one.** A route/context named in the
  request (e.g., "I'm viewing this from Project A's documents list") may identify *where the user
  started*, for UI and audit purposes, but must never narrow which links are actually checked —
  the full enumerated set is checked every time, unconditionally.
- Default deny the instant any linked record's check fails, for any reason.

This removes the prior branching between a "context-specific" and "context-free" evaluation
entirely — there is now exactly one rule, and it is at least as strict as the old context-free
branch was, applied everywhere.

**Unlinked documents — a real two-part authority path (fixing the conflict the review names):** a
document with no rows in any `Document*` link table has no linked-record check to run at all, so
the rule above degenerates to nothing — which is exactly why a document-specific
`DocumentPermissionGrant` *alone* was previously treated as sufficient, directly conflicting with
this document's own standing rule (§1, step 5) that a document operation always additionally
requires ordinary module/record permission. The fix adds the missing half instead of special-casing
it away:
- **New permission catalogue entry:** `documents.unlinked.access` — added as a new row in the
  existing `Permission` catalogue (Decision 4), not a schema change. Eligibility and row scope for
  this permission are resolved through the ordinary §1 algorithm like any other permission; because
  unlinked documents have no natural linked business record to scope against, this permission is
  expected in practice to be granted with `scopeKind = 'COMPANY'` via an explicit
  `UserPermissionGrant` — administrator-decided, never inferred, exactly as `COMPANY` scope always
  works under §1. Nothing in the design precludes a narrower scope kind being used for this
  permission in the future; none is specified now because no concrete need for one exists yet.
- **Both of the following are required, ANDed — never either alone:** (1) the user is eligible for
  and in-scope for `documents.unlinked.access` under §1, **and** (2) a `DocumentPermissionGrant`
  naming this exact `documentId` (never a `classification`-wide grant — see below) exists, is
  currently valid, and is not revoked.
- **Classification-wide grants must never reach unlinked documents.** This is an
  authorization-algorithm rule, not independently CHECK-enforceable: a `DocumentPermissionGrant`
  row cannot know at write time whether its target document currently has zero links, since links
  can be added or removed afterward. Phase 0B's authorization service must implement this exactly
  as stated; §8's R2A-3 future-Phase-0B-test list now includes an explicit regression test proving
  a classification-wide grant does **not** unlock a document with zero current links.
- The winning `DocumentPermissionGrant`'s `requiresMfa`/`requiresTrustedDevice`/
  `stepUpMaxAgeSeconds` apply exactly as in §1 step 6 — no separate MFA/device rule for unlinked
  documents.

**Derivative inheritance (unchanged from the prior revision):** a derivative does not inherit a
document-specific grant from its source document; it does fall under any classification-wide grant
already covering its own (copied) `classification`, purely because it is itself a `Document` row of
that classification — no separate inheritance mechanism exists.

### Token and device rules (item 6)

**`DocumentOpenToken` — consumption cannot exceed expiry (new CHECK, closing the gap named by the
review):** `CHECK ("consumedAt" IS NULL OR "consumedAt" <= "expiresAt")`. Combined with the
existing `CHECK ("expiresAt" > "createdAt")` and the existing mutual-exclusivity CHECK between
`consumedAt` and `revokedAt`, this table's full CHECK set is now: `"expiresAt" > "createdAt"`;
`"consumedAt" IS NULL OR "consumedAt" >= "createdAt"`; **`"consumedAt" IS NULL OR "consumedAt" <=
"expiresAt"`** *(new)*; `"revokedAt" IS NULL OR "revokedAt" >= "createdAt"`; `NOT ("consumedAt" IS
NOT NULL AND "revokedAt" IS NOT NULL)`.

**Atomic one-time consumption — the exact Phase 0B pattern (previously only gestured at; now
stated precisely, per the review's request):** neither a CHECK nor a `SELECT ... FOR UPDATE`
pattern is the right tool here — the correct, standard pattern for a one-time bearer token is a
single conditional `UPDATE` whose `WHERE` clause re-asserts every precondition and whose affected
row count *is* the success signal:

```sql
UPDATE "DocumentOpenToken"
SET "consumedAt" = now()
WHERE "id" = $1
  AND "consumedAt" IS NULL
  AND "revokedAt" IS NULL
  AND "expiresAt" > now()
RETURNING *;
```

If this returns zero rows, the token was already consumed, already revoked, or already expired —
the caller must treat all three identically as "token not usable," with no separate `SELECT` ever
needed to distinguish which. This is inherently race-free under Postgres's row-level MVCC:
concurrent callers racing this same statement can never both succeed, because the second one's
`WHERE` no longer matches once the first commits. The identical pattern applies to
`MfaRecoveryCode` redemption (`SET "usedAt" = now() WHERE "id" = $1 AND "usedAt" IS NULL`),
replacing the vaguer "row locking" language used for it in the prior revision with this same exact,
concrete statement shape.

**`TrustedDevice.deviceKeyThumbprint` — content validation, not just length (fixing the gap named
by the review):** the prior `CHECK (length("deviceKeyThumbprint") = 64)` accepted any 64-character
string, including uppercase letters or non-hex characters — not actually a SHA-256 hex digest.
**Fix:** `CHECK ("deviceKeyThumbprint" ~ '^[0-9a-f]{64}$')` — a regular-expression CHECK requiring
exactly 64 lowercase hexadecimal characters, equivalent to a normalized, lowercase SHA-256 digest.
The old length-only CHECK is removed; this replaces it, not supplements it (a redundant weaker
CHECK alongside a stronger one adds nothing).

**Same-device, multiple-user registration — decided (fixing the gap named by the review):** the
prior revision made `deviceKeyThumbprint` globally `@unique`, implicitly deciding one physical
device can only ever be trusted for one user, system-wide. **This decision is reversed.** Workshop
floors plausibly run shared terminals — a workbench tablet or kiosk touched by several Workers
across shifts — where the same physical device's key should legitimately be independently
trustable for more than one user, each via their own explicit administrator decision. **Each
`TrustedDevice` row therefore represents a `(user, device)` pairing, not a global device
registration:** the unique constraint becomes `@@unique([userId, "deviceKeyThumbprint"])` (one
device is trusted at most once per user, but the same device may appear under multiple users'
`userId`), replacing the prior bare-column `@unique`. A plain, non-unique `@@index(["deviceKeyThumbprint"])`
is added alongside it, so a security review can still efficiently answer "which users currently
trust this physical device" without that query implying or requiring exclusivity.

---

## 7. Migration strategy (unchanged from the prior revision)

Carried forward verbatim. Every R2A sub-pass continues to evolve the same single initial migration
file (`<timestamp>_init/migration.sql`) — there is no second or third migration file. Each
sub-pass is still its own commit and its own independent-review stop. Only once the backend is
actually deployed does this project switch to genuinely additive, cumulative migrations.

---

## 8. Corrected R2A-1 / R2A-2 / R2A-3 sub-passes

### R2A-1 — User lifecycle, verification, sessions, MFA, Notification, Outbox

**Exact models & fields:** the eleven models specified in full in §4, with the enums listed there
(`MfaEnrollmentStatus` now includes `PENDING_SETUP`).

**FK & delete behaviour:** `onDelete: Restrict` throughout.

**CHECK constraints, unique/partial indexes, triggers:** exactly as specified per-model in §4 and
per-integrity-rule in §5.

**Migration implications:** per §7, one strategy — this evolves the single initial migration.

**Database-enforceable acceptance tests (fully updated for this revision):**
- `User`: cannot become `ACTIVE` with a null `emailVerifiedAt` (unchanged).
- `UserSession`: insert rejected for `PENDING_APPROVAL`/`REJECTED`/`SUSPENDED` users (unchanged,
  3 tests); `expiresAt <= createdAt` rejected; `revokedAt < createdAt` rejected; duplicate
  `refreshTokenHash` rejected; **`revokedById` set with `revokedAt` NULL rejected (new)**;
  **`revokedAt` set with `revokedById` NULL accepted — positive control proving the intentional
  asymmetry (new)**.
- `EmailVerificationToken`: `expiresAt <= createdAt` rejected; `consumedAt < createdAt` rejected;
  duplicate `tokenHash` rejected; **`consumedAt > expiresAt` rejected (new)**.
- `AccessRequest`: for each of the four state-shape branches, one test that the *correctly shaped*
  row is accepted and, separately, tests that each field named in that branch being wrongly
  populated or wrongly null is rejected — concretely: `PENDING` with `decidedById` set rejected;
  `PENDING` with `expiredAt` set rejected; `APPROVED`/`REJECTED` with `decidedById` or `decidedAt`
  NULL rejected (each independently); `APPROVED` with `expiredAt` set rejected; `EXPIRED` with
  `expiredAt` NULL rejected; `EXPIRED` with `decidedById` set rejected; **`expiredAt < expiresAt`
  rejected (new)**; `expiresAt <= createdAt` rejected; `decidedAt < createdAt` rejected.
- `UserInvitation`: the same shape-branch-by-shape-branch positive/negative pattern as
  `AccessRequest`, against its four branches: `PENDING` with any of `acceptedAt`/`revokedAt`/
  `revokedById`/`expiredAt` set rejected (four separate tests); `ACCEPTED` with `acceptedAt` NULL
  rejected; `ACCEPTED` with `revokedAt` set (and `revokedById` NULL) rejected — **this is the exact
  case the review identified as previously silently passing (new)**; `REVOKED` with only one of
  `revokedAt`/`revokedById` set rejected (two separate tests); `EXPIRED` with `expiredAt` NULL
  rejected; **`acceptedAt > expiresAt` rejected (new)**; `expiredAt < expiresAt` rejected;
  `expiresAt <= createdAt` rejected; duplicate `tokenHash` rejected.
- `MfaEnrollment`: `PENDING_SETUP`/`ACTIVE` with either `revokedAt` or `revokedById` set (not both)
  rejected (two separate tests for "only revokedAt" and "only revokedById"); `REVOKED` with either
  field NULL rejected (two separate tests); `UPDATE ... SET method = ...` on an existing row
  rejected regardless of status; transitioning `PENDING_SETUP → ACTIVE` with zero matching
  credentials rejected, tested separately for TOTP and WebAuthn (two tests); the same transition
  with exactly one matching credential (TOTP) or at least one (WebAuthn) succeeds — positive
  controls (two tests). **New in this revision:** **direct `INSERT INTO "MfaEnrollment" (...)
  VALUES (..., 'ACTIVE', ...)` rejected — the exact bypass this revision closes** — tested with
  every feasible field combination on the inserted row to confirm none bypasses the gate: `ACTIVE`
  with `revokedAt`/`revokedById` both `NULL` and `method = 'TOTP'` rejected; the same with
  `method = 'WEBAUTHN'` rejected; `ACTIVE` with `revokedAt`/`revokedById` both set (an attempt to
  look simultaneously `ACTIVE` and `REVOKED`-shaped) rejected (fails on this trigger and,
  independently, on §4's shape CHECK — both are confirmed to reject it); direct `INSERT ... VALUES
  (..., 'REVOKED', ...)` also rejected, confirming the creation constraint is not `ACTIVE`-specific
  but rejects any non-`PENDING_SETUP` value; a plain `INSERT` with `status` omitted (using the
  `PENDING_SETUP` default) succeeds — positive control. **Transition-graph tests (new):**
  `ACTIVE → PENDING_SETUP` rejected; `REVOKED → ACTIVE` rejected; `REVOKED → PENDING_SETUP`
  rejected. **Revocation-immutability test, corrected in this revision** (the prior fixture —
  changing a revocation field on an `ACTIVE → ACTIVE` update — was internally impossible, since
  §4's state-shape CHECK requires an `ACTIVE` row's `revokedAt`/`revokedById` to both already be
  `NULL`, leaving nothing non-null to "change" in that scenario; corrected to the only fixture that
  can actually exist): create a properly `REVOKED` enrollment (`revokedAt`/`revokedById` both
  non-null, per the shape CHECK); attempt a same-status `REVOKED → REVOKED` update that changes
  `revokedAt` to a different non-null timestamp — rejected by the transition guard's same-status
  branch (`IS DISTINCT FROM` on `revokedAt` is `TRUE`); separately, attempt `REVOKED → REVOKED`
  changing only `revokedById` to a different user — also rejected. **Positive control:** an ordinary
  same-status `ACTIVE → ACTIVE` update that leaves `revokedAt`/`revokedById` unchanged (both remain
  `NULL → NULL`, satisfying the same-status branch's guard) succeeds. `MfaEnrollment` currently has
  no other freely mutable field besides the lifecycle ones already covered by dedicated tests above
  (`method` is separately, unconditionally immutable; `userId`/`createdAt` are creation-time facts
  never intended to change), so this positive control demonstrates the same-status branch permits a
  value-preserving update rather than rejecting every same-status write outright — which is the
  actual property being tested, not a change to some unrelated business field this table does not
  yet have. `PENDING_SETUP → ACTIVE`, `PENDING_SETUP → REVOKED`, and `ACTIVE → REVOKED` each
  succeed — positive controls (three tests).
- `MfaTotpCredential`: duplicate `mfaEnrollmentId` rejected (unique, unchanged); insert against a
  `WEBAUTHN`-method enrollment rejected; empty `encryptedSecret`/`encryptionKeyVersion` rejected;
  insert against a `REVOKED` enrollment rejected; deleting the sole credential of an `ACTIVE`
  enrollment rejected. **New in this revision — the reassignment-bypass fix:** `UPDATE ...
  SET "mfaEnrollmentId" = <a different TOTP enrollment's id>` on an existing credential rejected;
  `UPDATE ... SET "mfaEnrollmentId" = <a WebAuthn enrollment's id>` rejected; after each rejected
  move, re-querying confirms the credential's `mfaEnrollmentId` is unchanged and the original
  `ACTIVE` enrollment still owns exactly one credential (two tests, one per rejected move above).
- `MfaWebAuthnCredential`: insert against a `TOTP`-method enrollment rejected; duplicate
  `credentialId` (even under a different enrollment) rejected; empty `publicKey` rejected; a second
  WebAuthn credential for the same enrollment with a different `credentialId` succeeds (positive
  control); insert against a `REVOKED` enrollment rejected; deleting the last credential of an
  `ACTIVE` enrollment (with only one) rejected; deleting one of two credentials of an `ACTIVE`
  enrollment, leaving one, succeeds — positive control. **New in this revision:** `UPDATE ...
  SET "mfaEnrollmentId" = <a different WebAuthn enrollment's id>` rejected; `UPDATE ...
  SET "mfaEnrollmentId" = <a TOTP enrollment's id>` rejected; after each, re-querying confirms the
  credential still belongs to its original `ACTIVE` enrollment (two tests); `UPDATE ... SET
  "signCount" = signCount + 1` on an existing credential succeeds without touching
  `mfaEnrollmentId` — positive control proving legitimate non-parent updates remain possible.
  **Concurrency tests, corrected in this revision** (the prior fixtures described an enrollment
  that was simultaneously `ACTIVE`, per the deleting transaction, and mid-`PENDING_SETUP → ACTIVE`,
  per the activating transaction — impossible, since a single row has exactly one `status` at a
  time; the delete against a genuinely `ACTIVE` enrollment would also already be unconditionally
  rejected by the delete guard regardless of concurrency, leaving nothing left to race. Both
  scenarios are corrected below to start from the one state both transactions can legitimately
  contend over: `PENDING_SETUP`, where the delete guard permits the delete and the activation gate
  has not yet run):
  - **Scenario (1) — deletion racing activation, both starting from `PENDING_SETUP`:** create
    enrollment E as `PENDING_SETUP` with exactly one matching `MfaWebAuthnCredential`. Transaction
    A begins `DELETE FROM "MfaWebAuthnCredential" WHERE id = ...` for that credential; its delete
    guard locks E via `SELECT ... FOR UPDATE`, reads `status = 'PENDING_SETUP'` (not `ACTIVE`), and
    permits the delete — but A does not commit yet, so it continues to hold E's row lock.
    Transaction B attempts `UPDATE "MfaEnrollment" SET status = 'ACTIVE' WHERE id = E.id`
    (`PENDING_SETUP → ACTIVE`) on the *same* E; B's `UPDATE` must itself acquire E's row lock and
    therefore blocks behind A. **Commit variant:** A commits (credential now deleted); B resumes,
    its transition guard counts credentials for E, finds zero, and rejects the activation.
    **Rollback variant (separate run):** A rolls back (credential deletion undone); B resumes,
    counts one credential, and the activation succeeds.
  - **Scenario (2) — the symmetric case, activation racing deletion:** create a fresh enrollment E
    as `PENDING_SETUP` with one credential. Transaction A begins
    `UPDATE "MfaEnrollment" SET status = 'ACTIVE' WHERE id = E.id`; being an `UPDATE` on E, this
    itself acquires E's row lock, and A's transition guard finds one credential and permits the
    activation — but A does not commit yet, so the lock persists. Transaction B attempts to delete
    E's sole credential; its delete guard's `SELECT ... FOR UPDATE` on E blocks behind A.
    **Commit variant:** A commits (E is now `ACTIVE`); B resumes, its delete guard now reads
    `status = 'ACTIVE'` and rejects the deletion. **Rollback variant (separate run):** A rolls back
    (E remains `PENDING_SETUP`); B resumes, reads `status = 'PENDING_SETUP'`, and the deletion
    succeeds, leaving E `PENDING_SETUP` with zero credentials.
  - **On using `lock_timeout` to demonstrate blocking, stated correctly:** a short `lock_timeout`
    may be used as a separate smoke check that B is genuinely blocked rather than proceeding
    immediately — attempt B's statement with e.g. `SET LOCAL lock_timeout = '2s'` while A is still
    open, and expect it to fail with a lock-timeout error. That failure aborts B's transaction for
    all further statements (PostgreSQL puts an aborted transaction into an error state until
    `ROLLBACK`); the same timed-out statement does **not** later resume or continue automatically
    once A commits or rolls back. Proving blocking this way and observing the eventual commit/
    rollback outcome are therefore two separate steps, not one: after a `lock_timeout` probe fails,
    that transaction must be rolled back, and B's real attempt — the one whose outcome the
    commit/rollback variants above actually check — must be issued as a fresh statement (a new
    transaction, or the same connection after `ROLLBACK`) that waits on the lock without an
    artificially short timeout, or in autocommit.
- `MfaRecoveryCode`: duplicate `codeHash` rejected; `usedAt < createdAt` rejected.
- `Notification`: non-object `payload` rejected; `readAt < createdAt` rejected.
- `OutboxEvent`: **for each of the five state-shape branches, the correctly shaped row is accepted
  and each field named in that branch being wrongly populated or wrongly null is rejected** —
  concretely: `PENDING` with `lockedAt` set rejected; `PENDING` with `lastError` set rejected;
  `PROCESSING` with `lockedBy` NULL (only `lockedAt` set) rejected; `PROCESSING` with `lockedAt`
  NULL (only `lockedBy` set) rejected; `SENT` with `lastError` set rejected; `SENT` with `lockedAt`
  set rejected; `FAILED` with `lastError` NULL rejected; `FAILED` with `nextAttemptAt` NULL
  rejected; `FAILED` with `lockedAt` set rejected; `DEAD_LETTER` with `deadLetteredAt` NULL
  rejected; `DEAD_LETTER` with `lastError` NULL rejected; `DEAD_LETTER` with `nextAttemptAt` set
  rejected; duplicate `idempotencyKey` rejected; non-object `payload` rejected; negative
  `attemptCount` rejected; `processedAt < createdAt` rejected; `deadLetteredAt < createdAt`
  rejected.

**Future Phase 0B tests:** real registration → verify → request → approve flow end-to-end; real
login issuing a session; real MFA enrollment/challenge against both TOTP and WebAuthn, including
the `PENDING_SETUP → ACTIVE` transition performed by the actual enrollment endpoint; the exact
conditional-`UPDATE` atomic-consumption pattern from §6, exercised under real concurrency for both
`MfaRecoveryCode` and `DocumentOpenToken`; the Phase 0B expiry sweep for `AccessRequest` and
`UserInvitation`; outbox dispatcher retry/backoff/dedup behavior against a live queue, including a
real transition into `DEAD_LETTER`. **New in this revision:** a broader MFA concurrency/load test —
many simultaneous activation and credential-mutation attempts across many enrollments under
realistic application load, verifying throughput and lock-wait behavior under contention — as
distinct from the two deterministic two-connection tests already included at R2A-1 above, which
prove the specific serialization invariant but not broader system behavior under load.

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

**Exact models & fields:** unchanged from the prior revision — `AccessPackage`;
`AccessPackageVersion`; `AccessPackagePermissionTemplate`; `UserAccessPackageAssignment`;
`UserPermissionGrant`. Plus, per this revision: the corrected §2 trigger function attached to
`AccessPackagePermissionTemplate`.

**Database tests — one addition (item 4):** all tests from the prior revision, **plus**: create a
published version V1 with template row T1 and a draft version V2 (of the same or a different
package); attempt `UPDATE "AccessPackagePermissionTemplate" SET "accessPackageVersionId" = V2.id
WHERE id = T1.id` — **rejected**, because `OLD`'s parent (V1) is published; separately, attempt
moving a draft row from V2 into V1 — **rejected**, because `NEW`'s parent (V1) is published. This
is the exact bypass named by the review, now covered in both directions.

**Future Phase 0B tests:** unchanged — the full corrected effective-authorization algorithm (§1)
end-to-end, including the Role-eligibility-without-scope-facts regression case.

**Dependencies:** requires R2A-1.

**Exact files expected to change:** per §7 — same evolved schema.prisma/migration.sql, extended
integration-spec.ts, README.md additions.

**Parent commit:** R2A-1's own final, reviewed commit.

**Go/no-go criteria:** same bar as R2A-1, plus independent review before R2A-3 begins.

### R2A-3 — Document classification, grants, access requests/events, trusted devices

**Exact models & fields:** unchanged from the prior revision, plus this revision's additions:
`TrustedDevice` with the corrected `deviceKeyThumbprint` regex CHECK and `@@unique([userId,
"deviceKeyThumbprint"])`; `DocumentOpenToken` with the new `consumedAt <= expiresAt` CHECK; and a
new `Permission` catalogue row, `documents.unlinked.access` (data seed, not a schema change).

**Database tests — updated for this revision:** all tests from the prior revision, **plus**:
`DocumentOpenToken` insert/update with `consumedAt > expiresAt` rejected; `TrustedDevice` insert
with an uppercase or non-hex `deviceKeyThumbprint` rejected (content, not just length); a second
`TrustedDevice` row for the **same** `deviceKeyThumbprint` under a **different** `userId` succeeds
— positive control proving the per-user (not global) uniqueness decision; a second `TrustedDevice`
row for the same `(userId, deviceKeyThumbprint)` pair rejected (duplicate).

**Future Phase 0B tests — updated for this revision:** the multi-linked-document rule exercised
against a document linked to two records where the user has scope on only one — access must be
denied, regardless of which of the two records the request names as its route; the unlinked-document
two-part path exercised positively (both `documents.unlinked.access` scope **and** a document-
specific grant present → success) and negatively (either alone → denied); **an explicit regression
test proving a classification-wide `DocumentPermissionGrant` does not unlock a document with zero
current links**; the exact atomic conditional-`UPDATE` consumption pattern from §6 for
`DocumentOpenToken`, exercised under real concurrency.

**Dependencies:** requires R2A-1 and R2A-2.

**Exact files expected to change:** per §7 — same evolved schema.prisma/migration.sql, extended
integration-spec.ts, README.md additions.

**Parent commit:** R2A-2's own final, reviewed commit.

**Go/no-go criteria:** same bar as R2A-1/R2A-2. After R2A-3's independent review sign-off, R2A as a
whole is complete and ready for the next explicitly-authorized phase — not before.

---

## 9. NULL-behavior audit and internal-contradiction re-read

**Why the equality-CHECK pattern was unsafe, traced through PostgreSQL's actual evaluation:** a
CHECK of the form `status = 'X' = (a IS NOT NULL AND b IS NOT NULL)` compares two booleans. `a IS
NOT NULL AND b IS NOT NULL` is `FALSE` in *three* distinct situations — `a` null & `b` null, `a`
null & `b` non-null, `a` non-null & `b` null — but the CHECK cannot distinguish which; it only asks
whether that three-way-`FALSE` result happens to equal `status <> 'X'`. Whenever `status` is
*any* value other than `'X'` (the common case, since most rows are not in the terminal state named
by that particular CHECK), the left side is `FALSE`, and the CHECK passes as long as `a`/`b` are
in *any* of those three not-fully-populated combinations — including the two partial ones that
should always be rejected regardless of `status`. This is exactly the mechanism behind every
concrete failure traced in §4 (`UserInvitation`'s `ACCEPTED`-with-a-dangling-`revokedAt` row,
`MfaEnrollment`'s `ACTIVE`-with-a-dangling-`revokedAt` row).

**Every CHECK in this document has been re-audited against this failure mode:**
- `UserInvitation`, `AccessRequest`, `MfaEnrollment`, `OutboxEvent`: rewritten as exhaustive,
  mutually exclusive, per-status-value branches, each branch a pure conjunction of `IS [NOT] NULL`
  tests naming every relevant field — never a boolean comparison against an independently-`FALSE`-
  able expression. Traced by hand in §4 for the two examples the review named, plus the equivalent
  `AccessRequest`/`OutboxEvent` cases; every branch is a straightforward conjunction with no
  three-valued-logic surprises, since `IS NULL`/`IS NOT NULL` always themselves evaluate to a
  definite `TRUE`/`FALSE`, never `NULL`, regardless of the tested column's value.
- `UserAccessPackageAssignment` and `DocumentPermissionGrant`'s `("revokedAt" IS NULL) =
  ("revokedById" IS NULL)` pattern: **audited and confirmed safe, left unchanged.** This differs
  structurally from the buggy pattern — both sides are `IS NULL` tests on the *same pair* of
  columns the CHECK is actually about, with no third, independent `status` column creating a
  coincidental match. `TRUE = TRUE` (both null) and `FALSE = FALSE` (both non-null) are the only
  ways to pass; `TRUE = FALSE` (exactly one null) always fails. There is no failure mode here.
- `UserSession`'s new `"revokedById" IS NULL OR "revokedAt" IS NOT NULL`: a plain two-term `OR` of
  `IS [NOT] NULL` tests, evaluates to a definite `TRUE`/`FALSE` for every possible combination of
  the two columns' nullness — no ambiguity.
- Every ordering CHECK added or restated in this revision (`consumedAt <= expiresAt`,
  `expiredAt >= expiresAt`, `acceptedAt <= expiresAt`, `deadLetteredAt >= createdAt`, etc.) uses
  the `col IS NULL OR col <op> other` guard form throughout, per this project's standing rule that
  a bare comparison against a nullable column would let PostgreSQL treat a `NULL` result as
  satisfied rather than failed.

**Trigger-path re-read for this revision — `INSERT`, `UPDATE`, `DELETE`, and concurrent
operations, traced explicitly per the review's closing instruction:**
- `MfaEnrollment` `INSERT`: only `mfa_enrollment_insert_must_be_pending_setup` fires (there is no
  `BEFORE INSERT ... OR UPDATE` combined trigger anywhere in this design); it inspects only
  `NEW.status`, so every other field combination on the row is irrelevant to its verdict — traced
  explicitly in §5 and exercised by §8's "every feasible field combination" test group.
- `MfaEnrollment` `UPDATE`: only `mfa_enrollment_transition_guard` fires; it is the sole authority
  for method immutability, revocation-fact immutability, and the transition whitelist. It replaces
  the prior revision's two separate `UPDATE` triggers on this table, removing any question of
  firing order between them (there is now exactly one).
- `MfaEnrollment` has no `DELETE` trigger and none is introduced — enrollments are never deleted,
  only revoked (a `REVOKED` row is retained as a permanent record, consistent with this project's
  standing evidence-retention discipline).
- `MfaTotpCredential`/`MfaWebAuthnCredential` `INSERT`: only the method-check trigger fires
  (`mfa_totp_credential_method_check` / the mirrored WebAuthn function) — the parent-immutability
  trigger is `BEFORE UPDATE` only and cannot fire on `INSERT`, where there is no `OLD` row to
  compare against; nothing is skipped, since the immutability check has nothing to protect until a
  row already exists.
- `MfaTotpCredential`/`MfaWebAuthnCredential` `UPDATE`: only the new parent-immutability trigger
  fires — the method-check trigger no longer fires on `UPDATE` at all (retired, per §5's item 3),
  so there is no risk of the two triggers disagreeing or firing in an order-dependent way; exactly
  one trigger owns `UPDATE`, exactly one owns `INSERT`, and they check disjoint things.
- `MfaTotpCredential`/`MfaWebAuthnCredential` `DELETE`: only the respective delete-guard fires,
  unchanged in logic from the prior revision, now locking the parent row via `FOR UPDATE`.
- **Concurrent operations:** every trigger above that reads a fact from a *different* row now
  either (a) is itself invoked by an `UPDATE` on that row (`MfaEnrollment`'s own transition guard,
  which therefore already holds the row's write lock) or (b) explicitly acquires
  `SELECT ... FOR UPDATE` on that row before reading it (the credential-table `INSERT` and
  `DELETE` triggers). No trigger in this design reads a cross-row fact without one of these two
  guarantees, which is the property the locking protocol in §5 depends on; confirmed by inspecting
  every `SELECT ... FROM "MfaEnrollment"` in this section's trigger bodies individually.

**Re-read for internal contradictions and forward references, specific to this revision's
changes:**
- §2's corrected trigger function is referenced (not restated) from §8's R2A-2 and R2A-3 sections.
- §4's `MfaEnrollment` default change (`ACTIVE → PENDING_SETUP`) is consistent with §5's lifecycle
  description and with §8's new activation-transition tests; no other section still assumes
  `ACTIVE` is the creation default.
- §6's unlinked-document two-part path introduces `documents.unlinked.access` as a `Permission`
  catalogue data row, not a new model — confirmed it does not appear in §8's "Exact models &
  fields" lists (which correctly list only schema objects), only in R2A-3's prose and test list.
- §6's per-user `TrustedDevice` uniqueness decision is reflected consistently in both the model
  description and R2A-3's test list (which now tests the positive multi-user case, not just the
  duplicate-rejection case).
- No model introduced in §4/§6 is referenced by an earlier sub-pass's triggers/CHECKs in §8 before
  its own introduction — the R2A-2/R2A-3 boundary from §3 is untouched by this revision.
- §1 (the CRITICAL algorithm), §3 (the split), and §7 (the migration strategy) are each stated once
  and referenced, not restated, everywhere else — confirmed no second, drifted description of any
  of the three exists anywhere in this revision.

**This revision's two corrected fixtures, re-checked specifically:**
- The corrected concurrency-test scenarios (§8) both start from `PENDING_SETUP` for both
  transactions, matching what the delete guard and transition guard actually permit at that
  status; neither scenario asserts a row is simultaneously in two different `status` values, and
  each commit/rollback variant's asserted outcome was traced against the trigger bodies in §5:
  scenario (1)'s commit variant relies on the transition guard's credential count read seeing A's
  committed deletion (guaranteed, since B's `UPDATE` cannot proceed past A's lock until A resolves,
  and a fresh read after acquiring a previously-contended lock sees the latest committed data under
  `READ COMMITTED`); scenario (2)'s commit variant relies on the delete guard's `FOR UPDATE` read of
  `status` seeing A's committed `ACTIVE` value for the identical reason.
- The `lock_timeout` caveat added to the concurrency-test description is consistent with
  PostgreSQL's documented behavior: a statement that errors out (including on `lock_timeout`)
  aborts the enclosing transaction, which then rejects all further statements until `ROLLBACK` —
  nothing in this document elsewhere claims or relies on a timed-out statement resuming on its own.
- The corrected revocation-immutability test (`REVOKED → REVOKED`) exercises the transition guard's
  same-status branch against a row where `revokedAt`/`revokedById` are actually non-null (only
  possible for `REVOKED`, per §4's shape CHECK), which is the only status value where "changing a
  revocation field" is a constructible fixture at all — confirmed no other status admits a non-null
  `revokedAt`/`revokedById` to begin with, so no equivalent test is missing for `PENDING_SETUP` or
  `ACTIVE`.

**No unresolved architecture decision remains that is required to start R2A-1.**

---

## Exact Git state confirmation

- Branch: `backend-foundation` — unaffected by this document. HEAD:
  `9cdd8f3ec4167e33b94dd85340d1c46829a5ad87` (unchanged).
- `origin/main`: `6dc9de2a827d2902f5d14870ab8dc1560174832b` (unchanged, never merged into).
- This document is committed only to `r2-design-review`, as a **new** commit on top of
  `20a814edd07fddd32c55eaad43a25981d46b63d5` (which is not amended); the branch's full history
  remains `9cdd8f3` → `bd11f6c` → `c17839c` → `626324b` → `a963958` → `20a814e` → (this commit).
- No `schema.prisma`, migration, application code, test, or package file is touched by this commit.
- R2A-1, R2A-2, R2A-3, R2B, R2C, M14, M15, and Phase 0B implementation were not started.
