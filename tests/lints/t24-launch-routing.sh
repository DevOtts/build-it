#!/usr/bin/env bash
# T24 (E3, grep-lint): launch/SKILL.md team templates reference the canonical tier
# table shipped with the plugin (references/model-tiers.md — no divergent copy);
# default-inherit and escalate-on-struggle rules present; no remaining ad-hoc
# model labels outside the routing rule. v2.1: canonical home moved from
# docs/03-enhancement-spec.md §4.1 (which does not ship) into the plugin.
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
F="$REPO/plugins/build-it/skills/launch/SKILL.md"
T="$REPO/plugins/build-it/skills/references/model-tiers.md"
fail=0
[ -f "$F" ] || { echo "FAIL: $F missing"; exit 1; }

# canonical table ships with the plugin
if [ -f "$T" ] && grep -qi "escalate on struggle" "$T"; then
  echo "ok: canonical tier table ships with the plugin (incl. escalation gate)"
else
  echo "FAIL: plugins/build-it/skills/references/model-tiers.md missing or lacks the escalation gate"; fail=1
fi

# reference to the canonical table (and no stale pointer to the non-shipping spec)
if grep -q "references/model-tiers.md" "$F"; then
  echo "ok: references canonical tier table (references/model-tiers.md)"
else
  echo "FAIL: no reference to references/model-tiers.md tier table"; fail=1
fi
if grep -q "03-enhancement-spec.md" "$F"; then
  echo "FAIL: stale reference to docs/03-enhancement-spec.md (does not ship with the plugin)"; fail=1
else
  echo "ok: no stale spec reference"
fi

# escalate-on-struggle present in the routing rule
if grep -qi "escalate on struggle" "$F"; then
  echo "ok: escalate-on-struggle rule present"
else
  echo "FAIL: escalate-on-struggle rule missing"; fail=1
fi

# no divergent copy: the table's distinctive row markers must not be duplicated here
if grep -qi "error-amplifying\|mechanical, low-ambiguity, high-volume" "$F"; then
  echo "FAIL: tier table appears copied into launch (drift risk)"; fail=1
else
  echo "ok: no copied tier table"
fi

# default-inherit rule present
if grep -qi "default.*inherit" "$F"; then
  echo "ok: default-inherit rule present"
else
  echo "FAIL: default-inherit rule missing"; fail=1
fi

# no ad-hoc model labels (the v1 pattern was "(Model: Sonnet/Opus)" / "([Model])")
adhoc=$(grep -n "(Model:\|(\[Model\])" "$F" || true)
if [ -z "$adhoc" ]; then
  echo "ok: no ad-hoc model labels"
else
  echo "FAIL: ad-hoc model labels remain:"; echo "$adhoc"; fail=1
fi

if [ $fail -eq 0 ]; then echo "T24 PASS"; else echo "T24 FAIL"; exit 1; fi
