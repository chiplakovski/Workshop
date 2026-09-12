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
| Estimation | `estimations-desktop.html` |
| Projects | `projects-desktop.html` |
| Planning | `planning-desktop.html` |
| Store (inventory, movement, purchasing) | `store-desktop.html` |
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
- `jobcard-rules.js`, `estimation-rules.js`, `project-rules.js`, `quality-gates.js`,
  `equipment-gates.js`, `jobcard-equipment-rules.js`, `store-purchasing-rules.js` — small pure
  business-rule modules shared between a page and the automated test suite (see **Tests** below).

## Access model
- Worker logs in → Hours module only (demo only, not enforced by any backend)
- Admin logs in → Hub → any module (demo only, not enforced by any backend)

## Data storage and migration
All data is stored client-side under the `varmak.workshop.frontend.v4` localStorage key. On load,
if that key is missing or unreadable, `workshop-data.js` will look for the older
`varmak.workshop.frontend.v3` key and migrate it forward automatically, without ever deleting the
original v3 record or overwriting a valid v4 record with corrupted data. Call
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
Two themes ship with the prototype:

| Theme | Look | Type |
|---|---|---|
| **Navy** (default) | The original navy palette (#013179) | Sora / Inter |
| **Carbon** | Near-black ground, dimmed ambient wash, white-hot sparks | Space Grotesk / IBM Plex Sans |

The theme toggle lives on `login.html` (bottom-right, next to the language switcher). It writes
the choice to the `varmak.theme` localStorage key, and every page reads that key in a small
inline script in `<head>` — before first paint, so there is no flash of the wrong theme — and
sets `data-theme="carbon"` on `<html>` when it applies.

Theming is entirely CSS-variable driven: each page defines its palette in `:root` and overrides
the same variable names under `:root[data-theme="carbon"]`. Colours that used to be hardcoded in
`rgba()`/gradients were given `--c-*` custom properties (with `--c-*-rgb` triplet companions for
values used at several alpha levels) so both themes flow from one set of declarations. Adding a
third theme therefore means adding one more `:root[data-theme="..."]` block per page — no
component CSS has to change.

Two deliberate exceptions: colours built inside `<script>` blocks (a handful of calendar/chart
accent values) are left alone, as is the print stylesheet Equipment/Machines generates for its
print window — that one is meant for paper and must stay light.

## Run locally
Open any `.html` file in a browser, or use the VS Code **Live Server** extension
(right-click a file → "Open with Live Server"). Keep online — fonts load from Google.

## Tests
A lightweight test suite (Node's built-in test runner, no external dependencies) covers data
migration, backup/import safety, and pure business-rule helpers for Jobcards, Estimation,
Projects, Quality, Equipment, and Store/Purchasing. It requires Node.js 18+ on your PATH.

```
npm test          # runs tests/*.test.js via node --test
npm run test:syntax   # checks every .js file and every HTML page's inline scripts parse,
                       # and that every literal internal .html link resolves to a real file
npm run test:browser  # opens all 18 HTML entry points in headless Chrome/Edge and exercises
                      # safe tabs/views/filters/language controls while checking browser errors
npm run test:e2e      # runs persisted Customers/Estimations, Projects/Planning,
                      # Jobcards/Hours/Equipment, Store/Purchasing/Suppliers, and
                      # Documents/Reports and Marketing/Sales workflows
```

The browser smoke test uses an installed Chrome, Edge or Chromium executable and does not download
a separate browser. Set `PLAYWRIGHT_CHROME_PATH` when the browser is installed in a non-standard
location. External resources are stubbed during the run so the result does not depend on internet
access.

## Status
Frontend prototype. No production backend, database, secure file storage or real permission
enforcement exists yet. Next steps (not started): a shared-data consolidation pass, a real
backend/API/database, and real authentication.
