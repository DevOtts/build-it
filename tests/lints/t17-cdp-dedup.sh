#!/usr/bin/env bash
# T17 (E5, grep-lint): CDP core deduplicated across the whole plugin.
# Pass criteria (delivery/epics-build-it-v2.md):
#   1. Selector ladder + CDP action template appear in exactly one file (the core).
#   2. Other skills reference the core file.
#   3. No `9222` outside the core file's default declaration lines.
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PLUGIN="$REPO/plugins/build-it"
CORE="$PLUGIN/skills/references/cdp-core.md"
fail=0

[ -f "$CORE" ] || { echo "FAIL: core file $CORE missing"; exit 1; }

# --- 1a. selector ladder (get_by_role marker) in exactly one plugin file
ladder_files=$(grep -rl "get_by_role" "$PLUGIN" | sort)
if [ "$ladder_files" = "$CORE" ]; then
  echo "ok: selector ladder only in cdp-core.md"
else
  echo "FAIL: selector ladder found in: $ladder_files"; fail=1
fi

# --- 1b. CDP action template (connect_over_cdp marker) in exactly one plugin file
tmpl_files=$(grep -rl "connect_over_cdp" "$PLUGIN" | sort)
if [ "$tmpl_files" = "$CORE" ]; then
  echo "ok: CDP action template only in cdp-core.md"
else
  echo "FAIL: connect_over_cdp found in: $tmpl_files"; fail=1
fi

# --- 2. both consumer skills reference the core
for s in chrome-cdp-control full-qa; do
  if grep -q "references/cdp-core.md" "$PLUGIN/skills/$s/SKILL.md"; then
    echo "ok: $s references cdp-core.md"
  else
    echo "FAIL: $s does not reference cdp-core.md"; fail=1
  fi
done

# --- 3. no 9222 outside the core's default-declaration lines
stray=$(grep -rn "9222" "$PLUGIN" | grep -v "^$CORE:" || true)
if [ -z "$stray" ]; then
  echo "ok: no 9222 outside cdp-core.md"
else
  echo "FAIL: hardcoded 9222 outside core:"; echo "$stray"; fail=1
fi
in_core_bad=$(grep -n "9222" "$CORE" | grep -vi "default" || true)
if [ -z "$in_core_bad" ]; then
  echo "ok: every 9222 in cdp-core.md sits on a default-declaration line"
else
  echo "FAIL: 9222 in core off the default declaration:"; echo "$in_core_bad"; fail=1
fi

if [ $fail -eq 0 ]; then echo "T17 PASS"; else echo "T17 FAIL"; exit 1; fi
