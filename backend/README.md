# The database

Three files. `schema.sql` is the database, `test-schema.js` tries to break it, and
`mutation-check.js` checks that the tests would notice if it stopped refusing.

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
npm run test:mutations     # puts each rule's bug back and checks the tests catch it
```

`test:schema` takes a few seconds. `test:mutations` rebuilds the database and re-runs the whole
suite once per mutation, so it takes minutes — it is a check to run when a rule changes, not on
every save. One rule at a time:

```sh
node backend/mutation-check.js "per-group item numbers"
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

The mutation for per-group item numbering is worth looking at, because it reproduces the original
bug in its original form. Replace the one-statement `UPDATE … RETURNING` in `next_item_number()`
with a read and then a write, and twelve simultaneous callers come back with:

```
PLT-0003, PLT-0003, PLT-0003, PLT-0003, PLT-0003, …
```

which is exactly what the browser did before any of this existed. Item numbers are the one number
here a sequence cannot hand out, because every group counts from 1 — so the counter has to live on
a row, and that one statement is the whole of what makes it safe.
