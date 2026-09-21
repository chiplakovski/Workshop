#!/bin/sh
# Start the throwaway Postgres these tests run against, or say it is already up.
#
# In a container this dies whenever the container is restarted, which happens often enough that
# retyping the pg_ctl line got tedious. Nothing here is specific to this project beyond the port.
set -e
PGD=${PGDATA:-/var/lib/postgresql/varmak}
PORT=${PGPORT:-5433}

if psql -h /tmp -p "$PORT" -U postgres -qtAX -c 'SELECT 1' >/dev/null 2>&1; then
  echo "Postgres already up on $PORT."
  exit 0
fi

if [ ! -d "$PGD" ]; then
  echo "Creating a data directory at $PGD"
  install -d -o postgres -g postgres "$PGD"
  su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $PGD --auth=trust -U postgres" >/dev/null
fi

su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGD \
  -o '-k /tmp -p $PORT -c listen_addresses=' -l $PGD/server.log start -w -t 30" >/dev/null
echo "Postgres up on $PORT."
