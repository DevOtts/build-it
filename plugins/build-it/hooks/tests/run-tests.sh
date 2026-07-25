#!/usr/bin/env bash
# E7 unit tests — T21 (evidence-lint) and T22 (turn-end-gate).
# Each case builds a fixture dir, pipes hook-shaped stdin JSON, asserts behavior.
set -u
HOOKS="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0

assert() { # name, condition-result ($?==0)
  if [ "$2" -eq 0 ]; then echo "ok: $1"; else echo "FAIL: $1"; fail=1; fi
}

########################################
# T22 — turn-end-gate.py
########################################
mk_t22() { # dir, final_text, dod_content
  local d="$TMP/$1"; mkdir -p "$d/.taskstate"
  python3 - "$d/transcript.jsonl" "$2" <<'PY'
import json, sys
path, text = sys.argv[1], sys.argv[2]
with open(path, "w") as f:
    f.write(json.dumps({"type": "user", "message": {"content": "go"}}) + "\n")
    f.write(json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}}) + "\n")
PY
  printf '%s\n' "$3" > "$d/.taskstate/dod.md"
  printf '{"transcript_path": "%s", "stop_hook_active": false}' "$d/transcript.jsonl" > "$d/stdin.json"
}

# (a) promise + unfinished DoD -> blocked with bounce
mk_t22 t22a "All three endpoints are wired.

I'll continue tomorrow." "- [x] endpoint A
- [ ] endpoint B"
out=$(cd "$TMP/t22a" && python3 "$HOOKS/turn-end-gate.py" < stdin.json); rc=$?
echo "$out" | grep -q '"decision": "block"' && echo "$out" | grep -qi "promise" && [ $rc -eq 0 ]
assert "T22a: promise + unfinished DoD is blocked with bounce message" $?

# (b) same text + all DoD done -> allowed
mk_t22 t22b "All three endpoints are wired.

I'll continue tomorrow." "- [x] endpoint A
- [x] endpoint B"
out=$(cd "$TMP/t22b" && python3 "$HOOKS/turn-end-gate.py" < stdin.json); rc=$?
[ -z "$out" ] && [ $rc -eq 0 ]
assert "T22b: promise with all DoD done is allowed" $?

# (c) honest BLOCKED report + unfinished DoD -> allowed (valid terminal state)
mk_t22 t22c "Endpoint B could not be finished.

Status: BLOCKED — the staging credentials expired and only Fernando can rotate them." "- [x] endpoint A
- [ ] endpoint B"
out=$(cd "$TMP/t22c" && python3 "$HOOKS/turn-end-gate.py" < stdin.json); rc=$?
[ -z "$out" ] && [ $rc -eq 0 ]
assert "T22c: honest BLOCKED terminal state is allowed" $?

########################################
# T21 — evidence-lint.py
########################################
mk_t21() { # dir, report_content, ledger_content
  local d="$TMP/$1"; mkdir -p "$d/.taskstate" "$d/.build-it-reports"
  printf '%s\n' "$3" > "$d/.taskstate/evidence.md"
  python3 - "$d" "$2" <<'PY'
import json, sys, os
d, report = sys.argv[1], sys.argv[2]
payload = {"tool_name": "Write", "tool_input": {"file_path": os.path.join(d, ".build-it-reports", "report.md"), "content": report}}
with open(os.path.join(d, "stdin.json"), "w") as f:
    json.dump(payload, f)
PY
}

# (a) VERIFIED + empty evidence cell -> rejected with named row
mk_t21 t21a "| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | webhook writes row | VERIFIED |  |" "# ledger
(nothing)"
out=$(cd "$TMP/t21a" && python3 "$HOOKS/evidence-lint.py" < stdin.json); rc=$?
echo "$out" | grep -q '"permissionDecision": "deny"' && echo "$out" | grep -q "webhook writes row" && [ $rc -eq 0 ]
assert "T21a: VERIFIED with empty evidence is rejected, row named" $?

# (b) VERIFIED + matching ledger entry -> passes
mk_t21 t21b "| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | webhook writes row | VERIFIED | \`SELECT count(*) FROM events\` returned 1 |" "# ledger
### Criterion 1 · 2026-07-02 · SELECT count(*) FROM events WHERE source='webhook-test' → PASS
> 1"
out=$(cd "$TMP/t21b" && python3 "$HOOKS/evidence-lint.py" < stdin.json); rc=$?
[ -z "$out" ] && [ $rc -eq 0 ]
assert "T21b: VERIFIED with matching ledger entry passes" $?

# (c) hook made to crash (garbage stdin) -> fail-open: exit 0, error logged
d="$TMP/t21c"; mkdir -p "$d/.taskstate"
out=$(cd "$d" && echo "this is not json {" | python3 "$HOOKS/evidence-lint.py"); rc=$?
[ $rc -eq 0 ] && grep -q "ERROR (fail-open)" "$d/.taskstate/hooks.log"
assert "T21c: crashing hook fails open (exit 0) and logs the error" $?

# same fail-open property for the turn-end gate
d="$TMP/t22d"; mkdir -p "$d/.taskstate"
out=$(cd "$d" && echo "garbage" | python3 "$HOOKS/turn-end-gate.py"); rc=$?
[ $rc -eq 0 ] && grep -q "ERROR (fail-open)" "$d/.taskstate/hooks.log"
assert "T22d(bonus): turn-end gate fails open on garbage input" $?

########################################
if [ $fail -eq 0 ]; then echo "ALL HOOK TESTS PASS"; else echo "HOOK TESTS FAIL"; exit 1; fi
