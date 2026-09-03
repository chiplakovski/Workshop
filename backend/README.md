# Varmak Workshop — Backend

Phase 0A (corrected in Phase 0A-R1): backend foundation and database schema only. There is no
authentication, no business CRUD, and no frontend integration in this phase — see "Phase 0A scope"
below.

## Stack

- NestJS 12 (TypeScript, strict mode), modular monolith — not microservices.
- PostgreSQL via Prisma 7 (`prisma-client` generator, driver-adapter based — see below).
- `oxlint` for linting, `vitest` for testing.

## Project setup

```bash
npm install
cp .env.example .env   # then edit DATABASE_URL for your machine
```

For a local database, either:

- `docker compose up -d` (uses `docker-compose.yml`, Postgres on `localhost:5432`), or
- `npx prisma dev` (Prisma's own managed local Postgres server — what this schema and its
  migration were authored and verified against in an environment without Docker available).

Then generate the Prisma Client and apply migrations:

```bash
npx prisma generate
npx prisma migrate deploy   # applies existing migrations without prompting
```

## Prisma 7 driver adapters

This project uses Prisma 7's newer `prisma-client` generator, which requires an explicit driver
adapter rather than reading `DATABASE_URL` implicitly at `PrismaClient` construction time. See
`src/prisma/prisma.service.ts` — it constructs `PrismaClient` with a `PrismaPg` adapter
(`@prisma/adapter-pg`) built from `process.env.DATABASE_URL`.

## Scripts

```bash
npm run build              # nest build
npm run lint                # oxlint src/ test/
npm test                     # vitest run — unit tests (src/**/*.spec.ts), no database required
npm run test:e2e               # vitest run --config vitest.config.e2e.ts — requires a live database
npm run test:integration         # vitest run --config vitest.config.integration.ts — requires a live
                                  # database with the current migration applied; exercises every
                                  # CHECK constraint, trigger and functional index in
                                  # test/database-constraints.integration-spec.ts
```

`test:e2e` boots the full `AppModule`, which connects to a real database via `PrismaModule` — it
is not run as part of routine `npm test`. `test:integration` is a separate, narrower suite that
talks to the database directly (no Nest bootstrap) specifically to prove the hand-written SQL
constraints below actually work; run it against a freshly-migrated database before any release
that touches `prisma/schema.prisma` or the migration.

## Database protections that are not expressed in schema.prisma

Prisma's schema language cannot express every constraint this project's database rules require —
confirmed directly against Prisma 7.10.0: there is no `@@check` attribute, no functional/partial
unique index, and no trigger support. The following are added as hand-written SQL appended to the
initial migration (`prisma/migrations/<timestamp>_init/migration.sql`), directly after the
Prisma-generated DDL, and are exercised by `npm run test:integration`:

1. **`SafetyEvent`, `QualityRelease` and `AuditLog` are append-only.** Each has its own trigger
   (`safety_event_append_only()`, `quality_release_append_only()`, `audit_log_append_only()`,
   attached as `BEFORE UPDATE` and `BEFORE DELETE` triggers) that rejects every UPDATE and DELETE
   against that table unconditionally.

   Known limitation: the ideal enforcement point is a dedicated, low-privilege application
   database role with INSERT/SELECT-only grants on these tables — a true permission-level
   `REVOKE UPDATE, DELETE`. No such role exists yet; this environment has no application database
   user distinct from the migration/superuser role. Provisioning that role is deferred to when a
   real deployment target and connection-pooling role exist. The triggers are a real, working
   enforcement mechanism in the meantime — verified to reject both UPDATE and DELETE on all three
   tables — but they are not a substitute for a permission-level grant, since a role with
   `BYPASSRLS`/superuser privilege, or a future migration that drops the trigger, could still
   bypass them.

2. **`SafetyEvent` targets exactly one typed foreign key (or, for `DOCUMENT_SUPERSEDED`, a typed
   pair), matching its `kind`.** A CHECK constraint (`SafetyEvent_exactly_one_target`) enforces
   that `EQUIPMENT_BLOCK`/`EQUIPMENT_PASS` set `equipmentId` only, `HOLD_APPLY`/`HOLD_RELEASE` set
   `qualityHoldId` only, `RELEASE_GRANT`/`RELEASE_REJECT` set `qualityReleaseId` only, and
   `DOCUMENT_SUPERSEDED` sets **both** `previousDocumentId` and `newDocumentId` (real FKs to
   `Document`, required to differ from each other) with every other target column NULL. A second
   CHECK constraint (`SafetyEvent_actor_consistency`) forbids anonymous actions: `actorType =
   'USER'` requires `userId` set, `actorType = 'SYSTEM'` requires it NULL. `reasons` (default
   `'[]'`) and `decisionSnapshot` are plain NOT NULL columns — a successful gate may record zero
   reasons, but never a missing (NULL) reasons list or snapshot.

   *Phase 0A-R1 review-correction*: `DOCUMENT_SUPERSEDED` previously identified only the
   `QualityHold`/`QualityRelease` context a supersession happened in, without naming the two
   actual `Document` rows involved. `previousDocumentId`/`newDocumentId` fix that — this kind no
   longer touches `equipmentId`/`qualityHoldId`/`qualityReleaseId` at all.

3. **`QualityRelease.previousVersionId` and `Document.previousVersionId` cannot reference their
   own row.** A `CHECK` constraint on each (`previousVersionId IS NULL OR previousVersionId <>
   id`). This is only the one-hop case of Decision 8's cycle-prevention requirement. Full
   multi-hop cycle prevention (A supersedes B supersedes A, or longer chains) is not expressible
   as a plain SQL constraint on a self-referential column and is deferred to application-level
   validation and tests, per the Architecture Contract's own instruction on this point.

   *Phase 0A-R1 review-correction*: `QualityRelease.supersededAt` was removed entirely — an
   immutable, insert-only row can never later be UPDATEd to record when it was superseded. That
   fact is now carried purely by the *new* row's own `previousVersionId` and `createdAt`/
   `decidedAt`, which is the only place it could ever have been recorded correctly.

4. **`QualityRelease` decision-level attribution, for every result.** *(Phase 0A-R1
   review-correction — the original design let `RELEASED`/`RELEASED_WITH_CONDITIONS` rows through
   with a NULL actor, time and gate snapshot.)* `decisionActorType` (required) plus
   `decidedById`/`decidedAt` replace the old `releasedBy`-only fields, with the same
   USER-requires-actor / SYSTEM-forbids-actor CHECK (`QualityRelease_actor_consistency`) used by
   SafetyEvent and QualityHold. `gateVersion` is required and CHECK-enforced non-blank
   (`QualityRelease_gateVersion_normalized`). `gateResultSnapshot` and `decidedAt` are plain NOT
   NULL columns (sufficient on their own — "a decision cannot exist without its snapshot" needs no
   separate CHECK). `blockingReasons` is required JSON, defaulting to `'[]'` when there are none,
   so "no reasons" and "reasons not recorded" can never be confused as the same NULL.
   `RELEASED_WITH_CONDITIONS` carrying actual conditions is a content-shape rule on an arbitrary
   JSON blob — deliberately left to the future Phase 0B `ReleaseGateService` rather than a brittle
   SQL check, per instruction.

5. **`QualityHold` target-scope integrity.** A CHECK constraint (`QualityHold_valid_target`)
   enforces that `PROJECT` scope requires `projectId` and forbids `jobcardId`, and `JOBCARD` scope
   requires `jobcardId` and forbids `projectId` — a hold can never exist without a valid target.

6. **`QualityHold` apply/release actor consistency and release-fact integrity.** *(Phase 0A-R1
   review-correction — the original design had no actor-type field for either apply or release, and
   nothing stopped a row from being inserted directly as `RELEASED` with incomplete release
   facts.)* `appliedActorType` (required) pairs with `appliedById` under the same USER/SYSTEM CHECK
   (`QualityHold_applied_actor_consistency`) as SafetyEvent; `releasedActorType` is nullable until
   release. One comprehensive CHECK (`QualityHold_release_fields_consistency`) ties every release
   field to `status` in both directions at once: an `ACTIVE` row must have `releasedActorType`,
   `releasedById`, `releasedAt`, `releaseReason` and `releaseEvidenceRef` **all** NULL; a
   `RELEASED` row must have all of them populated and mutually consistent (actor type set, actor
   vs. id consistent, `releasedAt` set, `releaseReason`/`releaseEvidenceRef` both non-blank). This
   one constraint is what makes it impossible to insert a row directly as `RELEASED` with
   incomplete facts, and equally impossible to populate any release field while `status` is still
   `ACTIVE` (via either INSERT or UPDATE — a CHECK constraint applies to both).

   A narrower trigger than #1 above: the `ACTIVE -> RELEASED` transition itself is a legitimate,
   required UPDATE (unlike SafetyEvent, QualityRelease and AuditLog, which are insert-only from the
   start), but once `status` is `RELEASED`, a trigger (`quality_hold_release_immutable()`) rejects
   any further change to `status` or any release field (including `releasedActorType`) on that row.
   The full historical apply/release trail is additionally recorded, unconditionally immutably, in
   `SafetyEvent` (kind `HOLD_APPLY` / `HOLD_RELEASE`).

   A note on writing these two CHECK constraints (and the analogous ones on QualityRelease/
   SafetyEvent): **a Postgres CHECK expression that evaluates to NULL is treated as *satisfied*,
   not failed.** A naive `length(btrim(releaseReason)) > 0` on a nullable column would silently
   pass when `releaseReason` is NULL (`btrim(NULL)` is NULL, and `NULL > 0` is NULL, not FALSE).
   Every conditional "required when X" check in this migration therefore adds an explicit
   `col IS NOT NULL AND ...` guard rather than relying on the comparison alone.

7. **At most one active `TeamMembership` per `(userId, teamId)`.** A partial (WHERE-clause)
   unique index — `CREATE UNIQUE INDEX ... WHERE "active" = true` — since Prisma's `@@unique`
   cannot be conditioned on another column's value. A user may still hold multiple historical,
   non-overlapping memberships on the same team; only simultaneous *active* duplicates are
   rejected.

8. **Case-insensitive `User.email` uniqueness.** A functional unique index
   (`CREATE UNIQUE INDEX ... ON "User" (LOWER(email))`) — Prisma's declarative `@unique` can only
   express a case-sensitive index, which would incorrectly allow both `A@x.com` and `a@x.com` to
   register as distinct accounts.

9. **Numeric range and date-order constraints.** Percentages/probabilities are constrained to
   `[0, 100]` (`EstimationLine.discountPct/taxPct/wastePct`, `MarketingOpportunity.probability`);
   quantity and hours fields are constrained non-negative (stock levels, planned/logged/used
   hours, BOM/requisition quantities, meter readings — but deliberately *not*
   `StockCount.difference`, which is legitimately signed); `TeamMembership.validTo` cannot precede
   `validFrom`; `EquipmentUsageSession.meterAfter` cannot be lower than `meterBefore`.

10. **Normalized (non-empty) business codes.** Every unique human-readable business identifier —
   every `no` field, plus `InventoryItem.code`, `BarcodeLink.barcode`, `Offcut.code`,
   `Equipment.equipmentId` — has a `CHECK (length(btrim(col)) > 0)` constraint, rejecting empty or
   whitespace-only values.

## UUID identity (Phase 0A-R1)

Every model has a database-native UUID `id` primary key, without exception. Prior to Phase 0A-R1,
`InventoryItem` and `BarcodeLink` used their human-readable business key (`code`, `barcode`) as
the primary key itself. This was corrected: both now have a real `id` UUID primary key, with
`code`/`barcode` demoted to a separate unique business-key column, and every relationship that
previously referenced them by that business key (`ProjectBomLine`, `InventoryLot`,
`StockMovement`, `Offcut`, `StockCount`, `BarcodeLink`, `PurchaseRequisitionLine`) now uses a real
UUID foreign key (`inventoryItemId`) instead.

## Phase 0A scope

This phase establishes only the backend project skeleton and the database schema/migration. It
deliberately does not include: authentication or login endpoints, any replacement of the existing
frontend's login, business CRUD endpoints or workflow services, gate logic (Final Release,
Quality Hold, Equipment Safety), Jobcard completion logic, file upload or malware scanning,
localStorage import/migration, frontend API calls, notifications, external integrations, or
seed data of any kind (development or production). See the Backend Architecture Contract for the
full phased plan.

## Production dependency packaging (Phase 0A-R1, corrected in the review-correction pass)

`npm audit --omit=dev` originally reported 4 HIGH vulnerabilities even in a genuinely clean
production-only install (`npm ci --omit=dev` in an isolated directory — not an artifact of a mixed
dev+prod `node_modules`). Root cause: `@prisma/client`'s own `package.json` declares `prisma` as
an **optional peer dependency** (`peerDependenciesMeta.prisma.optional = true`). Because this
project also lists `prisma` in `devDependencies` (needed for `prisma7.config.ts`, which imports
`prisma/config` and therefore requires `prisma` to be a real, locally-resolvable package — an
`npx prisma@<version>` invocation with `prisma` removed from `devDependencies` cannot load that
config file), npm resolves and keeps that optional peer even under `--omit=dev` (recorded as
`devOptional` in `package-lock.json`, which survives the `--omit=dev` filter). That optional peer
drags in `prisma`'s own heavier dependency tree — `@prisma/config` → `deepmerge-ts` (stack
exhaustion, GHSA-ggr8-5vv4-36mx) and `mysql2` (auth-plugin downgrade + decompression-bomb DoS,
GHSA-3f6p-5ww8-9rcr / GHSA-rgwj-5xj2-c3m3) — into the production dependency graph.

**First-pass fix (superseded — do not reintroduce):** an `overrides` entry forcing `deepmerge-ts`
and `mysql2` to patched versions. Reviewed and rejected: forcing a major transitive version
(`deepmerge-ts` 7.x → 8.x) onto a package neither declared nor tested against it is not something
`prisma format`/`validate`/`generate` passing proves is actually supported — those three commands
don't exercise anywhere near the surface of `@prisma/config`'s internal usage of `deepmerge-ts`.

**Actual fix: exclude Prisma's optional CLI peer from the production install entirely**, rather
than patching what it pulls in. `prisma` stays exactly as published in `devDependencies` — no
version forcing anywhere. The production install/audit commands change instead:

```bash
npm ci --omit=dev --omit=optional
npm audit --omit=dev --omit=optional
```

`--omit=optional` is what actually excludes the `devOptional`-flagged `prisma` package (and
everything reachable only through it) — `--omit=dev` alone does not, since `devOptional` survives
that filter by design (see above). Verified directly, both in isolation and against this project:

- `npm ci --omit=dev --omit=optional` installs 127 packages (vs. 260 for `--omit=dev` alone);
  `node_modules/prisma` is absent; `@prisma/client` and `@prisma/adapter-pg` (the real runtime
  dependencies) are present.
- `npm audit --omit=dev --omit=optional` reports **0 vulnerabilities** — with no `overrides` of
  any kind.
- `npx prisma format`/`validate`/`generate` all continue to work normally from the full
  dev install, since `prisma` is untouched there.
- **The production artifact actually boots and connects to PostgreSQL** using exactly this
  install: `nest build` (dist/ includes the compiled generated Prisma Client, since it lives
  under `src/generated/prisma`) → copy `dist/`, `package.json`, `package-lock.json` to an
  isolated directory → `npm ci --omit=dev --omit=optional` there → `node dist/main.js` against a
  live database. Observed log output: `[PrismaService] Connected to the database.` followed by
  `Nest application successfully started`, and a live HTTP request to the running process
  returned the expected response.

The full dev+prod graph (plain `npm audit`, no flags) still reports the same 4 HIGH findings —
correctly, since `prisma` genuinely is a devDependency with its own heavier tree. That's expected
and no longer a production concern: the findings live entirely in tooling that this packaging
strategy proves does not ship. No advisories were hidden, suppressed, or routed around with an
incompatible override.
