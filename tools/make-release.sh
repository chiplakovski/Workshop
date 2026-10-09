#!/bin/sh
# Builds the copy that goes onto a server: what runs, and nothing that only develops or tests it.
#
#   sh tools/make-release.sh [output-directory]
#
# Exported with `git archive` from the committed tree, so nothing that exists only on this machine
# can end up in it — no node_modules, no scratch files, no uncommitted edits. Refuses to run with
# uncommitted changes for the same reason: the package has to be a commit, by its hash.
#
# Left out on purpose: tests/ (and the invented test workshop in tests/fixtures), tools/, the test
# and mutation suites in backend/, the developer notes (HANDOVER, BACKEND, REVIEW, APP-SPEC, THEMES)
# and the dev-only scripts. The server would never serve any of them — it serves only files sitting
# directly in the site directory — but a copy for a server should not carry them at all.
set -e
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing: there are uncommitted changes. A release has to be a commit." >&2
  exit 1
fi

OUT=${1:-dist}
SHA=$(git rev-parse --short HEAD)
DAY=$(git log -1 --format=%cd --date=format:%Y-%m-%d)
NAME="varmak-workshop-$DAY-$SHA"
STAGE="$OUT/$NAME"
# Guarded so an empty variable stops the script instead of widening the removal.
rm -rf "${OUT:?}/${NAME:?}" "${OUT:?}/${NAME:?}.zip"
mkdir -p "$STAGE"

# What the server serves, what it runs, how the database is installed, and how hosts start it.
git archive HEAD \
  $(git ls-files '*.html' '*.css' | grep -v /) \
  $(git ls-files '*.js' | grep -v /) \
  backend/server.js \
  backend/schema.sql backend/auth.sql backend/api.sql backend/views.sql \
  backend/supabase-install.sql backend/supabase-password.sql backend/supabase-check.sql \
  backend/install.sh backend/preflight.sh backend/backup.sh \
  deploy \
  package.json package-lock.json .nvmrc Procfile railway.json render.yaml \
  DEPLOY.md SUPABASE.md \
  | tar -x -C "$STAGE"

# The scripts a server needs: start it, install the database. The rest of package.json's scripts
# run test suites that are not in this copy. Dependencies are left exactly as they are, because
# `npm ci` refuses a package.json that no longer matches its lockfile.
node -e '
  const fs = require("fs"), f = process.argv[1];
  const p = JSON.parse(fs.readFileSync(f, "utf8"));
  p.scripts = { start: p.scripts.start, "install:db": p.scripts["install:db"] };
  fs.writeFileSync(f, JSON.stringify(p, null, 2) + "\n");
' "$STAGE/package.json"

cat > "$STAGE/INSTALL.md" <<EOF
# Varmak Workshop — server copy

Built from commit \`$SHA\` ($DAY). This is everything the system needs to run, and nothing else:
no tests, no developer tools, no example or invented records. It starts empty.

## What is in it

| Where | What |
|---|---|
| \`*.html\`, \`*.js\`, \`workshop-ui.css\` | the 17 screens and the code they share |
| \`backend/server.js\` | the server — it serves the screens and talks to the database |
| \`backend/supabase-install.sql\` | the whole database in one file, for Supabase's SQL editor |
| \`backend/supabase-password.sql\` | sets the server's database password (the one file you edit) |
| \`backend/supabase-check.sql\` | checks the install worked; reads only |
| \`backend/schema.sql\` … \`views.sql\`, \`install.sh\`, \`preflight.sh\`, \`backup.sh\` | the same install from a terminal, and backups |
| \`Procfile\`, \`railway.json\`, \`render.yaml\`, \`.nvmrc\` | so Railway, Render or Fly know how to start it |
| \`deploy/\` | for running it on your own machine behind Caddy |
| \`SUPABASE.md\` | the database, click by click (Macedonian) |
| \`DEPLOY.md\` | the full runbook (English) |

## Installing

1. **Database** — follow \`SUPABASE.md\`: paste \`supabase-install.sql\`, then \`supabase-password.sql\`, then \`supabase-check.sql\`.
2. **Server** — on a host (Railway, Render): give it this folder and set one value, \`DATABASE_URL\`.
   Do not set \`HOST\`. On your own machine:
   \`\`\`
   npm ci --omit=dev
   DATABASE_URL='postgresql://varmak_api.xxxx:PASSWORD@….pooler.supabase.com:5432/postgres' npm start
   \`\`\`
   It needs Node 20 or later.
3. **First administrator** — open \`/admin.html\` on the running server and make yourself the administrator.

The server refuses to start if \`DATABASE_URL\` has no password or connects as the database owner —
that is deliberate, and the message says which.
EOF

( cd "$OUT" && zip -qr "$NAME.zip" "$NAME" )
echo "$OUT/$NAME.zip"
echo "$(find "$STAGE" -type f | wc -l) files, $(du -sh "$OUT/$NAME.zip" | cut -f1)"
