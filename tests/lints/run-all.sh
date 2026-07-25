#!/usr/bin/env bash
# build-it v2 — run every scripted lint + the hook unit tests. Green = ship-ready
# per CONTRACT §7 (lint half; tabletop goldens and [REAL] cases are judged separately).
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$DIR/../.." && pwd)"
fail=0
for s in "$DIR"/t*.sh "$DIR/consistency-7-2.sh"; do
  name=$(basename "$s")
  if out=$("$s" 2>&1); then
    echo "PASS  $name"
  else
    echo "FAIL  $name"; echo "$out" | sed 's/^/      /'; fail=1
  fi
done
if out=$("$REPO/plugins/build-it/hooks/tests/run-tests.sh" 2>&1); then
  echo "PASS  hooks/tests/run-tests.sh"
else
  echo "FAIL  hooks/tests/run-tests.sh"; echo "$out" | sed 's/^/      /'; fail=1
fi
[ $fail -eq 0 ] && echo "ALL LINTS + UNIT TESTS GREEN" || { echo "LINT SUITE FAIL"; exit 1; }
