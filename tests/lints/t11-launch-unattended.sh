#!/usr/bin/env bash
# T11 (E3, grep-lint): launch/SKILL.md — conditioned interactive gates, unattended
# path documented, build templates carry no-refactor + pass-requires-evidence,
# D9 state-location rule stated exactly once.
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
F="$REPO/plugins/build-it/skills/launch/SKILL.md"
fail=0
[ -f "$F" ] || { echo "FAIL: $F missing"; exit 1; }

# interactive gates wrapped in a direct-invocation condition (both gates)
p2=$(awk '/^## Phase 2/,/^## Phase 3/' "$F")
p4=$(awk '/^### 4.2/,/^### 4.3/' "$F")
for name in "Phase 2" "Phase 4.2"; do :; done
if echo "$p2" | grep -qi "direct human" && echo "$p2" | grep -qi "unattended"; then
  echo "ok: Phase 2 gate conditioned on invocation mode"
else
  echo "FAIL: Phase 2 gate not conditioned"; fail=1
fi
if echo "$p4" | grep -qi "direct human" && echo "$p4" | grep -qi "unattended"; then
  echo "ok: Phase 4.2 gate conditioned on invocation mode"
else
  echo "FAIL: Phase 4.2 gate not conditioned"; fail=1
fi

# unattended path documented (a dedicated mode section)
if grep -qi "invocation modes" "$F" && grep -q "decisions.md" "$F"; then
  echo "ok: unattended mode documented with decisions.md logging"
else
  echo "FAIL: unattended mode not documented"; fail=1
fi

# build templates: no-unrequested-refactor snippet + pass-requires-evidence rule
if grep -qi "no unrequested refactor" "$F"; then
  echo "ok: no-unrequested-refactor snippet present"
else
  echo "FAIL: no-refactor snippet missing"; fail=1
fi
if grep -qi 'only with.*evidence' "$F" && grep -qi 'is not evidence' "$F"; then
  echo "ok: pass-requires-evidence rule present"
else
  echo "FAIL: pass-requires-evidence rule missing"; fail=1
fi

# D9 stated exactly once (the full rule statement; later mentions must be
# pointers like "per the state location rule", not restatements), no stale
# .claude/ state references
count=$(grep -c "State location rule (D9" "$F")
restate=$(grep -ci "NEVER save to .claude\|requires extra permission prompts\|requires permission prompts" "$F")
if [ "$count" -eq 1 ] && [ "$restate" -le 1 ]; then
  echo "ok: state-location rule stated exactly once (pointers defer to it)"
else
  echo "FAIL: rule statement count=$count (want 1), restatement markers=$restate (want <=1, the canonical one)"; fail=1
fi
stale=$(grep -n "\.claude/features\|\.claude/progress" "$F" || true)
if [ -z "$stale" ]; then
  echo "ok: no stale .claude/ state paths"
else
  echo "FAIL: stale .claude/ state paths:"; echo "$stale"; fail=1
fi

if [ $fail -eq 0 ]; then echo "T11 PASS"; else echo "T11 FAIL"; exit 1; fi
