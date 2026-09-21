# The database

Five files. `schema.sql` is the database and `auth.sql` is who may see what; `test-schema.js` and
`test-auth.js` try to break each of them, and `mutation-check.js` checks that the tests would
notice if either stopped refusing.

Where it stands: 111 refusals and 58 allowances on the schema, 53 refusals and 26 allowances on
auth, and every mutation caught — every rule in either file has a test that fails without it.

This is steps 1 and 2 of the order in [`BACKEND.md`](../BACKEND.md): the schema with its
constraints and safety rules, and numbering as sequences. 31 tables, 103 checks, 13 triggers, and
all six rules named in §1a of that document. Steps 3 to 7 — auth, the API, pointing
the frontend at it, backups — are not built yet. The frontend still runs entirely on browser
storage and does not talk to any of this.

## Running it

PostgreSQL 16. Nothing else — no npm packages, no ORM, no migration tool yet. The tests drive
`psql` directly, which is also the honest way to test locks and partial unique indexes.

```sh
# a throwaway server, if there isn't one already
initdb -D /var/lib/postgresql/varmak --auth=trust -U postgres
pg_ctl -D /var/lib/postgresql/varmak -o "-k /tmp -p 5433 -c listen_addresses=" -l server.log start

npm run test:schema        # builds a fresh database from schema.sql and attacks it
npm run test:auth          # adds auth.sql and attacks it as each real role
npm run test:mutations     # puts each rule's bug back and checks the tests catch it
```

`test:schema` takes a few seconds. `test:mutations` rebuilds the database and re-runs the whole
suite once per mutation — 42 of them, about half an hour — so it is a check to run when a rule
changes, not on every save. One rule at a time:

```sh
node backend/mutation-check.js "per-group item numbers"   # one rule
node backend/mutation-check.js file:auth                  # everything in auth.sql
```

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
