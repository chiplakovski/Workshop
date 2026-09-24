# Putting this into service

For Varmak AB, Lagmansgatan 31, 241 71 Marieholm. Sixteen steps, and at the end of them the workshop
is running on a real database with real data and nobody has to open psql again.

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

## 2 · Install the schema

On any machine with `psql` and this repository checked out:

```sh
export DATABASE_URL='postgresql://postgres:OWNER-PASSWORD@db.xxxxxxxxxxxx.supabase.co:5432/postgres'
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

## 3 · The server

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

## 4 · HTTPS

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

## 5 · The people

12. **The first administrator**, once, from the screen: open `https://your-name/admin.html`. The form
    is offered only while the system has nobody in it, and it shuts behind itself — a second use is
    refused by the database, not by the page.
13. **Everybody else** from the same screen. A person added there **cannot sign in yet** and the list
    says so: give them a PIN for the shop tablet or a password for their own phone. Two doors on
    purpose — the tablet is shared and a PIN is what somebody will actually type with gloves on; a
    password is for a device that belongs to one person.
14. **Their own password** they change themselves, from the same screen, by typing the old one.

## 6 · Backups, and the drill

15. **Supabase takes its own, and they are not enough on their own.** Measured rather than assumed: a
    `pg_dump` of this database carries around 500 `GRANT` statements and 74 row-level policies and
    **zero `CREATE ROLE`**, because roles live in the cluster and not in the database. Restore that
    dump alone onto a clean server and every one of those grants fails, because `varmak_workshop` does
    not exist there — and you are left with the data and none of the rules about who may read it,
    which is worse than no backup because you would trust it. So:
    ```sh
    DATABASE_URL='postgresql://postgres:OWNER-PASSWORD@db.xxxx.supabase.co:5432/postgres' \
      sh backend/backup.sh /var/backups/varmak
    ```
    It writes two files and prints which one goes back first. Put it in cron weekly, keep a copy
    somewhere that is not that machine, and read
    [`backend/test-restore.js`](backend/test-restore.js) once — it restores a backup, compares all 34
    tables by a checksum of their contents rather than a row count, and then asks whether the copy
    still *refuses* what the original refused. A restore nobody has ever done is a hope.
16. **Do one now, before there is real data to lose**, so that the first time you restore this is not
    the day you need to.

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

- **Eight of the sixteen screens are not on the database yet.** Wired: the shop-floor hours screen,
  Access, Customers, Jobcards, Store, and the project half of Project / Estimator. The rest refuse to
  show a signed-in session anything at all, and say why, rather than showing figures that are not the
  workshop's. They still work for a browser with no session.
- **The estimating half of Project / Estimator writes nothing**, on purpose: that screen holds work
  items in nested groups, options, terms, revisions and a priced bill of materials, and the `estimate`
  table holds a title, a total and a date. Quoting stays on paper or in the browser-storage app until
  that gap is real work rather than a mapping.
- **The pages fetch their typefaces from `fonts.googleapis.com`**, which will not arrive on a tablet in
  a steel hall with no internet. The pages work; they look wrong. Self-hosting the fonts is a small job
  and is not done.
- **There is no service worker**, so a tablet has to load the page while it has a connection. Once it
  is loaded, booking hours survives losing the signal — the entry is kept on the tablet and sent when
  the line comes back — but a tablet that is restarted out of range cannot open the app at all.
- **Photographs, printing and two suppliers' prices for one item** have nowhere to go yet. See
  [`REVIEW.md`](REVIEW.md), which lists what is missing and why each one matters.
