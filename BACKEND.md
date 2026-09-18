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
  an incident.
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

1. **Schema and constraints**, with the safety rules as triggers from the start. Not "add
   constraints later" — later never comes, and by then there is data that violates them.
2. **Numbering as sequences.** Before two people ever use it.
3. **Auth and the three roles**, with row-level security written alongside the tables.
4. **The API for the workflows in §4**, one at a time, tested.
5. **Point the frontend at it.** `workshop-data.js` is the only file that touches storage — 221
   operations behind one interface. The sixteen pages do not change.
6. **Backups verified by restoring one.**
7. Only then: the AI sweep, the catalogue import, push notifications.

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
