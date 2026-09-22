#!/bin/sh
# Back the workshop up, in the two pieces it actually takes.
#
# pg_dump of the database is not a backup of this system. Measured, not assumed: a dump of
# varmak carries 497 GRANT statements and 72 row-level policies, and zero CREATE ROLE — because
# roles live in the cluster, not in the database. Restore that dump into a fresh server and every one
# of those 497 lines fails, because varmak_workshop does not exist there. You would be left with the
# data and none of the rules about who may read it, which is worse than no backup: you would trust it.
#
# So two files, always, and the restore instructions below use both.
#
#   sh backend/backup.sh [directory]
#
# Writes <directory>/varmak-<timestamp>.roles.sql and .dump. Default directory: ./backups
set -e

DIR=${1:-./backups}
HOST=${PGHOST:-/tmp}
PORT=${PGPORT:-5433}
USER=${PGUSER:-postgres}
DB=${PGDATABASE:-varmak}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

mkdir -p "$DIR"
ROLES="$DIR/varmak-$STAMP.roles.sql"
DATA="$DIR/varmak-$STAMP.dump"

# The roles, with their memberships and attributes. --no-role-passwords keeps the hashed passwords
# out of the file: a backup that carries the API role's password is a backup that hands over the
# database to whoever finds the file, and the password is set once at deploy time anyway.
pg_dumpall -h "$HOST" -p "$PORT" -U "$USER" --roles-only --no-role-passwords \
  | grep -E 'varmak_|^--|^$' > "$ROLES"

# The database itself, in the custom format so pg_restore can be selective and parallel.
pg_dump -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" --format=custom --file="$DATA"

echo "Roles: $ROLES  ($(wc -l < "$ROLES" | tr -d ' ') lines)"
echo "Data:  $DATA  ($(du -h "$DATA" | cut -f1))"
echo ""
echo "To restore onto a clean server, in this order:"
echo "  psql -h HOST -U postgres -d postgres -f $ROLES"
echo "  createdb -h HOST -U postgres varmak"
echo "  pg_restore -h HOST -U postgres -d varmak $DATA"
echo ""
echo "The roles file goes FIRST. Without it the data restores and every GRANT in it fails,"
echo "leaving a database anybody can read. backend/test-restore.js proves this round trip."
