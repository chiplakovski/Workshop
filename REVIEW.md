# Varmak Workshop — a review of the whole system

Every module gone through, with an opinion on what would make it simpler and more useful.
17 September 2026.

---

## The verdict in one line

**The app is built at the scale of a 200-person engineering company. Varmak is about five people
and twelve machines.** Almost everything that feels heavy traces back to that one mismatch — not
to bad screens.

## The measurements this rests on

| | |
|---|---|
| Pages | 16 |
| Lines of markup | 20,128 |
| JavaScript in the pages | 1.23 million characters |
| Functions | 961 |
| Views in module sidebars | 61 |
| Tabs inside those views | 83 |
| Form dialogs | 28 |
| Data collections | 40 |
| Translated strings (3 languages) | ~13,400 |
| Distinct CSS rules | 2,581 |

And the number that matters most:

| Data collections | Count |
|---|---|
| **Never held a single row** | **13** |
| Hold 1–2 rows (seed only) | 14 |
| Genuinely populated | 14 |

**Two thirds of the data model is scaffolding.** Never filled: `hours`, `suppliers`, `invoices`,
`purchaseRfqs`, `supplierInvoices`, `stockCounts`, `documentFolders`, `breakdowns`,
`qualityReleases`, `activity`, and the three prospect collections (those last three are new and
expected to be empty).

`hours` being empty is the one that should worry you. It is the module a worker touches every
single day.

---

## Module by module

### Login
322 lines. Language and theme switch, no credential check.

**Read:** right-sized for a prototype. **Do:** nothing until there is a backend. Then keep it this
plain — a workshop login should be one field and a PIN on the shop floor, not a password policy.

### Hub — 12 tiles
416 lines desktop, 255 mobile.

**Read:** a menu of twelve doors. Everyone sees all twelve, whatever their job.

**Do: replace it with a "Today" screen.** A welder opening the app should land on *the work in
front of them*, not a menu. What is due today, what is running, what is blocked, what is waiting
for me. The tile grid is a table of contents for an app the size of an ERP — which is the problem,
not the solution.

### Customers — 6 views
923 lines. Overview, contacts, quotes, projects, invoices, notes. Eight customers seeded.

**Read:** one of the healthiest modules. Right size, clear purpose, views are genuinely different
things rather than filters.

**Do:** leave it alone.

### Suppliers — single view, **zero rows**
345 lines, and not one supplier has ever been entered.

**Read:** a module that exists for symmetry with Customers, not because anything needed it. A shop
this size has perhaps fifteen suppliers, and what actually matters about them — what they charge,
what their article number is, how long they take — lives nowhere.

**Do: fold it into Store.** A supplier is a name attached to a price, not a module. The
supplier–item price table (item ↔ supplier ↔ their article number ↔ price ↔ pack size ↔ lead time)
is worth ten times more than this page.

### Project / Estimator — 6 views, 172 functions
2,911 lines, 211k of JavaScript. **The largest page in the app.**

**Read:** it is the heart of the system, so weight is partly earned. But the six "views" were not
views — they were Kanban column visibility (all / draft / review / sent / accepted / closed),
**removed in Pass 4.39**; focusing a stage is now done from the stage's own header. And 172
functions in one file is where bugs go to hide — still true, still unaddressed.

**Do:**
- Status filters become a **chip row above one list**, not six sidebar entries. Five entries gone.
- Split the file. Pricing, the workflow strip, and the item list are three separable jobs.

### Planning — Board, Schedule, Capacity
1,159 lines, rebuilt recently.

**Read:** the best-shaped module in the app. Three views that are genuinely three different
questions — *where is everything*, *when does it happen*, *can we take more*.

**Do:** nothing. Use it as the template for what the others should feel like.

### Store — single view, dense
1,174 lines, 102k of JavaScript. Six stock items, a 1,908-product generated catalogue.

**Read:** coherent and genuinely good. The generated catalogue and calculated weights are the
strongest engineering in the app.

**Do:**
- **One price per item is the real bug.** Two suppliers, two prices, and the app remembers one.
- Groups, subgroups, warehouses, sublocations and bins is four levels of structure for **one
  warehouse**. Collapse to two: a location and a shelf.

### Jobcards — 8 views, 149 functions, 9 dialogs
2,009 lines, 172k of JavaScript.

**Read:** again, the eight views are status filters (ready / in progress / blocked / completed /
inspection / archived / all / overview). Nine separate modal forms for one module is a lot of
places to get lost.

**Do:**
- ~~Filters become chips. Seven entries gone.~~ **Done, Pass 4.39** — and the duplicate raw-status
  dropdown it was fighting with now releases it, instead of both being set at once.
- ~~**A jobcard needs to print onto paper and go to the machine.** It does have print styles — good.
  Make that a first-class button, not a browser afterthought.~~ **Already was** — a primary button,
  and a complete traveller. What it lacked was somewhere to write: each operation now carries ruled
  boxes for actual hours, the date done and initials (**Pass 4.43**).

### Hours — **the most important module, and the thinnest**
550 lines desktop, 509 mobile. **Zero entries ever recorded.**

**Read:** this is the one a worker opens every day, several times, with dirty hands, on a phone,
possibly with bad wifi in a steel building. It got less attention than the campaign calendar.

**Do — this is my strongest recommendation in the whole review:**
- **Make it the app's centre of gravity, not a side module.** Booking time should be two taps.
- **Make it work offline.** There is no service worker anywhere in the app; a steel workshop is
  exactly where the signal dies. Time booked in a dead spot must not be lost.
- Big touch targets. Gloves.

### Equipment & Machines — 12 tabs per machine
2,282 lines. Twelve machines in the register.

**Read:** inspections, maintenance, certifications, calibrations, usage sessions, downtime
records, pre-use checks, return-to-service... twelve tabs for each of twelve machines. The
`breakdowns` collection has never held a row.

**Do:** keep three things — *is it working*, *when is it next serviced*, *is its certificate
valid*. Everything else is a log nobody reads. The **gate** it provides (an operation cannot start
on a machine that is out of service) is the valuable part and must survive any trimming.

### Quality — done: 4 views (was 16), 1,363 lines (was 2,488)
**Pass 4.38 (19 September).** Thirteen views removed; a **Quality Holds** page added, because the
hold was the most valuable thing in the module and was the one record with no page of its own —
it could be counted on the overview and released from a modal, but never simply listed. The module
is now Overview, Inspections, NCR and Quality Holds.

The record types were left **in the data layer**, only unreachable from the UI. Nothing has been
lost yet, so the carve-out below is still recoverable — but it must be honoured **before**
`qualityWelds`, `qualityWps` and `qualityWelderQuals` are deleted from `workshop-data.js`, not
after.

The original reading, which still stands:

**Read:** this is enterprise ISO machinery. **But I need to be careful here**: if Varmak is
certified to **EN 1090** for structural steel — which is normal in Sweden — then weld records, WPS
and welder qualifications are not optional, they are what the certificate requires. Five-whys and
fishbone diagrams on a CAPA, however, are consultancy furniture.

**Decided (18 September): no certification is held.** So: **keep** inspections, NCRs and holds —
the three that stop bad work going out. **Drop** welds, WPS, welder qualifications, CAPA's analysis
tooling, ITPs, dossiers, supplier quality and complaints: nine record types down to three.

One exception, because it cannot be recovered later: record **who welded it and with what filler**
as plain fields on the operation. If certification is pursued in two years that history exists;
the subsystem can be built then, the facts cannot. A jobcard operation carries `worker` and
`machine` today; it needs `welder`, `fillerMaterial` and `consumableBatch`. **Not yet done** — and
it is the gate on deleting the weld collections.

The **hold gate** — an active hold blocks completion — is the most valuable thing in the module and
survives any trimming.

### Documents — 46 lines
The smallest module in the app, and `documentFolders` has never held a row.

**Read:** under-built relative to its importance. Drawings, certificates and MTCs are the paperwork
a fabricator actually lives on, and they are scattered — a certificate reference sits on a store
item, a drawing number on a jobcard, a file here.

**Do:** stop treating documents as a module. **Attach them where they belong** — on the jobcard, on
the store item, on the project — and let this page be a search across all of them.

### Marketing — 10 views
1,800 lines. Leads, opportunities, tenders, campaigns, content calendar, case studies, audience
segments, analytics, findings.

**Read:** a marketing department's software for a workshop with no marketing department. A
**content calendar** and **audience segments** for a five-person fabricator is fantasy. Tenders are
held in the page and vanish on reload.

**Do:** cut to three — **Findings**, **Leads**, **Opportunities**. The findings queue is the most
genuinely useful new thing in the app; the rest dilutes it. Delete campaigns, content, case
studies, segments. Move tenders into real storage or drop them.

### Reports — done: 6 reports (was 15 views, 61 tabs), 1,317 lines (was 2,939)

**Pass 4.40.** The six are **What We Won · What Is Late · Where The Hours Went · What Is Low In
Stock · What We Bought · What Failed Inspection**, plus the Saved Reports list, which stays because
it is a real, tested workflow and its records are created from Documents, not from the builder.
The builder is gone.

One name changed on purpose. The proposal said *what did we earn this month*; the system has no
invoicing — `invoices` is empty in both the empty state and the demo — so there is no earned figure
to report. The report counts **accepted quotations** and is called **What We Won**, and its lead
line says in as many words that this is order intake, not invoiced revenue. Naming it *earned*
would have been the first invented number in the app.

Four defects fell out of the rebuild, none of them visible from a tab count:

- **Two tabs never opened at all.** A KPI card and a tab panel shared an `id` in Store (Reserved)
  and in Purchasing (Late), so `getElementById` handed the tab switcher the KPI and the panel stayed
  hidden. Both had been dead since they were written.
- **The module opened on "today".** The default range was `today`, so a shop whose last job was
  yesterday opened Reports to a blank page. It opens on All Time now.
- **Two field names were wrong** in the stock figures (`minimum`/`unitPrice` against the store's real
  `minStock`/`avgCost`), so stock value read N/A and the below-minimum list was empty.
- **A stale instruction.** Purchasing reports told the user to go to "the Purchasing module", deleted
  back in Pass 4.06. Purchase orders come from Suppliers.

---

## The four structural changes

### 1. Sixteen modules become nine

| Now | Becomes |
|---|---|
| Hub | **Today** — what is due, running, blocked, waiting on me |
| Customers | **Customers** — unchanged |
| Estimator + Planning | **Jobs** — one page per job: quote → plan → schedule |
| Jobcards + Hours | **Shop floor** — mobile-first, offline |
| Store + Suppliers | **Store** |
| Equipment | **Machines** — trimmed to three questions |
| Quality | **Quality** — only what certification demands |
| Marketing | **Leads** — findings, leads, opportunities |
| Reports | **Numbers** — six reports |
| Documents | *dissolved into the records they belong to* |

**The biggest single win is Jobs.** Today a job's life is spread across four modules — quoted in
one, scheduled in another, worked in a third, timed in a fourth. Nobody thinks that way. A job is
one thing; give it one page with tabs.

### 2. Status filters are not navigation — done (Pass 4.39)

Of 61 sidebar views, roughly twenty were status filters wearing a navigation costume. Estimator had
six, Jobcards eight. Both are done: Jobcards 9 sidebar entries → 3 with a counted chip row over the
one table it always was, Estimations 6 → 2 with stage focus moved onto the board's own column
headers, where the lane being focused can actually be seen.

Two things this turned up that the count alone did not predict:

- **Jobcards had two status controls, and they could disagree.** The sidebar view and the filter
  bar's raw-status dropdown both narrowed by status, with nothing stopping you setting both — which
  silently produced an empty list. They release each other now.
- **On Estimations the "filter" was hiding Kanban columns.** A board exists to show every stage and
  its count at once; a control that leaves one lane standing is not a filter, it is a way to throw
  the board away. And it only narrowed the board — the detail panel below kept showing whatever was
  selected, so "Drafts" could show a Draft board above an Accepted estimate.

The remaining status-as-navigation cases are in the modules not yet reviewed for this; check each
before assuming the count of twenty is spent.

### 3. Empty structures get filled or deleted

Thirteen collections have never held a row. Each is either a missing feature or dead weight — and
right now you cannot tell which by looking. Decide one by one. `hours` gets filled. Most of the
rest get deleted.

### 4. Four levels of location become two

Group → subgroup → warehouse → sublocation → bin, for one building. A shelf and a slot is enough.

---

## What is missing, and matters more than any of the above

1. **Offline.** ~~No service worker anywhere.~~ **Partly done.** Booking hours now survives a dead
   signal: the entry is written to the tablet with the id the server will take, the screen says it is
   held, and it is sent by itself when the line comes back — `workshop-queue.js`, wired into
   hours-mobile. Starting or finishing a step and taking material off the shelf have the database
   half (`record_operation_offline`, `issue_material_offline`) and not yet the screen half. There is
   still no service worker, so the page itself must be loaded while there is a connection.
2. **Paper.** Only four of sixteen pages can print. A jobcard goes to the machine on paper; a
   material certificate gets filed on paper; an invoice gets posted.
3. **Two prices for one item.** You cannot compare what two suppliers charge.
4. **Photographs.** A fabricator photographs the weld, the defect, the delivered job. There is
   nowhere to put a picture.
5. **A phone that works.** Only Hours and Hub have mobile pages. Everything else assumes a desk.
6. **Macedonian is written in two scripts, and nobody has decided which.** Measured over every
   page's Macedonian dictionary: **1,616 strings in Latin script, 727 in Cyrillic** — 31% of the
   Macedonian in this app is in the other script from the rest of it.

   It is not scattered noise. Five screens are written almost entirely in Cyrillic — Equipment (166 of
   166), Reports (151 of 153), Planning (142 of 144), Quality (115 of 116) — while Customers,
   Suppliers, Access, both Hubs and Hours-desktop have not a single Cyrillic character. Jobcards,
   Marketing, Estimations and Hours-mobile are mixed, and **Login is nearly half and half**, so the
   screen a person signs in on changes script as they read down it.

   Both are correct Macedonian, so nothing is unreadable and no test can see it; this is a decision,
   not a bug, and it is yours. Say which script and it is a mechanical pass — Macedonian romanisation
   is a letter-for-letter map, and the transliteration in the Latin pages is already consistent
   (`š ž č ḱ`) apart from a handful of `kj` for `ḱ`. Until then new strings follow whichever script
   dominates the page they are added to: that is why Hours-mobile's queue messages came out Latin and
   Planning's came out Cyrillic.

   **The first version of this count was wrong, and how it was wrong is worth keeping.** It said 419
   Cyrillic strings out of 1,945, because the scan looked only for dictionaries written as `mk:{…}`
   inside one object and this app has five pages that write `T.mk = {…}` as their own statement —
   including Equipment and Planning, the first and third largest Cyrillic pages in the list. A
   measurement that cannot see a third of what it is measuring understates the work by exactly that
   third, and this project has now had the same lesson from `coverage.js` twice and from here once.

---

## Three questions only you can answer — **answered 18 September**

> **No certification yet** · **both a shared tablet and personal phones** · **2–4 people will log
> in.** What each settled is in [`BACKEND.md`](BACKEND.md) §6. The consequences for this review:
> the Quality trim below is now decided rather than proposed, the shop-floor half genuinely does
> need rebuilding around a device, and two roles are enough.

The original questions, kept for the reasoning behind them:

**Which certification do you hold?** It decides how much of Quality is legally required and how
much is furniture. I will not guess at this — getting it wrong in either direction is expensive.

**Does anyone on the floor need Macedonian?** Three languages cost roughly 13,400 translated
strings, and every new screen pays that tax three times. If Macedonian serves only you, and you
read English and Swedish comfortably, dropping it halves the ongoing translation work. If there
are Macedonian-speaking workers, it stays — that is not a cost question.

**Who actually opens this, and on what?** If the answer is mostly you, on a laptop, the app is
roughly right and just needs trimming. If it is four people on phones in a workshop, then the
shop-floor half needs to be rebuilt around a phone and the desk half can stay as it is.

---

## What I would not touch

The engineering underneath is better than the surface suggests, and a rebuild should carry it
across rather than start over:

- **Ten pure rule modules with 681 tests.** The quality holds, the equipment gates, the status
  transitions. This is the part that makes the app correct rather than merely pretty.
- **The generated catalogue and calculated weights.** Cross-section × density, never typed in.
- **Planning.** Three views, three real questions. The template for everything else.
- **The honesty rule** — never show an invented figure, report *no data* instead — and the fact
  that it is enforced structurally rather than by good intentions.

Trim the app by half and all of that still stands up.
