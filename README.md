# Varmak Workshop

Internal workshop system prototype for Varmak AB (Marieholm), built module by module.

**To put this into service on a real database, follow [`DEPLOY.md`](DEPLOY.md).** Sixteen steps:
Supabase for the database, a small machine for the Node server, Caddy for HTTPS, and the first
administrator made from a screen rather than from psql. `npm run test:deploy` runs the whole install
against a Postgres deliberately shaped like a hosted one and then asks whether a welder can still read
a price on the result.

**Two halves, and they are at different stages.** There is now a real backend — PostgreSQL with
its safety rules as triggers, two sign-in doors, three database roles with row-level security
forced on every table, the workflows as database functions, and a thin HTTP layer that decides
nothing. It lives under [`backend/`](backend/) and has its own [README](backend/README.md).

**Twelve pages read and write the database** — both hubs, both hours screens, the access screen,
Customers, Jobcards, Store, Planning, Reports, Equipment, and the project half of Project / Estimator. Together they are the chain a
workshop needs to start: record a customer, put work on the board, book hours against it, take steel
off the shelf for it. The rest still run entirely on the browser's `localStorage` (see [`workshop-data.js`](workshop-data.js)), which is lost if browser
data is cleared. A page that has not been wired refuses to show anything at all to a signed-in
session and says why, rather than showing figures that are not the workshop's; see
[`workshop-guard.js`](workshop-guard.js). Nothing changes for a browser with no session: all sixteen
pages work exactly as they always have.

**The shop tablet keeps what it cannot send.** A steel building eats wifi, and the screen used most
is the one used furthest from the router — so booking hours no longer needs a connection. The entry
is written to the tablet with the id the server will be given, the screen says what is being held and
what has not gone through, and it is sent by itself when the line comes back. Asking twice is harmless
because the id is generated once; see [`workshop-queue.js`](workshop-queue.js). The page itself still
has to be loaded while there is a connection: a tablet that comes up with no signal can send what it
is holding, and says plainly that it cannot read the workshop rather than showing the job list from
this browser's own leftovers.

## Modules (current)

| Module | File(s) |
|---|---|
| Login | `login.html` |
| Hub | `hub-desktop.html`, `hub-mobile.html` |
| Customers | `customers-desktop.html` — **on the database** when there is a session |
| Suppliers | `suppliers-desktop.html` |
| Project / Estimator | `estimations-desktop.html` — the **project** half is on the database; estimating is not, and says so |
| Planning | `planning-desktop.html` |
| Store | `store-desktop.html` — **on the database** when there is a session |
| Hours | `hours-desktop.html`, `hours-mobile.html` |
| Jobcards | `jobcard-desktop.html` — **on the database** when there is a session |
| Documents | `documents-desktop.html` |
| Marketing | `marketing-desktop.html` |
| Equipment & Machines | `equipment-machines-desktop.html` |
| Reports | `reports-desktop.html` |
| Quality | `quality-desktop.html` |
| Access | `admin.html` — **on the database.** Who may sign in, and through which door |

Shared logic used across modules:
- `workshop-data.js` — the shared browser-storage data layer (`window.WorkshopData`), including
  the customers/estimations/projects/inventory/jobcards/equipment/quality records, the v3→v4
  migration and backup/import safeguards described below.
- `workshop-api.js` — the browser's side of the backend: carries requests, holds the session token,
  decides nothing. A dead connection is answered rather than thrown, so a page can tell "we cannot
  reach the server" from "the server would not give it to you".
- `workshop-queue.js` — work booked with no connection, kept until it arrives. Stored under its
  owner's id, flushed oldest first, and never sent with a new id.
- `customer-record.js` · `jobcard-record.js` · `project-record.js` · `stock-record.js` ·
  `equipment-record.js` — the translation between what a screen holds and what a column holds, one per
  record type, each with its own unit tests. They exist because a page that shows a subset of a record
  must not save a subset of it.
- `workshop-forms.js` — shared form helpers.
- `workshop-ui.js` / `workshop-ui.css` — the shared UI layer: one type scale, delayed tooltips, the
  per-module Help panel, and `wConfirm`/`wAlert`/`wPrompt`. The last of those matter: a sandboxed
  iframe silently refuses `window.confirm()`, so the packaged demo asks and tells in its own markup.
- Pure business-rule modules, each shared between a page and the automated test suite (see
  **Tests** below), so the browser and the tests can never disagree about a rule:
  `jobcard-rules.js`, `estimation-rules.js`, `project-rules.js`, `quality-gates.js`,
  `equipment-gates.js`, `jobcard-equipment-rules.js`, `planning-rules.js`, `estimate-memory.js`,
  `material-reference.js`, `prospect-rules.js`.
- `prospect-stub.js` — fixed sample findings standing in for an outward sweep of public sources,
  so the Marketing findings queue can be driven before anything is wired to a model or a network.

## Access model
With no server, the sign-in on `login.html` is still what it always was: a way into the local demo,
enforcing nothing.

With the server up it is real, and enforced by the database rather than by the interface:

- **Two doors.** The office signs in with an email and a password; the shop floor signs in with a
  PIN on the shared tablet, and that session ends with the shift rather than in thirty days.
- **Three Postgres roles.** Every request runs as the role the person's own row names, with
  row-level security forced on every table and money granted column by column — so a welder cannot
  read the customer's agreed price even by asking the API directly.
- **`admin.html`** is where a workshop gives and takes away access: add somebody, set their PIN or
  password, change what they may do, switch them off. It makes the first administrator too, on an
  empty system, which is how the system is started without a database console.

The details, and what each role may touch, are in [`backend/README.md`](backend/README.md).

## Data storage and migration
**The application opens on an empty system.** No customers, no projects, no machines, no stock —
a workshop meeting it on its first day sees its own empty workshop, and the first customer it
creates is C-001. The only things present are the classification scheme (item groups and warehouse
locations), because without them you would have to design a numbering system before entering a
single bolt; rename or delete them freely.

The demonstration records still exist as a fixture. `WorkshopData.loadDemoData()` fills the system
with them — used by the test suites, and available from the browser console for showing the system
populated. `WorkshopData.reset()` empties it again.

All data is stored client-side under the `varmak.workshop.frontend.v5` localStorage key. On load,
if that key is missing or unreadable, `workshop-data.js` looks for the older
`varmak.workshop.frontend.v4` and `...v3` keys and migrates them forward automatically, without
ever deleting the original record or overwriting valid data with corrupted data. Call
`WorkshopData.getDataHealth()` from the browser console to see the current migration/data-health
status. `WorkshopData.backupData()` downloads a JSON backup; `WorkshopData.validateBackup(obj)`
and `WorkshopData.importBackup(obj)` validate and safely restore one (the current data is kept as
a recovery copy before an import is applied). There is currently no in-app UI for import — this is
a data-layer safeguard only, with an import/export UI planned for a future Settings/Data
Administration pass.

## External lookups
The New Customer form (Customers module) has a "Fetch from allabolag.se" button next to the
organization number field. It performs a real `fetch()` against allabolag.se — this is not a
simulation. allabolag.se does not expose a public, CORS-enabled API for third-party pages, and
this prototype has no backend to proxy the request through, so in a real browser the call is
expected to fail with a network/CORS error; the UI reports that honestly (with a message
explaining why) rather than fabricating company data. It only auto-fills the form if a future
backend proxy makes the request succeed and returns the expected JSON shape.

## Shared design
Sharp edges, engineering-grid + spark animation, compact SV / EN / MK language switcher,
3K/4K scaling on desktop screens.

### Themes
Three themes ship with the prototype:

| Theme | Look | Type |
|---|---|---|
| **Navy** (default) | The original navy palette (#013179) | Sora / Inter |
| **Carbon** | Near-black ground, dimmed ambient wash, white-hot sparks | Space Grotesk / IBM Plex Sans |
| **Iris** | Light: white panels, indigo accent, dark text | Public Sans |

The theme toggle lives on `login.html` (bottom-right, next to the language switcher). It writes
the choice to the `varmak.theme` localStorage key, and every page reads that key in a small
inline script in `<head>` — before first paint, so there is no flash of the wrong theme — and
sets `data-theme="carbon"` or `data-theme="iris"` on `<html>` when it applies.

Iris is the one that catches mistakes: it is the only light theme, so anything that relies on a
dark ground — a button with no explicit `color`, a chip tinted by opacity alone — becomes
unreadable there and nowhere else. Check every new colour in Iris before calling it done.

Theming is entirely CSS-variable driven: each page defines its palette in `:root` and overrides
the same variable names under `:root[data-theme="carbon"]` and `:root[data-theme="iris"]`. Colours that used to be hardcoded in
`rgba()`/gradients were given `--c-*` custom properties (with `--c-*-rgb` triplet companions for
values used at several alpha levels) so both themes flow from one set of declarations. Adding a
fourth theme therefore means adding one more `:root[data-theme="..."]` block per page — no
component CSS has to change.

Two deliberate exceptions: colours built inside `<script>` blocks (a handful of calendar/chart
accent values) are left alone, as is the print stylesheet Equipment/Machines generates for its
print window — that one is meant for paper and must stay light.

## Run locally
Open any `.html` file in a browser, or use the VS Code **Live Server** extension
(right-click a file → "Open with Live Server"). Keep online — fonts load from Google.

## Tests
A test suite (Node's built-in test runner, no external dependencies) covers data migration,
backup/import safety, and every pure business-rule module — Jobcards, Estimation, Projects,
Quality, Equipment, Planning, estimate recall, the material reference and the findings queue.
**719 unit tests, a browser smoke test over all 17 pages, and 202 end-to-end steps, all passing** —
67 of those steps drive a real browser against a real PostgreSQL: the welder's hours slice, the access
screen, Customers, Jobcards, making a project, and the store. Requires Node.js 18+ on your PATH, and
PostgreSQL 16 for the backend suites.

```
npm test          # runs tests/*.test.js via node --test
npm run test:syntax   # checks every .js file and every HTML page's inline scripts parse,
                       # and that every literal internal .html link resolves to a real file
npm run test:browser  # opens every HTML entry point in headless Chrome/Edge and exercises
                      # safe tabs/views/filters/language controls while checking browser errors
npm run test:e2e      # runs persisted Customers/Estimations, Estimating/Planning,
                      # Jobcards/Hours/Equipment, Store/Suppliers, Documents/Reports
                      # and Marketing/Sales workflows, then the seven that go all the way to
                      # Postgres: the hours slice, the access screen, Customers, Jobcards,
                      # making a project, the store, and the offline queue with the
                      # connection actually cut
npm run test:backend  # the database, the roles, the workflows, real HTTP, a restored backup,
                      # and the install onto a hosted-shaped Postgres over verified TLS
```

The last two e2e runs and `test:backend` need PostgreSQL. They start a throwaway server themselves
if one is not already up — see [`backend/README.md`](backend/README.md).

The browser smoke test uses an installed Chrome, Edge or Chromium executable and does not download
a separate browser. Set `PLAYWRIGHT_CHROME_PATH` when the browser is installed in a non-standard
location. External resources are stubbed during the run so the result does not depend on internet
access.

## Status
The backend exists and is tested: schema and safety rules, sign-in and roles, the workflows, reading
it back, and backups verified by restoring one. Step 5 of [`BACKEND.md`](BACKEND.md) — pointing the
pages at it — is **done: every screen is on the database**, the login page needing nothing of its own.

Documents was the last, and the thing it had been waiting for was the wrong thing. File storage was never
what mattered: what a document register is for is knowing that a material certificate runs out on the 12th,
that revision B supersedes revision A, and which job the procedure on file belongs to — all metadata, none
of it needing the scan to exist. The register is wired; the file half of each row stays empty until there
is object storage, and the screen says which is which rather than offering a download that leads nowhere.

There is still a measured gap in how much of what the pages collect the database can hold
(`npm run coverage` — 77% today), and the remainder is concentrated on **invoicing**, estimating and
purchasing. It is **not** concentrated on the sales pipeline, which is what this document said until the
pipeline was wired and all twelve of the fields reported missing there turned out to be columns that
already existed under longer names.

**Twenty-one collections are not measured against a table, and every one is named with its reason** in
`backend/coverage.js`, because a meter silent about a module reads as though it covered it. Fourteen have no
table; the other seven are a rollup, a grouping, a second copy of something, or this browser's own
bookkeeping. Twenty of the twenty-one were found by fixing the meter rather than by reading the app — first
eleven, then nine more when the check stopped skipping collections the demonstration fixture had left empty.

Two of those were the largest gaps and both are now settled, one by building and one by deciding.

The **four welding registers** are built — a weld log, the NDT against those welds, the procedures they are
welded to, and which welder is qualified to each — which for a fabrication shop are what a delivery is
signed off against. Five tables, five rules enforced in the database, four panels on the Quality screen.

**`invoices`** is settled the other way: this system provides the **invoice basis** and not the invoice.
Hours booked and material issued, per project, per line, with dates — exported as CSV for the accounting
system that issues the actual invoice. No invoice number, no VAT, nothing stored, and nothing that knows
what has already been billed, because a second place that thinks it knows what a customer owes is the one
nobody reconciles. There is no labour amount either: no hourly rate is recorded anywhere in this system, and
inventing one here would be inventing the invoice. [`BACKEND.md`](BACKEND.md) has the reasoning in full.

There is also a deployment path now: [`DEPLOY.md`](DEPLOY.md) installs the four SQL files onto a
hosted PostgreSQL as a non-superuser, over verified TLS, with real passwords — and
[`backend/test-deploy.js`](backend/test-deploy.js) proves it against a Postgres shaped like a hosted
one. Secure file storage still does not exist, so photographs and attachments have nowhere real to live —
which is a smaller thing than it was once thought to be: it costs the bytes of a file and nothing else. The
document register, the expiry dates and the revisions are all on the database without it.

One thing wiring Customers settled, which is worth knowing before the next screen: the claim in
`BACKEND.md` that the pages would not change was wrong about shapes as well as about writes. The
screen has always held payment terms as the words "30 days" and the billing address as an array of
lines; the database holds a count of days and one block of text. The translation lives in
[`customer-record.js`](customer-record.js), [`jobcard-record.js`](jobcard-record.js),
[`project-record.js`](project-record.js) and [`stock-record.js`](stock-record.js), each with its own
unit tests, and each remaining screen will need one.

Eight times now the schema has turned out to hold words nobody uses — a jobcard priority of `normal`
where the dropdown offers `medium`, a material state of `ready` where the screen says `available`, an
equipment status of `out-of-service` where seven places compare against `Out of Service`, and an
inspection status of `done` where the screen writes `completed`, a supplier status with no word for
`preferred` where the register has three filter tabs, two of the sales board's eight columns missing from
the stage enum, a lead that could only be `lost` where the filter offers `disqualified`, and a contact
preference in lower case where the dropdown offers `Email`. The rule that came out of it: one
spelling per state, and when the schema and the screen disagree the screen wins, because those are the
words somebody picks from a dropdown. The equipment one was not a preference — the gate fails closed on
a status it cannot read, so it was refusing every machine in the workshop.

The shared-data consolidation is done — every module reads and writes one `WorkshopData` state and
re-renders on the `workshop:data` event, rather than keeping its own copy.

The design system — every colour, font, type size and component recipe across the three themes —
is written out in [`THEMES.md`](THEMES.md).

What has to exist behind the interface — the database, the login, and which rules must move out of
the browser to hold at all — is in [`BACKEND.md`](BACKEND.md).

A module-by-module review of the whole system, with an opinion on what would make it simpler and
more useful, is in [`REVIEW.md`](REVIEW.md).

For where the work stands, what was decided and why, and what to pick up next, see
[`HANDOVER.md`](HANDOVER.md). For a platform-independent description of the whole system — the
data model, the business rules and the workflows — see [`APP-SPEC.md`](APP-SPEC.md).
