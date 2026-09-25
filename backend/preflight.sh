#!/bin/sh
# Will the install work on this database? Asked before anything is written to it.
#
#   DATABASE_URL=postgres://... sh backend/preflight.sh
#   sh backend/preflight.sh                              the local cluster, for comparison
#
# install.sh is careful and re-runnable, but it finds out about a wrong database halfway through — after
# the tables and before the ownership changes, which is a database that looks installed and is not. Every
# one of the checks below is a real failure this deployment path has already had, and each was found only
# by the install stopping on it:
#
#   * A role that is not a superuser and also has no CREATEROLE cannot make the five roles at all.
#   * `public` grants no CREATE from PostgreSQL 15 on, so the ownership changes are refused after
#     everything else has gone in.
#   * pgcrypto in a schema of its own, which a column default is parsed against as the table is created.
#   * A URL with no sslmode, which connects and is not verified — a password sent to whoever answered.
#
# It writes nothing and creates nothing. It is safe to run against a database that is already installed,
# and says so when it is.
set -e

FAIL=0
WARN=0
say()  { printf '  %s\n' "$1"; }
ok()   { printf '  ok      %s\n' "$1"; }
warn() { printf '  warn    %s\n' "$1"; WARN=$((WARN+1)); }
bad()  { printf '  REFUSED %s\n' "$1"; FAIL=$((FAIL+1)); }

if [ -n "$DATABASE_URL" ]; then
  PSQL="psql $DATABASE_URL"
  WHERE=$(printf '%s' "$DATABASE_URL" | sed 's|://[^@]*@|://…@|')
  REMOTE=yes
else
  PSQL="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-5433} -U ${PGUSER:-postgres} -d ${PGDATABASE:-varmak}"
  WHERE="${PGHOST:-/tmp}/${PGDATABASE:-varmak}"
  REMOTE=no
fi
# Trimmed at the ends only. `tr -d ' '` was the first version and it turned the server version into
# "16.13(Ubuntu16.13-...)" — a value with a space inside it is still one value.
ask() { $PSQL -qtAX -c "$1" 2>/dev/null | head -1 | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'; }

echo "Preflight for $WHERE"
echo ""

# ── 1 · The client ────────────────────────────────────────────────────────────────────────────
if command -v psql >/dev/null 2>&1; then
  ok "psql is here — $(psql --version | awk '{print $3}')"
else
  bad "psql is not on this machine. The install is four psql runs; there is no way round it."
  echo ""; echo "Refusing: $FAIL check(s) failed."; exit 1
fi

# ── 2 · Does it answer at all ─────────────────────────────────────────────────────────────────
if [ "$(ask 'SELECT 1')" = "1" ]; then
  ok "the database answers"
else
  bad "cannot connect. Run the same URL through psql by hand to see what it says."
  echo ""; echo "Refusing: $FAIL check(s) failed."; exit 1
fi

VERSION=$(ask 'SHOW server_version_num')
if [ "$VERSION" -ge 130000 ] 2>/dev/null; then
  ok "PostgreSQL $(ask 'SHOW server_version')"
else
  bad "PostgreSQL $(ask 'SHOW server_version') — the schema uses generated columns and needs 13 or later."
fi

# ── 3 · Is the connection actually encrypted, and verified ────────────────────────────────────
#
# Two different questions. `pg_stat_ssl` says whether this connection is encrypted; nothing the server
# can tell you says whether the client checked who it was talking to. That is sslmode, and only
# verify-full checks the hostname as well as the certificate.
if [ "$REMOTE" = yes ]; then
  if [ "$(ask 'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()')" = "t" ]; then
    ok "the connection is encrypted"
  else
    bad "this connection is NOT encrypted. The owner's password is crossing the network in the clear."
  fi
  MODE=$(printf '%s' "$DATABASE_URL" | sed -n 's/.*[?&]sslmode=\([a-z-]*\).*/\1/p')
  [ -n "$MODE" ] || MODE="${PGSSLMODE:-}"
  case "$MODE" in
    verify-full) ok "sslmode=verify-full — the certificate and the hostname are both checked" ;;
    verify-ca)   warn "sslmode=verify-ca checks the certificate but not the hostname. verify-full is one word more." ;;
    require)     bad "sslmode=require encrypts and verifies nothing: it accepts any certificate from anybody who answers. Use verify-full." ;;
    "")          bad "no sslmode is set, so libpq will take whatever it is offered. Use verify-full." ;;
    *)           bad "sslmode=$MODE is not good enough for a password. Use verify-full." ;;
  esac
  if [ "$MODE" = verify-full ] || [ "$MODE" = verify-ca ]; then
    ROOT="${PGSSLROOTCERT:-}"
    if [ -z "$ROOT" ]; then
      ROOT=$(printf '%s' "$DATABASE_URL" | sed -n 's/.*[?&]sslrootcert=\([^&]*\).*/\1/p')
    fi
    if [ -n "$ROOT" ] && [ -r "$ROOT" ]; then
      ok "the certificate authority is readable — $ROOT"
    elif [ -n "$ROOT" ]; then
      bad "PGSSLROOTCERT points at $ROOT, which cannot be read."
    else
      warn "no PGSSLROOTCERT. verify-full will fall back to ~/.postgresql/root.crt, which may not be the database's CA."
    fi
  fi
else
  say "local socket — TLS does not apply, and neither does anything below about passwords"
fi

# ── 4 · Can this role do what the install does ────────────────────────────────────────────────
WHO=$(ask 'SELECT current_user')
say "connected as $WHO"
if [ "$(ask "SELECT rolsuper::text FROM pg_roles WHERE rolname = current_user")" = "true" ]; then
  ok "a superuser, so nothing below can refuse"
else
  if [ "$(ask "SELECT rolcreaterole::text FROM pg_roles WHERE rolname = current_user")" = "true" ]; then
    ok "CREATEROLE — the five roles can be made"
  else
    bad "$WHO has neither superuser nor CREATEROLE. The install makes five roles and cannot start."
  fi
  if [ "$(ask "SELECT has_schema_privilege(current_user, 'public', 'CREATE')::text")" = "true" ]; then
    ok "CREATE on schema public — the tables and the functions can be made"
  else
    bad "no CREATE on schema public. From PostgreSQL 15 that is not granted by default: GRANT ALL ON SCHEMA public TO $WHO;"
  fi
  if [ "$(ask "SELECT rolbypassrls::text FROM pg_roles WHERE rolname = current_user")" = "true" ]; then
    ok "BYPASSRLS — the installer can read its own tables back to check them"
  else
    warn "no BYPASSRLS. The install should still work; the checks it runs on its own work may not."
  fi
fi

# ── 5 · pgcrypto, and where it lives ──────────────────────────────────────────────────────────
#
# `app_session.token` defaults to encode(gen_random_bytes(32),'hex'), and a column default is parsed as
# the table is created — so this one stops the install three tables in rather than at the end.
SCHEMA=$(ask "SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pgcrypto'")
if [ -n "$SCHEMA" ]; then
  ok "pgcrypto is installed, in schema $SCHEMA"
  if [ "$(ask "SELECT has_schema_privilege(current_user, '$SCHEMA', 'USAGE')::text")" = "true" ]; then
    ok "and this role may use it"
  else
    bad "pgcrypto is in $SCHEMA and $WHO has no USAGE on that schema."
  fi
elif [ "$(ask "SELECT count(*) FROM pg_available_extensions WHERE name = 'pgcrypto'")" = "1" ]; then
  warn "pgcrypto is available but not installed. install.sh will create it; that needs the right to."
else
  bad "pgcrypto is neither installed nor available. Passwords and session tokens both need it."
fi

# ── 6 · Encoding, because this system holds Swedish and Macedonian ────────────────────────────
ENC=$(ask 'SHOW server_encoding')
if [ "$ENC" = "UTF8" ]; then
  ok "server encoding UTF8"
else
  bad "server encoding is $ENC. Every name on every screen is Swedish or Macedonian; this must be UTF8."
fi

# ── 7 · Is it already installed ───────────────────────────────────────────────────────────────
MINE=$(ask "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('app_user','project','jobcard','weld','document')")
if [ "$MINE" = "0" ]; then
  ok "an empty database — this will be a first install"
elif [ "$MINE" = "5" ]; then
  say "this system is already installed here. install.sh is safe to run again; it will say what it finds."
else
  bad "$MINE of the 5 tables looked for are here, so this database is half installed. Restore a backup or start a new database; do not install over it."
fi

# ── 8 · The one thing install.sh needs that nothing can check for you ─────────────────────────
if [ "$REMOTE" = yes ]; then
  if [ -n "$VARMAK_API_PASSWORD" ]; then
    ok "VARMAK_API_PASSWORD is set — the server's own password"
  else
    warn "VARMAK_API_PASSWORD is not set. install.sh will refuse: VARMAK_API_PASSWORD=\$(openssl rand -base64 32)"
  fi
fi

echo ""
if [ "$FAIL" -gt 0 ]; then
  echo "Refusing: $FAIL check(s) failed, $WARN warning(s). Nothing was written."
  exit 1
fi
if [ "$WARN" -gt 0 ]; then
  echo "Clear to install, with $WARN warning(s) above worth reading first."
else
  echo "Clear to install."
fi
echo "Next: VARMAK_API_PASSWORD=... sh backend/install.sh"
