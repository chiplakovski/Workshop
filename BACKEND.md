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

| Action | Why it must queue |
|---|---|
| Book hours against an operation | happens at the machine, several times a shift |
| Start / pause / finish an operation | the timestamp is the point; recording it later is a guess |
| Issue material to a jobcard | the steel leaves the shelf whether or not there is signal |

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
   flushing a queue twice changes nothing. Attacked by
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
   | Still to do | 58 fields need a column, 23 want a join rather than a column, 31 hold a list and want a child table |
   | Not a gap | 52 more fields are carried by the demo data and read by no page at all |

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

   It is opt-in per page. Three pages opt in — the phone hours screen, `admin.html` and Customers.
   Nothing changes for the rest, which still run on browser storage exactly as before.

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
7. Only then: the AI sweep, the catalogue import, push notifications.

### What steps 1 and 2 cost, and what they caught

`npm run test:schema` asks the database to refuse 110 things and asserts the wording of every
refusal, and to allow 58 more — because a gate that refuses everything passes every refusal test
and still stops the workshop working.

`npm run test:mutations` then puts each rule's bug back, one at a time, and fails if the suite
sleeps through it. A passing test tells you the rule works today, not that anybody would notice it
breaking. 139 mutations across the four SQL files and the backup script.

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
