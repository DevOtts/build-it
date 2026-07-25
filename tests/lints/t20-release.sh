#!/usr/bin/env bash
# T20a/b/c (E6, grep-lints): degraded-mode coverage, rebrand + sources, release metadata.
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
ROOT="$REPO/SKILL.md"
COND="$REPO/plugins/build-it/skills/build-it/SKILL.md"
RM="$REPO/README.md"
PJ="$REPO/plugins/build-it/.claude-plugin/plugin.json"
MJ="$REPO/.claude-plugin/marketplace.json"
fail=0

########################################
# T20a — root SKILL.md vs conductor catalog (section diff)
########################################
for gate in "Turn-end gate" "Claim gate" "State-change gate" "Phase-boundary gate" "Delegation gate"; do
  if grep -qi "$gate" "$ROOT" && grep -qi "$gate" "$COND"; then
    line=$(grep -i "$gate" "$ROOT" | grep -i "trigger:" | head -1)
    if echo "$line" | grep -qi "test:" && echo "$line" | grep -qi "action:"; then
      echo "ok(T20a): $gate in root with trigger+test+action"
    else
      echo "FAIL(T20a): $gate in root lacks trigger/test/action"; fail=1
    fi
  else
    echo "FAIL(T20a): $gate missing from root or conductor"; fail=1
  fi
done
for f in grounding.md decisions.md evidence.md run-memory.md; do
  grep -q "$f" "$ROOT" && echo "ok(T20a): run-state file $f present in root" || { echo "FAIL(T20a): $f missing in root"; fail=1; }
done
grep -qi "only if.*evidence.md\|ledger lookup" "$ROOT" && echo "ok(T20a): claim rule present" || { echo "FAIL(T20a): claim rule missing"; fail=1; }
grep -qi "setting aside the implementation context" "$ROOT" && echo "ok(T20a): degraded verifier protocol present" || { echo "FAIL(T20a): degraded verifier missing"; fail=1; }
# zero Claude-Code-only mechanics inside the mechanics region (gates -> Install)
mech=$(awk '/^## The gates/,/^## Install/' "$ROOT")
cc=$(echo "$mech" | grep -ni "claude code\|subagent\|slash command\|settings.json\|hooks" || true)
if [ -z "$cc" ]; then
  echo "ok(T20a): degraded mechanics are host-agnostic"
else
  echo "FAIL(T20a): Claude-Code-only mechanics in degraded path:"; echo "$cc"; fail=1
fi

########################################
# T20b — README + root SKILL.md rebrand, sources, corrected claim
########################################
grep -q "plan-it plans it, build-it builds it" "$RM" && echo "ok(T20b): README tagline" || { echo "FAIL(T20b): README tagline missing"; fail=1; }
grep -q "plan-it plans it, build-it builds it" "$ROOT" && echo "ok(T20b): root SKILL tagline" || { echo "FAIL(T20b): root tagline missing"; fail=1; }
stale=$(grep -rn "Make your model behave like Fable" "$RM" "$ROOT" || true)
[ -z "$stale" ] && echo "ok(T20b): no stale v2/v3.0 tagline" || { echo "FAIL(T20b): stale fable-era tagline:"; echo "$stale"; fail=1; }
stale=$(grep -rn "Make Opus behave like Fable" "$RM" "$ROOT" || true)
[ -z "$stale" ] && echo "ok(T20b): no stale v1 tagline" || { echo "FAIL(T20b): stale tagline:"; echo "$stale"; fail=1; }
if grep -q "runs%20on-Opus-blueviolet" "$RM"; then
  echo "FAIL(T20b): stale runs-on-Opus-only badge"; fail=1
else
  grep -qi "Sonnet%205\|Sonnet 5" "$RM" && grep -qi "Opus%204.8\|Opus 4.8" "$RM" && echo "ok(T20b): Sonnet 5 + Opus 4.8 badges/claims" || { echo "FAIL(T20b): model badges missing"; fail=1; }
fi
grep -qi "## Sources" "$RM" && grep -q "docs/research/01-fable5-vs-opus.md" "$RM" && grep -q "docs/research/02-gap-analysis.md" "$RM" \
  && echo "ok(T20b): SOURCES section links research 01 + 02" || { echo "FAIL(T20b): SOURCES section incomplete"; fail=1; }
grep -qi "prompt-induced" "$RM" && echo "ok(T20b): corrected honest-reporting row (prompt-induced on Fable too)" || { echo "FAIL(T20b): corrected row missing"; fail=1; }

########################################
# T20c — plugin.json + marketplace.json
########################################
# version pins derive from the CHANGELOG's latest entry (no per-release lint edit)
V=$(sed -n 's/^## \[\([0-9][0-9.]*\)\].*/\1/p' "$REPO/CHANGELOG.md" | head -1)
[ -n "$V" ] || { echo "FAIL(T20c): no version found in CHANGELOG.md"; fail=1; }
grep -q "\"version\": \"$V\"" "$PJ" && echo "ok(T20c): plugin.json $V (matches CHANGELOG)" || { echo "FAIL(T20c): plugin.json version != CHANGELOG $V"; fail=1; }
grep -q "\"version\": \"$V\"" "$MJ" && echo "ok(T20c): marketplace.json $V (matches CHANGELOG)" || { echo "FAIL(T20c): marketplace.json version != CHANGELOG $V"; fail=1; }
for f in "$PJ" "$MJ"; do
  grep -qi "Sonnet 5" "$f" && grep -qi "Opus" "$f" && echo "ok(T20c): $(basename "$f") description mentions Sonnet 5 + Opus" || { echo "FAIL(T20c): $(basename "$f") description models"; fail=1; }
done

if [ $fail -eq 0 ]; then echo "T20 PASS"; else echo "T20 FAIL"; exit 1; fi
