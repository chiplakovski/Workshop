# Varmak Workshop

Internal workshop system prototype for Varmak AB (Marieholm), built module by module.

**This is a frontend prototype.** There is no backend, no database, no API and no real
authentication. All application data lives in the browser's `localStorage` (see
[`workshop-data.js`](workshop-data.js)) and is lost if browser data is cleared. Login and user
roles are a visual demonstration only — no credentials are checked against any server, and no
permission is actually enforced beyond the UI.

## Modules (current)

| Module | File(s) |
|---|---|
| Login | `login.html` |
| Hub | `hub-desktop.html`, `hub-mobile.html` |
| Customers | `customers-desktop.html` |
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
- Worker logs in → Hours module only (demo only, not enforced by any backend)
- Admin logs in → Hub → any module (demo only, not enforced by any backend)

## Data storage and migration
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

For a consistent browser-storage origin, serve the repository folder, for example with
`python -m http.server 4173 --bind 127.0.0.1`, then open
`http://127.0.0.1:4173/hub-desktop.html`. Changing the port or hostname uses a different browser
storage area; export a backup before moving your working data.

## Latest frontend update — 15 September 2026

Development continues on `codex/tender-persistence`.

- Tenders persist in shared browser storage, including reloads, cross-tab updates and backups.
- Hours on desktop and mobile shows named jobcards instead of `(whole jobcard)` and preserves
  the selected item when shared data refreshes.
- Jobcards search sits in the page header, above the register filters.
- Shared sidebar labels and Hub return buttons use larger, consistent typography with wrapping
  support for menu labels.
- Quality has the approved simplified overview: three summary cards, an attention queue,
  release readiness and recent activity. Specialist registers sit under **More quality records**.
  This is an initial visual implementation; remaining Quality interaction and reporting gaps
  are recorded in the handover.

The previously published Version 72 demo has not been republished with these changes.

## Tests
A test suite (Node's built-in test runner, no external dependencies) covers data migration,
backup/import safety, and every pure business-rule module — Jobcards, Estimation, Projects,
Quality, Equipment, Planning, estimate recall, the material reference and the findings queue.
**688 unit tests, a 16-page browser smoke test and the end-to-end workflow suites.** Requires
Node.js 18+ on your PATH.

```
npm test          # runs tests/*.test.js via node --test
npm run test:syntax   # checks every .js file and every HTML page's inline scripts parse,
                       # and that every literal internal .html link resolves to a real file
npm run test:browser  # opens all 16 HTML entry points in headless Chrome/Edge and exercises
                      # safe tabs/views/filters/language controls while checking browser errors
npm run test:e2e      # runs persisted Customers/Estimations, Estimating/Planning,
                      # Jobcards/Hours/Equipment, Store/Suppliers, Documents/Reports
                      # and Marketing/Sales workflows, plus tender persistence
npm run test:tenders  # tender create/edit, reload, cross-tab updates and backup/import;
                      # tests both a served page and an inlined sandboxed srcdoc fixture
```

The browser smoke test uses an installed Chrome, Edge or Chromium executable and does not download
a separate browser. Set `PLAYWRIGHT_CHROME_PATH` when the browser is installed in a non-standard
location. External resources are stubbed during the run so the result does not depend on internet
access.

## Status
Frontend prototype. No production backend, database, secure file storage or real permission
enforcement exists yet. Most modules read and write one `WorkshopData` state and re-render on
the `workshop:data` event. Tenders now use that shared state and survive reloads and backup/import.
Marketing's content calendar and case studies still need the same persistence migration. The
remaining infrastructure steps are a real backend/API/database and real authentication.

For where the work stands, what was decided and why, and what to pick up next, see
[`HANDOVER.md`](HANDOVER.md). For a platform-independent description of the whole system — the
data model, the business rules and the workflows — see [`APP-SPEC.md`](APP-SPEC.md).
