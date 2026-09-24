# Varmak Workshop — the backend

What has to exist behind the interface, and why each piece is there. Decisions, not a survey.
18 September 2026.

---

## The shape

**One Postgres database, one API in front of it, one identity service.** For five to ten people
that is the whole thing. Supabase supplies all three and removes the hosting, backups and auth
work; the reasoning for choosing it over an all-in-one platform is in [`APP-SPEC.md`](APP-SPEC.md)
§10.

The single decision that matters more than the choice of host:

> **The rules live in the database, not in the screens.**

Every rule in this system that protects somebody — a quality hold that stops an unsafe job being
completed, a machine out of service that must not be started — is currently enforced by JavaScript
running in a browser. Anything a browser enforces, a browser can skip. Once there is an API, every
one of those rules has to hold against a direct call to it, not only against a button.

---

## 1. Safety

"Safety" here means three different things. They need separating, because they have different
answers.

### 1a. Rules that keep people from getting hurt or work from going out wrong

These are the ten pure rule modules and 687 tests already written. They must move **into the
database** as constraints, triggers and functions — where they hold whatever calls them.

| Rule | Today | Must become |
|---|---|---|
| An active quality hold blocks completing a project or jobcard | JS in Quality | `BEFORE UPDATE` trigger on `projects` / `jobcards` |
| An operation cannot start on a machine that is out of service, under maintenance, quarantined or retired | JS in Jobcards | trigger on `operations`, reading `equipment.status` |
| A machine already assigned elsewhere cannot be double-booked | JS | unique partial index on the active assignment |
| Status transitions follow a defined sequence | JS | a function plus an `allowed_transitions` table |
| A locked estimate line cannot be repriced without a reason and a name | JS | trigger; the reason is a column, not a convention |
| Stock cannot be issued below zero | JS | `CHECK (stock >= 0)` plus a transactional issue function |

Keep the existing test suite as the specification. Where a rule moves into SQL, port its tests to
pgTAP so the same cases still run — a rule with no test behind it is a rule nobody will notice
breaking.

### 1b. Who may do what

**Decided: two to four people will log in.** That settles the roles at **two**, not three:

| Role | Can |
|---|---|
| **admin** | everything — quoting, pricing, buying, invoicing, quality, deleting |
| **workshop** | book hours, start and pause operations, issue material, record an inspection result; **sees no prices at all** |

The `office` role in between is for a workshop that has hired somebody to do the quoting. At two to
four people that person is you. Add it the day it describes a real person — the role is a row in a
table, not a rebuild.

Two roles rather than three also keeps the row-level security simple enough to read in one sitting,
which matters more than it sounds: a security policy nobody can follow is a security policy nobody
maintains.

Enforced with **row-level security**, not by hiding buttons. A welder's session must be unable to
read the customer's agreed price even by asking the API directly.

### 1c. Not losing anything

- **Point-in-time backup**, and a restore tested once before go-live rather than discovered during
  an incident. The restore is tested on every run now, not once: [`backend/backup.sh`](backend/backup.sh)
  takes it in the two pieces it needs and [`backend/test-restore.js`](backend/test-restore.js) puts
  one back and asks the copy whether it still refuses. Point-in-time recovery itself is Supabase's
  side of the line (§step 7) — what is proven here is that a dump plus its roles file reconstitutes
  a workshop that still says no to the right things.
- **Every change written to an audit log** — who, what, when, old value, new value — by trigger, so
  it cannot be forgotten. The application already logs activity into each record; this replaces the
  convention with a guarantee.
- **Deletes are soft.** A record with history is archived, never removed. The delete guard in Store
  already works this way; make it universal.
- **The API key for the AI sweep never reaches a browser.** Stated already in the handover, and it
  is a rule, not a preference.

---

## 2. Database

### A problem that only appears once there is a server

Document numbers come from a counter held in the browser. Measured just now, two people creating a
customer at the same moment:

```
browser 1 created: C-001
browser 2 created: C-001
```

Two customers, one number. The same is true of every project, estimate, jobcard and purchase
order. **Numbering must become a database sequence** on day one of the backend — it is invisible
today because there is exactly one user.

### The tables

Twenty-five, down from forty. Thirteen of the current collections have never held a row and
fourteen more hold only fixture data — the reasoning is in [`REVIEW.md`](REVIEW.md).

**Commercial** — `customers` · `suppliers` · **`supplier_items`** · `leads` · `opportunities` ·
`tenders` · `prospect_findings`

`supplier_items` is new and closes a real gap: item ↔ supplier ↔ their article number ↔ price ↔
pack size ↔ lead time. Today an item can hold one price, so buying the same plate from two
merchants loses one of them. It is also where every supplier catalogue import lands later.

**Delivery** — `projects` · `estimates` · `estimate_lines` · `jobcards` · `operations` · `hours`

**Store** — `items` · `item_groups` · `locations` · `movements` · `offcuts` ·
`purchase_orders` · `purchase_order_lines` · `barcodes`

**Equipment** — `equipment` · `equipment_events`

One event table replaces twelve tabs. An inspection, a service, a calibration, a breakdown and a
pre-use check are the same shape — a thing that happened to a machine on a date, with a result.

**Quality** — `inspections` · `ncrs` · `holds`

**Decided: no certification is held yet**, so the list is three tables, not six. `welds`, `wps` and
`welder_quals` exist to satisfy EN 1090 and ISO 3834 auditors. Building them before there is an
auditor is building paperwork for nobody.

One thing is kept anyway, because it costs nothing and cannot be recovered later: **who did the
work, and on what material.** The jobcard already carries a heat number and a certificate
reference; add the welder's name and the filler used as plain fields on the operation. If
certification is pursued in two years, that history is the difference between starting from a
record and starting from nothing. The subsystem can be built then; the facts cannot be
back-filled then.

The three that stay are the ones that protect the workshop rather than an auditor: an inspection
result, a non-conformance, and a hold that stops work going out wrong.

**System** — `users` · `documents` · `audit_log`

### Rules that belong in the schema, not the code

- Every foreign key is a real foreign key. A jobcard cannot reference a project that does not exist.
- `CHECK` constraints on every quantity, price and percentage.
- Money as `numeric`, never floating point.
- Every timestamp `timestamptz`. Sweden changes clocks twice a year and hours get booked across it.
- Weights computed, never stored as typed input — the material reference already does this correctly.

---

## 3. Login

**Decided: both a shared tablet in the hall and personal phones on site.** So there really are two
doors, and they guard different things.

### Two different doors, because there are two different situations

**Office and site — email and password.** Supabase Auth, standard. Anything touching prices,
invoices, approvals or deletion sits behind it. This is also the door on a personal phone: a phone
is one person's, so it gets that person's real login and their real role.

**Shop floor — a shared tablet and a personal PIN.** A welder in gloves will not type a password
forty times a day, and if you make them, they will share one login and your hours data becomes
worthless.

The honest part: **a PIN is weaker than a password, and that is acceptable only for what it
guards.** A PIN answers "who booked these hours" and "who started this operation" — useful, and
the cost of a wrong answer is a corrected timesheet. It must not be able to approve an invoice,
change a price, or release a quality hold. Those need the office door.

So the rule is: **the strength of the door matches what is behind it.** The shop-floor session gets
the `workshop` role and nothing more, and the role is enforced by row-level security, so the limit
holds even if somebody works out the PIN.

### Offline — the part "both devices" actually costs

A tablet in a steel hall and a phone on somebody else's site are both places the signal dies. This
is the largest piece of engineering in the whole backend, so it needs scoping rather than a promise
that everything works offline.

**Offline for writing, not for reading everything.** Three actions must survive no signal, because
they happen at the machine and cannot wait:

| Action | Why it must queue | State |
|---|---|---|
| Book hours against an operation | happens at the machine, several times a shift | **done, both halves** |
| Start / pause / finish an operation | the timestamp is the point; recording it later is a guess | database half only |
| Issue material to a jobcard | the steel leaves the shelf whether or not there is signal | database half only |

"Both halves" is the distinction that matters here. All three have had their database half since step
4 — each takes an id the device generates, and a replay of the same id is answered rather than
repeated. Booking hours now has the other half as well: [`workshop-queue.js`](workshop-queue.js),
wired into the phone hours screen, which writes the entry down before sending it and sends it by
itself when the line comes back. The other two are the same wiring against the same kind of
workflow, and the screens for them are not built yet.

All three are **append-only**. That is what makes this tractable: they add a row, they do not edit
one, so two devices offline at once cannot conflict. Queue them locally with a device-generated id,
replay when the signal returns, and let the server reject a duplicate by that id.

**Everything else requires a connection and says so.** Quoting, pricing, purchase orders, the
findings queue, reports — all of it needs the current state of the database to be correct, and a
stale offline copy of a price is worse than no price. The screen says "no connection" rather than
showing something that might be wrong.

**The gates still hold.** An operation queued offline is still checked when it replays — if the
machine was out of service, the server refuses it and the person is told. Offline delays the
check; it does not skip it. This is exactly why the rules have to be in the database: the tablet
cannot be the thing that decides.

**There is still no service worker.** The page itself has to be loaded while there is a connection.
A tablet that comes up with no signal can send what it is holding, and it says out loud that it
cannot read the workshop — what it does not do is show the job list from memory, because it has
none. That is the remaining piece of this section.

### Practical points

- Sessions on the shop tablet expire at end of shift, not after thirty days.
- Password reset by email; PIN reset by an admin, in person.
- No self-registration. An admin creates people.
- Two-factor for admin accounts once there is money in the system.

---

## 4. Where the logic goes

Three layers, and the decision of what goes where is the one that determines whether this stays
maintainable.

**In the database** — anything that must be true no matter who is asking. The safety rules in §1a,
foreign keys, constraints, numbering, the audit log. This is the floor nothing can fall through.

**In the API** — workflows that span several tables in one transaction: accepting an estimate and
creating its project, receiving goods against a purchase order, issuing material to a jobcard,
converting a lead into a customer. Each is several writes that must all succeed or all fail.

**In the browser** — what to show, what to grey out, what to warn about before the server refuses.
Convenience, never the last line of defence. Every check in the browser exists to save a round trip,
and every one of them is also enforced behind it.

The AI sweep sits outside all three: a scheduled agent that reads public sources and **posts
findings to the API like any other client**, with no special access. It writes to one table and
cannot touch anything else.

---

## 5. Order of work

1. ~~**Schema and constraints**, with the safety rules as triggers from the start.~~ **Done** —
   [`backend/schema.sql`](backend/schema.sql): 31 tables, 103 checks and 13 triggers, every one of
   them attacked by [`backend/test-schema.js`](backend/test-schema.js). All six rules named in §1a
   above are in the database, including the two this list originally skipped — status transitions
   (as the `allowed_transition` table, seeded from the frontend's own map) and repricing a locked
   estimate line.
2. ~~**Numbering as sequences.**~~ **Done** — and the first test in the suite demonstrates the old
   row-counting handing two simultaneous sessions the same reference, so the reason stays visible.
3. ~~**Auth and the two roles**, with row-level security written alongside the tables.~~ **Done** —
   [`backend/auth.sql`](backend/auth.sql): two doors, three database roles, row-level security
   forced on every table, and money granted column by column. Attacked as each real role by
   [`backend/test-auth.js`](backend/test-auth.js). The sentence in §1b — that a welder cannot read
   the customer's agreed price even by asking the API directly — is now a `GRANT` rather than a
   promise, and it failed the first three times it was tested.
4. ~~**The API for the workflows in §4**, one at a time, tested.~~ **Done** —
   [`backend/api.sql`](backend/api.sql) holds the seven workflows as database functions, and
   [`backend/server.js`](backend/server.js) is the HTTP layer over them, which decides nothing at
   all: no writes of its own, no branch on a role, and a test that reads the file and says so.
   Offline replay is built — each of the three actions from §3 takes an event id from the device, and
   flushing a queue twice changes nothing. The device that generates those ids came later, in step 5
   below: the database half alone is a promise nothing kept. Attacked by
   [`backend/test-api.js`](backend/test-api.js) (each workflow made to fail on its last write) and
   [`backend/test-server.js`](backend/test-server.js) (over real HTTP with real tokens).

   `login.html` still has no password field. It can have one now that there is something to check it
   against, and that belongs with step 5 — the page is honest in the meantime: it says "Open local
   demo" and "authentication is not enabled".
5. **Point the frontend at it.** ← in progress. `workshop-data.js` is the only file that touches
   storage — 221 operations behind one interface.

   **This step had a precondition nobody had checked.** It says the sixteen pages do not change,
   which assumed the schema can hold what the app holds. It cannot: the schema was built from the
   twenty-five-table plan in §2, which trimmed the *collections* but said nothing about the fields
   inside them. Measured with [`backend/coverage.js`](backend/coverage.js), the database could store
   **111 of the 345 fields the pages actually read — 32%.** Pointing the frontend at it in that state
   would have left a few hundred fields blank on screen, which is not "the pages do not change".

   So step 5 is two jobs, and the first one is widening the schema. `npm run coverage` is the
   progress meter, and it ratchets: a pass that widens the schema cannot quietly narrow it elsewhere.

   | | |
   |---|---|
   | Pass 1 — customer, equipment, stock_item | **32% → 42%** |
   | Pass 2 — project, jobcard | **42% → 51%** |
   | Pass 3 — stock_item, stock_movement, offcut, document | **51% → 54%** |
   | Pass 4 — lead, opportunity, inspection, ncr | **54% → 61%** |
   | Pass 5 — no columns at all: the meter itself was wrong | **61% → 68%** |
   | Pass 6 — the meter was wrong the other way too | **68% → 65%** |
   | Still to do | 70 fields need a column, 23 want a join rather than a column, 31 hold a list and want a child table |
   | Not a gap | 38 more fields are carried by the demo data and read by no page at all |

   Pass 5 is the one worth reading. Wiring the customers screen meant looking at the five customer
   fields the meter said had no column — and all five had had one since pass 1, under a longer name:
   `since`/`customer_since`, `terms`/`payment_terms_days`, `type`/`customer_type`,
   `preferred`/`is_preferred`, `billing`/`billing_address`. The same was true of `created`/`created_at`
   on three tables, the four store columns for groups and locations, and three lists whose child table
   already existed and was already pointing the right way. Twenty-three fields, no schema change.

   That is worth more than the seven points. **86** was the size of the remaining work in this
   document, and a number that overstates the work is a number that gets planned around — it is why
   this list said "widen the schema first, then wire". With the meter corrected, **customers, projects
   and jobcards need no widening at all.** The remaining gap is concentrated rather than spread: 16 of
   the 58 are on `equipment` and 9 on `lead`, and the rest are single fields on five other tables. So
   the order changes: the screens whose tables are already wide get wired first, and widening becomes
   a per-screen job rather than a phase.

   Pass 6 went the other way, and is the more useful of the two. The meter's test for "does any page
   actually read this field" listed the characters it expected after the name and therefore missed
   every read written as `j.inspectionRequired ? a : b`. Fourteen fields the pages do read were being
   reported as width nobody misses — `inspection_required` among them, which the jobcard screen, the
   quality screen and `equipment-gates.js` all read. Correcting it took the coverage **down** and the
   ratchet refused the run until the baseline moved, which is the only honest reason to move one: the
   number got worse because the measurement got better. A meter that overstates the work gets planned
   around; one that understates it hides work. Both had happened.

   Three fields were deliberately left as gaps rather than mapped, because mapping them would have
   hidden real work: `inventory.certificate` holds a PDF's filename and wants the document table and
   somewhere to put files, not a text column; `inventory.location` is a bin address ('A1-01-02') that
   nothing holds; and `estimations.plannedHours` is a sum of the labour lines, which is a claim about
   what the page does with it that nobody has checked yet.

   Widening is not only columns. Each pass has turned up rules the trimmed schema had no way to
   state, and they are worth more than the fields: a project on hold has to say why, an offcut is
   either on the rack or used up on a date and cannot say both, an inspection with a result has a
   date it happened on, a re-inspection points back at the failure it repeats, a lost enquiry records
   why it was lost, and somebody who has asked not to be contacted cannot have a follow-up booked
   against them.

   The second job is the wiring itself, and one thing about it is already clear and worth writing
   down: **a synchronous write cannot be validated by a remote server.** Reads can stay synchronous
   against a snapshot loaded at page load, but every write has to become asynchronous or the screen
   will show figures the server rejected. That does change the pages, and the plan's claim that it
   would not was wrong.

   **The first slice is wired and works.** Rather than widen to ~95% and only then find out whether
   the wiring model holds, one screen was taken end to end first — the phone hours screen, because it
   is the one the workshop touches every day and because it exercises the whole stack at once.
   [`tests/vertical-slice.e2e.js`](tests/vertical-slice.e2e.js) runs a real browser against the real
   server against a real Postgres: a welder types a PIN on the shop tablet, picks a job, books six and
   a half hours, and the test then walks round the back and asks the database whether the hours are
   there. They are, under the name the PIN belonged to.

   It also holds the §1b promise on the real path: **not one figure in kronor reaches the welder's
   browser**, and asking the API directly for the prices is refused. That is the first evidence in
   this project that any of the four layers work together, as opposed to each working alone.

   What came with it: `workshop-api.js` (the browser's side — carries requests, holds the token,
   decides nothing), a real sign-in on `login.html` with both doors, and the server now serving the
   pages as well, so there is one origin and no CORS anywhere.

   **The screen itself is wired.** `workshop-data.js` gained a server-backed mode: a page that has
   signed in calls `adoptSnapshot()` and from that moment the module is a **reader** — and `save()`
   refuses rather than quietly writing to browser storage. That refusal is the important half. A page
   in backed mode that still called a mutator would put the record somewhere the server never sees and
   the next reload wipes, which is the worst outcome available because it looks like it worked.

   It is opt-in per page. Six opt in — the phone hours screen, `admin.html`, Customers, Jobcards, Store,
   and the **project half** of Project / Estimator. Nothing changes for the rest, which still run on
   browser storage exactly as before.

   **`admin.html` is the second, and it was not a choice of convenience.** Until it existed, giving
   anybody access to this system meant opening psql — which is not a workshop using software, it is
   a workshop telephoning whoever wrote it. It makes the first administrator on an empty system,
   adds people, sets a PIN or a password, changes what somebody may do and switches them off, and
   every one of those is a workflow in `api.sql` rather than anything the page decides. Fifteen
   end-to-end checks drive it in a real browser against a real Postgres
   (`tests/access-screen.e2e.js`).

   Two of its checks are the reason it exists. `add_person` deliberately creates somebody who cannot
   sign in, so the list has to **say** that rather than report "added" and let an admin walk away
   having given nobody anything. And an admin is not offered the two moves that lock the building
   from the inside — switching themselves off, taking away their own admin. The database refuses
   both; not offering them is a separate promise and has its own check, because a button that always
   fails teaches people that refusals are noise.

   **Customers is the third, and the first commercial screen.** `save_customer` and
   `set_customer_contacts` are its workflows, and nine end-to-end checks drive the page in a real
   browser (`tests/customers-server.e2e.js`). It needed no widening — the table was already wide
   enough, which is what the corrected meter above made visible — but it did need a child table for
   the contacts, so that a rule could finally be stated about them: one main contact per customer,
   and a contact with neither an email nor a telephone number is not a contact.

   What it settled is bigger than the screen. **The claim that the pages would not change is wrong
   about shapes as well as about writes.** This screen has always held the payment terms as the words
   "30 days", the billing address as an array of lines, and the customer type as "Company"; the
   database holds a count of days, one block of text, and one of four words. Neither side is wrong —
   a column called `payment_terms_days` should be a number and a line on a screen should read
   "30 days" — so something has to translate. That something is
   [`customer-record.js`](customer-record.js), with its own unit tests, and every screen after this
   one will need the same.

   And it produced a rule that will apply to all of them:

   > **A page that shows a subset of a record must not save a subset of it.**

   `save_customer` replaces the record, which is right for a screen holding the whole thing — and this
   screen shows about two thirds of a customer. A page that sent back only what it displays would
   clear the price list, the discount agreement, the VAT number and the customer type every time
   somebody corrected a telephone number, and nothing on screen would say so. So the translation keeps
   the server's record as it arrived and overlays only what the page actually edits. That is the last
   check in the suite, and it is the one worth keeping.

   Three smaller things it found, each of which had been quietly wrong:

   * The snapshot handed the page `is_preferred` — whether the workshop favours the customer — for a
     field the screen labels **Preferred Contact** and expects to hold "Email". Two different facts
     one word apart. `preferred_contact` is now its own column, and `coverage.js` had been counting
     that field as stored on the strength of the wrong one.
   * A JavaScript list sent to a `jsonb` parameter arrived as a Postgres ARRAY literal, so a
     perfectly good contact list came back as "something went wrong at our end". The server now
     serialises it, which is transport rather than a decision.
   * The page's own `workshop:data` listener re-ran the browser-storage merge while the screen was in
     server mode, pushing the database's shapes into a screen expecting its own. Wiring a screen means
     switching off the merge as well as switching on the writes.

   Four things this screen does have no workflow yet — a document, a quote, an invoice, a note — and
   in server mode it **says so and writes nothing**, rather than saving to a browser that the next
   reload wipes. Same rule as the hours screen refusing an entry that carries material.

   **Work can reach the floor.** `save_project`, `save_jobcard` and `set_jobcard_operations` are the
   workflows that were missing, and their absence was larger than it sounds: the only way a job got
   onto a bench was `accept_estimate`, so a workshop that took an order over the telephone had no way
   to record it at all and the hours screen had nothing to book against.

   Two decisions in them are worth keeping:

   * **`save_jobcard` has no customer parameter.** It takes the customer from the project. A jobcard
     carrying a different customer from its project makes every report disagree with itself, and
     nobody would ever put the two columns side by side to notice.
   * **The steps cannot be replaced wholesale, unlike every other list here.** `hours_entry.operation_id`
     is `ON DELETE SET NULL`, so deleting a step succeeds silently and leaves every hour ever booked
     on it pointing at nothing — losing the answer to "how long did the weld-out actually take",
     which is the only number that makes the next estimate better than a guess. So the list is
     matched on the ids the snapshot handed out, the workflow names any step it is about to lose and
     refuses, and a `BEFORE DELETE` trigger refuses it whoever asks. Re-ordering the rest is what
     made `UNIQUE (jobcard_id, seq)` deferrable: the halfway state of a re-order is a collision the
     finished list does not have.

      **Jobcards is the fourth screen, and it was wired differently** — because Customers had one save
   function to wrap and this page writes through sixty-odd call sites: seventeen calls to
   `updateJobcard`, six to `updateJobcardOperation`, thirty-four to `recordJobcardActivity`. Wrapping
   each would have been sixty chances to miss one, and a missed one writes to a browser the next reload
   wipes. So the intervention is one layer lower: **the `WorkshopData` methods the page writes through
   are replaced, for that page, with versions that send the same intent to the server.** The page's own
   logic — its ordering, its locks, its gates, its error handling — runs unchanged, and because it
   already checks `res.error` at nearly every site, a workflow that does not exist yet gets to say so
   in the place the page already shows refusals.

   Two things fell out of it that will apply to the remaining screens:

   * **Redirect the page's own re-read, not just its writes.** `refreshShared()` reassigns the
     jobcard list from `WorkshopData` and is called from sixty places, so translating the records
     anywhere else meant the next call put the server's raw shapes back and the screen broke on a field
     that was no longer there. One function, one source of truth, every caller right by construction.
     The customers screen needed the same for `hydrateSharedCustomers()`.
   * **Nothing is changed locally.** A mutator queues the call and returns the shape the page expects;
     the refresh that follows moves the screen. Showing a step as started and then taking it back
     because the database refused — the machine is out of service — is worse than showing nothing for
     the moment it takes to ask.

   It also turned up two more vocabularies where the schema had invented words nobody uses. The
   jobcard priority dropdown offers **low, medium, high**; the column was `low, normal, high, urgent`
   and therefore refused the one value the screen actually writes. Material readiness was the same
   story. Both now hold the screen's words, by the rule from `material_readiness`: one spelling per
   state, and when the two disagree the screen wins, because those are the words somebody picks from a
   dropdown.

      **Projects, which was the hole that actually blocked using this for real.** `save_project` existed
   and no wired screen called it — so a workshop could record a customer and then get no further,
   because nothing on a screen could create the project that the jobcards and the hours hang off. The
   project half of Project / Estimator is now wired: it makes the project, and the items typed on the
   form become jobcards on it, each taking its customer from the project rather than from the form.

   **Half of that screen is wired and half of it refuses, on purpose.** An estimate there carries work
   items in nested groups, options, terms, exclusions, an overhead and a contingency percentage, a
   discount, a revision history with snapshots, and a priced bill of materials. The `estimate` table
   holds a title, a customer, a status, a currency, a margin, a total and a validity date. That gap is
   real work on the schema rather than a mapping, so the estimating writes say so and write nothing —
   and the end-to-end test asserts that the project half keeps working after the estimating half has
   refused, because a half-wired screen has to prove that one half going quiet does not take the other
   down with it.

   One thing about creating a project with items on it is worth keeping. The page's own flow is: save
   the project, read the id off the answer, then create one jobcard per item against it. With a server
   there is no id to read yet. So the jobcard calls pass **a function instead of arguments**, and it
   runs when its turn in the queue comes — by which time the project has been saved and its id is
   known. The alternatives were inventing an id or making the page wait, and both are worse.

   And a decision that goes the opposite way from the jobcard priority. The frontend has **two** names
   for one project state — `active` in the estimating screen's vocabulary and `production` from the
   estimate-conversion path, aliased to each other in `project-rules.js` — plus `draft` as a retired
   alias of `quotation`. Where the screen had one word and the schema had invented another, the screen
   won. Here the screen cannot be followed, because it disagrees with itself: a database that accepted
   both would mean every query had to know the aliases. So `save_project` translates on the way in,
   exactly as `schema.sql` said it would, and the test asserts that both words arrive as one.

      **The store, which completes the chain a workshop needs to start.** With Customers, Projects,
   Jobcards, hours and now the store all on the database, a workshop can record a customer, put work on
   the board, book the hours against it and take the steel off the shelf for it — without a database
   console at any point. `issue_material_offline` had existed since step 4, so material could already
   leave the shelf; what was missing was any way to put an item on it. So a workshop could issue
   material it had no way of telling the system it had.

   Three workflows, and one of them holds a number worth protecting. `receive_stock` recomputes the
   average cost **weighted by what is already on the shelf** — fifty kilos at 14.00 plus fifty at 16.00
   is a hundred at 15.00, not a hundred at 16.00 — which is the difference between a store that can cost
   a job and one that can only say what the last load cost. A delivery note with no price on it leaves
   the average where it was rather than dragging it to zero. Both have mutations.

   `record_stocktake` writes **nothing** when the count matches, because a movement of nothing is noise
   in the one place a storeman goes to find out why a figure changed. And `save_stock_item` takes no
   stock figure at all: steel arrives through a receipt, leaves through an issue and is corrected
   through a count, each of which writes the movement that explains it. A figure typed into that column
   is a shelf that disagrees with the record of why.

   The snapshot also gained the **movement log**, which it had never carried — so the one panel in the
   app whose job is explaining why a figure changed was empty. The last two hundred, newest first,
   because a workshop's log grows without limit and every screen pays for the snapshot.

      Writing the screen also found two refusals that never reached anybody, both of which had passed
   two suites. `bootstrap_first_admin` raised its refusal as `insufficient_privilege`, and `server.js`
   replaces the text of every 42501 with "that is not yours to do" — because Postgres writes its own
   privilege errors as "permission denied for table stock_item" and that names the inside of the
   database. So the first-run form answered "that is not yours to do" to the only person who could
   possibly be using it. Worse, `change_my_password` raised `invalid_password`, a code the server does
   not recognise as a refusal at all, so the single refusal in this flow an ordinary person meets
   weekly — mistyping their own password — came back as "something went wrong at our end". The SQL
   suite asserted the wording and never went through HTTP; the HTTP suite had no case for either.
   Both now raise plainly, and the rule is asserted structurally rather than case by case: every
   hand-raised refusal in `api.sql` and `auth.sql` must use a code the server carries to the person,
   because the next one will be in a function nobody thought to test over HTTP either.

   The collections a snapshot does not cover are left **empty**, never filled with demo data: a screen
   showing three real jobs beside eleven invented ones is worse than one showing three real jobs and
   nothing else, because nobody can tell which is which. For the same reason the screen refuses to
   save when the entry carries equipment or material — those workflows do not exist yet, and booking
   the hours while dropping the rest would be a save that looks complete.

      **The tablet keeps what it cannot send.** The database half of this had existed since step 4 and
   nothing used it: every offline workflow took an id from the device, and no device generated one that
   outlived the press. So a welder in the part of the hall where the signal dies pressed Save, was told
   "something went wrong at our end", and had nothing — which is the failure the whole §3 section
   exists to prevent, sitting in the one screen that meets it daily.

   [`workshop-queue.js`](workshop-queue.js) is the other half, and the whole of it is one sentence:
   **the id is generated once, written down before anything is sent, and never generated again.**
   Everything else follows from that. `localStorage` rather than memory, because the failure that loses
   work is not a slow network — it is the tablet being locked, the browser being killed, or the page
   being reloaded with an entry unsent. One at a time and oldest first, because two entries against the
   same step sent together arrive in whichever order the network chose, and "started" landing after
   "finished" is a jobcard that reads wrongly for ever.

   Three decisions in it were not obvious:

   * **The queue belongs to a person, not to a device.** The server takes the name for a booking from
     the session, never from the request — so a queue left behind by one welder and flushed under the
     next one's session would book the first welder's hours in the second welder's name. On a shared
     tablet that is a real Tuesday. Each queue is therefore stored under its owner's id, taken from the
     snapshot (`takenById`, which the server answers from the session), and only ever flushed by them.
     A tablet holding somebody else's unsent work says so and does not offer to send it, and the next
     welder's own bookings go straight to the server rather than joining a queue that is not theirs.
   * **A refusal is not a failure.** If the database says no — the machine is out of service, the step
     has been moved to another jobcard — retrying cannot help and retrying forever would hide it. The
     entry moves to a list the person is shown, with the database's own words, and they decide: send it
     again or remove it. A lost connection is the opposite: the entry stays, in order, and the next
     flush tries again. A 5xx counts as a lost connection, because none of those are a welder's to fix
     and all of them are safe to send again.
   * **A session that has expired is not a refusal either.** A shift that outlasts its token would
     otherwise have every booking in it thrown onto the refused list, where nobody can act on them.

   Two things had to change underneath it. `workshop-api.js` now **answers** a dead connection instead
   of throwing — a fetch that rejects used to come out of a click handler, leaving the person looking
   at a button that did nothing and said nothing — and a mistyped password no longer reads the same as
   an unreachable server. And the page no longer falls back to browser storage when it cannot read the
   workshop: with a session and no snapshot it says so and refuses to book, because the records still
   in this browser are demonstration data and hours logged onto them go where the office never looks.
   That was the last hiding place of the two-worlds failure, and the end-to-end test baits it — it
   fills browser storage with the demonstration workshop first, so the dropdowns offer real-looking
   jobs and the refusal is the only thing in the way.

   Thirteen end-to-end checks drive it with the connection actually cut
   ([`tests/offline-queue.e2e.js`](tests/offline-queue.e2e.js)), and eight mutations put each rule's
   bug back. The one worth reading is "a retry makes a new id instead of sending the one it was given":
   with it, the suite books two days' hours for one press. Those mutations are also the first this
   project has run against front-end files — the damaged copy is served to the browser when it asks for
   the file, so nothing is ever written into the site directory.

   One of the eight went unnoticed at first, and the reason is worth keeping: removing the queue's own
   "this is not your queue" guard changed nothing the screen could see, because the screen refuses to
   flush a queue it does not own before the module is ever asked. Two guards where one would do is
   right; it just means the inner one can only be checked where it is stated, so that mutation is asked
   of the unit tests instead.

   Two smaller things it found, both of which would have bitten somebody: an author CSS rule that sets
   `display` silently beats the browser's own `[hidden]`, so the banner could not be hidden at all
   until `.unsent[hidden]` was written down; and the hours screen had **two** Log out handlers, one
   from before it was wired, so the navigation raced the sign-out — the browser cancels a fetch on
   navigation, which made ending the session a coin toss.

      **The front door, which was the one screen that refused everybody.** `login.html` sends anybody
   with a password to `hub-desktop.html`, and that page was not wired — so the guard covered it and the
   first thing this system did for a welder signing in on their own phone was tell them the screen
   could not be shown. Wiring it is reading rather than writing: a count per collection, and a name.

   The phone hub was the same problem and worse. It loaded **no data layer at all**, so nothing guarded
   it and nothing could correct it, and it showed a name and the word **Admin** written into the page
   in all three languages. A welder read "Aleksandar · Admin" on the only line of that screen that says
   whose session it is. The snapshot now carries `takenRole` beside `takenBy` and `takenById`, all three
   answered by the database from the session, and both hubs paint the badge from them — after the
   language sweep, because `#whoRole` carries a `data-i` and a dictionary entry reading "Admin" would
   put itself back over a welder's role on every language switch.

   Two things on the desktop hub had to change rather than be carried across:

   * **"Save a copy" and "Restore a copy" are gone in server mode.** They are operations on this
     browser's storage. On the server they would write a file called a backup that held nothing, or
     replace storage nobody reads — so the panel now says where the work actually is and that
     `backup.sh`, run by whoever looks after the database, is what backs it up.
   * **A collection the snapshot does not carry reads as nothing**, not as whatever is left in this
     browser. Quotations and inspections are in that list today, and the check asserts they are absent
     rather than zero.

   And one thing on the phone hub that was not about the server at all. "Team Talk" accepted a typed
   message, appended it to the page under a hardcoded name, and dropped it on the next reload — a chat
   that sends nothing to anybody. By this project's own first rule that is worse than no box, so the
   input says it is not connected and is disabled. Whether the workshop wants a message feed at all is
   a decision for them, not for the pass that found it.

   The `vertical-slice.e2e.js` example of an unwired page moved to Quality, which genuinely has no
   workflows yet. Nine end-to-end checks drive both hubs as two different people
   (`tests/hub-server.e2e.js`), and the last one asks whether a welder's front door carries a figure in
   kronor anywhere.

      **Planning, which is the screen an office opens to answer "what is the shop doing".** It was one
   of the screens a signed-in session could not see at all, so a workshop on the database had the
   projects and no way to look at them together. Wiring it turned out to be mostly reading: every render
   on that page already goes through `WorkshopData.get()`, and the snapshot's project already carries
   `start` as an alias of `planned_start`, which is what the schedule reads. Nothing on the page holds a
   copy of anything, so adopting a snapshot made the board, the schedule and the weekly load the
   workshop's own with no translation layer at all.

   It writes three things and two had workflows already — a project's stage (a status, a phase, and a
   progress of 100 for the done lane) and a project's dates with its planned hours, plus each item that
   moved with them, which on the server is a jobcard. The third, creating a project from a quotation, is
   the estimating path and refuses out loud.

   Two things it confirmed rather than discovered, which is the useful kind of confirmation:

   * **The subset rule holds one level down as well.** Dragging a card sends three fields and
     `save_project` replaces the record, so the patch rides on top of the record the snapshot handed
     over. The check asserts eight fields the board never shows — the purchase order number, the
     responsible, the notes, the workshop, the material state, the kinds of work, the quoted value and
     the deadline — are all still there after a card is moved. The same for a jobcard: nudging a bar on
     the schedule must not clear its heat number.
   * **`sharedId`, not `id`.** `JobcardRecord.toServer` reads the id from `sharedId` because that is
     what the jobcard screen calls it, and the snapshot calls it `id`. Sending it under the wrong name
     creates a second jobcard every time somebody moves a bar, which is the kind of bug that is
     invisible for a week and then unpickable.

   And one thing left as it is, deliberately: the weekly capacity in hours lives in `localStorage` per
   browser. It is an assumption rather than a record and the schema has nowhere for it, so two people
   can hold different figures — worth knowing, and not worth inventing a column for until somebody says
   what the number is.

   One thing found while writing the schema that this step has to deal with: the status sequence
   lives in `ALLOWED_TRANSITIONS` in `jobcard-desktop.html`, page-local, and **not** in
   `workshop-data.js` — `canTransitionJobcard()` there checks only the quality gate. So the shared
   data layer will happily write `draft → completed`, which the database now refuses. Either the map
   moves into `workshop-data.js` beside the other rules, or every path that writes a status has to
   go through the jobcard page. The first one. It is a small job now and a confusing bug later.
6. ~~**Backups verified by restoring one.**~~ **Done** — [`backend/backup.sh`](backend/backup.sh)
   and [`backend/test-restore.js`](backend/test-restore.js).

   This one turned on a measurement. A `pg_dump` of `varmak` carries **497 GRANT statements, 72
   row-level policies and zero `CREATE ROLE`**, because roles live in the cluster and not in the
   database. Restore that file alone onto a clean server and all 497 of those lines fail, because
   `varmak_workshop` does not exist there — and you are left with the data and none of the rules
   about who may read it. Half of this system is privileges rather than records, so a one-file
   backup of it is worse than no backup: you would trust it. Hence two files, and a script that
   prints which one goes back first.

   Then the drill, because `pg_dump` exiting zero says a file was written and nothing more. A
   populated workshop is backed up, restored into a fresh database, and the copy is compared table
   by table on a **checksum of its contents** rather than a row count — a count still matches after
   every price in the store has been quietly rounded. All 33 tables came back identical.

   And the question a restore drill usually skips: **does the copy still refuse?** The hold gate, the
   append-only log, the stock floor, the status sequence, the locked price; a welder still unable to
   read a price or anybody else's row; the people still able to sign in — a restored database nobody
   can get into is a working database and a locked building; and the next two hours of work going in
   with the roll-ups following. Ten checks, and `backup.sh` carries five mutations of its own,
   because the restore suite is the one suite that could be green while proving nothing.

   What it cannot tell you, and the runbook says so out loud: it restores onto the same server it
   dumped from. Restoring onto a different machine is what the roles file is for, and that is only
   proven the first time somebody does it for real.
7. ~~**Put it into service** — a hosted database, a real password, HTTPS in front.~~ **Done, and it
   found four things that were broken.** [`DEPLOY.md`](DEPLOY.md) is the runbook,
   [`backend/install.sh`](backend/install.sh) does the install, [`deploy/`](deploy/) holds the Caddy
   configuration, the systemd unit and the environment file, and
   [`backend/test-deploy.js`](backend/test-deploy.js) is the only part of this worth trusting.

   Every other suite in this project runs against the Postgres on this machine: a unix socket, trust
   authentication, and a **superuser**. A hosted database is none of those three, and the difference was
   not cosmetic — it was four separate install failures, none of which were visible from here:

   * `ALTER ROLE ... NOSUPERUSER` is refused from a role that is not a superuser itself, **even when it
     changes nothing**. The install stopped four lines into the roles on every hosted Postgres there is.
     The intent is now asserted rather than set, which is also strictly better: it catches a superuser
     granted by hand afterwards.
   * `pgcrypto` goes into a schema of its own on a managed database, and two different things break.
     `app_session.token` has `DEFAULT encode(gen_random_bytes(32), 'hex')` — a column default is parsed
     as the table is created — so the install died three tables in. The quieter half: `crypt()` is
     resolved when a function body runs, so an install that *finished* could still be a system nobody
     can sign in to, discovered by the workshop on the morning it meant to start. Three search paths
     are now set from where the extension actually is: the install session's, the database's, and the
     connecting role's.
   * A `CREATEROLE` role that creates another role gets ADMIN OPTION and **not** the right to become
     it, so every `ALTER FUNCTION ... OWNER TO varmak_engine` was refused — and those lines are what
     make the four functions allowed to step around row security belong to a role that may. Worth
     knowing: `pg_has_role(..., 'MEMBER')` answers *true* on the strength of that admin option, so a
     guard written with it skips the grant that is needed and the error is identical to having no guard.
   * On PostgreSQL 15 and later `public` no longer grants `CREATE` to everybody, and the incoming owner
     of a function needs it. Granted around the ownership changes and taken back in the same
     transaction, because nothing `varmak_engine` does afterwards creates anything.

   And one in the client rather than the database, which would have been the hardest to see: pasting a
   connection string with `?sslmode=require` on the end — which is how anybody gets one — makes
   node-postgres derive its own TLS settings and **replace** the ones the server passes, certificate
   authority and all. The parameter is now stripped before use. TLS to the database is not
   configurable: always on, always verified.

   So the suite builds a second Postgres with the hosted shape — TLS only, scram authentication over
   TCP, a non-superuser owner, `pgcrypto` in `extensions` — runs `install.sh` against it exactly as a
   deployment would, and then drives the whole stack through it: the first administrator, a welder with
   a PIN, a customer, a project, a jobcard, hours booked and read back out of Postgres, and the same
   entry sent twice to show it arrives once. The last check is the one worth the most: **on that hosted
   install, can a welder read a price?** If the install had connected as the owner, or `varmak_api` had
   come out with `BYPASSRLS`, every other check would pass and that one would not.

   Two refusals were added to the server itself, because both of these deployments look like they work.
   It will not start with a database over a network and no password, and it will not start connected as
   the owning role — as the owner, every `GRANT` and every policy in `auth.sql` applies to nobody.

   The pages also gained the headers a page needs once it is on the open internet: a content-security
   policy naming the only two foreign origins they use, `nosniff`, and HSTS **only** when the request
   arrived over TLS — sending it over plain HTTP tells a browser to refuse the one address that works.

   What this still cannot tell anybody: it has not been run against a real Supabase project. The shape
   is faithful and the four failures above were real, but the first run against the actual thing is the
   only one that counts, and `DEPLOY.md` says so in its first paragraph rather than at the end.
8. Only then: the AI sweep, the catalogue import, push notifications.

### What steps 1 and 2 cost, and what they caught

`npm run test:schema` asks the database to refuse 110 things and asserts the wording of every
refusal, and to allow 58 more — because a gate that refuses everything passes every refusal test
and still stops the workshop working.

`npm run test:mutations` then puts each rule's bug back, one at a time, and fails if the suite
sleeps through it. A passing test tells you the rule works today, not that anybody would notice it
breaking. **172 mutations** — across the four SQL files, the backup script, and now the three
front-end files the shop tablet's offline queue lives in and the server that connects to a hosted
database. Three of them were found to be **stale** while this count was being updated: the rule each
one damaged had been rewritten and the anchor still quoted the old wording, so the harness had been
reporting "the rule this mutation edits is no longer in schema.sql" rather than testing anything. A
stale mutation is a rule nobody is testing while the report says otherwise, so the anchors are now
checked as a matter of course.

The two checks caught different things, and the difference is the point. **The tests** found five
real defects in the schema, three of which had already survived a careful reading of the file: the
hold gates ran on `UPDATE` only so a jobcard created already completed walked past them; the hours
roll-up left the same hours on two operations when an entry was corrected; nothing stopped an hours
entry naming one jobcard and an operation from another; a refusal read `MIG 400s certification`;
and deleting a rack silently forgot where the steel on it was. **The mutation check** found
something the tests could not — that the test for "stock can never go below zero" passed with its
own constraint deleted, because a different constraint was doing the refusing. A test standing on
the wrong rule is not a test. All of it is written up in [`backend/README.md`](backend/README.md).

### What step 4 caught

Two of them were in `auth.sql` rather than in the new code, and neither had been noticed because
step 3's tests asked what the **floor** could not do and took the office for granted:

- **The office could not create an estimate, a supplier, a purchase order or a lead.** `auth.sql`
  had write policies on a handful of tables and none at all on fourteen others, so every write the
  office attempted matched no rows or was filtered away. A `GRANT` with no policy behind it fails
  closed, so it was not dangerous — it was simply broken, in the quietest possible way. It came out
  when the first workflow tried to lock an estimate row and was told there was no such estimate.
  `test-auth.js` now asks the privilege tables directly: every write privilege any role holds must
  have a policy that permits it.
- **Admin and office held `UPDATE` and `DELETE` on `stock_movement`** with no policy behind either.
  Asked properly, the answer was not to add a policy: a movement is the record explaining why a stock
  figure changed, so it is append-only now. A miscount is corrected by an adjustment movement, which
  is what a store does anyway — you do not rub out the goods-in book.

And one about the cluster rather than the database: **roles survive dropping and rebuilding the
database**, so `CREATE ROLE ... IF NOT EXISTS` means a role created with the wrong attributes once
stays wrong forever. `varmak_api` was created without `LOGIN`, and creating it correctly afterwards
changed nothing. The attributes are set unconditionally now, which is the only version of that which
is safe to run twice.

### What step 3 caught

`npm run test:auth` runs every check as a real Postgres role, because row security tested as the
superuser proves nothing at all — the superuser bypasses it, so every policy passes whether or not
it was ever written. The first check in the file is therefore that the test is not cheating.

Three defects, each of which made the file's central promise untrue while the file read as though
it held:

- A table-wide `GRANT SELECT ON stock_item` sat a few lines above a careful column-by-column grant
  for the same table. The broad grant wins and the narrow one adds nothing, so **a welder read the
  plate cost on the first try**. The same line had handed over `equipment_event.cost`.
- `sign_in` counted a failed attempt and then raised, and **the `RAISE` rolled back the count** — so
  the lockout never engaged and a four-digit PIN had ten thousand free guesses.
- `current_app_role()` read `app_user`, whose policy asks what role you are, so **every query a
  welder ran died in infinite recursion**.

And one about the tests, which is the one worth remembering: a check comparing
`has_column_privilege(...)::text` to `'t'` can never be true, because casting a Postgres boolean to
text gives `'true'`. The most important check in the suite passed while the workshop could read
every price in the building. It surfaced only because a neighbouring check failed out loud. The
details are in [`backend/README.md`](backend/README.md).

Several decisions in this document were quietly contradicted by the first draft of the schema and
have been corrected to match it rather than the other way round: the roles are `admin` and
`workshop` with `office` present but unheld (§1b), the project statuses include `approved` (§2), and
the operation now carries the **filler** beside the welder's name, and the jobcard the **heat number
and certificate reference** (§2) — the facts that cannot be back-filled if certification is ever
pursued. Their absence now fails a test rather than being noticed in two years.

---

## 6. The three questions, answered

| Question | Answer | What it settled |
|---|---|---|
| Which certification? | **None yet** | Quality is three tables, not six. No WPS or welder-qualification subsystem. But the welder's name and the filler used are recorded on the operation from day one, because that history cannot be back-filled. |
| Shop floor devices? | **Both** — tablet at the machines, phone on site | Two doors: PIN on the shared tablet, password on a personal phone. Offline queueing for three append-only actions, and nothing else. |
| How many people? | **2–4** | Two roles, not three. `office` is added the day somebody is hired to do the quoting. Audit log still built, because it is one trigger and it answers "what happened to this job". |

### What these answers removed from the build

- Three quality tables and their screens — `welds`, `wps`, `welder_quals`
- One role and its policies
- Offline support for reading the whole database, which was never worth its cost

### What they added

- The welder and filler as fields on the operation, so certification stays possible later
- An offline write queue for hours, operation timing and material issues
- A second login mode, because a tablet and a phone are not the same thing

### Still genuinely open

**When do you want the AI sweep turned on?** It is cheap ($9–19/month) but it is the only part
with a running cost, and it only earns anything once somebody reads the queue every morning. It
can wait until the rest is in daily use without losing anything.
