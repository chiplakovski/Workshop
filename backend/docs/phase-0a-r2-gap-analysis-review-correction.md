# Phase 0A-R2 Gap Analysis — Review Correction

Design-only document. No schema, migration, application code, tests, or package files are
part of this commit — see the confirmation section at the end.

**Branch:** `backend-foundation`
**HEAD (unchanged by this document):** `9cdd8f3ec4167e33b94dd85340d1c46829a5ad87`
**Parent:** `527237a183dff223c9287de1778b28ceb19fba76`
**`origin/main` (untouched):** `6dc9de2a827d2902f5d14870ab8dc1560174832b`

This document **supersedes** the original *Phase 0A-R2 Gap Analysis* for design purposes. That
document's frontend fact-finding (five parallel investigations, exact file/line citations across
the `main` working tree) remains valid and is reused here without re-verification; only the design
conclusions built on top of it are corrected below.

---

## What changed, and why

Ten corrections were mandatory. Each one is a real design flaw in the original document, not a
stylistic preference — several repeat mistake classes this same project already paid to learn and
fix during Phase 0A-R1 (e.g. proposing a CHECK constraint for something CHECK constraints
structurally cannot do; proposing a polymorphic soft-link the Architecture Contract already
rejected once).

1. **M15 (Frontend UX: UI-01, HUB-01, UI-02) added** — the original silently dropped these three
   requirements entirely.
2. **M2 identity model corrected** — removed the `active=true` + `PENDING_APPROVAL` dual-authority
   conflict; added session/token, MFA, notification/outbox, and explicit grant-materialization
   design; replaced generic scope with typed FK scope columns.
3. **M4 document-security model corrected** — removed the ambiguous `granteeId`; normalized the 11
   actions into real enum-constrained rows; added `DocumentAccessEvent`; token now stores a hash,
   never the raw bearer value; added an explicit upload-lifecycle enum; resolved the
   confidentiality-lock-vs-classification duplication.
4. **Equipment assignment/reservation model added** — `JobcardOperation.equipmentId` alone was
   never sufficient for a server-authoritative safety gate; M7 now proposes real reservation,
   maintenance, certification, and calibration tables.
5. **M1 (EST-01) substantially deepened** — immutable revisions, item hierarchy, rate/price
   snapshots, currency/rounding, and explicit traceability chains were all missing from the
   original.
6. **M5 inventory corrected** — retracted a genuinely incorrect claim (a CHECK constraint cannot
   compare a row's value against a cross-row `SUM()`); `InventoryItem.stock`/`reserved` are now
   proposed for deprecation as writable fields, not kept as a second, driftable source of truth.
7. **M13 cross-record consistency substantially deepened** — the original overclaimed that
   ordinary FKs solve consistency; six specific relationships are now analyzed with an explicit
   CHECK-vs-trigger-vs-application-layer judgment for each.
8. **M8 customer/supplier master data deepened** — addresses, supplier contacts/products/pricing,
   and a real commercial `SupplierApproval` distinct from `SupplierQuality` are added.
9. **M9's `ProjectTask.resourceId` design corrected** — replaced with typed
   `ProjectTaskUserAssignment`/`ProjectTaskEquipmentAssignment` tables; Planning Scenarios promoted
   from an open question to an in-scope R2C deliverable per binding decision 5.
10. **M6's RFQ design corrected** — a single `supplierId` field cannot represent "one RFQ, several
    invited suppliers, several comparable responses"; a full header/line/invitation/response/
    response-line structure is proposed.

Ten decisions that the original document left open are now applied as binding directives — see
the next section. They are woven into every module below; nothing in this document treats them as
still-open.

---

## Binding decisions now in effect

These were open questions in the original document. They are directives here — every module below
is designed consistently with them, not around a hypothetical alternative.

1. **Estimate acceptance is template-only, not live production.** Accepting an Estimation
   atomically creates ProjectItems + BOM + operation *templates*. It never auto-issues a live
   Jobcard. A Project Manager reviews the generated structure and explicitly creates/releases
   Jobcards from it.
2. **EstimationLine is retired for new writes; "Quick Estimate" is not a second model.** Kept
   read-only for legacy/migration compatibility only. A "quick" estimate is implemented as exactly
   one default EstimateItem — there is one Estimation data model, not two.
3. **Ordinary document access gets its own append-only table; SafetyEvent stays narrow.** A
   dedicated `DocumentAccessEvent` records metadata-view/preview/native-open/download/print/share.
   `SafetyEvent` remains scoped to gate decisions (equipment/hold/release) and safety-document
   supersession — it is not extended with a fifth target type or flooded with routine file access.
4. **Managed-device enforcement is a provider-neutral TrustedDevice/DeviceAttestation model.**
   Entra ID/Intune can become the first real attestation provider later; the schema itself names no
   vendor. IP allowlisting alone is explicitly rejected as device verification. When a grant
   requires a managed device and trust cannot be verified, access is denied — fail closed, not
   open.
5. **Planning Scenarios are in scope for R2C.** Draft scenario, comparison, versioning, and
   explicit promotion to the committed schedule are real deliverables, not a frontend-only
   demonstration left standing indefinitely.
6. **Logged hours are never hard-blocked.** Real hours are always saved. Crossing a configurable
   overrun threshold requires a reason and shows a warning; the override is recorded in AuditLog.
   The database never refuses to record real labor.
7. **Saved Reports: PRIVATE / TEAM / COMPANY visibility, default PRIVATE, executed under the
   viewer's own scope.** Explicit share rows exist for individual users/teams beyond the
   visibility tier. Critically: a shared report always re-executes under the *viewer's* current
   permissions and row scope — never the creator's — so sharing a report can never leak rows the
   viewer wasn't already allowed to see.
8. **Commercial SupplierApproval is separate from SupplierQuality approval.** A supplier can be
   commercially approved (creditworthy, contracted, onboarded) while quality-pending, or vice
   versa — these are two independent facts, not one field wearing two names.
9. **Jobcard equipment summary is derived, not a second writable source of truth.** Computed from
   real `EquipmentAssignment` rows and `JobcardOperation.equipmentId`. The frontend's `machines[]`
   array is not carried forward as an independently-writable backend field.
10. **Internal row scope: OWN, ASSIGNED, TEAM, SITE, COMPANY — via real typed FK columns, not a
    polymorphic scope link.** A future Customer/Supplier portal scope is supported the same way,
    with its own dedicated typed FK scope rows when it's built — never a generic
    `scopeType`/`scopeId` soft-link, which the Architecture Contract already rejected once for a
    different subsystem.

---

# A — Module-by-module gap analysis (revised)

## M1 — Estimation & Project Items (EST-01)

Frontend capability and backend-coverage facts are unchanged from the original (still cited
there). This revision replaces the "missing model/field/FK" design with the depth the review
correction requires — immutability, hierarchy, snapshots, and full traceability were all absent
before.

**Status:** Not a Phase 0A blocker.

**Missing model/field/FK**
- `Estimation` gains `kind{QUOTATION,CHANGE_ORDER}`, `ownerId` FK, and (for CHANGE_ORDER) a
  required `changeOrderOfProjectId` FK.
- `EstimationRevision` (new, append-only): estimationId FK, revisionNumber, snapshotJson,
  createdAt, createdById. Real point-in-time immutability — the frontend's own `createRevision()`
  already does this conceptually with a JSON snapshot; the backend makes the row itself insert-only
  (same pattern as `QualityRelease`/`SafetyEvent`).
- `EstimateItem` (new): estimationId FK, `parentItemId` (nullable self-FK, for assemblies/
  sub-items), `sequence Int`, `itemNumber` (stable, human-assigned, unique within the estimation),
  `optionGroupId` (nullable — groups mutually-exclusive alternatives) + `isSelectedAlternative
  Boolean`, plus item-level `overheadPct`, `riskPct`, `marginPct` (per EST-01's explicit "every
  item has ... overhead, risk ... margin" wording — these are deliberately item-level, not only
  estimate-level, unlike the frontend's estimate-only overhead/contingency).
- `EstimateItemMaterialLine` / `LabourLine` / `MachineLine` / `SubcontractLine` / `OtherCostLine`
  (new): each with an *optional* source FK (`inventoryItemId`, `supplierId`, `equipmentId`
  respectively, all nullable) **plus** a required `quotedDescription` and `unitCostSnapshot`/
  `unitSellSnapshot` (Decimal, never a live join to current master rates) — so accepting a change
  to a supplier's price list next month cannot silently reshape an estimate issued last month.
  Currency is stored explicitly per line; a single `roundingRule` enum on Estimation governs how
  line/item rollups round.
- `ProjectItem` (new): projectId FK, `sourceEstimateItemId` FK (nullable — legitimately null for
  items added directly to a Project without going through Estimation), `sourceEstimationRevisionId`
  FK (nullable, records exactly which accepted revision produced it), delivery date/status fields.

**Enums / transitions**
`EstimationKind{QUOTATION,CHANGE_ORDER}`. `ProjectItemStatus{PLANNED,IN_PROGRESS,COMPLETED,
DELIVERED,CANCELLED}` — deliberately independent of Jobcard/Estimation status (binding
requirement: completing estimation must never mark production complete). Per binding decision 1,
ProjectItem acceptance creates BOM/operation *templates*, not live Jobcards — the template *is*
the ProjectBomLine/operation-template rows themselves, materialized once, then edited freely by a
human before a real Jobcard is ever released from them.

**FK & delete behaviour**
All new FKs `onDelete: Restrict`, consistent with the whole schema's existing convention.
`EstimateItem.parentItemId` self-relation needs the same one-hop self-reference CHECK already
proven for `Document.previousVersionId`/`QualityRelease.previousVersionId` (id ≠ parentItemId);
true multi-level assembly cycles are, like those two precedents, deferred to application-level
validation.

**Atomic transactions**
Accepting a quotation (or change order) → insert N ProjectItem rows + their generated
ProjectBomLine/operation-template rows + one EstimationRevision snapshot, all in a single
transaction. Per binding decision 1, this transaction never touches the Jobcard tables at all.

**Permissions & row scope**
Create/edit: Estimator role, row-scoped OWN (via the new `ownerId`) or TEAM. Accept/convert:
Project Manager or Admin — a materially higher-privilege action since it commits
production-facing records.

**Audit & safety**
`AuditLog` entry on acceptance/conversion and on every change-order application. Not SafetyEvent
material.

**Migration implications**
Additive. Per binding decision 2, `EstimationLine` is not dropped — it becomes read-only for
legacy rows; no new write path targets it once EstimateItem exists.

---

## M2 — Identity, Sessions & Access Packages (AUTH-01 / AUTH-02)

The single largest correction in this document. The original proposal had a real conflict (two
independent status signals implying authority) and two design shortcuts (abusing UserRole for
customization, a generic scope) that the review correctly rejected.

**Status:** Gates row scope for every other module.

**Corrected identity model**
`User.approvalStatus{PENDING_APPROVAL,ACTIVE,SUSPENDED,REJECTED}` is **the** authoritative
lifecycle field. `User.active` is removed as an independent status signal (its prior role — "can
this user do anything at all" — is now a pure derived fact: `active` ⇔ `approvalStatus = ACTIVE`)
rather than a second column an application could set inconsistently with the first. A
newly-registered user always starts `PENDING_APPROVAL` with zero rows in any grant table —
enforced structurally by the fact that grant creation is the only thing that ever changes what a
user can do, and grant creation is itself gated on `approvalStatus = ACTIVE` at the service layer
(see the DB-vs-service split below).

**New models — identity & verification**
- `User.emailVerifiedAt` (nullable DateTime) — a verified-email `AccessRequest` requires this to
  be non-null before it can be approved.
- `UserSession` (new): userId FK, `refreshTokenHash` (never the raw token — same discipline as
  M4's DocumentOpenToken), `expiresAt`, `revokedAt` (nullable), device/user-agent metadata,
  createdAt.
- `MfaEnrollment` (new): userId FK, method enum, secretHash/credentialRef (never a raw secret),
  `enrolledAt`, `enforced Boolean` — the schema records enrollment/enforcement state; the actual
  challenge/verification flow is Phase 0B service logic.
- `Notification` (new): recipientUserId FK, kind, payload (Json), `readAt` (nullable), createdAt —
  the durable record an "administrator approval notification" is.
- `OutboxEvent` (new, transactional outbox pattern): aggregateType, aggregateId, eventType,
  payload (Json), `processedAt` (nullable), createdAt. This is what lets "approve a user" and
  "queue the approval email" commit in the *same* database transaction without the backend
  directly calling an email provider inline — a separate dispatcher process reads unprocessed
  OutboxEvent rows and sends the actual email, so a crash between "approved in the DB" and "email
  sent" can never happen silently.

**New models — access requests & invitations**
`AccessRequest` (new): requestedByEmail (pre-account) or requestedByUserId, justification, status,
decidedById FK, decidedAt. `UserInvitation` (new): invitedEmail, invitedById FK (administrator),
tokenHash (never raw), expiresAt, status{PENDING,ACCEPTED,EXPIRED,REVOKED}.

**Corrected grant materialization — resolves the "abusing UserRole" question directly**
`AccessPackage` (template): a named bundle of default module/action/row-scope/document-clearance
settings. It is **never** read at authorization-check time — no service ever asks "what does this
user's package say." Assigning a package to a user is a one-time (or re-appliable) *materialization*
step that writes real `UserPermissionGrant` rows (new model: userId FK, moduleKey, action,
`scopeKind{OWN,ASSIGNED,TEAM,SITE,COMPANY}` + the typed scope FKs below, `documentClearance`
nullable classification ceiling, **plus full provenance**: `sourceAccessPackageId` nullable FK,
`grantedById` FK, `reason`, `validFrom`, `validTo` nullable, `revokedAt` nullable, `revokedById`
nullable FK). Customizing a package's defaults for one user just means the materialized
`UserPermissionGrant` rows differ from a fresh application of the template — the template is never
mutated to match, and re-applying the template later does not silently overwrite a customized
grant (a real product behavior worth confirming with the owner once Phase 0B design begins,
flagged here for visibility, not left unresolved as an open decision — it is an implementation
detail of the materialization step, not a schema question).

**Corrected row scope — no polymorphic scope link**
Per binding decision 10: `UserPermissionGrant` carries `scopeKind` plus four nullable,
individually-real FK columns — `siteId`, `teamId`, `projectId`, `jobcardId` — never a generic
`scopeType`/`scopeId` pair. A CHECK constraint (the same "exactly one populated, matching the
discriminator" pattern already proven for `SafetyEvent`'s target columns in Phase 0A-R1) enforces:
`OWN`/`COMPANY` ⇒ all four NULL; `SITE` ⇒ only siteId set; `TEAM` ⇒ only teamId set; `ASSIGNED` ⇒
exactly one of projectId/jobcardId set. A future Customer/Supplier portal scope, when built, gets
its own new typed FK column on a purpose-built grant table rather than retrofitting this enum —
not designed here, deliberately, since it isn't requested yet.

**Enums / transitions**
`UserApprovalStatus{PENDING_APPROVAL,ACTIVE,SUSPENDED,REJECTED}`. `AccessRequestStatus{PENDING,
APPROVED,REJECTED,EXPIRED}`. `InvitationStatus{PENDING,ACCEPTED,EXPIRED,REVOKED}`.
`GrantScopeKind{OWN,ASSIGNED,TEAM,SITE,COMPANY}`.

**Database-enforceable invariants vs. Phase 0B service/AuthGuard tests — explicit split**
*What the schema can prove by itself:* a UserPermissionGrant row's scope columns are internally
consistent (CHECK, above); a revoked grant has both `revokedAt` and `revokedById` set together or
neither (CHECK); a session's refresh-token hash is unique; an expired/revoked grant or session is
a plain, queryable fact (`validTo < now()` or `revokedAt IS NOT NULL`).
*What only a running NestJS AuthGuard + integration test can prove:* that an actual HTTP request
from a PENDING_APPROVAL or SUSPENDED user is rejected; that a direct URL/API call with no matching
UserPermissionGrant returns 403; that an expired session is actually refused at the middleware
layer, not just marked expired in the table.
**This document does not claim the Prisma schema alone proves runtime authorization** — it proves
the data *can* represent every required state correctly and unambiguously; enforcing it against
live traffic is Phase 0B application code, explicitly out of scope here exactly as it was for
Phase 0A itself.

**Audit & safety**
Every request/approval/rejection/grant/revocation/suspension writes an `AuditLog` entry — the
explicit requirement. `UserPermissionGrant`'s own provenance fields (grantedById/reason/
revokedById) make each row self-documenting even before the AuditLog entry is consulted, giving
genuine defense in depth.

**Migration implications**
Additive; removing `User.active` as an independent field is the one field-level change to an
existing, already-shipped-and-approved model — a real, if small, backward-incompatible change
worth calling out explicitly rather than treating as purely additive.

---

## M3 — Documents: Native Open, Checkout & Upload Lifecycle (DOC-02)

**Status:** Not a Phase 0A blocker.

**Corrected token design**
`DocumentOpenToken` stores **only** `tokenHash` (or a JTI + separate hash) — never the raw bearer
value, matching the same discipline now applied to `UserSession.refreshTokenHash` and
`UserInvitation.tokenHash` in M2. Fields: documentId (a specific *version* — i.e. one immutable
Document row, not "the document" abstractly), userId FK, action{OPEN,DOWNLOAD}, expiresAt,
`consumedAt` nullable, `revokedAt` nullable, `trustedDeviceId` nullable FK (see M4 — device
binding is optional per grant, not mandatory for every token).

**Upload lifecycle — new, explicit**
`UploadLifecycleStatus{UPLOADING,QUARANTINED,SCANNING,CLEAN,REJECTED}` replaces the original's
plain `malwareScanStatus` field with a real state machine. A file is quarantined (not yet linked
to a usable Document row's content) from the moment bytes arrive until scanning completes; a
`DocumentOpenToken` can only ever be issued for a Document whose current lifecycle status is
`CLEAN` — enforced by a CHECK constraint on token issuance's underlying insert (the check needs a
cross-row lookup to Document, so — consistent with the SafetyEvent-document-supersession
precedent from Phase 0A-R1 — this is a `BEFORE INSERT` trigger on DocumentOpenToken, not a
same-row CHECK).

**Checkout — unchanged from original, still correct**
`DocumentCheckout`: documentId FK, checkedOutById FK, checkedOutAt, expiresAt. Editing requires an
active checkout; uploading a new version releases it and inserts a new, separate immutable
Document row (existing Decision-8 version-chain pattern, unchanged).

**FK & delete behaviour**
`onDelete: Restrict` throughout, consistent with the rest of the schema.

**Migration implications**
Additive.

---

## M4 — Documents: Classification & Sensitive-Access Control (DOC-03)

**Status:** Not a Phase 0A blocker — largest new subsystem in R2.

**Corrected grant design — no ambiguous grantee**
`DocumentPermissionGrant.userId` is a real, always-populated FK — never ambiguous between a User
and a Package. Package-based access still works: assigning an AccessPackage with a
document-clearance setting materializes one concrete `DocumentPermissionGrant` row per covered
user (identical materialization discipline to M2's `UserPermissionGrant`), with
`sourceAccessPackageId` carried only as provenance, never as a live authorization join. A grant
applies to *either* one specific `documentId` *or* a whole `classification` level as a default
(mutually exclusive, CHECK-enforced — the same "exactly one of these is populated" pattern used
throughout this document). Full provenance fields: `grantedById`, `sourceAccessRequestId` nullable
FK (provenance back to the request that led to this grant, when applicable), `reason`,
`validFrom`, `validTo` nullable, `revokedAt`/`revokedById` nullable.

**Corrected action model — normalized, not JSON, not booleans**
`DocumentGrantAction{VIEW_METADATA,PREVIEW,NATIVE_OPEN,DOWNLOAD,EDIT,NEW_VERSION,PRINT,SHARE,
APPROVE,ARCHIVE,MANAGE_ACCESS}` (the exact eleven). `DocumentPermissionGrantAction` (new join
table): grantId FK, action (this enum), `unique(grantId, action)`. This is a real,
database-validated action value on every row — not an unchecked JSON array, and not eleven
separate boolean columns that would need a schema migration every time an action is added.
`DocumentAccessRequest` gets the identical treatment: a new `DocumentAccessRequestAction` child
table replaces any JSON "requested actions" field.

**New: DocumentAccessEvent — the append-only access log**
Per binding decision 3: `DocumentAccessEvent` (new, insert-only via the same trigger pattern as
SafetyEvent/QualityRelease/AuditLog) records every `VIEW_METADATA/PREVIEW/NATIVE_OPEN/DOWNLOAD/
PRINT/SHARE` event — documentId FK, userId FK, action (reusing `DocumentGrantAction`), occurredAt,
and (nullable) the DocumentOpenToken that authorized it. `SafetyEvent` is **not** extended with a
document-access target — its four existing targets (equipment/hold/release/
document-supersession-pair) remain exactly as approved in Phase 0A-R1, untouched by this module.
For SAFETY_CRITICAL documents specifically, the existing SafetyEvent DOCUMENT_SUPERSEDED design
(already proven, already tested) continues to be the mechanism for supersession events —
DocumentAccessEvent additionally logs routine access to those same documents, so a
SAFETY_CRITICAL document gets *both* records, each doing the job it's actually good at.

**Resolved: confidentiality lock vs. classification/access policy**
`DocumentConfidentialityLock` as a separate table is **dropped** — it would have represented the
same fact as "classification + the absence of a matching DocumentPermissionGrant" a second time.
`Document.classification` (required enum, default-deny via the absence of grants) is the single,
sole confidentiality mechanism. `DocumentCheckout` (M3) remains the single, sole edit-lock
mechanism. The two were never meant to be the same axis — "who may even see this" vs. "who
currently holds the pen" — and now there are exactly two tables for exactly two concerns, not
three for two.

**DocumentDerivative — completed**
`DocumentDerivative` (new): `sourceDocumentId` FK, `kind`{WATERMARKED_PREVIEW, REDACTED_COPY,
...}, its own `storageKey`, its own `checksum`, its own `uploadLifecycleStatus` (reusing M3's
enum — a derivative goes through the same clean-scan discipline as the source), and its own
narrower grant surface (a DocumentDerivative is itself referenced by DocumentPermissionGrant/
DocumentOpenToken in place of the source Document when the policy is preview-only/no-download).

**Managed-device restriction — resolved per binding decision 4**
`TrustedDevice` (new): userId FK, provider-neutral `attestationProvider` string/enum (first real
value expected to be an Entra ID/Intune identifier, but the column names no vendor),
`attestedAt`, `trustExpiresAt`. `UserPermissionGrant`/`DocumentPermissionGrant` gain a
`requiresTrustedDevice Boolean`. Enforcement: a token/session request against a grant with this
flag set must resolve to a currently-valid TrustedDevice row for that user, or access is denied —
fail closed. IP-range checks are explicitly not an acceptable substitute, per the decision.

**Enums / transitions**
`DocumentClassification{INTERNAL,CONFIDENTIAL,RESTRICTED,NDA_LEGAL,SAFETY_CRITICAL}`.
`DocumentGrantAction` (above). `DocumentAccessRequestStatus{PENDING,APPROVED,REJECTED,EXPIRED,
REVOKED}`.

**Migration implications**
Additive, but as noted in the original document, default-deny means every real Document row needs
a classification at creation time — no nullable-column shortcut once real documents exist
post-Phase-0A.

---

## M5 — Inventory: Locations, Lots & Balances

**Status:** Not a Phase 0A blocker.

**Retracted claim**
The original document implied a CHECK constraint could keep `InventoryItem.stock` in sync with
`SUM(InventoryLocationBalance.quantity)`. **This is wrong and is withdrawn** — a PostgreSQL CHECK
constraint evaluates one row at a time and cannot reference an aggregate across other rows; there
is no way to express "this column equals the sum of some other table's matching rows" as a CHECK,
full stop.

**Corrected design**
`InventoryLocationBalance` (documented in the original, unchanged in shape: inventoryItemId,
locationId, lotId nullable, quantity) becomes the **sole writable source of truth** for on-hand
quantity. `InventoryItem.stock`/`reserved` are proposed for deprecation as writable columns before
Phase 0B — either removed outright, or kept only as a cached/derived value refreshed by an
explicit recomputation path (a view, a materialized view, or a service-computed aggregate on read)
rather than ever being written to directly by business logic. Whichever approach is chosen, the
guarantee is structural non-divergence by construction (nothing else can write to it), not a
constraint proving two independently-writable numbers agree.

**Nullable-lot uniqueness — corrected**
Postgres treats every NULL as distinct from every other NULL in a plain unique index, so
`UNIQUE(inventoryItemId, locationId, lotId)` alone would silently allow duplicate no-lot balance
rows for the same item+location. Two partial unique indexes are required:
`UNIQUE(inventoryItemId, locationId) WHERE lotId IS NULL` and
`UNIQUE(inventoryItemId, locationId, lotId) WHERE lotId IS NOT NULL` — the same partial-index
technique already proven for `TeamMembership`'s active-membership constraint in Phase 0A-R1,
applied to a second, genuinely different case.

**New: InventoryReservation/Allocation**
`InventoryReservation` (new): inventoryItemId, locationId nullable, lotId nullable, `projectId`
FK, `jobcardId` nullable FK, `projectBomLineId` nullable FK, `jobcardOperationId` nullable FK,
quantity, status{ACTIVE,FULFILLED,RELEASED,CANCELLED} — a real link from "this stock is spoken
for" to the specific project/jobcard/BOM-line/operation that claims it, closing the reservation
gap the original document only described at the flat-quantity level.

**Other corrections**
`StockMovement` gains `lotId`, `fromLocationId`, `toLocationId` (all real FKs — none of these
exist on the current model), and a real `actorId` FK (replacing any free-text "who did this,"
consistent with the actor-FK discipline already established for PurchaseRequisition/QualityHold/
EquipmentBreakdown in Phase 0A-R1). `InventoryItem` gains `unitOfMeasure` and confirms existing
grade/dimension-style spec fields are kept. Receiving/transfer/issue/return/scrap/count all route
through one shared service-layer transactional pattern — each ultimately writing a StockMovement
row and adjusting the relevant InventoryLocationBalance row(s) atomically; this is a service-layer
commitment noted here for completeness, not a new table.

**Migration implications**
Additive for the new tables/columns; the stock/reserved deprecation is the one item on this list
with real behavioral consequences for any Phase 0B code written against the old fields in the
meantime — sequence it early.

---

## M6 — Purchasing: PO Lines, Real RFQ Comparison, Goods Receipts

**Status:** Not a Phase 0A blocker.

**Corrected RFQ design**
The original kept `PurchaseRfq.supplierId` as the sole supplier relation while separately
proposing response tables — internally inconsistent, since a single-supplier header can't be
"invited to" by more than one supplier. Corrected structure: `PurchaseRfq` (header — no
supplierId field at all), `PurchaseRfqLine` (rfqId, inventoryItemId or spec, qty),
`PurchaseRfqSupplier` (new — the invitation: rfqId FK, supplierId FK, invitedAt),
`PurchaseRfqResponse` (rfqId FK, supplierId FK — validated to be one of the invited suppliers via
a trigger or a compound FK through PurchaseRfqSupplier, respondedAt, status),
`PurchaseRfqResponseLine` (responseId FK, rfqLineId FK, unitPrice, leadTimeDays, notes). This is
what actually makes a "Compare Suppliers" screen possible — the frontend's permanent empty-state
stub had nothing to query against; this does.

**PO lines & goods receipts — unchanged from original, still correct**
`PurchaseOrderLine` (purchaseOrderId, inventoryItemId, qtyOrdered, qtyReceived, unitPrice).
`GoodsReceipt` + `GoodsReceiptLine` for real line-level partial receipt, crediting M5's
InventoryLocationBalance/InventoryLot atomically with the PO line update.

**Enums / transitions**
`PurchaseRfqResponseStatus{AWAITED,RECEIVED,DECLINED}`. `GoodsReceiptStatus{PARTIAL,COMPLETE}`.

**Migration implications**
Additive. Depends on M5's location/lot tables for goods-receipt crediting.

---

## M7 — Equipment: Reservation, Maintenance, Certification, Calibration

**Status:** Not a Phase 0A blocker.

**The gap this closes**
`JobcardOperation.equipmentId` records that an operation currently points at a piece of
equipment — it says nothing about who reserved it, when, whether the reservation was
project-level before it became jobcard-level, or whether the equipment is already committed
elsewhere for an overlapping period. A frontend safety gate consulting only this field can be
fooled by any code path that sets it directly. The gate cannot become server-authoritative until
the actual reservation/assignment facts exist as their own rows.

**New models**
- `EquipmentAssignment` (new): equipmentId FK, `projectId` FK (assignment can start as
  project-level, before a specific jobcard exists), `jobcardId` nullable FK (populated when the
  assignment narrows to a specific jobcard — **required to reference the same project** as the
  assignment's own projectId, enforced by a trigger per M13's pattern), `assignedUserId` FK (the
  worker), `assignedById` FK (the user who made the assignment — distinct actor), `reservedAt`,
  `assignedAt` nullable (when it narrowed from reservation to a live assignment), `returnedAt`
  nullable, status{RESERVED,ASSIGNED,RETURNED,CANCELLED}.
- Database constraint preventing conflicting active assignments: a partial unique index
  `UNIQUE(equipmentId) WHERE status IN ('RESERVED','ASSIGNED')` — the same one-active-row-at-a-time
  technique already proven for TeamMembership/InventoryLocationBalance elsewhere in this document,
  applied here to guarantee one piece of equipment cannot be simultaneously reserved/assigned
  twice.
- `EquipmentMaintenanceRecord`, `EquipmentCertification`, `EquipmentCalibration` (new, one
  dedicated table per concern — replacing the current single ad-hoc `EquipmentInspection` table's
  implicit overloading, matching the frontend's own four genuinely-distinct concerns confirmed in
  the original fact-finding).
- `EquipmentRequirement` (new): what a project/jobcard/operation requires from assigned equipment
  (e.g. "must be certified for X," "must have calibration current") — the fact set the existing
  frontend safety gate already checks informally against equipment's own overdue-date fields; this
  table lets that requirement be expressed per-project/operation rather than only globally
  per-equipment.
- `EquipmentMaintenancePlan` (unchanged from original): links to the corresponding completed
  Maintenance/Certification/Calibration records to compute next-due dates from a real interval,
  replacing the frontend's confirmed-unused `serviceInterval` field.

**Migration implications**
Additive. `EquipmentInspection` is not removed — pre-use/ad-hoc inspection remains its own
concern, distinct from scheduled maintenance/certification/calibration.

---

## M8 — Customer & Supplier Master Data

**Status:** Not a Phase 0A blocker.

**New models**
- `CustomerAddress`/`CustomerSite` (new): customerId FK, `addressType`{BILLING,SHIPPING,
  OPERATIONAL}, real multi-row support (the current schema, matching the frontend, only allows one
  of each).
- `SupplierAddress`, `SupplierContact` (new — mirrors CustomerContact, which already exists;
  Supplier currently has no equivalent).
- `SupplierProduct`/`SupplierMaterial` (new): what a given supplier can actually supply —
  supplierId FK, optional inventoryItemId FK, supplier's own item code/description.
- `SupplierPrice` (new): supplierProductId FK, price, currency, `validFrom`/`validTo`, MOQ,
  leadTimeDays — a real price list distinct from ad-hoc PO pricing, and exactly the kind of
  "current master rate" an EstimateItem line (M1) deliberately snapshots rather than joins live.
- `Customer`/`Supplier` gain structured `paymentTermsDays Int` (replacing/supplementing free-text
  terms).
- `SupplierApproval` (new, per binding decision 8): supplierId FK, approvedById FK, approvedAt,
  reason, `expiresAt` nullable — commercial approval, entirely separate from the existing
  quality-specific `SupplierQuality`.

**Archive over delete**
`Customer` gains a real `status` enum + `archived Boolean` (today it's a plain unstructured String
field — weaker than Supplier's already-real `SupplierStatus` enum). Neither Customer nor Supplier
ever supports hard delete — consistent with the whole schema's existing archive-don't-delete
convention.

**Migration implications**
Additive, except `Customer.status` moving from a free String to a real enum — a genuine, if small,
backward-incompatible field-type change worth flagging explicitly.

---

## M9 — Planning: Tasks, Dependencies, Scenarios

**Status:** Not a Phase 0A blocker.

**Corrected resource design**
The original's single `ProjectTask.resourceId` (ambiguously either a User or Equipment) is
replaced with `ProjectTaskUserAssignment` (taskId FK, userId FK) and
`ProjectTaskEquipmentAssignment` (taskId FK, equipmentId FK) — two real, typed, unambiguous join
tables. A task can now legitimately have both a worker and a machine assigned simultaneously,
which the original single-field design could not represent at all.

**Planning Scenarios — now in scope, per binding decision 5**
`ProjectScheduleScenario` (new): projectId FK, name, `isCommitted Boolean` (exactly one
non-deleted scenario per project may be committed — partial unique index, same technique as
elsewhere in this document), createdById FK, createdAt. `ProjectTask`, `ProjectTaskDependency`,
and `ProjectMilestone` all gain a `scenarioId` FK (pointing at the owning
ProjectScheduleScenario). "Promotion to committed" is a service-layer operation (Phase 0B) that
atomically flips the previous committed scenario's `isCommitted` to false and the new one to
true — the schema's job is only to make that state representable and the
one-committed-scenario-per-project invariant enforceable, which the partial unique index does
directly.

**Migration implications**
Additive. Genuinely new subsystem (as in the original document) — no existing data to reconcile.

---

## M10 — Jobcard Production Detail: Material Needs

**Status:** Not a Phase 0A blocker.

**Design**
`JobcardOperationMaterialLine` (jobcardOperationId FK, inventoryItemId FK, qtyRequired,
qtyIssued) — unchanged from the original document; nothing in the review correction touched this
specific proposal. Material issuance against it now explicitly routes through M5's
InventoryReservation/InventoryLocationBalance machinery rather than the deprecated flat
InventoryItem.stock.

**Equipment summary — corrected per binding decision 9**
The frontend's jobcard-level `machines[]` summary array is **not** carried forward as an
independently-writable backend field. A Jobcard's equipment summary is a derived read
(aggregating M7's EquipmentAssignment rows scoped to the jobcard, plus
JobcardOperation.equipmentId) — one source of truth, not two.

---

## M11 — Marketing: Lead/Opportunity Identity, Ownership & Campaigns

Unchanged from the original — no correction applied to this module.

**Design**
`MarketingLead.ownerId`/`MarketingOpportunity.ownerId` (real FK to User, once M2 exists),
`MarketingLead.campaignId` (nullable FK — the frontend has none today). Nothing in the ten
corrections named this module; it is reproduced here unchanged for completeness of the document,
still gated on M2 landing first for ownerId to reference real users.

**Migration implications**
Additive; depends on M2.

---

## M12 — Saved Reports: Ownership, Sharing & Row Scope

**Status:** Not a Phase 0A blocker.

**Design**
`SavedReport.ownerId` (real FK), `SavedReport.visibility{PRIVATE,TEAM,COMPANY}` (default
PRIVATE — replacing the original's dead, never-read `visibility:'private'` literal with a real,
enforced column), `SavedReport.teamId` nullable FK (populated when visibility=TEAM).
`SavedReportShare` (new): reportId FK, sharedWithUserId FK — explicit per-user shares beyond the
visibility tier.

**Critical execution-time rule**
Per binding decision 7: a shared/visible report is always **re-executed under the viewer's own
current permissions and row scope** when opened — never the creator's. This is a service-layer
commitment (Phase 0B), but it is the single most important fact about this module and is stated
here explicitly so it is never designed around later: a SavedReport's stored `definition`/
`filters` describe *what* to show, never *whose scope* to show it under.

**Migration implications**
Additive; depends on M2.

---

## M13 — Cross-Record Consistency Constraints

The original overclaimed that ordinary FKs solve consistency generally. FKs prove referential
*existence*; they cannot prove two independently-stored facts about *related* rows agree with each
other. Six specific relationships are analyzed below with an explicit judgment on which
enforcement layer actually fits each one — reusing, not reinventing, the CHECK/trigger/
application-layer framework already established and proven across Phase 0A-R1's three passes.

**Status:** Not a Phase 0A blocker.

**HoursEntry ↔ operation's Jobcard**
`HoursEntry` stores both `jobcardId` and `operationId` independently — nothing stops them
disagreeing, since `operationId` already implies a Jobcard via `JobcardOperation.jobcardId`.
**Recommended fix: remove the redundant `HoursEntry.jobcardId` column entirely** and always
derive it through the operation relation — this eliminates the inconsistency risk at its root
rather than policing it. If a denormalized column is kept for query performance, a
`BEFORE INSERT/UPDATE` trigger (cross-row lookup — not CHECK-expressible) must validate agreement.

**EquipmentPreUseCheck.projectId/jobcardId same context**
When jobcardId is set, projectId must equal that jobcard's own projectId. Cross-row fact →
trigger, not CHECK, following the same reasoning as above.

**ProjectTaskDependency: same project/scenario, no self-reference, no cycles**
Self-reference (predecessorTaskId ≠ successorTaskId) is same-row and CHECK-expressible directly.
Same-project/scenario agreement between the two referenced tasks is cross-row → trigger.
**Multi-hop cycle detection is explicitly deferred to application-level validation and tests** —
this is not a gap unique to this module; it is the identical, already-approved reasoning behind
`Document.previousVersionId` and `QualityRelease.previousVersionId` only enforcing the one-hop
case at the database layer in Phase 0A-R1. Reusing an already-reviewed judgment here rather than
inventing a new one.

**EquipmentAssignment.jobcardId same project as EquipmentAssignment.projectId**
Cross-row (jobcardId's own projectId must match) → trigger, identical pattern to the two above.

**ProjectItem/BOM/Jobcard/operation links stay within one project**
Wherever a chain of FKs could in principle be threaded to different projects (e.g. a
JobcardOperationMaterialLine's Jobcard belongs to a different Project than the
InventoryReservation it's linked to expects), the general rule applied throughout this document
is: prefer removing a redundant FK and deriving the fact through the existing relation wherever
possible (as recommended for HoursEntry above); where a genuinely independent FK must remain for a
real reason, add a same-project trigger. No single new table is needed for this row — it's a
design discipline applied per-model, not a new consistency model in itself.

**Document relation/supersession context**
Already solved — the `safety_event_document_supersession_check()` trigger from Phase 0A-R1
already verifies `newDocument.previousVersionId = previousDocumentId` for every
DOCUMENT_SUPERSEDED SafetyEvent. Listed here only to confirm it was reassessed, not because it
needs further work.

---

## M14 — Platform Foundation

Unchanged from the original — no correction applied.

**Scope**
Validated configuration, structured logging, request/correlation IDs, `/api/v1` prefix, standard
error envelope, liveness/readiness endpoints, graceful shutdown, Docker health checks, CI. Pure
application code, no schema/migration impact, tracked as a parallel non-blocking track per the
original document's conclusion — reproduced here unchanged since none of the ten corrections
named it.

---

## M15 — Frontend UX Workstream (UI-01 / HUB-01 / UI-02)

Entirely new section — the original document silently dropped these three requirements. This is a
**frontend-only** work package: no Prisma model changes for UI-01/HUB-01, and UI-02's one real
backend need (an admin-managed station allowlist) is scoped narrowly and kept out of any R2
migration commit per the explicit instruction.

### UI-01 — Persistent Module Action Bar

**Status:** Frontend-only, no backend schema impact.

**Frontend capability today:** Confirmed: all six checked action bars (Customers, Estimations,
Store, Suppliers, Purchasing, Documents) render at the **bottom** of the page in normal document
flow — none use `position:sticky` or `fixed`. Each page independently codes its own bar (no
shared component). Destructive actions are handled three inconsistent ways today: absent from the
bar entirely in favor of row-level menus (Customers, Store, Purchasing, Documents), present with
real danger styling (Estimations), or present with a `danger` class that has no matching CSS rule
and so renders identically to primary actions (Suppliers — a real, confirmed bug independent of
this redesign). Two pages (Purchasing, Documents) duplicate their primary CTA at both the top
toolbar and the bottom bar today.

**Proposed change:** One reusable, sticky *top* module action bar component, replacing all six
independently-coded bottom bars. Primary actions stay visible at all scroll positions; destructive
actions are grouped and visually separated at the far right in every instance (fixing Suppliers'
broken styling as a side effect of unification, not a separate task). No new backend model or
field — this is presentational.

**Explicit non-goal:** UI visibility must never substitute for a backend permission check — a
button being hidden client-side is a UX convenience, not an authorization boundary; the real
boundary is M2/M4's grant model. This is stated as a hard constraint on the implementation, not
left implicit.

**Migration implications:** None — no schema/migration involvement whatsoever.

### HUB-01 — Fixed One-Screen Desktop Hub

**Status:** Frontend-only, no backend schema impact.

**Proposed change:** CSS Grid/Flex layout using `100dvh` to fit the Hub's module grid within one
viewport at normal desktop sizes, eliminating unnecessary page scroll. Team Talk's message list
ends exactly at the module-grid's height, scrolls internally, and keeps its input pinned at the
bottom of that internal region — not the page. Small windows/high zoom levels retain a safe
scroll fallback (the layout must degrade gracefully, not clip content unreachably). Mobile
(hub-mobile.html) is explicitly exempted — it may continue to scroll normally.

**Migration implications:** None.

### UI-02 — Global Radio Player

**Status:** One narrow backend model; frontend architecture limits full scope to two delivery
stages.

**Frontend capability today:** Confirmed: the radio player exists only in `hub-desktop.html` —
fully self-contained (CSS/HTML/JS all inline in that one file), not shared or importable. Five
hardcoded internet radio stream URLs. Zero persistence of any kind — station selection, volume,
and play state all reset on every reload, confirmed via a zero-match grep for localStorage in
that file.

**Architectural constraint — stated plainly, not glossed over:** The app today is a genuinely
multi-page architecture — every module is a separate full HTML document load. An `<audio>`
element's playback state cannot survive a full page navigation in that architecture; there is no
shared JS runtime alive across page loads to keep it playing. **Uninterrupted audio across module
navigation is not achievable until a persistent App Shell/router replaces the current
multi-page-HTML structure** — that is a substantial frontend-architecture change with its own
scope, not a radio-player task.

**Split delivery, as instructed:**
- **Stage A (deliverable now, within the current architecture):** extract the player into one
  shared, non-duplicated component (a single JS/CSS module every page includes, not eleven copies
  of the same inline code) that appears identically on every desktop module; persist
  station/volume/mute to `localStorage` so a fresh page load *restores* the prior state (station
  keeps playing conceptually — from the user's perspective, "my station and volume are exactly
  where I left them" — even though the underlying audio element necessarily restarts on each
  navigation, since that restart is unavoidable in the current architecture).
- **Stage B (deferred, depends on the App Shell):** true gapless, non-restarting playback across
  navigation, achievable only once a persistent shell/router exists to keep one `<audio>` element
  alive across route changes.

**Missing model/field/FK:** `RadioStation` (new, admin-managed allowlist): name, streamUrl,
`enabled Boolean`, sortOrder — replaces the five hardcoded stream URLs with a real, administrable
list. `UserRadioPreference` (new, optional): userId FK, `lastStationId` FK, `volume`, `muted` —
only needed if server-side preference persistence (survives a different browser/device, not just
the same browser's localStorage) is actually wanted; Stage A's localStorage approach may be
entirely sufficient on its own, so this table is proposed but explicitly conditional, not
committed.

**Permissions:** Managing the RadioStation allowlist is an administrative action (module-scoped
permission, reusing M2's grant model); listening itself requires no permission beyond ordinary
authenticated access.

**Migration implications:** `RadioStation` (and, if adopted, UserRadioPreference) are new, small,
low-risk additive tables — but per the explicit instruction, they are **not** bundled into any
R2A/R2B/R2C security/estimation/inventory migration. If backend support for the allowlist is
wanted in R2 at all, it ships as its own narrow, separate migration, decoupled from every other
module in this document.

---

# B — Revised phased implementation plan

Each phase below is intentionally bounded — security (M2/M4), estimation (M1), and
inventory/purchasing (M5/M6) never land in one commit. "Exact files expected to change" mirrors
the file pattern already established and proven across Phase 0A-R1's three independently-approved
passes (schema.prisma, one evolved migration.sql, a matching integration-spec.ts, README.md
documentation of every new hand-written constraint).

## Phase 0A-R2A — Identity, sessions & document-security foundation

**Exact models & fields**
- `User`: + `approvalStatus` (remove `active` as an independent column)
- `UserSession`, `MfaEnrollment`, `Notification`, `OutboxEvent`
- `AccessRequest`, `UserInvitation`
- `AccessPackage` (template, no runtime FK from any grant-check path)
- `UserPermissionGrant` (+ typed scope FKs: siteId, teamId, projectId, jobcardId)
- `Document`: + `classification` (required)
- `DocumentPermissionGrant`, `DocumentPermissionGrantAction`
- `DocumentAccessRequest`, `DocumentAccessRequestAction`
- `DocumentAccessEvent` (append-only)
- `DocumentDerivative`, `TrustedDevice`

**Exact enums**
`UserApprovalStatus, AccessRequestStatus, InvitationStatus, GrantScopeKind,
DocumentClassification, DocumentGrantAction, DocumentAccessRequestStatus`

**FK & delete behaviour**
All new FKs `onDelete: Restrict`. `UserPermissionGrant`/`DocumentPermissionGrant` scope/target
columns follow the exactly-one-populated pattern (CHECK), not cascading deletes.

**Database CHECK / unique / partial index / triggers**
- CHECK: UserPermissionGrant scope-kind-vs-FK consistency (5-way, mirrors SafetyEvent's
  exactly-one-target).
- CHECK: DocumentPermissionGrant exactly one of (documentId, classification) populated.
- CHECK: revokedAt/revokedById set together or neither (both grant tables).
- Unique: `DocumentPermissionGrantAction(grantId, action)`,
  `DocumentAccessRequestAction(requestId, action)`.
- Unique: `UserSession.refreshTokenHash`, `UserInvitation.tokenHash`.
- Append-only trigger: `DocumentAccessEvent` (reuses the exact SafetyEvent/QualityRelease/
  AuditLog pattern).

**Migration implications**
Removing `User.active` as an independent column is the one backward-incompatible change to an
already-approved model in this phase — every other change is additive.

**Database-enforceable acceptance tests**
- A PENDING_APPROVAL user has zero UserPermissionGrant rows creatable that reference them without
  an ACTIVE approvalStatus check — enforced at minimum by the grant's own scope CHECK plus a
  documented service-layer gate (see next row).
- DocumentAccessEvent rejects UPDATE/DELETE.
- A DocumentPermissionGrant cannot specify both documentId and classification, nor neither.
- A UserPermissionGrant with scopeKind=SITE and a populated projectId is rejected.

**Future service-layer acceptance tests (Phase 0B, not run here)**
- An HTTP request from a PENDING_APPROVAL/SUSPENDED user is rejected end-to-end.
- A direct URL/API call with no matching grant returns exactly 403.
- An expired UserSession is refused by the AuthGuard, not merely flagged in the table.

**Dependencies**
None beyond the current, approved Phase 0A-R1 schema.

**Go/no-go acceptance criteria**
- Default-deny proven by integration test for every one of the 11 document actions and for
  module/action grants generally.
- No code path exists where a non-ACTIVE user ends up with a non-empty, usable grant.
- Full Phase 0A-R1-style verification battery (empty-DB apply ×2, idempotency, integration tests,
  lint/build/unit/e2e, production packaging audit) + independent review sign-off.

**Exact files expected to change**
`backend/prisma/schema.prisma` · one new evolved
`backend/prisma/migrations/<ts>_init/migration.sql` ·
`backend/test/database-constraints.integration-spec.ts` (extended) · `backend/README.md` (new
sections documenting every new hand-written constraint, matching the existing per-blocker
documentation convention).

## Phase 0A-R2B — Estimation, document lifecycle, inventory locations, material linkage

**Exact models & fields**
- `Estimation`: + kind, ownerId, changeOrderOfProjectId
- `EstimationRevision` (append-only)
- `EstimateItem` (+ parentItemId, sequence, itemNumber, optionGroupId, isSelectedAlternative,
  overheadPct, riskPct, marginPct)
- `EstimateItemMaterialLine`, `LabourLine`, `MachineLine`, `SubcontractLine`, `OtherCostLine`
  (each with snapshot cost/sell fields)
- `ProjectItem` (+ sourceEstimateItemId, sourceEstimationRevisionId)
- `DocumentOpenToken` (tokenHash, action, expiresAt, consumedAt, revokedAt, trustedDeviceId)
- `DocumentCheckout`
- `Document`: + uploadLifecycleStatus
- `Location`, `InventoryLocationBalance` (+ lotId)
- `InventoryReservation`
- `StockMovement`: + lotId, fromLocationId, toLocationId, actorId
- `JobcardOperationMaterialLine`
- `InventoryItem.stock/reserved`: deprecation of write paths (schema-level: either removed or
  documented as derived-only)

**Exact enums**
`EstimationKind, ProjectItemStatus, UploadLifecycleStatus, DocumentOpenTokenAction,
InventoryReservationStatus`

**FK & delete behaviour**
Restrict throughout. `EstimateItem.parentItemId` self-relation with one-hop self-reference CHECK
(mirrors Document/QualityRelease precedent).

**Database CHECK / unique / partial index / triggers**
- Two partial unique indexes on InventoryLocationBalance (lotId NULL vs NOT NULL cases) — the
  corrected nullable-lot design.
- CHECK: EstimateItem.id ≠ parentItemId.
- Trigger: DocumentOpenToken issuance requires Document.uploadLifecycleStatus = CLEAN (cross-row
  lookup).
- Append-only trigger carried over/unaffected: EstimationRevision.

**Migration implications**
EstimationLine's write paths are retired (read-only thereafter) per binding decision 2 — not
dropped, but no longer targeted by new inserts/updates once EstimateItem exists.
InventoryItem.stock/reserved's behavioral change (derived, not authoritative) is the one item
here needing explicit sign-off before any Phase 0B code is written against the old assumption.

**Database-enforceable acceptance tests**
- Quotation acceptance's transaction: a forced mid-transaction failure leaves zero partial
  ProjectItem/BOM/operation-template rows.
- A DocumentOpenToken cannot be issued while uploadLifecycleStatus ≠ CLEAN.
- Two InventoryLocationBalance rows for the same item+location with lotId NULL are rejected; two
  with the same non-null lotId are also rejected; one NULL + one non-null lotId row for the same
  item+location coexist correctly.

**Future service-layer acceptance tests**
- Accepting a quotation never creates a live Jobcard (binding decision 1) — verified against the
  actual service, not just the schema.
- A change order against an existing Project correctly links new ProjectItems without disturbing
  prior ones.

**Dependencies**
**Requires R2A complete and approved** — DocumentOpenToken issuance checks
DocumentPermissionGrant; EstimateItem/ProjectItem creation events need a real actor for AuditLog.

**Go/no-go acceptance criteria**
- All database-enforceable tests above pass on two independently-created fresh databases, plus
  idempotent second-apply.
- Full verification battery + independent review, same bar as R2A.

**Exact files expected to change**
Same file pattern as R2A: `schema.prisma`, one evolved migration.sql, extended
integration-spec.ts, README.md additions.

## Phase 0A-R2C — Purchasing/RFQ depth, equipment lifecycle, master data, planning, remaining ownership fields

**Exact models & fields**
- `PurchaseOrderLine`
- `PurchaseRfqLine`, `PurchaseRfqSupplier`, `PurchaseRfqResponse`, `PurchaseRfqResponseLine`
  (+ removal of PurchaseRfq.supplierId as sole relation)
- `GoodsReceipt`, `GoodsReceiptLine`
- `EquipmentAssignment`, `EquipmentMaintenanceRecord`, `EquipmentCertification`,
  `EquipmentCalibration`, `EquipmentRequirement`, `EquipmentMaintenancePlan`
- `CustomerAddress`, `SupplierAddress`, `SupplierContact`, `SupplierProduct`, `SupplierPrice`,
  `SupplierApproval`
- `Customer`: status String → real enum + archived
- `ProjectScheduleScenario`, `ProjectTask`, `ProjectTaskDependency`, `ProjectMilestone`,
  `ProjectTaskUserAssignment`, `ProjectTaskEquipmentAssignment`
- `MarketingLead`/`MarketingOpportunity`: + ownerId, campaignId
- `SavedReport`: + ownerId, visibility, teamId; `SavedReportShare`
- M13 triggers: HoursEntry/EquipmentAssignment/EquipmentPreUseCheck/ProjectTaskDependency
  same-context checks (exact set per the agreed fix — column removal preferred over trigger where
  noted in M13)
- *(Optional, separate narrow migration, not bundled here per instruction)* `RadioStation`,
  optionally `UserRadioPreference`

**Exact enums**
`PurchaseRfqResponseStatus, GoodsReceiptStatus, EquipmentAssignmentStatus, MaintenancePlanKind,
CustomerAddressType, SavedReportVisibility, DependencyType`

**FK & delete behaviour**
Restrict throughout, consistent with every prior phase.

**Database CHECK / unique / partial index / triggers**
- Partial unique index: `EquipmentAssignment(equipmentId) WHERE status IN ('RESERVED','ASSIGNED')`.
- Partial unique index: `ProjectScheduleScenario(projectId) WHERE isCommitted`.
- CHECK: ProjectTaskDependency.predecessorTaskId ≠ successorTaskId.
- Triggers: EquipmentAssignment.jobcardId same-project-as-projectId; EquipmentPreUseCheck
  same-context; ProjectTaskDependency same-project/scenario; PurchaseRfqResponse.supplierId must
  be one of the RFQ's invited suppliers.

**Migration implications**
Additive except Customer.status's type change (String → enum), flagged the same way in R2B's
equivalent InventoryItem note.

**Database-enforceable acceptance tests**
- Two active EquipmentAssignment rows for the same equipment are rejected.
- A GoodsReceiptLine crediting a PurchaseOrderLine atomically updates InventoryLocationBalance in
  the same transaction (forced-failure test proves no partial credit).
- A PurchaseRfqResponse from a non-invited supplier is rejected.
- A ProjectTaskDependency self-reference is rejected; a cross-project dependency is rejected.

**Future service-layer acceptance tests**
- Scenario promotion atomically flips isCommitted and is reflected immediately in the live
  schedule view.
- An hours-overrun past the configurable threshold requires a reason and is recorded in AuditLog
  (binding decision 6) — end-to-end, not just schema-level.
- A SavedReport opened by a user other than its creator executes under the viewer's own row scope
  (binding decision 7).

**Dependencies**
**Requires R2A** (M11/M12 need real Users). **Requires R2B's M5** (GoodsReceipt credits
InventoryLocationBalance). M15's RadioStation table, if built at all in R2, ships as its own
separate, unbundled migration regardless of R2C's timing.

**Go/no-go acceptance criteria**
- All database-enforceable tests above pass on two independently-created fresh databases, plus
  idempotent second-apply.
- Full verification battery + independent review.
- Platform foundation (M14) remains a parallel, non-blocking track — no schema dependency, but
  must land before any Phase 0B endpoint is exposed publicly.

**Exact files expected to change**
Same established pattern: `schema.prisma`, one evolved migration.sql, extended
integration-spec.ts, README.md additions per new constraint.

---

# C — Confirmation

**No repository state was changed by the analysis this document records:**

- Branch: `backend-foundation` — unchanged throughout the analysis. HEAD:
  `9cdd8f3ec4167e33b94dd85340d1c46829a5ad87` — unchanged. Parent:
  `527237a183dff223c9287de1778b28ceb19fba76` — unchanged.
- `origin/main`: `6dc9de2a827d2902f5d14870ab8dc1560174832b` — unchanged, never merged into.
- No `schema.prisma`, migration, application code, test, or package file was created, edited, or
  deleted as part of producing this analysis.
- Phase 0A-R2 implementation was not started. Phase 0B was not started.

This document itself is being committed only to a new, separate branch (`r2-design-review`),
created from `backend-foundation`'s HEAD above — `backend-foundation` and `main` are not modified
by that commit either.
