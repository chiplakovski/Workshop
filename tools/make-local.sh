#!/bin/sh
# Builds the copy that runs on one PC with no server and no installation: one HTML file, opened by
# double-clicking it, plus a short guide. Records stay in that PC's browser.
#
#   sh tools/make-local.sh [output-directory]
#
# Built from the committed tree (git archive), never from files that exist only on this machine, and
# refuses to run with uncommitted changes: the file has to be a commit, by its hash.
set -e
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing: there are uncommitted changes. The local copy has to be a commit." >&2
  exit 1
fi

OUT=${1:-dist}
SHA=$(git rev-parse --short HEAD)
DAY=$(git log -1 --format=%cd --date=format:%Y-%m-%d)
NAME="varmak-workshop-local-$DAY-$SHA"
STAGE="$OUT/$NAME"
SITE="$OUT/$NAME.site"
# Guarded so an empty variable stops the script instead of widening the removal.
rm -rf "${OUT:?}/${NAME:?}" "${OUT:?}/${NAME:?}.site" "${OUT:?}/${NAME:?}.zip"
mkdir -p "$STAGE" "$SITE"

git archive HEAD $(git ls-files '*.html' '*.css' '*.js' | grep -v /) | tar -x -C "$SITE"
node tools/make-local.js "$SITE" "$STAGE/Varmak-Workshop.html"
rm -rf "${SITE:?}"
# For Notepad on Windows: a byte-order mark so the Cyrillic is read as UTF-8, and CRLF line ends.
{ printf '\357\273\277'; cat tools/local-readme.txt; printf '\nBuilt from commit %s (%s).\n' "$SHA" "$DAY"; } \
  | sed 's/$/\r/' > "$STAGE/README.txt"

(cd "$OUT" && zip -qr "$NAME.zip" "$NAME")
echo "Built $OUT/$NAME.zip"
