# Varmak Workshop — Application Specification

A complete description of the system as built, for anyone rebuilding or extending it on another
platform. Written 14 September 2026.

---

## 1. What it is

An internal workshop-management system for **Varmak AB**, a metal fabrication workshop at
Lagmansgatan 31, 241 71 Marieholm, Sweden.

It covers the whole life of a job: a lead arrives, becomes a customer, is quoted, becomes a
project, is broken into jobcards, is cut and welded against booked machines and issued material,
is inspected, and is invoiced. Everything one workshop does, in one place.

**Users:** roughly 3–10 people. An administrator sees everything. A worker sees only the Hours
module. Roles are visual only today — nothing is enforced server-side, because there is no server.

**Languages:** every page runs in English, Swedish and Macedonian (Latin script).

## 2. Current status — read this first

**It is a frontend prototype.** No backend, no database, no API, no real authentication. All data
lives in one browser `localStorage` key and is lost if browser data is cleared. Login checks no
credentials.

What that means for a platform evaluation: **the application logic, the data model and the
workflows are complete and proven; the infrastructure does not exist.** The 40 tables below are
real and populated, and 681 automated tests prove the business rules hold. What is missing is
precisely what a platform like Bubble supplies — database, auth, hosting, multi-user access.

**Scale of what exists:** 16 pages · 40 data collections · 221 data operations · 10 shared
business-rule modules · 681 unit tests, a 16-page browser smoke test and 94 end-to-end steps,
all passing.

## 3. Modules

| Module | What it does |
|---|---|
| **Login** | Entry point. Language and theme switch. No credential check. |
| **Hub** | Way into every module. Desktop and mobile. |
| **Customers** | Customer register: contacts, addresses, terms, credit limit, price list, notes, documents. Org-number lookup against allabolag.se. |
| **Suppliers** | Vendor register with delivery and quality history. |
| **Project / Estimator** | The centre of the system. A job is created as the quotation it is being priced for. Line-by-line pricing with material, labour, machine and other cost. Items lock once agreed. One workflow strip drives the project: Quotation → Approved → Planned → Active, with hold, complete, close, cancel. |
| **Planning** | Three views — **Board** (drag a project between lanes), **Schedule** (bars over weeks, per project and per item), **Capacity** (hours owed per week against what the shop can do). |
| **Store** | Inventory: stock, reserved, available, per-item history, groups and subgroups with their own numbering, warehouse locations down to the bin, unit-of-measure with weight calculation, receiving against a purchase order, issuing to a jobcard, offcuts. |
| **Jobcards** | The shop-floor instruction: what to make, from what, on which machine, by when. Operations start and pause here; material is reserved, issued, returned and scrapped. |
| **Hours** | Time booked against jobcard operations, plus materials used. Desktop and mobile. |
| **Equipment & Machines** | Machine register: status, condition, maintenance, inspections, calibrations, certifications, usage sessions, breakdowns, pre-use checks. |
| **Quality** | Inspections, NCRs, CAPAs, weld records, NDT, ITPs, welder qualifications, WPS, complaints, holds, final release dossiers. |
| **Documents** | Files and templates linked to a project, jobcard, customer or supplier. |
| **Marketing** | Leads, opportunities, tenders/RFQs, campaigns, content calendar, case studies, segments, analytics — and **Findings**, the AI review queue (§7). |
| **Reports** | Saved report definitions and generated reports. |

## 4. Data model

40 collections. Grouped by area, with the fields that matter. Every record carries an `id`, and
most carry a human-readable `no` (C-001, P-2026-014, EST-2026-023, LD-2026-041) issued from a
central counter so numbering never collides.

### Commercial
- **customers** — no, name, status, city, country, org, vat, email, phone, website, since, terms,
  credit, currency, industry, type, priceList, deliveryTerms, discountAgreement, billing address,
  shipping address, contacts[], notes[], documents[]
- **suppliers** — same shape, plus delivery and quality history
- **estimations** — no, customerId, title, status, revision, created, validUntil, currency,
  estimatedMaterial, estimatedLabour, estimatedMachine, estimatedOther, totalCost, sellingPrice,
  plannedHours, machines[], deliveryTarget, projectId, **bom[]** (the priced lines), revisions[]
- **invoices**, **savedReports**, **reportConfig**

### Delivery
- **projects** — no, customerId, name, estimationId, status, phase, start, deadline,
  expectedCompletion, progress, plannedHours, usedHours, responsible, workers[], machines[],
  materialStatus, bom[], tasks[], milestones[], jobcards[], hours[], materials[], purchases[],
  types[], documents[], customerRef, poNumber, pm, workshop, sales, quotedValue, estLabourHours,
  estMaterialCost, estPurchaseCost, otherCostEst/Act, plannedStart, actualStart,
  plannedCompletion, actualCompletion, closedDate, holdReason, holdComment, expectedResume,
  cancelReason, activity[]
- **jobcards** — no, projectId, customerId, title, item, quantity, revision, drawingNo, workType,
  location, priority, responsible, workers[], plannedStart, plannedCompletion, actualStart,
  actualCompletion, plannedHours, progress, status, materialReadiness, inspectionRequired,
  deliveryTarget, **operations[]**, **materials[]**, machines[], inspections[], notes[],
  documents[], activity[]
- **hours** — time booked against a jobcard operation
- **breakdowns**, **activity**

### Store
- **inventory** — code, itemNo, group, subgroup, description, category, grade, dimensions,
  **baseUnit / sizePerUnit / weightPerBase** (see §5), unit, stock, reserved, minStock,
  reorderQty, avgCost, lastPrice, supplier, heat, certificate, status, locationGroup,
  locationSub, location (bin)
- **itemGroups** — name, numbering start, next number, subgroups[]
- **locationGroups** — warehouse, sublocations[]
- **movements** — time, action, code, qty, unit, from, to, projectNo, jobcard, user
- **offcuts** — the usable remainder of a cut plate, with its source project
- **stockCounts**, **barcodeLinks** (barcode → item code; several codes per item)
- **purchaseOrders** — no, supplier, project, date, expected, value, buyer, status, items[],
  receivedQty, receivedValue
- **purchaseRfqs**, **supplierInvoices**

### Equipment
- **equipment** — equipmentId, name, category, manufacturer, model, serial, assetNumber,
  **status**, currentLocation, homeLocation, department, responsiblePerson, condition,
  criticality, purchase details, warrantyExpiry, operatingHourMeter, serviceInterval,
  maintenanceDate, inspectionDate, certificationExpiry, calibrationDate, safetyWarnings,
  assignedProject, assignedJobcard, operator, inspections[], maintenance[], certifications[],
  calibrations[], usageHistory[], downtimeRecords[], usageSessions[], preUseChecks[], isRetired

### Quality — nine record types
**qualityInspections** · **qualityNcrs** (non-conformance) · **qualityCapas** (corrective and
preventive action, with five-whys and fishbone) · **qualityWelds** (weld map position, joint
type, WPS, welder qualification, filler, gas, preheat, repair history) · **qualityNdt** ·
**qualityItps** (inspection and test plan) · **qualityHolds** · **qualityComplaints** ·
**qualityDossiers** / **qualityReleases** · **qualityWps** · **qualityWelderQuals** ·
**supplierQuality**

### Marketing
- **marketingLeads** — no, company, contact, email, phone, country, city, industry, size, source,
  service, value, priority, status, owner, created, lastContact, nextFollowUp, commPref, **dnc**
  (do not contact), linkedCustomerId, linkedOpportunityId, notes[], activity[]
- **marketingOpportunities** — no, company, leadId, customerId, title, services[], scope,
  industry, value, probability, stage, expectedDecision, requiredDelivery, competitor,
  decisionReason, owner, linkedEstimateNo, linkedProjectNo, nextAction, followUpDate
- **marketingCampaigns** — objective, target industries and services, segment, channels, dates,
  budget, spend, leads, qualified, estimates, wonValue
- **prospectFindings** / **prospectSeen** / **prospectSweeps** — the AI findings queue (§7)

### Documents
- **documents** — name, type, module, record, category, updated, status, expiry, revision,
  author, fileData, fileName, mimeType, fileSize
- **documentFolders**

## 5. Business rules that must survive any rebuild

These are the valuable part. Anyone can build CRUD screens; these rules are what make the system
correct, and several of them are safety-related.

**Quality holds block work.** An active hold naming a project or jobcard prevents that project or
jobcard being completed or closed. A hold is cleared in Quality and nowhere else — it cannot be
overridden from the module it blocks.

**Equipment status blocks operations.** An operation cannot start on a machine that is out of
service, under maintenance, quarantined or retired. Statuses are split into hard-block and
operational sets, and a machine already assigned elsewhere cannot be double-booked.

**Status transitions are validated, not free.** A project, jobcard and jobcard operation each move
through a defined sequence. Illegal transitions are refused with a reason, and every transition
is written to an activity log with who and when.

**Locked estimate lines.** Once a price is agreed the line locks. Unlocking requires a reason and
records who did it.

**Numbering is central.** All document numbers come from one counter set, so two people creating
a record at the same time cannot collide. Store items additionally number per group, each group
with its own start and next value.

**Units and weight.** An item has a stock unit (what you count), a base unit (what you measure —
m, m², m³, kg, pcs) and a size per stock unit. Weight is **calculated** from cross-section ×
density using a built-in material reference (10 materials, 7 section shapes, real pipe OD and wall
series) — never typed in and never guessed.

**A generated product catalogue.** 1,908 purchasable products across 11 families — plate, pipe,
hollow section, bar, butt-weld fittings, flanges, valves, welding consumables, abrasives, gases,
fasteners. These are **not stored rows**: they are computed at runtime from real dimension series,
which is why every weight is arithmetically correct. On a platform with a database, materialise
them as ~1,900 rows.

**The honesty rule — the one that governs everything.** *Never show an invented figure. Report "no
data" instead.* It is enforced structurally, not by good intentions:
- A finding with no verifiable source is dropped, not shown with a caveat.
- What the workshop can do is read from the equipment register, never from a typed list — so a job
  needing a machine the shop does not own is reported as missing rather than quietly accepted.
- A lead created from a public post carries no email, no phone and no value, because a forum
  thread has none. A value nobody has estimated shows as `—`, never `0 kr`.
- Estimating's recall counts only finished work as evidence, and says when the evidence is thin.

## 6. Core workflows

**Lead → cash**
```
Lead → (qualify) → Opportunity → (open estimation) → Estimate → (accept)
     → Project → Jobcards → Operations + booked machines + issued material
     → Hours booked → Inspection → Final release → Invoice
```
Each arrow is a real, linked, logged transition — not a status field someone types over. A lead
converts to a customer; an opportunity links to its estimate; an estimate becomes a project
carrying its priced lines as the project's bill of materials.

**Material flow**
```
Purchase order → Receive (against the PO, with heat number and certificate)
              → Stock → Reserve to a jobcard → Issue → Return unused / Scrap
              → Offcut registered back into stock
```
Receiving updates both the stock and the order. A project cannot be completed with undelivered
orders outstanding.

**Quality flow**
```
Inspection → fail → NCR → disposition → CAPA (five-whys, fishbone) → verification → close
Weld → NDT → repair if required → re-inspection
Hold applied → blocks the named project or jobcard → released only in Quality
```

## 7. The AI layer — built and working offline

**Marketing → Findings** is a review queue for work the workshop could be doing but has not been
asked to do. A sweep of public sources (Swedish renovation and machinery forums, classifieds,
public award notices, inventor communities) produces findings; each is triaged and presented as a
card; the user presses **Accept** or **Reject**. Accepted becomes a real lead.

It runs today with **no server, no network and no spend**, driven by a fixed sample set — built
deliberately that way so the workflow could be judged before paying for it.

Three rules are enforced in code:
1. **Capability matching reads the real equipment register.** A quarantined machine counts as
   *owned but not usable today* — two different answers, both shown.
2. **A verdict has a ceiling, not just a score.** Freshness and proximity rank work the shop *can*
   take; they can never lift work it cannot. "100-ton pressing, posted yesterday, 5 km away" comes
   out **SKIP**, because Varmak has no press.
3. **Reported once, never reported again** — rejected findings included.

Classifications: HOT LEAD · PROTOTYPE/INVENTION · REPAIR · SUBCONTRACT TARGET · WEAK SIGNAL ·
WATCH. Verdicts: GO · MAYBE · SKIP, each with its reasons shown.

Everything is labelled as sample data, and no source link points at a live page.

**Also built:** Estimating recalls how similar past work actually turned out and offers a bias
factor by job type. Only finished work counts as evidence.

## 8. What is not built

- No backend, database, API or real authentication
- No enforced permissions — roles are visual only
- No real file storage (documents hold data in the browser)
- No email, no printing pipeline, no accounting integration
- No supplier catalogue import; no product images; no live pricing
- Barcode scanning is manual entry only — no camera, no physical scanner
- Tenders/RFQs are held in the page and lost on reload (known bug)
- An item can hold only one supplier's price
- The AI sweep is a fixed sample; no model or network is connected

## 9. Future plans

**Step 1 — finish the prototype.** Tenders into shared storage; a supplier–item price table
(item ↔ supplier ↔ their article number ↔ price ↔ pack size ↔ lead time); split the overloaded
item code field; fix lookups that throw on a missing record.

**Step 2 — the backend.** Database, API, auth, hosting, backups. This is the real project. *This
is the step a platform like Bubble removes.*

**Step 3 — the real AI sweep.** A scheduled agent runs nightly, searches named public sources
only, and posts findings to the app. The queue already exists; only the source of the list
changes. Budget capped at roughly $9–19/month.

**Step 4 — supplier catalogue import.** Real catalogues from the merchants Varmak actually buys
from: article numbers, prices, stock, barcodes, pictures. Excel/CSV by email is the realistic
format. AI reads the first rows and proposes the column mapping once per supplier; every import
after that is deterministic.

**Step 5 — push notifications.** Web Push on Android and desktop; on iPhone it requires the app be
installed to the home screen. Email or a messaging bot is the simpler alternative.

**Before going live:** GDPR — names and contacts taken from public forums are personal data, and
those people are owed notice and a right to object. And check each source's terms on automated
access.

## 10. Choosing a platform to run this on

There are three shapes of answer, and they differ in what they hand you and what they cost.

### A — An all-in-one platform (e.g. Bubble)
Frontend, database, auth and hosting in one proprietary product.

- **Hands you:** the entire backend problem, solved, with no schema design and no SQL.
- **Costs you:** all 16 pages of UI rebuilt, three themes, three-language switching. The business
  rules in §5 become clickable configuration with no test suite behind them. The data layer is
  proprietary — hard to export, and this model is heavily relational (project → jobcards →
  operations → hours; hold → project/jobcard), which is not where these data layers are fastest.
- **Best when:** the priority is getting something live quickly without technical depth.

### B — A frontend builder over a real database (e.g. WeWeb + Supabase)
WeWeb publishes a standard **Vue.js single-page app that can be exported and self-hosted**, and
connects to Supabase, Xano, Airtable, Google Sheets, REST or GraphQL — it also now offers a native
backend of its own.

- **Hands you:** the same freedom from hosting and auth work, **without lock-in** — the code is
  exportable and, on Postgres, so is the data.
- **Fits this system unusually well**, for a specific reason: the §5 rules can live in the
  *database* rather than in the UI. A quality hold that blocks completion becomes a constraint or
  trigger — it then holds against direct API access too, not only when someone clicks through the
  interface. Status transitions become functions. And they can be **tested** (pgTAP or plain SQL
  test scripts), so the discipline behind the current 681 tests survives in another form. For
  rules that are safety logic rather than convenience, that is the difference that matters.
- Forty related tables with foreign keys is Postgres's home ground, and an external scheduled
  agent can write findings straight in through the REST API or an edge function (§9, step 3).
- **Costs you:** the 16 pages still get rebuilt. More technical — SQL, row-level security,
  possibly triggers. Two products to pay for and learn unless the native backend is used.

### C — Keep the frontend, add a backend to it
The pages already exist, work, are tested, and run in three languages and three themes.
`workshop-data.js` is **the only file that touches storage** — 221 operations behind one stable
interface. Replacing its persistence with a real database leaves the 16 pages untouched, the ten
rule modules untouched, and most of the test suite intact.

- **Costs you:** it stays code. Changing a screen means editing code, not dragging a box.
- **Best when:** the goal is the system being right and staying right, rather than being editable
  without a developer.

### How to weigh them
Option A is fastest to something live. Option B is the best technical fit for *this* system, and
the only one of the three that both removes the infrastructure work and keeps the rules testable.
Option C is the least total work, because rebuilding sixteen working pages is more effort than
swapping one file's storage layer — but it does not answer the wish to maintain the app without
touching code, which is usually the real reason for asking.

**What transfers to A or B regardless:** the 40 tables, all CRUD, list views with filtering and
search, the linked-record workflows, roles and permissions, file storage, multi-user access.
Existing data exports as JSON (`backupData()`) and converts to CSV. The generated catalogue
becomes ~1,900 ordinary rows.

**What must be rebuilt for A or B:** all 16 pages of UI, three themes, three-language switching.

**What deserves real care in every case:** the rules in §5 currently live in ten pure modules with
681 tests proving they hold. A quality hold that stops blocking, or an equipment gate that lets an
operation start on a machine that is out of service, is not a cosmetic bug. Whatever the platform,
budget time to re-verify those rules deliberately, and keep the existing test suite as the
specification of what correct behaviour looks like.

**Worth checking before committing to any of them:** performance on list views over the larger
tables, the price tier needed for 40 tables and this many workflows, whether three-language
switching is comfortable or awkward, and whether an external scheduled agent can write into the
platform's data API — that last one decides whether step 3 works at all. Platform pricing and AI
features move quickly; check them directly rather than trusting any summary, this one included.
