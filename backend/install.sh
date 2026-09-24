#!/bin/sh
# Put this system into a database that does not have it yet, in the order the files depend on.
#
# The four files are not interchangeable and the order is not a style: schema.sql makes the tables,
# auth.sql makes the roles and the policies over those tables, api.sql makes the workflows, views.sql
# makes what the screens read. Running them in any other order fails on a missing dependency, which
# is the good case — the bad case is a half-installed database that looks finished.
#
#   sh backend/install.sh                          a local database (socket in /tmp, port 5433)
#   DATABASE_URL=postgres://... sh backend/install.sh   a hosted one
#
# The URL here is the OWNER's connection — on Supabase that is the `postgres` user from the project's
# connection settings — because this creates roles and tables. It is not the URL the server runs with:
# that one is varmak_api, and it can do none of this.
#
# VARMAK_API_PASSWORD sets the password the server will connect with. It is required for a hosted
# database and refused for a local socket, because a password on a trust-authenticated socket is a
# password that exists only to be left in a shell history.
set -e

HERE=$(dirname "$0")

if [ -n "$DATABASE_URL" ]; then
  PSQL="psql $DATABASE_URL"
  WHERE=$(printf '%s' "$DATABASE_URL" | sed 's|://[^@]*@|://…@|')
  REMOTE=yes
else
  PSQL="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-5433} -U ${PGUSER:-postgres} -d ${PGDATABASE:-varmak}"
  WHERE="${PGHOST:-/tmp}/${PGDATABASE:-varmak}"
  REMOTE=no
fi

if [ "$REMOTE" = yes ] && [ -z "$VARMAK_API_PASSWORD" ]; then
  echo "Refusing to install: VARMAK_API_PASSWORD is not set." >&2
  echo "" >&2
  echo "The server connects as varmak_api, and over a network that needs a password. Generate one" >&2
  echo "and keep it wherever the server's environment lives — not in this repository:" >&2
  echo "" >&2
  echo "  VARMAK_API_PASSWORD=\$(openssl rand -base64 32) sh backend/install.sh" >&2
  exit 1
fi

echo "Installing into $WHERE"

# pgcrypto lives wherever the database put it, and on a managed database that is usually a schema of
# its own rather than public. Everything that hashes a PIN or a password calls crypt() and gen_salt()
# from it, so a search_path that cannot see that schema is a system where nobody can sign in — and it
# fails at the first sign-in rather than here, which is the worst possible place to find out. Asked
# now, and the answer is printed whether it is good news or not.
EXTSCHEMA=$($PSQL -qtAX -c "SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pgcrypto';" 2>/dev/null | head -1 | tr -d ' ')

for f in schema auth api views; do
  echo "  $f.sql"
  $PSQL -v ON_ERROR_STOP=1 -q -f "$HERE/$f.sql"
done

if [ -n "$VARMAK_API_PASSWORD" ]; then
  # Through a psql variable rather than in the SQL text, so the password does not end up in a log of
  # statements or in this file. ALTER ROLE takes a literal and not a parameter, so the literal is built
  # by the database's own quoting (format %L) and run by \gexec — which has to arrive on standard input,
  # because psql does not read meta-commands from -c.
  echo "  setting the varmak_api password"
  $PSQL -v ON_ERROR_STOP=1 -q -v pw="$VARMAK_API_PASSWORD" > /dev/null <<'SQL'
SELECT format('ALTER ROLE varmak_api LOGIN PASSWORD %L', :'pw')
\gexec
SQL
fi

# Nothing above proves the server can actually get in, and that is the only question that matters at
# the end of an install. Asked as varmak_api itself, with the password just set, over the same kind of
# connection the server will use.
if [ -n "$VARMAK_API_PASSWORD" ] && [ "$REMOTE" = yes ]; then
  APIURL=$(printf '%s' "$DATABASE_URL" | sed "s|://[^:]*:[^@]*@|://varmak_api:$VARMAK_API_PASSWORD@|")
  if PGCONNECT_TIMEOUT=10 psql "$APIURL" -qtAX -c "SELECT 1;" > /dev/null 2>&1; then
    echo "  varmak_api can sign in"
  else
    echo "Installed, but varmak_api could not connect with that password." >&2
    echo "Check that the hosted database allows password logins for it, and that the host in" >&2
    echo "DATABASE_URL is one varmak_api may reach." >&2
    exit 1
  fi
fi

echo ""
if [ -n "$EXTSCHEMA" ] && [ "$EXTSCHEMA" != "public" ]; then
  echo "pgcrypto is in schema '$EXTSCHEMA', not public. The roles were given a search_path that"
  echo "includes it (auth.sql does this), so signing in works — but if you ever add a role by hand,"
  echo "it needs the same."
  echo ""
fi
echo "Installed. Nobody can sign in yet: open /admin.html and make the first administrator."
