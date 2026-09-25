# Putting this into service

For Varmak AB, Lagmansgatan 31, 241 71 Marieholm. Twenty-three steps, and at the end of them the workshop
is running on a real database with its own data and nobody has to open psql again.

**Read this first: none of it has been run against your Supabase project.** It has been run, in full,
against a Postgres deliberately built to have the same shape — TLS only, a password, a non-superuser
owner, `pgcrypto` in a schema of its own — by [`backend/test-deploy.js`](backend/test-deploy.js),
which installs the four files, makes the first administrator, signs a welder in with a PIN, books
hours, and then checks that the welder still cannot read a price. `npm run test:deploy`. Four separate
things in this repository were broken for a hosted database and none of them were visible from the
machine it was written on; that suite is why they are fixed rather than waiting for you to find them.

What is left that only your project can answer is listed at the end, under **If something refuses**.

---

## What you are building

| | |
|---|---|
| The database | Supabase Postgres. It holds the tables, the roles, the row-level policies and every workflow. |
| The server | Node, one file, on a small machine you control. It carries requests to the database and decides nothing. |
| HTTPS | Caddy in front of the Node server, with a certificate it gets and renews by itself. |
| The pages | Served by the same Node server, so there is one origin and no CORS anywhere. |

The database is the expensive half to get wrong, which is why it is not on the same machine as the
server: a machine can be rebuilt in an afternoon, and Supabase takes its own backups of the database
while you sleep. You will still take your own — see step 15, and the reason there.

---

## 1 · The database

1. **Make a project** at supabase.com. Choose the region closest to Marieholm (Frankfurt, usually) —
   every page load pays the distance twice. Keep the database password it gives you somewhere safe;
   it is the owner's password and you need it for exactly two of these steps.
2. **Find the connection string.** Project Settings → Database → Connection string → URI. It looks
   like `postgresql://postgres:PASSWORD@db.xxxxxxxxxxxx.supabase.co:5432/postgres`.
3. **Download the certificate authority** from the same page ("Download certificate"). Put it
   somewhere the server will be able to read it — step 9 points at it.

## 2 · Ask the database whether the install will work, before writing to it

```sh
export DATABASE_URL='postgresql://postgres:OWNER-PASSWORD@db.xxxxxxxxxxxx.supabase.co:5432/postgres?sslmode=verify-full'
export PGSSLROOTCERT=/path/to/prod-ca-2021.crt      # downloaded from the project's dashboard
sh backend/preflight.sh
```

It writes nothing and creates nothing. It answers one question — will `install.sh` get all the way
through here — and it refuses with a reason rather than a code when the answer is no. Run it first,
because `install.sh` finds out about a wrong database *halfway through*: after the tables and before the
ownership changes, which is a database that looks installed and is not.

Every check in it is a failure this deployment path has actually had:

| It refuses | Because |
|---|---|
| `sslmode=require`, or no `sslmode` | Those encrypt and verify nothing — the owner's password goes to whoever answered. Only `verify-full` checks the certificate *and* the hostname. |
| A role with neither superuser nor `CREATEROLE` | The install makes five roles and cannot start. |
| No `CREATE` on schema `public` | From PostgreSQL 15 that is not granted by default, and the ownership changes are refused after everything else has gone in. |
| pgcrypto missing, or in a schema this role cannot use | `app_session.token` defaults to `gen_random_bytes`, and a column default is parsed as the table is created — so this one stops the install three tables in. |
| A server encoding that is not UTF8 | Every name on every screen is Swedish or Macedonian. |
| Some of the tables already there, but not all | A half-installed database. Restore a backup or start a new one; do not install over it. |

It ends in `Clear to install.` or in `Refusing: N check(s) failed`, and
[`backend/test-deploy.js`](backend/test-deploy.js) runs it both ways against a Postgres shaped like a
hosted one — refusing an unverified URL, passing a verified one.

## 3 · Install the schema

On any machine with `psql` and this repository checked out:

```sh
export DATABASE_URL='postgresql://postgres:OWNER-PASSWORD@db.xxxxxxxxxxxx.supabase.co:5432/postgres?sslmode=verify-full'
export PGSSLROOTCERT=/path/to/prod-ca-2021.crt
export VARMAK_API_PASSWORD="$(openssl rand -base64 32)"
echo "$VARMAK_API_PASSWORD"          # write it down now; nothing stores it for you
sh backend/install.sh
```

4. That runs [`schema.sql`, `auth.sql`, `api.sql`, `views.sql`](backend/) in that order — the order is
   not a style, each depends on the one before — sets the password the server will connect with, and
   then **proves that `varmak_api` can actually sign in with it** rather than assuming so. It prints
   `varmak_api can sign in` when that worked. If it does not print that line, nothing else below will
   work; go to **If something refuses**.
5. **It ends with "nobody can sign in yet", and that is correct.** The system installs with no people
   in it at all. Step 12 is where that changes.

`install.sh` is safe to run again. Every file in it is written to be, and it says what it finds rather
than assuming: which schema `pgcrypto` is in, whether the roles already exist, whether the password
works.

## 4 · The server

6. **A small machine.** Any Debian or Ubuntu box with a public address: a 1 GB virtual machine is
   ample — this server holds no state, does no work the database could do, and the whole app is
   sixteen files. Point a DNS name at it.
7. **Node 20 or later, and the repository:**
   ```sh
   adduser --system --group varmak
   git clone https://github.com/chiplakovski/Workshop /opt/varmak-workshop
   cd /opt/varmak-workshop && npm install --omit=dev
   chown -R root:root /opt/varmak-workshop      # the service only ever reads it
   ```
8. **The environment**, which is where the database password lives and the only place it should:
   ```sh
   install -d -m 700 /etc/varmak
   install -m 600 -o root -g root deploy/varmak.env.example /etc/varmak/workshop.env
   $EDITOR /etc/varmak/workshop.env
   ```
   Put the connection string in with `postgres:` swapped for `varmak_api:` and the password from step 2.
   **Never the owner's.** The server refuses to start as the owning role, and it is right to: as the
   owner, every `GRANT` and every policy in `auth.sql` applies to nobody, and nothing would look wrong
   until a welder read a price.
9. **The certificate authority** from step 3, and `PGSSLROOTCERT` pointing at it:
   ```sh
   install -m 644 db-ca.crt /etc/varmak/db-ca.crt
   ```
   TLS to the database is always on and always verified; there is no setting for that. Any `?sslmode=`
   on the end of the connection string is stripped before use, because the value copied from a
   dashboard replaces the certificate check rather than adding to it.
10. **Run it as a service:**
    ```sh
    cp deploy/varmak-workshop.service /etc/systemd/system/
    systemctl daemon-reload && systemctl enable --now varmak-workshop
    systemctl status varmak-workshop
    ```
    It should say `Varmak Workshop on http://127.0.0.1:8787 — database db.xxxx.supabase.co`. If it
    refused to start, it said why in one sentence and the sentence is the instruction.

## 5 · HTTPS

11. **Caddy**, because it gets and renews the certificate itself and there is no cron job to forget in
    fourteen months:
    ```sh
    apt install caddy
    cp deploy/Caddyfile /etc/caddy/Caddyfile
    $EDITOR /etc/caddy/Caddyfile        # put your own name in place of workshop.example.se
    systemctl reload caddy
    ```
    Then open `https://your-name/` and you should see the sign-in page. The Node server is bound to
    127.0.0.1, so this is the only way in.

## 6 · The people

12. **The first administrator**, once, from the screen: open `https://your-name/admin.html`. The form
    is offered only while the system has nobody in it, and it shuts behind itself — a second use is
    refused by the database, not by the page.
13. **Everybody else** from the same screen. A person added there **cannot sign in yet** and the list
    says so: give them a PIN for the shop tablet or a password for their own phone. Two doors on
    purpose — the tablet is shared and a PIN is what somebody will actually type with gloves on; a
    password is for a device that belongs to one person.
14. **Their own password** they change themselves, from the same screen, by typing the old one.

## 7 · Backups, and the drill

15. **Supabase takes its own, and they are not enough on their own.** Measured rather than assumed: a
    `pg_dump` of this database carries around 500 `GRANT` statements and 94 row-level policies and
    **zero `CREATE ROLE`**, because roles live in the cluster and not in the database. Restore that
    dump alone onto a clean server and every one of those grants fails, because `varmak_workshop` does
    not exist there — and you are left with the data and none of the rules about who may read it,
    which is worse than no backup because you would trust it. So:
    ```sh
    DATABASE_URL='postgresql://postgres:OWNER-PASSWORD@db.xxxx.supabase.co:5432/postgres?sslmode=verify-full' \
    PGSSLROOTCERT=/path/to/prod-ca-2021.crt \
      sh backend/backup.sh /var/backups/varmak
    ```
    It writes two files and prints which one goes back first. Put it in cron weekly, keep a copy
    somewhere that is not that machine, and read
    [`backend/test-restore.js`](backend/test-restore.js) once — it restores a backup, compares all 41
    tables by a checksum of their contents rather than a row count, and then asks whether the copy
    still *refuses* what the original refused. A restore nobody has ever done is a hope.
16. **Do one now, before there is real data to lose**, so that the first time you restore this is not
    the day you need to.

## 8 · The first day's data

The system installs empty on purpose — no demonstration customers, no invented stock — so the first day is
data entry, and the order matters because the database refuses a record that points at nothing. Every step
here is a screen; none of it needs psql.

17. **The item groups and the locations are already there**, and they are the one thing that ships
    populated. They are a classification scheme rather than anything invented about this workshop — every
    metal shop sorts stock into materials, consumables, hardware and tooling and puts it on a shelf in a
    warehouse — and without them the first thing anybody must do is design a numbering scheme before
    entering a single bolt. **Rename or delete them freely** from Store; they are a starting point, not a
    decision.
18. **Customers before projects.** A project names a customer and the database will not accept one that
    does not exist. Customers → New Customer. The organisation number and the VAT number are worth
    entering as you go: they are on the invoice later and nobody enjoys chasing them afterwards.
19. **Suppliers before stock prices.** A merchant, then their contacts, then Items & Prices — which is one
    row per item per merchant, so buying the same plate from two suppliers keeps both. That register is the
    office's: a welder opening Suppliers sees the merchant, the address and who to ring, and a dash where
    the terms would be.
20. **Stock after the groups and the locations.** Store → an item can carry a group and a shelf, and the
    database does *not* insist on either — checked rather than assumed: `stock_item.group_id` and
    `location_id` are nullable. Fill them anyway. An item with no shelf is physical steel whose record has
    forgotten where it is, and the only person who finds out is the one walking the racks looking for it.
    Enter the stock you actually have; the first count is what every figure after it is measured against.
21. **The machines.** Machines → the register, with the certification dates. Those dates are not
    paperwork: the equipment gate refuses to start a job on a machine whose certification has run out, and
    it refuses out loud with the date in the message. A machine entered without them is a machine the gate
    cannot protect anybody from.
22. **Then work.** A project, its jobcards, the steps on each. Hours get booked against a step from the
    tablet or the desk, and the roll-up onto the jobcard and the project is the database's, not the
    screen's.
23. **The paperwork as it arrives.** Documents → file the certificate, give it its expiry date, and link it
    to the order, the project or the merchant it belongs to. The file itself has nowhere to go yet; the
    expiry date is the half that stops a delivery being signed off against a certificate that has run out.

**Nothing here has to be finished before the next thing starts.** A workshop can enter one customer, one
project and one jobcard and book hours against it on the first afternoon, then add stock and machines over
the following week. The only hard order is the one above: a record cannot point at something that is not
there yet.

---

## If something refuses

Each of these is a real failure with a real cause, found by running the install against a
hosted-shaped database rather than by imagining it.

| What it says | What it means |
|---|---|
| `VARMAK_API_PASSWORD is not set` | The server connects over a network and needs a password. The line to generate one is in the message. |
| `function gen_random_bytes(integer) does not exist` | `pgcrypto` is in a schema the install session cannot see. `auth.sql` sets the path from wherever the extension actually is, so this should not happen — if it does, the extension is missing entirely: `CREATE EXTENSION pgcrypto;` as the owner. |
| `varmak_engine cannot use schema extensions` | Exactly what it says, with the one line to run at the end of it. The schema belongs to a role you are not, so ask for `GRANT USAGE ON SCHEMA extensions TO varmak_engine;`. This refusal exists because the alternative was a `WARNING` nobody reads and a system nobody can sign in to. |
| `permission denied to alter role` | The role you are installing with cannot change role attributes at all, which means it has no `CREATEROLE`. On Supabase the `postgres` role has it; check with `SELECT rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = current_user;` |
| `must have BYPASSRLS to create a role with BYPASSRLS` | The same query. `varmak_engine` owns the four functions allowed to step around row security and has to be created with that attribute; if the owner role does not have it, no part of this can be installed and Supabase support is the next step. |
| `must be able to SET ROLE "varmak_engine"` | Fixed in `auth.sql`, which grants itself that membership. If you see it, you are running an older checkout. |
| `permission denied for schema public` | Also fixed: `CREATE` is granted for the ownership changes and taken back afterwards. Older checkout. |
| `Refusing to start: connecting as postgres rather than varmak_api` | The environment file has the owner's connection string in it. Swap the user and the password. |
| `self-signed certificate` from the server | `PGSSLROOTCERT` is not pointing at the database's certificate authority, or is pointing at the wrong one. Download it again from the project's dashboard. |
| A welder can see a price | Stop. Something is connecting as the wrong role. `SELECT current_user;` through the app is not possible by design, so check the environment file, and `npm run test:deploy` on the machine to see the same question asked and answered. |

## What is still not done

Written down because a deployment guide that implies everything works is worse than one that does not.

- **Every screen is on the database now**, which the earlier version of this list did not say — it said
  eight of sixteen were not. Kept as a note rather than deleted, because a deployment guide going stale
  is how somebody plans around a limit that has been gone for a month.
- **What a wired screen still cannot write, it refuses out loud** rather than putting it in the browser,
  which is the outcome that looks like it worked and is gone on the next machine. Today that list is:
  estimating's nested work items, options, terms and revisions; the invoice arriving from a supplier and
  the enquiry before a purchase order; purchase orders; marketing campaigns; the outward prospect sweep;
  the quality register's ITP, CAPA and dossier; document folders; and the bytes of any file.

  The four welding registers came off this list: the weld log, the NDT against those welds, the procedures
  and the welder qualifications are tables now, with their rules in the database, and the Quality screen
  writes all four.
- **The estimating half of Project / Estimator writes nothing**, on purpose: that screen holds work
  items in nested groups, options, terms, revisions and a priced bill of materials, and the `estimate`
  table holds a title, a total and a date. Quoting stays on paper or in the browser-storage app until
  that gap is real work rather than a mapping.
- **Invoicing out is deliberately not here, and what replaces it is.** This was called the largest single
  gap in the schema; the decision taken was that it is not a gap in that direction. Varmak issues its
  invoices from its accounting system, and a second place that knows what a customer owes is two places
  that disagree. What this system provides instead is the **invoice basis**, on the Reports screen under
  *What To Invoice*: hours booked and material issued, per project, per line, with dates, exported as CSV.
  No invoice number, no VAT, nothing stored, and no labour amount — no hourly rate is recorded anywhere
  here, which is the accounting system's to apply. The **incoming** half is still absent: a supplier's
  invoice against a purchase order has no table.
- **The document register works; the files do not.** A certificate's expiry date, its revision and which
  job it belongs to are all on the database and a welder can read them. The scan itself has nowhere to
  go until there is object storage, and the screen says so at the point somebody attaches one.
- **The letterhead has no organisation number and no VAT number.** The printed offer carries the firm's
  name, address and email. A Swedish offer is expected to carry both numbers, and an invoice also needs
  *Godkänd för F-skatt* and a bankgiro or IBAN. Nothing has been guessed at — supply them and they go in
  beside the address.
- **The pages fetch their typefaces from `fonts.googleapis.com`**, which will not arrive on a tablet in
  a steel hall with no internet. The pages work; they look wrong. Self-hosting the fonts is a small job
  and is not done.
- **There is no service worker**, so a tablet has to load the page while it has a connection. Once it
  is loaded, booking hours survives losing the signal — the entry is kept on the tablet and sent when
  the line comes back — but a tablet that is restarted out of range cannot open the app at all.
- **Photographs, printing and two suppliers' prices for one item** have nowhere to go yet. See
  [`REVIEW.md`](REVIEW.md), which lists what is missing and why each one matters.
