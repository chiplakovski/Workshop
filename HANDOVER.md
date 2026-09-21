# Handover — 14 September 2026

Where the Varmak Workshop prototype stands, what was decided and why, and what to pick up next.
Written so a later session can continue without re-opening settled questions.

**Branch:** `claude/relaxed-albattani-sehl3a` — all work is committed and pushed here.
**HEAD:** `6bbaceb` — Pass 4.34.
**Live demo:** https://claude.ai/code/artifact/c77193c9-c065-40fe-bac6-fbd29e56a090 (Version 72)
**Green:** 681 unit tests · 16-page browser smoke · 94 end-to-end steps.

---

## 1. What this is

A frontend prototype of an internal workshop system: 16 HTML pages, no backend, all data in one
`localStorage` key (`varmak.workshop.frontend.v5`). It is also published as a single ~7 MB HTML
file — every page inlined and served to an iframe via `srcdoc` — which is the link above.

Two consequences of that packaging shape every decision below, and both have bitten:

- **The sandboxed iframe refuses `window.confirm()` silently.** It returns `false`, so a guarded
  action just quietly does nothing. Use `wConfirm` / `wAlert` / `wPrompt` from `workshop-ui.js`.
- **HTML5 drag never fires there** — `dragstart` does not happen. Planning's board uses pointer
  events instead. Do not "fix" it back to native drag.

**Verification must happen in the packaged bundle**, not only against the files served from disk.
A change that works locally and fails in the iframe is the normal failure mode, not a rare one.

## 2. The rule that governs the whole project

**Never show an invented figure. Report "no data" instead.**

This is not a style preference — it is why the app can be trusted on a shop floor, and it is
enforced structurally rather than by good intentions:

- A finding with no source URL is dropped, not shown with a caveat.
- What the workshop can do is read from the equipment register, never from a typed list, so a job
  needing a machine it does not own is reported as missing rather than quietly accepted.
- A lead created from a public post carries no email, no phone and no value, because a forum
  thread has none. A lead with no value reads as `—`, never `0 kr`.
- Estimating's recall counts only finished work as evidence, and says when the evidence is thin.

When adding anything, ask what happens when the data is absent. The honest answer is always a
visible gap, never a plausible number.

## 3. Architecture worth knowing before changing anything

**Business rules live in pure shared modules**, loaded by the page *and* required by the Node
tests, so the browser and the test suite can never disagree about a rule. Adding a rule means
adding it to the module, not to the page.

`jobcard-rules` · `estimation-rules` · `project-rules` · `quality-gates` · `equipment-gates` ·
`jobcard-equipment-rules` · `planning-rules` · `estimate-memory` · `material-reference` ·
`prospect-rules`

**One state, one event.** Every module reads `WorkshopData.get()` and re-renders on the
`workshop:data` event. No module keeps its own copy. *(One exception — see §6.)*

**Three themes, and Iris is the honest one.** Navy and Carbon are dark; Iris is light. Anything
relying on a dark ground — a button with no explicit `color`, a chip tinted by opacity alone —
breaks in Iris and nowhere else. Check every new colour there.

## 4. What was built in this session

**Pass 4.22–4.26 — Planning rebuilt.** It was called a catastrophe in both UI and workflow, and
was rebuilt as Board / Schedule / Capacity against `planning-rules.js`. Clicking a board project
opens its items, each with its own start and finish dates. Titles lead, numbering steps back.

**Pass 4.27–4.28 — the workshop answers from its own record.** `estimate-memory.js` lets
Estimating recall how similar past work actually turned out, and offer a bias factor by job type.
Only finished work counts. Thin evidence is reported as thin.

**Pass 4.29–4.33 — Store.** A wide item form, validation that names the field it rejects, an
information panel per item (where it lives, when it was bought, the last projects it went into),
and card actions that are big enough to hit and no longer overlap the quantity.

**Pass 4.34 — the Marketing findings queue (Phase 0 of the marketing rework).**
Marketing → **Findings**. Run a sweep, get a queue of cards, Accept or Reject each. Accepted
becomes a real lead. It works offline with no server and no spend, because the point was to test
whether the workflow is worth paying for *before* paying for it.

Three things are enforced in code, not intention:
- Capability matching reads the real equipment register; a quarantined machine counts as *owned
  but not usable today*.
- A verdict has a **ceiling**, not just a score. Freshness and proximity rank work the shop *can*
  take; they can never lift work it cannot. "100-ton pressing, posted yesterday, 5 km away" comes
  out **SKIP**.
- Reported once, never reported again — rejected findings included.

Everything is labelled as sample: `demo:true` on every finding, a banner above the queue, and
**no source URL points at a live page** (all on `demo.varmak.local`). A fabricated thread id on a
real forum is the one lie this project does not tell.

## 4b. The system now starts empty (18 September)

Every fictional record is gone from what a user sees. `seed()` returns an empty state; the
demonstration data lives on as `demoState()` behind `WorkshopData.loadDemoData()`, which the test
helpers and the e2e suites call explicitly. Item groups and warehouse locations stay, because they
are a classification scheme rather than anything invented about this workshop.

Three things were found doing this and are worth remembering:

- **Pages carried their own fixtures.** Customers, Estimations and Marketing each held hard-coded
  record arrays that had nothing to do with the data layer. Emptying `seed()` did not touch them.
- **Two pages crashed on an empty system** — Customers and Estimations both read `.id` off the
  first record without checking there was one. Both now have a real empty state.
- **Store showed invented figures that came from nowhere** — "Across 8 projects", "$12,640",
  "28 bins, 78% utilisation" — static text no code ever updated. All six are computed now.

Typography was unified at the same time: 29 arbitrary font sizes across the pages collapsed onto
an eight-step scale (9.5 / 11 / 12 / 13 / 15 / 17 / 21 / 26 px), 480 declarations moved. Colour
tokens were already consistent bar two pages; `suppliers` carried a dead palette that the shared
one shadowed, now removed.

## 4c. The structural trim has started (19 September)

The review in `REVIEW.md` proposed cutting screens that were not paying for themselves, and the
agreed order was **Quality 9→3**, then **status filters as chips**, then **Reports**.

**Quality is done (Pass 4.38).** Sixteen views became four — Overview, Inspections, NCR and a new
**Quality Holds** page — and the file halved, 2,488 lines to 1,363. The hold register is the
addition rather than a survivor: a hold is the one record in the system that physically stops work
leaving the building, and until now it had no page, only a counter and a release dialog.

Two things learned doing it, both worth repeating on the next module:

- **Removing a view is four removals, not one.** The markup, the sidebar entry, the render
  function and the `loadSectionData` branch. Miss the sidebar and you get thirteen orphaned
  `<span>…</span></button>` fragments rendering as loose text down the nav — which is exactly what
  happened, and what the first screenshot caught. **Look at the page; the tests will not see it.**
- **Dead code hides behind dead code.** A single unreachability pass found 51 functions; removing
  them and the modals they served made 8 more unreachable. The prune has to iterate until it
  finds nothing, and the same is true of translation keys — 168 of 280 in the English table were
  no longer referenced by anything.

A regression suite came with it: `tests/quality.e2e.js` holds the hold gate to its promise — a
critical failed inspection raises a hold naming the jobcard, the jobcard cannot be completed while
it stands, and it clears only against a named authority and written evidence.


**Status filters stopped pretending to be screens (Pass 4.39).** Second on the agreed list.

*Jobcards* had seven sidebar entries — Ready, In Progress, Paused/Blocked, Inspection, Completed,
Archived, All — every one of them rendering the same table through the same function. Worse, the
filter bar underneath carried a **second** status control, a dropdown over all eleven raw statuses.
Nothing stopped you holding both: sidebar on *Ready to Start*, dropdown on *Completed*, and the
list came back empty with nothing on screen to say why. That is now one chip row above the table,
each chip carrying its own count, and the two controls release each other — setting either clears
the other, so what the list is showing is always readable from one place. Sidebar: 9 entries → 3.

*Estimations* was the same pattern doing more damage. Its five sidebar entries did not filter a
list, they **hid columns on the Kanban board** — the one screen whose entire value is seeing every
stage and its count at once. Picking "Drafts" left a single lane, while the detail panel below went
on showing an Accepted estimate, because the filter narrowed the board and nothing else. The
entries are gone; focusing a stage now lives on the stage — press a column header to work in that
lane alone, press it again for the board back. Sidebar: 6 entries → 2 (the board, and New project).

Found on the way: `.filterbar input[type=text]` is more specific than `.search input`, so it had
been winning the padding and dropping the placeholder text underneath the magnifier icon, on
Jobcards and Marketing both. Fixed on both.

`.scopechips` / `.scopechip` now live in `workshop-ui.css` so the next module that needs this uses
the same control. A chip reading zero is still shown — "none of those" is an answer.

The jobcard list had **no e2e coverage at all**, which is why nothing broke when its view table
was rewritten. It has some now: every chip's count is asserted against the rows that chip shows,
and the exclusivity rule is asserted in both directions.


**Reports became six reports (Pass 4.40).** Third and last on the agreed list. Fifteen sections and
sixty-one tabs became six fixed reports plus the Saved Reports list: 2,939 lines to 1,317.

The one deliberate change from the plan: the proposal called the first report *what did we earn this
month*. The system has no invoicing — `invoices` is empty in both the empty state and the demo — so
there is no earned figure to report. It counts accepted quotations, is called **What We Won**, and
says on the page that this is order intake and nothing here has been billed or paid.

Rebuilding it found four things a tab count would never show: two tabs that had **never opened**
(a KPI and a panel sharing an `id`, so the tab switcher got the KPI), a default date range of
**today** that made the whole module open blank, two **wrong field names** in the stock figures, and
a message telling the user to go to the Purchasing module, deleted in Pass 4.06.

Two lessons for the pruning tool itself, which now enforces both:

- **A reference is a use.** The pruner only counted `name(`, so `projects.filter(isProjectOverdue)`
  did not count and it proposed deleting a function the new code depends on. It counts any mention
  now, which is the safe direction to be wrong in.
- **Two functions with one name is a bug, not a prune decision.** Writing a new `renderHours`
  alongside the old one left both in the file; in JS the later declaration wins, so the *old* one
  ran and the new report was dead code that quietly threw. The pruner now refuses to run at all
  when it finds duplicate declarations, rather than guessing which to keep.


**The integrity sweep (Pass 4.41).** Every defect found in the three trimming passes was found by
measuring, never by looking. None of them threw an error. None of them failed a test. All of them
were plainly visible to anyone who checked the right thing — and nobody was checking. So the check
is now a file: `tests/integrity.js`, run over all sixteen pages by `npm run test:integrity`.

It asserts six things, and each one is there because it catches a bug that actually happened:

| Check | The bug it would have caught |
|---|---|
| No two elements share an `id` | Reports: a KPI and a tab panel shared one, so two tabs never opened |
| No two functions share a name | Reports: a new `renderHours` beside the old one; the old one ran |
| No loose `<span>` in a nav | Quality: deleting buttons left thirteen labels as floating text |
| No label rendering its own key | any translation written in one language and forgotten in another |
| No page scrolls sideways | checked at the width the page is *for* — phone pages on a phone |
| No figure on an empty system | the whole honesty rule, enforced rather than remembered |

**A test that has never failed is not yet a test.** Each of the six was proved by putting its bug
back into a real page, confirming the sweep named it, and reverting. Do the same for anything added
to it.

Two checks were written, failed honestly, and removed. A static scan for `$('id')` calls with no
matching element flagged six working forms, because ids can be built by a helper
(`fieldTextarea('brNotes', …)`) and never appear literally in the source. A scan for any label
outside a control flagged twelve legitimate status boxes and user badges. **A check that cries wolf
is worse than no check** — it trains you to skim the output, which is exactly how the real ones get
missed.


**Hours on a phone became a fifteen-second job (Pass 4.42).** This is the screen the workshop
actually touches every day, and it was a six-section form: project dropdown, item dropdown, typed
hours, date, equipment, material, notes, then three chips, then Save. Twenty-three of its
twenty-six controls were under 44px tall — a target you miss with a glove half off.

It is three presses now. The jobcards that are **running right now** are offered as large cards at
the top; pressing one fills in the project and its operation by driving the same two selects the
long way round, so everything downstream sees exactly what it would have seen. Hours are buttons —
½ 1 2 4 8 — with a −/+ pair stepping in halves, because workshops book time in halves and typing
6.5 on a phone is the slowest thing on the screen. **Yesterday** is one press, being the correction
people actually need. Underneath, the day reads back: the worker's own entries and their total,
which is the only thing that makes a time sheet trustworthy to the person filling it in. Equipment,
material and notes fold away behind **More detail**, which until now only turned blue.

Three buttons on these two screens promised things they did not do: "More detail" and "Share to
team feed" toggled their own colour and nothing else, and the photographs "Add pics" collected were
never read by anything. Removed. Photographs of finished work are worth having and belong with the
backend — a phone photo is 2–5MB against a ~5MB budget for the whole browser store, so it needs a
size policy, a downscaler and somewhere to view them. The integrity sweep now fails any page
carrying a button whose class nothing reads, so this cannot creep back.

**And a flaky test turned out to be a real jolt.** The Store drag test had been failing most runs
for a while. Not flake: the page's heading font arrives over the network, and when it swaps in the
toolbar buttons change width just enough to wrap the top bar onto a second row — which pushes the
whole board **38px down the page**, mid-drag. Aim at a lane, let go, land in the one above. The
quick-action row takes its own line now, so the toolbar height never changes; eight consecutive
runs green where it had been failing six from six. Two smaller things fell out of chasing it: a
subgroup lane was a 22px drop strip (it is now the whole lane down to the next heading — darts,
before), and `settle()` in the harness waits for the layout to stop moving before anything
measures geometry.

The lesson worth keeping: **"flaky" was a label, not a diagnosis.** The test was right every time.


**The printed jobcard became a form (Pass 4.43).** `REVIEW.md` said to make printing first-class.
It already was — a primary button on the jobcard, and the sheet it produces carries the company
header, customer, drawing, dates, operations with their work instructions, materials with heat
numbers, inspection checkpoints, notes and four sign-off lines. That proposal was wrong: printing
was already done, and done well. **Print it and look at it before proposing to fix it.**

What the sheet did lack was **anywhere to write.** A jobcard on paper is not a report, it is a
form: it goes to the machine, the work gets done, and someone writes down what it actually took.
Each operation now has three ruled, shaded, empty boxes — actual hours, date done, initials — and
each material line has one for the quantity actually taken. The printed *Status* column went to
make room, which is right: it is a snapshot that is stale the moment it leaves the printer, and
"date done" is the same question answered by somebody who knows.

One real defect fell out of reading the paper: `visual-weld` printed as itself. The status lookup
stripped the hyphen (`is_visualweld`) and the type lookup did not, so any hyphenated checkpoint
type fell through to its stored code. Fixed, with the four labels that were missing entirely
(`material-cert`, `incoming-material`, `fitup`, `drawing-revision`). The test for it asks the
records what their codes are and checks none of them appear as printed text — **not** a pattern
match for hyphens, because drawing numbers and item codes are full of hyphens and belong on the
sheet exactly as stored. The first version of that check flagged `DWG-VD-014-A` and `Fit-up`.

Checked in all three languages: a Swedish shop prints Swedish, and the new column headings and the
fill-in note are translated with the rest.


**The paper closes the loop (Pass 4.44).** The sheet goes to the machine and comes back filled in
with a pen. Getting that back into the system meant opening each operation's edit form, changing
one number among twelve fields, saving, and again — about **thirty interactions for a sheet of
eight operations**. Nobody does that at five o'clock, and hours that never get entered turn every
figure downstream into a guess.

**Enter returned sheet** is the paper on screen: same order, same three columns, one save. It does
not invent a second way to record an hour — each row goes through `logHours()` and
`updateJobcardOperation()` exactly as the Hours module does, so the project totals, the reports and
the worker's own day all see one kind of record.

Two real defects fell out of building it:

- **Eight hours records saved in one millisecond all got the same id.** `logHours()` built its id
  from `Date.now()`, which is unique only for as long as no two entries land in the same
  millisecond. It was getting away with it because each save takes a fraction of one — luck, not
  design. Counted now, like every other record in the data layer. Proved by freezing the clock.
- **`f_worker` was written three times per language** on Jobcards. Identical values, so harmless —
  right up until somebody edits one of them and the later copy silently wins. The integrity sweep
  now fails any page with a translation key written twice, which is the same failure as two
  functions sharing a name.

**A hold is explained before the form is filled, not after.** A jobcard on Quality Hold cannot have
an operation closed, so the sheet says so at the top and offers no box to tick — but the hours
columns stay, and the hours still go in. The work was done whatever the hold says about letting it
leave the building. Telling somebody a rule after they have filled in a form is not enforcing a
rule, it is wasting their time.

One habit to watch: I reached for `.noticebar` on Jobcards, which is a class from a different page,
so the warning rendered as plain text. Third time this session I have used a class from whichever
page I worked on last (`tblwrap` and `empty3` on Quality were the others). **Check the page's own
stylesheet before borrowing a class name.**


**The app could lose everything, and the way out had no button (Pass 4.45).** Asked what stands
between this and a working program, I went looking rather than guessing, and the first thing found
was this: `backupData()`, `validateBackup()` and `importBackup()` have been in the data layer for a
long time, written carefully, keeping a recovery copy before they overwrite — and **reachable from
no page in the app**. Everything lives in one browser. Clear it, change device, or hand the tablet
to somebody who clears it, and the workshop's history is gone with no warning and nothing to go
back to.

The front page now carries **Your data**: what is kept, how much of it, where it lives, and the two
buttons. What stood there was **Team Talk** — a chat box that wrote into the page and nowhere else.
Send a message, refresh, gone. Messages between people need a server, and an "Internal feed" that
forgets is worse than no feed: it is the front page promising something the app cannot do. Team
messaging is a backend feature and is written down as one.

Two more defects fell out:

- **`isEmpty()` could never return true.** It counted every known collection, but an empty system
  still ships the classification scheme (item groups, warehouse locations) because that is the
  app's and not the workshop's, and clearing is itself an event the audit trail records. A question
  with no reachable answer. Nothing called it, so it had been wrong quietly.
- **A count read "10projects"** — the gap was drawn by CSS, so the text itself had no space in it.
  Wrong when selected, copied, or read aloud.

The test is the whole round trip, because **a copy you cannot restore is not a copy**: save it,
read the file back as plain JSON outside the app, wipe the system, restore, compare record for
record, then reload and check it is still there. Plus a file that is not a backup, which must be
refused by name and change nothing.

**What is still between here and functional** — and none of it is frontend work:

| Gap | Why it needs a server |
|---|---|
| One browser is one workshop | Aleksandar's PC and Marko's phone hold unrelated data. Nothing syncs, because there is nowhere to sync to. |
| No login | "Marko K." is typed into the markup of `hours-mobile.html`. |
| Numbering collides | Two browsers both create C-001, and neither knows. |
| Photographs | A phone photo is 2–5MB against roughly 5MB for the whole browser store. |

Backup/restore does not fix any of those. What it does is make the single scariest property of the
current app — silent, total, unrecoverable loss — survivable, today, with no server at all.

**Left deliberately:** the removed record types (`qualityWelds`, `qualityCapas`, `qualityItps`,
`qualityWps`, `qualityWelderQuals`, `qualityComplaints`, `qualityDossiers`, `qualityReleases`,
`supplierQuality`) are still in the data layer, just unreachable from the UI. Nothing is lost yet,
so the carve-out in `REVIEW.md` — record **who welded it and with what filler** on the jobcard
operation — is still recoverable. It must be done **before** those collections are deleted.

## 5. Decisions already made — do not re-open these

| Decision | Why |
|---|---|
| **No 50,000-item material catalogue** | Generated rows carry no supplier article number, price or availability — you cannot order from them. Real supplier catalogues will be imported instead once there is a backend. |
| **No catalogue search index / virtualised picker** | It existed only to survive 50k rows. Dropped with the 50k. The current search is fine for a few thousand. |
| **No fabricated beam weights** | IPE/HEA/HEB weight per metre is tabulated (root radii, tapered flanges). Computing one lands ~2–3% wrong and presents it as fact. Either carry the designation with no weight, or load a real supplier table. |
| **No auto-created opportunities from findings** | A GO verdict means *worth a phone call*, not *there is a budget*. An auto-created opportunity carries a value that flows into the pipeline total, the weighted forecast and the win rate. One bad entry corrupts every figure downstream. |
| **The AI brings things; it never commits you** | It may draft a reply. It does not send one. |
| **Model backing needs a server** | The API key cannot live in browser JS, and the published artifact cannot make network calls at all (CSP blocks fetch to every host). Anything model-backed can never run inside the shareable demo. |

## 6. Known problems, in the order they are worth fixing

1. **Tenders are page-local and are lost on reload.** `TENDERS` is a plain array inside
   `marketing-desktop.html` (~line 375) — not in `workshop-data.js`, not saved, not refreshed on
   the `workshop:data` event. This is a plain bug and the only module that breaks the one-state
   rule. *Fix first.*

2. **An item has exactly one price.** Buy the same plate from two suppliers and only the last one
   entered survives. Needs a supplier–item table: item ↔ supplier ↔ their article number ↔ their
   price ↔ pack size ↔ lead time. Useful immediately, and it is the landing zone every catalogue
   import writes into later — building it after the import means redesigning instead of loading.

3. **`code` is overloaded** — one field labelled "Supplier / drawing code" doing two jobs. The
   supplier article number needs to be its own field.

4. **A lookup for a missing record throws.** `clone(undefined)` is a `JSON.parse` error, so
   `findMarketingLead('nope')` and its siblings throw rather than returning nothing.
   `findProspectFinding` and `lastProspectSweep` guard against this; the older ones do not.

5. **A page offers a file through a plain download link**, which the artifact viewer never grants
   permission for — the link silently does nothing for viewers. Pre-existing; surfaced by the
   Version 72 publish warning.

## 7. The road to live, in order

**Step 1 — finish the prototype.** §6 items 1–4. None need a backend.

**Step 2 — the backend.** A database and a small API. This is the real project; the AI is the
cheap half. Auth, backups, hosting, someone to fix it at 11pm.

**Step 3 — the real sweep.** Managed Agents *scheduled deployments* run the agent nightly on
Anthropic's side — no scheduler of your own. `web_search` / `web_fetch` take `allowed_domains`, so
it is pointed at named sources only. The API token lives in a **vault credential**: substituted at
egress, never visible inside the agent's sandbox. **Session budgets** are hard dollar caps, so it
cannot overspend. Start on `claude-opus-5`; move reading-heavy sub-tasks to Haiku 4.5 workers once
there is a baseline of what gets accepted and rejected. Roughly $9–19/month.

**The app barely changes at that point.** The findings queue already does all of it. One swap:

```js
ProspectStub.sample()   →   fetch('/api/findings')
```

That was the entire reason Phase 0 was built against a stub.

**Step 4 — supplier catalogue import.** Excel/CSV by email is what a small customer actually gets;
punchout/OCI exists but usually needs a bigger account. The model reads the first rows and proposes
the column mapping (`Artikelnr` / `Art.nr` / `Benämning` / `Nettopris` differ per supplier); you
confirm it once; every import after is plain deterministic code. AI for the ambiguous one-time
step, none in the repeating path.

Barcodes will cover the consumables half of the store — fasteners, abrasives, welding wire and gas
have real EANs. **Steel cut to size does not**; it is identified by heat number, which the app
already tracks. `barcodeLinks` + `linkBarcode()` already exist and support several codes per item.
Pictures need the backend — they cannot live in `localStorage`.

**Step 5 — push notifications, last.** Web Push works on Android and desktop. **On iPhone it only
works if the app is installed to the home screen as a PWA.** If that will not happen, use email or
a Telegram bot instead. Decide before building, not after.

## 8. Two things to settle before going live

**GDPR.** Names and contacts taken from public forums are personal data. B2B prospecting can rest
on legitimate interest, but those people are owed notice and a right to object. The `dnc` flag
helps, and the queue already records where every record came from — which is what you would have
to show. Worth twenty minutes with someone who knows Swedish practice *before* launch.

**The sources' own terms.** Blocket in particular is unfriendly to automated access, whoever runs
the fetch. Check each source and drop the ones that forbid it.

## 9. Working notes

- Tests: `npm test`, `npm run test:syntax`, `npm run test:browser`, `npm run test:integrity`,
  `npm run test:e2e`.
  The browser suites need `PLAYWRIGHT_CHROME_PATH` set to an installed Chromium. Never run
  `playwright install`.
- Commit style: `Pass N.NN - <what changed, in plain words>`, then why it mattered.
- A Python edit script that asserts at the end and fails has saved **nothing** — the write is the
  last statement. Write after each edit, or verify the file afterwards.
- Do not re-derive expectations in tests from your own reasoning. Derive them from what the code
  actually produces, then judge whether that output is right.
