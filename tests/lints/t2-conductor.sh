#!/usr/bin/env bash
# T2 (E1, grep-lint): conductor gates catalog + claim-grounding co-occurrence + line budget.
# Pass criteria (delivery/epics-build-it-v2.md):
#   1. Every VERIFIED mention co-occurs with the ledger-lookup rule (evidence/ledger
#      reference within a ±2-line window).
#   2. All 5 gates present, each with trigger + test + action.
#   3. File <= 330 lines.
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
F="$REPO/plugins/build-it/skills/build-it/SKILL.md"
fail=0

[ -f "$F" ] || { echo "FAIL: $F missing"; exit 1; }

# --- 3. line budget
lines=$(wc -l < "$F" | tr -d ' ')
if [ "$lines" -le 330 ]; then
  echo "ok: line count $lines <= 330"
else
  echo "FAIL: line count $lines > 330"; fail=1
fi

# --- 2. five gates, each carrying trigger/test/action on its catalog line(s)
for gate in "Turn-end gate" "Claim gate" "State-change gate" "Phase-boundary gate" "Delegation gate"; do
  # the catalog line for the gate must contain trigger, test and action markers
  if grep -i "$gate" "$F" | grep -qi "trigger:" ; then
    line=$(grep -i "$gate" "$F" | grep -i "trigger:")
    if echo "$line" | grep -qi "test:" && echo "$line" | grep -qi "action:"; then
      echo "ok: $gate has trigger+test+action"
    else
      echo "FAIL: $gate catalog line lacks test:/action:"; fail=1
    fi
  else
    echo "FAIL: $gate has no catalog line with trigger:"; fail=1
  fi
done

# --- 1. every VERIFIED mention co-occurs with evidence/ledger within +/-2 lines
awk '
  { lines[NR] = $0 }
  END {
    bad = 0
    for (i = 1; i <= NR; i++) {
      if (lines[i] ~ /VERIFIED/) {
        found = 0
        for (j = i - 2; j <= i + 2; j++) {
          if (j >= 1 && j <= NR && tolower(lines[j]) ~ /evidence|ledger/) { found = 1; break }
        }
        if (!found) { printf("FAIL: VERIFIED without evidence/ledger nearby at line %d: %s\n", i, lines[i]); bad = 1 }
      }
    }
    exit bad
  }' "$F" || fail=1
[ $fail -eq 0 ] && echo "ok: all VERIFIED mentions co-occur with ledger-lookup context"

if [ $fail -eq 0 ]; then echo "T2 PASS"; else echo "T2 FAIL"; exit 1; fi
