#!/usr/bin/env bash
# T16 (E4, grep-lint): iterate + full-qa — evidence.md append rule present in both;
# no-silent-caps section in both report templates; full-qa verdict maps to the DoD
# table (no standalone second verdict).
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
IT="$REPO/plugins/build-it/skills/iterate/SKILL.md"
QA="$REPO/plugins/build-it/skills/full-qa/SKILL.md"
fail=0
for f in "$IT" "$QA"; do [ -f "$f" ] || { echo "FAIL: $f missing"; exit 1; }; done

for f in "$IT" "$QA"; do
  n=$(basename "$(dirname "$f")")
  if grep -q "evidence.md" "$f" && grep -qi "append" "$f"; then
    echo "ok: $n has evidence.md append rule"
  else
    echo "FAIL: $n missing evidence.md append rule"; fail=1
  fi
  if grep -qi "no silent caps\|no-silent-caps" "$f"; then
    echo "ok: $n report has no-silent-caps section"
  else
    echo "FAIL: $n missing no-silent-caps"; fail=1
  fi
done

# full-qa verdict maps onto the conductor's DoD table, no standalone verdict
if grep -qi "maps onto the DoD table\|maps onto the conductor" "$QA" && grep -qi "feeder" "$QA"; then
  echo "ok: full-qa verdict declared a feeder mapping onto the DoD table"
else
  echo "FAIL: full-qa verdict not mapped to DoD table / feeder missing"; fail=1
fi
if grep -qi "feeder" "$IT"; then
  echo "ok: iterate report declared a feeder"
else
  echo "FAIL: iterate feeder declaration missing"; fail=1
fi

if [ $fail -eq 0 ]; then echo "T16 PASS"; else echo "T16 FAIL"; exit 1; fi
