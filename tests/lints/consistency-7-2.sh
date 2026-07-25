#!/usr/bin/env bash
# CONTRACT §7.2 consistency lint:
#   1. No duplicated CDP core text (delegates to T17).
#   2. No /launch interactive gate reachable from an unattended conductor run.
#   3. One report verdict (iterate/full-qa are feeders; conductor report is the verdict).
#   4. No stale "Make Opus behave like Fable" claim outside history/changelog
#      (docs/research + delivery planning docs are the historical record).
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$DIR/../.." && pwd)"
fail=0

# 1 — CDP dedup
"$DIR/t17-cdp-dedup.sh" >/dev/null && echo "ok(§7.2-1): CDP core single-sourced" || { echo "FAIL(§7.2-1): CDP duplication"; fail=1; }

# 2 — unattended runs cannot hit an interactive gate
L="$REPO/plugins/build-it/skills/launch/SKILL.md"
C="$REPO/plugins/build-it/skills/build-it/SKILL.md"
grep -q "unattended mode" "$C" && grep -qi "never waited on" "$C" || { echo "FAIL(§7.2-2): conductor does not force unattended /launch"; fail=1; }
p2=$(awk '/^## Phase 2/,/^## Phase 3/' "$L"); p4=$(awk '/^### 4.2/,/^### 4.3/' "$L")
echo "$p2" | grep -qi "unattended" && echo "$p4" | grep -qi "unattended" \
  && echo "ok(§7.2-2): no interactive gate reachable unattended (both gates conditioned; conductor invokes unattended)" \
  || { echo "FAIL(§7.2-2): an approval gate lacks the unattended branch"; fail=1; }

# 3 — one report verdict
grep -qi "feeder" "$REPO/plugins/build-it/skills/iterate/SKILL.md" \
  && grep -qi "never stands as a second" "$REPO/plugins/build-it/skills/full-qa/SKILL.md" \
  && grep -qi "single verdict source" "$C" \
  && echo "ok(§7.2-3): one verdict source, loop reports are feeders" \
  || { echo "FAIL(§7.2-3): competing report verdicts"; fail=1; }

# 4 — stale claim sweep (shipped surfaces: skills, plugin metadata, READMEs)
stale=$(grep -rn "Make Opus behave like Fable" "$REPO/README.md" "$REPO/SKILL.md" "$REPO/plugins" "$REPO/.claude-plugin" 2>/dev/null || true)
if [ -z "$stale" ]; then
  echo "ok(§7.2-4): no stale v1-only claim on shipped surfaces"
else
  echo "FAIL(§7.2-4): stale claim:"; echo "$stale"; fail=1
fi

if [ $fail -eq 0 ]; then echo "CONSISTENCY §7.2 PASS"; else echo "CONSISTENCY §7.2 FAIL"; exit 1; fi
