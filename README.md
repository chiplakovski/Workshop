# Varmak Workshop

Internal workshop system prototype for Varmak AB (Marieholm), built module by module.

**Two halves, and they are at different stages.** There is now a real backend — PostgreSQL with
its safety rules as triggers, two sign-in doors, three database roles with row-level security
forced on every table, the workflows as database functions, and a thin HTTP layer that decides
nothing. It lives under [`backend/`](backend/) and has its own [README](backend/README.md).

**The pages are mostly not on it yet.** Three of them read and write the database — the shop floor's
hours screen, the access screen and Customers — and the rest still run entirely on the
browser's `localStorage` (see [`workshop-data.js`](workshop-data.js)), which is lost if browser
data is cleared. A page that has not been wired refuses to show anything at all to a signed-in
session and says why, rather than showing figures that are not the workshop's; see
[`workshop-guard.js`](workshop-guard.js). Nothing changes for a browser with no session: the
fourteen pages work exactly as they always have.

## Modules (current)

| Module | File(s) |
|---|---|
| Login | `login.html` |
| Hub | `hub-desktop.html`, `hub-mobile.html` |
| Customers | `customers-desktop.html` — **on the database** when there is a session |
| Suppliers | `suppliers-desktop.html` |
| Project / Estimator | `estimations-desktop.html` |
| Planning | `planning-desktop.html` |
| Store | `store-desktop.html` |
| Hours | `hours-desktop.html`, `hours-mobile.html` |
| Jobcards | `jobcard-desktop.html` |
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
**697 unit tests, a browser smoke test over all 17 pages, and 181 end-to-end steps, all passing** —
46 of those steps drive a real browser against a real PostgreSQL: the welder's hours slice, the
access screen and Customers. Requires Node.js 18+ on your PATH, and PostgreSQL 16 for the backend
suites.

```
npm test          # runs tests/*.test.js via node --test
npm run test:syntax   # checks every .js file and every HTML page's inline scripts parse,
                       # and that every literal internal .html link resolves to a real file
npm run test:browser  # opens every HTML entry point in headless Chrome/Edge and exercises
                      # safe tabs/views/filters/language controls while checking browser errors
npm run test:e2e      # runs persisted Customers/Estimations, Estimating/Planning,
                      # Jobcards/Hours/Equipment, Store/Suppliers, Documents/Reports
                      # and Marketing/Sales workflows, then the three that go all the way
                      # to Postgres: the hours slice, the access screen and Customers
npm run test:backend  # the database, the roles, the workflows, real HTTP, and a restored backup
```

The last two e2e runs and `test:backend` need PostgreSQL. They start a throwaway server themselves
if one is not already up — see [`backend/README.md`](backend/README.md).

The browser smoke test uses an installed Chrome, Edge or Chromium executable and does not download
a separate browser. Set `PLAYWRIGHT_CHROME_PATH` when the browser is installed in a non-standard
location. External resources are stubbed during the run so the result does not depend on internet
access.

## Status
The backend exists and is tested: schema and safety rules, sign-in and roles, the workflows, reading
it back, and backups verified by restoring one. What is not done is step 5 of
[`BACKEND.md`](BACKEND.md) — pointing the pages at it. Three of the seventeen are on it; the rest need
their workflows written and their screens wired, and there is a measured gap in how much of what the
pages collect the database can hold (`npm run coverage` — 68% today, and the remainder is concentrated
on Equipment and the sales pipeline rather than spread).

One thing wiring Customers settled, which is worth knowing before the next screen: the claim in
`BACKEND.md` that the pages would not change was wrong about shapes as well as about writes. The
screen has always held payment terms as the words "30 days" and the billing address as an array of
lines; the database holds a count of days and one block of text. The translation lives in
[`customer-record.js`](customer-record.js) with its own unit tests, and each screen will need its
own.

There is also no deployment: everything above runs on a local PostgreSQL started by the test
suites. Secure file storage does not exist — photographs and attachments still have nowhere real to
live.

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
