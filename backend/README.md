# The database

Four things, each with a suite that attacks it:

| | |
|---|---|
| `schema.sql` | the database — tables, constraints, the safety rules as triggers |
| `auth.sql` | who may see what — two doors, three roles, row-level security |
| `api.sql` | the workflows — several writes that must all succeed or all fail |
| `views.sql` | reading it back, in the shape the pages already use |
| `server.js` | the HTTP layer, which decides nothing at all |
| `backup.sh` | the backup, in the two pieces it actually takes |

`mutation-check.js` then checks that the tests would notice if any of these stopped refusing:
**149 mutations**, across the four SQL files and the backup script.

Where it stands: 111 refusals on the schema, 57 on auth, 25 on the workflows and 18 over real HTTP,
with 112 allowances beside them — because a gate that refuses everything passes every refusal test
and still stops the workshop working.

Steps 1 to 4 and 6 of the order in [`BACKEND.md`](../BACKEND.md) are built: the schema with its
constraints and safety rules, numbering as sequences, the two doors and three roles, the workflows,
and backups verified by restoring one. 31 tables, 103 checks, 13 triggers, and all six rules named
in §1a of that document.

Step 5 — pointing the frontend at it — is one screen in. `hours-mobile.html` reads and writes the
database; the other fifteen pages still run on browser storage, and `workshop-guard.js` says so on
screen rather than showing a signed-in person figures that came from nowhere. Step 7, a deployment
that outlives a container, is not built.

## Running it

PostgreSQL 16. Nothing else — no npm packages, no ORM, no migration tool yet. The tests drive
`psql` directly, which is also the honest way to test locks and partial unique indexes.

```sh
# a throwaway server, if there isn't one already
initdb -D /var/lib/postgresql/varmak --auth=trust -U postgres
pg_ctl -D /var/lib/postgresql/varmak -o "-k /tmp -p 5433 -c listen_addresses=" -l server.log start

npm run test:backend       # all five suites, each building its own database
npm run test:schema        # constraints and triggers
npm run test:auth          # roles and row-level security, as each real role
npm run test:api           # the workflows, made to fail halfway
npm run test:server        # over real HTTP, with real tokens
npm run test:restore       # takes a backup, restores it, and asks the copy to refuse
npm run coverage           # how much of what the app holds the database can store

sh backend/pg-up.sh        # start the throwaway server, or say it is already up
npm run test:mutations     # puts each rule's bug back and checks the tests catch it

npm run serve              # the API itself, on PORT (8787 by default)
```

`pg` is the only runtime dependency. It was added for `server.js` and nothing else — hand-rolling
the Postgres wire protocol to avoid one dependency would be a worse trade than taking it.

`test:schema` takes a few seconds. `test:mutations` rebuilds the database and re-runs the whole
suite once per mutation — 149 of them, a couple of hours — so it is a check to run when a rule
changes, not on every save. One rule, or one file, at a time:

```sh
node backend/mutation-check.js "per-group item numbers"   # one rule
node backend/mutation-check.js file:auth                  # everything in auth.sql
node backend/mutation-check.js file:backup                # everything in backup.sh
```

Running the whole of one file is worth doing after the file changes, not only after a rule changes.
A mutation whose anchor text has been edited away cannot be applied at all, and the check reports it
as `?` and counts it as untested — which is how the single most important mutation in the project
was found to have gone stale: `project` and `equipment` were lifted out of the workshop's whole-table
grant (each had acquired a money column), and the mutation that puts `stock_item` back into that
list no longer matched the line it was quoting. A rule guarded by a mutation that can no longer be
applied is a rule with no mutation at all.

**Do not edit `schema.sql` while `test:mutations` is running.** It reads the schema once at the
start and every mutation is a copy of that, so an edit part-way through makes the suite fail on the
edit rather than on the mutation — and every mutation then reports as caught, for the wrong reason.
This is not hypothetical: a run reported all 42 caught while every single one was failing on an
unrelated assertion. The check now re-reads the file at the end and throws the whole run away if it
moved, which is the only honest thing it can do with a result like that.

Both read `PGHOST`, `PGPORT` and `PGUSER`, defaulting to `/tmp`, `5433` and `postgres`.
`test:schema` drops and rebuilds `varmak_schema_test` every run, so it never tests a database that
has drifted. `VARMAK_SCHEMA` points it at a different schema file, which is how the mutation check
works.

## What is enforced here rather than in the browser

The dividing line from `BACKEND.md` §4: **anything that must be true no matter who is asking.**
The sixteen pages check the same things to grey a button out before it is pressed — that is
convenience. This is the floor nothing falls through.

| Rule | How |
|---|---|
| An active quality hold stops work being completed or closed | trigger, on the jobcard and the project, on INSERT as well as UPDATE |
| A hold clears only against a named authority, written evidence and a date | `release_needs_evidence` |
| Work cannot start on a machine that is out of service, under maintenance, quarantined, retired, or out of certification | trigger, on the move into `in-progress` |
| A machine cannot be assigned to two jobcards at once | partial unique index |
| Work cannot start before what it depends on is finished, and dependencies cannot loop | trigger, including a walk of the chain |
| Logged hours are the sum of the entries | trigger, recomputing both the operation an entry left and the one it joined |
| An hours entry cannot name one jobcard and an operation from another | trigger |
| An estimate's total is its lines plus its margin | generated column for the line, trigger for the total |
| Stock never goes below zero, and never has more reserved than exists | `reserved_never_negative` + `reserved_within_stock` |
| Two people cannot issue the same last piece of steel | `SELECT … FOR UPDATE` in `issue_stock` |
| An NCR closes only on a root cause and an action taken | `closed_ncr_says_what_was_done` |
| Document numbers are never handed out twice | sequences, not a count of rows |
| Item numbers run per group and are never handed out twice either | `next_item_number()`, one `UPDATE … RETURNING` — the one number a sequence cannot give, because every group starts at 1 |
| A status follows the sequence the workshop actually uses | `allowed_transition`, a table of pairs seeded from `ALLOWED_TRANSITIONS` in `jobcard-desktop.html` and the `can*` rules in `project-rules.js` |
| A line that has gone to the customer cannot be repriced without a reason and a name | trigger; and the reason has to be a new one |
| The activity log can be added to and nothing else | trigger refusing UPDATE and DELETE |

## Who may see what

Two doors, because they guard different things — email and password for the office and for a
personal phone, a personal PIN on the shared tablet in the hall. A welder in gloves will not type a
password forty times a day, and if you make them they share one login and the hours data becomes
worthless. So a PIN opens a `workshop` session and nothing more, and that limit is a GRANT rather
than an `if`, so it holds even if somebody works out the PIN.

Three real Postgres roles — `varmak_admin`, `varmak_office`, `varmak_workshop` — plus `varmak_api`,
which is what the connection pool logs in as. `varmak_api` can become any of the three and can read
nothing itself, so a bug that forgets to pick a role ends with a session that cannot see a single
row. That is the direction a mistake here has to fail.

Three things carry the weight:

- **GRANT, column by column, for money.** `SELECT avg_cost FROM stock_item` as a welder is refused
  by the server. Not filtered, not blanked — refused. So is `SELECT *`, and so is reaching the
  column sideways with `WHERE avg_cost > 10` or `ORDER BY avg_cost`. The cost is real and worth
  saying: the workshop's queries have to name their columns.
- **Row-level security, forced, on every table.** Forced so the owner is held to the same rules —
  otherwise the one role that runs the migrations is the one role none of this applies to, and it
  is the role most likely to be left connected in a console.
- **The role comes from the row, never from the session.** A session claiming `admin` when its row
  says `workshop` is refused and named in the refusal. Holding the office *database* role is not
  enough either: the policies read the person.

Ten functions may step around row security, and the test suite asserts that list by name so it
cannot grow quietly. Four of them are the bootstrap — signing in has to write a session row before
anybody is signed in. Two answer "who am I" and cannot be subject to a policy that needs the answer
first. Two hash secrets. Two are the door material leaves by.

Material is worth its own note. §1b says the workshop may issue material, which changes
`stock_item`. Granting UPDATE on the quantity columns would also let a welder set the stock to
anything with no movement written against it, and then the store's figures and the movements meant
to explain them drift apart silently. So the workshop has no UPDATE on `stock_item` at all — it has
`issue_material()`, which is the door. Note what that function does *not* take: who is doing it.
That comes from the session, so the movement records the person who actually issued the steel
rather than whichever name the caller passed.

Nobody can read `password_hash` or `pin_hash`. Not office, not admin. Signing in compares inside
the database and setting a new secret overwrites, so nothing has a reason to select them — and a
hash that cannot be selected cannot leave the building in a spreadsheet.

## The workflows

§4 of BACKEND.md divides the system in three and says what belongs where. `api.sql` is the middle
one: **workflows that span several tables in one transaction.** Seven of them, and they are database
functions rather than code in the server for the same reason the safety rules are triggers — a
workflow written in the server holds right up until somebody adds a second caller.

| | |
|---|---|
| `send_estimate` | locks every line and puts a date on the quote. Nothing else in the system set `locked`, which made the whole repricing rule unreachable |
| `accept_estimate` | the estimate becomes accepted, a project comes into being or moves forward, and the quoted labour becomes the planned hours |
| `receive_goods` | the line records what came, stock goes up, a movement explains why, and the order's status is derived from its lines |
| `convert_lead` | the customer arrives carrying what was known about the lead, the lead is marked converted, and anything already quoted follows across |
| `book_hours` · `record_operation` · `issue_material_offline` | the three the shop tablet may do with no signal |

And the work itself, without which nothing could reach the shop floor except by accepting a
quotation — so a workshop that took an order over the telephone had no way to record it at all:

| | |
|---|---|
| `save_project` | one project, created or corrected. `used_hours` is **not** a parameter and must never become one: it is a running total the hours entries maintain, and a screen that could set it could make a project claim work nobody did. It also translates the frontend's two names for one state — `active` and `draft` — into the one spelling the enum holds, which is what `schema.sql` said the API would do |
| `save_jobcard` | one jobcard on a project. There is **no customer parameter** — it is taken from the project, because a jobcard carrying a different customer from its project makes every report disagree with itself and nobody would put the two columns side by side to notice |
| `set_jobcard_operations` | the steps, matched on the id the snapshot handed out rather than rebuilt. It refuses to take off a step somebody has booked hours on, or has started, and names it |

The steps are the one list in this system that cannot be replaced wholesale, and the reason is worth
reading. `hours_entry.operation_id` is `ON DELETE SET NULL` — which is right, because hours must
outlive a step being reorganised — but it means deleting a step **succeeds silently** and leaves every
hour ever booked on it pointing at nothing. What the workshop loses is the answer to "how long did the
weld-out actually take", which is the only number that makes the next estimate better than a guess,
and nothing would appear on any screen. So there are two layers: the workflow names every step it is
about to lose and refuses first, and a `BEFORE DELETE` trigger refuses it whoever asks and however
they ask — because the office holds `DELETE` on that table and could otherwise do it in one statement.

Re-ordering those steps is why `UNIQUE (jobcard_id, seq)` is **deferrable**: writing seq 1 where seq 2
was, while 1 is still 1, is a halfway state an immediately-checked index refuses even though the
finished list is fine. Deferred, it is checked once at the end of the transaction. The rule is
identical; only the moment it is asked changes. The alternative tried first was renumbering through
negative numbers, which `CHECK (seq > 0)` refuses, and rightly.

And the customer, which is the first record a workshop starting from nothing has to be able to make:

| | |
|---|---|
| `save_customer` | one row, created or corrected. It **replaces** rather than patches, because the screen holds the whole record — so emptying a box empties the column, which is what makes a correction possible at all. It refuses a second customer with a name somebody already used, and says which reference it already is: a duplicate is made by somebody who searched, did not find it and typed it again, and from then on half the jobs are under one and half the other |
| `set_customer_contacts` | the whole list at once, because that is how the screen holds it. At most one main contact, refused in a sentence rather than as the name of a unique index, and a contact nobody can reach is not a contact |

And the people, which are what stop this system needing a database console to start:

| | |
|---|---|
| `bootstrap_first_admin` | the first administrator, on an empty system, with no session — because there is nobody to sign in as yet. It refuses the instant the table has anybody in it, and that condition cannot become true again without deleting everybody |
| `add_person` | somebody arrives with **no way in at all**. An admin gives them one afterwards, so there is never a moment where an account exists with a password somebody else chose and nobody changed |
| `set_person_pin` · `set_person_password` | by an admin, in person. Setting either clears a lockout |
| `set_person_role` · `set_person_active` | what somebody may do, and whether they may. Switching somebody off ends the session they are **already holding**, which is the thing a stateless token cannot do |
| `change_my_password` | yours, and only by proving you know the current one |
| `people()` (a read) | the list `admin.html` shows. Under row-level security a welder's copy of it is one row: their own |

Two rules the list carries that are easy to state and easy to lose: it says whether somebody can
**actually** get in — `password_set_at` and `pin_set_at`, never the hashes, which no role may read at
all — and it says which row is the caller's, so the screen can leave out the two moves that lock the
building from the inside.

The thing worth testing about a multi-write workflow is not that it works — it is what it leaves
behind when it doesn't. A receipt that puts stock on the shelf and then fails to write the movement
has left the store unable to explain itself, and no amount of the happy path passing will say so. So
each one is made to fail on its last write and the check is that every earlier write went with it,
compared against a snapshot of every table that could have moved.

### Offline

§3 scoped offline to those three actions because they happen at the machine and cannot wait. The
tablet queues them with an id it generates itself, and the point is that **it cannot know whether
its first attempt arrived before the connection died** — so it flushes the queue blindly and the
server has to make asking twice harmless. Each takes an event id; a replay gets the first answer back
and changes nothing.

Two things about that are easy to get wrong and are tested:

- **A refusal must not burn the event id.** If a queued start is refused because the machine went out
  of service, and the id has been consumed, then flushing the queue again reports "already done" and
  the work is silently lost. It survives because the refusal rolls the whole transaction back,
  including the claim.
- **The gates still hold on replay.** An operation queued against a machine that has since gone out
  of service is refused when it arrives, naming the machine and what is wrong with it. Offline delays
  the check; it does not skip it. This is the clearest argument for the rules living in the database:
  the tablet cannot be the thing that decides.

## Reading it back

`views.sql` is the first half of step 5. The pages read one object of named collections, so the
snapshot **is** that object, built in SQL with the field names the pages already expect. Renaming
happens there rather than in the browser because a rename in the browser is sixteen edits.

Two functions, and the split is the design:

| | |
|---|---|
| `workspace_snapshot()` | everything with no figure in kronor anywhere in it — granted to all three roles, so a welder makes the same call as the office |
| `workspace_money()` | the money, keyed by record id, for the office to merge in — granted to admin and office only |

The alternative was one function that checks the role and leaves the prices out for the floor. It was
rejected because that puts the decision back in code, and worse: `CASE WHEN may_see_money() THEN
avg_cost` still *mentions* the column, mentioning needs privilege on it, and the whole function would
have been refused for a welder. Two functions and a `GRANT` mean the privilege system decides, the
server forwards both without knowing which contains what, and **a welder's snapshot cannot carry a
price because the SQL that builds it never names one.**

The test searches a welder's snapshot as text for every money-ish key and for the actual figures,
rather than checking the fields it happens to think of — a price arriving under a name nobody expected
is exactly what a field-by-field check misses.

Money crosses the wire as **text**. `jsonb_build_object` on a `numeric(12,2)` yields a JSON number,
and a JSON number parsed in a browser is a double — which is the "money as floating point" mistake
the schema rules out and would then have reintroduced on the wire. `14.50` arrives as `"14.50"` and
keeps its scale.

## The HTTP layer decides nothing

`server.js` turns a bearer token into a session and calls a function from a fixed list. That is all
it does, and `test-server.js` asserts it by reading the file: no `INSERT`, `UPDATE` or `DELETE`, and
no branch on anybody's role. A rule like that decays the moment it is only a comment.

The session is set with `SET LOCAL ROLE` and `SET LOCAL app.user_id` inside the transaction, so
neither can leak onto the next request that borrows the pooled connection. The role comes from the
row the database returned, never from anything the client sent — and the sign-in response is a token
and nothing else, so the client has nothing to make its own decisions with.

Refusals are passed through in the words the database wrote them in. `cannot issue 500 KG of
S355-10: only 120 in stock` is something a storeman can act on; a 500 with a generic message is not.
Permission failures become 403, constraint and trigger refusals 422, and anything unrecognised is
this layer's fault and says nothing about the inside of the database.

### Which means the error code a refusal is raised with decides whether anybody reads it

42501 is flattened to "that is not yours to do", because Postgres writes its own privilege errors as
`permission denied for table stock_item` and that names the inside of the database to whoever asked.
Five codes carry their message through. **Everything else becomes "something went wrong at our end"** —
so a refusal raised with a sixth code is not a refusal any more, it is a fault report about a fault
that did not happen.

Both halves of that were wrong in the people workflows, and both had passed two suites:

- `bootstrap_first_admin` raised `insufficient_privilege`, so the first-run screen answered "that is
  not yours to do" to the only person who could possibly be using it. That refusal is not about who
  is asking — nobody is signed in and nobody can be — it is about the state the system is in.
- `change_my_password` raised `invalid_password`, which is on neither list, so the one refusal in the
  whole flow an ordinary person meets weekly — mistyping their own password — came back as a server
  error. The SQL suite asserted the wording and never went through HTTP. The HTTP suite had no case
  for it.

Both now raise plainly, which is `P0001`, which carries. And the rule is asserted structurally rather
than case by case: `test-server.js` reads every `USING ERRCODE` in `api.sql` and `auth.sql` and fails
if any of them is a code the server would turn into a 500. Case-by-case would have caught these two
and missed the next one, which will be in a function nobody thought to test over HTTP either.

## How much of the app the database can hold

`node backend/coverage.js` compares every field on a record the sixteen pages read against the
columns that exist, and says what fraction can be stored. It is not a test — it reports, and fails
only if the number goes backwards, so a pass that widens the schema cannot quietly narrow it
somewhere else.

It exists because step 5 of BACKEND.md ("point the frontend at it; the sixteen pages do not change")
turned out to rest on something nobody had checked. The schema was built from the twenty-five-table
plan in §2, which trimmed the *collections* — it said nothing about the fields inside them. The first
measurement: **111 of 345 fields the pages read could be stored. 32%.** Today it is **235 of 359, or
65%** — and the denominator moved because the meter itself was corrected twice, which is the next
thing in this section.

Two corrections to the meter itself are worth knowing about, because both moved the number more than
any pass of column-adding has.

Seven points came from names: five customer fields it reported as having no column had had one since
the first pass under a longer name — `since` is `customer_since`, `terms` is `payment_terms_days` — and
the same was true of `created`/`created_at` on three tables, the four store columns for groups and
locations, and three lists whose child table already existed. Twenty-three fields, no schema change.

Then the other direction. Its test for "does any page actually read this field" listed the characters
it expected after the name — `['"]\s.,;)=` — and therefore missed every read written as
`j.inspectionRequired ? a : b`, because `?` was not on the list. Fourteen fields the pages do read were
being reported as width nobody misses, `inspection_required` among them. Correcting that took the
coverage **down** from 68% to 65% and the missing columns up from 58 to 72, and the ratchet refused the
run until the baseline moved — which is the only honest reason a ratchet is ever allowed to move
backwards: the number got worse because the measurement got better.

A progress meter that overstates the work is a meter that gets planned around; one that understates it
is a meter that hides work. Both happened here, and the numbers in this file are the corrected ones.

The classification matters more than the total, and the judgements are written down in the file
rather than inferred, because a rule that maps `no` to `no` and shrugs at `org` would overstate the
coverage:

| | |
|---|---|
| **stored** | there is a column for it |
| **needs a column** | a page reads it and the database cannot hold it |
| **a join** | it is a copy of something on another record — a name that can drift from the name it copied is worse than a join |
| **a child table** | it holds a list, and a JSON array cannot have a foreign key or a constraint on its rows |
| **unused** | the demo data carries it and no page reads it — width, not a gap |

```sh
npm run coverage             # the summary and the ratchet
node backend/coverage.js customers   # one collection, field by field
```

## Backups

```sh
sh backend/backup.sh [directory]     # default: ./backups
npm run test:restore                 # take one, put it back, and check the copy still refuses
```

**A `pg_dump` of the database is not a backup of this system.** Measured rather than assumed: the
dump carries **497 GRANT statements, 72 row-level policies and zero `CREATE ROLE`**, because roles
live in the cluster and not in the database. Restore that file onto a clean server and every one of
those 497 lines fails, because `varmak_workshop` does not exist there — leaving the data and none of
the rules about who may read it. That is worse than having no backup, because you would trust it.

So `backup.sh` writes two files, always, and prints the order they go back in:

| | |
|---|---|
| `varmak-<stamp>.roles.sql` | the roles, from `pg_dumpall --roles-only --no-role-passwords` |
| `varmak-<stamp>.dump` | the database, in the custom format |

```sh
psql -h HOST -U postgres -d postgres -f varmak-<stamp>.roles.sql   # FIRST
createdb -h HOST -U postgres varmak
pg_restore -h HOST -U postgres -d varmak varmak-<stamp>.dump
```

`--no-role-passwords` is deliberate: a backup that carries the API role's password hash is a backup
that hands over the database to whoever finds the file, and the password is set once at deploy time
anyway.

### What the restore drill actually asks

`pg_dump` exiting zero says a file was written, not that anything can be got back out of it. So
`test-restore.js` populates a workshop, takes a backup the way the runbook says to, restores it into
a fresh database, and asks the copy two different questions.

**Did the records come back?** Compared table by table with `md5(string_agg(t::text, …))` of the
contents — not a row count. A row count still matches after every price in the store has been
silently rounded. All 33 tables, plus the figures checked for their scale and the rolled-up hours
checked for still being rolled up.

**Does the copy still refuse?** This is the half a restore drill usually skips, and the half that
matters more. A dump that brings back the data and loses a trigger is worse than no backup at all,
because nothing looks wrong until somebody ships work that was on hold. So the copy is asked for the
hold gate, the append-only log, the stock floor, the status sequence and the locked price; then
whether a welder can still be refused a price and anybody else's row; then whether the people can
still sign in — a restored database nobody can get into is a working database and a locked building;
and finally whether the next two hours of work go in and the roll-ups follow. Ten checks.

`backup.sh` has its own mutations for the same reason everything else here does. The restore suite is
the one suite that could be green while proving nothing: if the comparison stopped comparing, every
line would still read `OK`. So the script's bugs are put back too — the roles half left out, the
roles filtered out of the roles file, the password hashes left in, the restore order unstated, and a
structure-only dump that restores cleanly and contains not one record. Five of them, all caught. Two
more damage the SQL and run the restore suite instead of its own, which is what proves the copy is
really being asked to refuse rather than merely being opened.

One thing the drill cannot tell you, and the runbook should not pretend otherwise: it restores onto
the same server it dumped from. Restoring onto a *different* machine is what the roles file exists
for, and that step is only proven the first time somebody does it for real.

## Why the tests look the way they do

110 refusals, 58 allowances, 68 checks. Every case asserts the **wording** of the refusal, not only
that one happened. `ERROR: new row
violates check constraint "stock_item_check"` is not something a person standing at a machine can
act on; `cannot issue 500 KG of S355-10: only 120 in stock` is. Wording that a test holds is
wording that stays.

Three cases start a second `psql` session, because the failures that matter most here cannot be
reproduced with one: two people taking the same document number, two people adding an item to the
same group, and two people issuing the last of something. The first test in the file deliberately demonstrates the *old* numbering colliding,
so the reason for the sequences stays visible rather than becoming folklore.

## What the mutation check found that reading did not

Four bugs were in `schema.sql` after it was written and read carefully; three survived that
reading and were found by the tests, and one was found by the mutation check finding a *test* that
was wrong:

- The hold gates ran on `UPDATE` only, so a jobcard created already `completed` walked straight
  past them — the status never transitioned, so the trigger never looked.
- The hours roll-up recomputed only the operation named on the row it was handed, so an entry
  booked to the wrong operation and corrected left its hours on both. The same three hours counted
  twice, in a figure work is priced from.
- Nothing stopped an hours entry naming one jobcard and an operation belonging to another.
- The expired-certification refusal read `Fixture MIG 400s certification expired`: `%s` in a
  `RAISE` is the placeholder followed by a literal `s`, not a possessive.
- And the test for "stock can never go below zero" passed with its own constraint deleted, because
  `reserved <= stock` was refusing instead. A test standing on the wrong constraint is not a test.

Deleting a location also turned out to quietly set the location of every offcut on it to null —
physical steel whose place the record had forgotten. Found by asserting a refusal that did not
happen, and now a `RESTRICT`.

## What testing auth found

Every one of these was in `auth.sql` after it was written and read through, and the file looked
right each time:

- **The headline promise simply failed.** `GRANT SELECT ON ... stock_item ... TO varmak_workshop`
  sat a few lines above a careful column-by-column grant for the same table. A table-wide grant
  includes every column and the narrower one adds nothing, so a welder read `avg_cost` = 14.50 out
  of the store on the first try. The same mistake had handed over `equipment_event.cost`. This is
  why the suite now asks the server's own privilege tables rather than trusting the file to be
  right, and why it first checks that its list of money columns covers every numeric column in the
  database whose name looks like money.
- **The lockout did nothing whatsoever.** `sign_in` counted a failed attempt and then raised — and
  the `RAISE` rolled back the row it had just written, so `failed_attempts` never moved and
  `locked_until` was never set. A four-digit PIN with no working lockout is ten thousand free
  guesses, which is to say it is not a credential. A function that has to record something cannot
  also abort, so `sign_in` returns a refusal instead of raising. Caught on the sixth guess.
- **Every query by a welder died with "stack depth limit exceeded".** `current_app_role()` reads
  `app_user`; `app_user` has a policy; the policy asks what role you are. A function that reads one
  row to answer "who am I" cannot be subject to a policy that needs the answer first.
- **The broad grant handed both hash columns to admin and office.** Same shape as the first item,
  found by asking the privilege tables for every role rather than just the one under suspicion.
- **The office could sign a stock movement in anybody's name.** `issue_stock` takes the name to
  record, and `REVOKE ALL ON FUNCTION ... FROM PUBLIC` does not remove a privilege granted
  explicitly to a role — and an earlier line had granted it to all three. Being the one role that
  also holds `UPDATE` on `stock_item`, the office could use it. Found by the mutation check
  reporting a rule with no test behind it, then by the test it prompted.
- **The same shape of mistake, three times.** A broad or early `GRANT`, and a narrower line further
  down that reads as though it undoes it. It does not: a table-wide grant is not narrowed by a
  column grant, and `FROM PUBLIC` is not narrowed to the roles. Both need an explicit `REVOKE`
  naming what is being taken back. This is the thing to look for first in any future change to this
  file — and the reason the suite asks the server's privilege tables rather than reading the SQL.

And three about the tests rather than the code, kept because each one was a check that would have
passed forever:

- **Row security tested as the superuser proves nothing** — the superuser bypasses it, so every
  policy passes whether or not it was ever written. The first check in `test-auth.js` now asserts
  that the roles under test hold neither `SUPERUSER` nor `BYPASSRLS`, and that the list of functions
  which may bypass is exactly the ten expected ones.
- **A test comparing `has_column_privilege(...)::text` to `'t'` can never be true.** Casting a
  Postgres boolean to text gives `'true'`; `'t'` is only how psql prints it. So the most important
  check in the file — that the workshop holds no privilege on any price column — passed while the
  workshop could read every price in the building. It was caught only because a neighbouring check
  on the office role failed out loud.
- **A row-level policy on SELECT or UPDATE filters rather than refuses.** The statement succeeds
  having matched nothing. Three checks expected an error and would have passed just as happily if
  the policy had let the change through and reported success; they now assert the unchanged value
  and the empty answer, beside a non-empty one from somebody who may see it.

## A bug can need two lines to be wrong at once

The office-forging-a-movement hole took two lines: an explicit `GRANT EXECUTE ON FUNCTION
issue_stock` early in the file, and a `REVOKE ... FROM PUBLIC` further down that did not name the
roles. Either line alone is harmless — with no early grant, revoking from `PUBLIC` is enough,
because `EXECUTE` goes to `PUBLIC` by default and to no role explicitly; with the roles named in the
revoke, an early grant is cancelled.

Which meant that mutating either line on its own changed nothing any test could observe, and both
attempts reported `MISSED`. The rule looked untestable when it was only being asked about wrongly.
So a mutation can now carry several `edits` applied together, and this one makes both — which is the
only version of it that reproduces the bug that was actually there.

The general lesson, since it cost two full runs: **a `MISSED` is a question, not a verdict.** It
says the tests did not notice this edit. Sometimes that means a rule has no test behind it. Sometimes
it means the edit was a no-op — a redundant constraint, a defensive line that something else already
covers — and then the honest response is to say so in the schema and drop or rewrite the mutation,
not to invent a test for a difference that does not exist.

## The mutation that reproduces the original bug

The mutation for per-group item numbering is worth looking at, because it reproduces the original
bug in its original form. Replace the one-statement `UPDATE … RETURNING` in `next_item_number()`
with a read and then a write, and twelve simultaneous callers come back with:

```
PLT-0003, PLT-0003, PLT-0003, PLT-0003, PLT-0003, …
```

which is exactly what the browser did before any of this existed. Item numbers are the one number
here a sequence cannot hand out, because every group counts from 1 — so the counter has to live on
a row, and that one statement is the whole of what makes it safe.
