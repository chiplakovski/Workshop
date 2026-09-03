# Varmak Workshop — Backend

Phase 0A: backend foundation and database schema only. There is no authentication, no business
CRUD, and no frontend integration in this phase — see "Phase 0A scope" below.

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
npm run build        # nest build
npm run lint          # oxlint src/ test/
npm test               # vitest run — unit tests (src/**/*.spec.ts)
npm run test:e2e         # vitest run --config vitest.config.e2e.ts — requires a live database
```

`test:e2e` is not part of the Phase 0A validation set: it boots the full `AppModule`, which
connects to a real database via `PrismaModule`. Phase 0A's required checks are the unit tests
only (`npm test`), which do not touch Prisma.

## Database protections that are not expressed in schema.prisma

Prisma's schema language cannot express every constraint this project's database rules require.
The following are added as hand-written SQL appended to the initial migration
(`prisma/migrations/<timestamp>_init/migration.sql`), directly after the Prisma-generated DDL:

1. **`SafetyEvent` append-only.** A trigger (`safety_event_append_only()`, attached as
   `BEFORE UPDATE` and `BEFORE DELETE` triggers) rejects every UPDATE and DELETE against the
   `SafetyEvent` table unconditionally.

   Known limitation: the ideal enforcement point is a dedicated, low-privilege application
   database role with INSERT/SELECT-only grants on this table — a true permission-level
   `REVOKE UPDATE, DELETE`. No such role exists yet; Phase 0A has no application database user
   distinct from the migration/superuser role. Provisioning that role is deferred to when a real
   deployment target and connection-pooling role exist. The trigger is a real, working
   enforcement mechanism in the meantime — it was verified to reject both UPDATE and DELETE
   during Phase 0A — but it is not a substitute for a permission-level grant, since a role with
   `BYPASSRLS`/superuser privilege, or a future migration that drops the trigger, could still
   bypass it.

2. **At most one active `TeamMembership` per `(userId, teamId)`.** A partial (WHERE-clause)
   unique index — `CREATE UNIQUE INDEX ... WHERE "active" = true` — since Prisma's `@@unique`
   cannot be conditioned on another column's value. A user may still hold multiple historical,
   non-overlapping memberships on the same team; only simultaneous *active* duplicates are
   rejected.

3. **`Document.previousVersionId` cannot reference its own row.** A `CHECK` constraint
   (`previousVersionId IS NULL OR previousVersionId <> id`). This is only the one-hop case of
   Decision 8's cycle-prevention requirement. Full multi-hop cycle prevention (A supersedes B
   supersedes A, or longer chains) is not expressible as a plain SQL constraint on a
   self-referential column and is deferred to application-level validation and tests, per the
   Architecture Contract's own instruction on this point.

All three were verified against a running local PostgreSQL instance during Phase 0A: inserts
succeed, the disallowed UPDATE/DELETE/duplicate/self-reference operations are rejected, and
legitimate operations (a second *inactive* membership, a document superseding a *different*
document) succeed.

## Phase 0A scope

This phase establishes only the backend project skeleton and the database schema/migration. It
deliberately does not include: authentication or login endpoints, any replacement of the existing
frontend's login, business CRUD endpoints or workflow services, gate logic (Final Release,
Quality Hold, Equipment Safety), Jobcard completion logic, file upload or malware scanning,
localStorage import/migration, frontend API calls, notifications, external integrations, or
seed data of any kind (development or production). See the Backend Architecture Contract for the
full phased plan.
