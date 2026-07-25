#!/usr/bin/env bash
# T8 (E2, grep-lint): verifier prompt template carries the reading restriction and
# challenge-by-default instruction.
# Pass criteria (delivery/epics-build-it-v2.md): contains the reading restriction
# (only DoD + report + evidence.md; never the implementation conversation) and
# instructs challenge-by-default.
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
F="$REPO/plugins/build-it/skills/build-it/SKILL.md"
fail=0

[ -f "$F" ] || { echo "FAIL: $F missing"; exit 1; }

grep -qi "ONLY" "$F" && grep -q "evidence.md" "$F" || { echo "FAIL: no ONLY/evidence.md"; fail=1; }

# reading restriction: the three permitted inputs named together, plus the conversation ban
if grep -qi "read ONLY.*DoD.*report.*evidence\.md" "$F"; then
  echo "ok: reading restriction lists exactly DoD + report + evidence.md"
else
  echo "FAIL: reading restriction (ONLY DoD + report + evidence.md) not found on one line"; fail=1
fi
if grep -qi "never.*implementation conversation" "$F"; then
  echo "ok: implementation-conversation ban present"
else
  echo "FAIL: 'never ... implementation conversation' missing"; fail=1
fi
if grep -qi "challenge by default" "$F"; then
  echo "ok: challenge-by-default instruction present"
else
  echo "FAIL: challenge-by-default missing"; fail=1
fi

if [ $fail -eq 0 ]; then echo "T8 PASS"; else echo "T8 FAIL"; exit 1; fi
