#!/usr/bin/env python3
"""build-it hardened mode — evidence lint (Claude Code PreToolUse hook on Write|Edit).

When the final report is written, rejects any DoD row marked VERIFIED whose
evidence cell is empty or has no matching entry in .taskstate/evidence.md.
Fail-open: any script error allows the write and logs to .taskstate/hooks.log.
One-line disable: BUILD_IT_HOOKS_DISABLED=1 (legacy FABLE_IT_HOOKS_DISABLED=1 also honored).
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

LOG_PATH = os.path.join(".taskstate", "hooks.log")


def log(msg):
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a") as f:
            f.write("%s [evidence-lint] %s\n" % (datetime.now(timezone.utc).isoformat(), msg))
    except Exception:
        pass


def is_report_write(file_path):
    return os.path.basename(file_path) == "report.md" and ".build-it-reports" in file_path


def verified_rows(content):
    """Yield (row_label, evidence_cell) for table rows whose status cell is VERIFIED
    (exactly — IMPLEMENTED-NOT-VERIFIED does not count)."""
    for line in content.splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3:
            continue
        if any(c == "VERIFIED" for c in cells):
            yield (" | ".join(cells[:2]), cells[-1])


def has_matching_entry(evidence_cell, ledger_text):
    """A cell matches if some significant fragment of it appears in the ledger."""
    cell = evidence_cell.strip().strip("`").strip()
    if not cell:
        return False
    fragments = re.findall(r"[^,;`\"'()\[\]]{12,}", cell)
    for frag in fragments:
        if frag.strip() and frag.strip() in ledger_text:
            return True
    # fall back: any word of >= 8 chars shared
    return any(w in ledger_text for w in re.findall(r"\S{8,}", cell))


def main():
    if os.environ.get("BUILD_IT_HOOKS_DISABLED") == "1" or os.environ.get("FABLE_IT_HOOKS_DISABLED") == "1":
        return
    data = json.load(sys.stdin)
    tool_input = data.get("tool_input", {})
    file_path = tool_input.get("file_path", "")
    content = tool_input.get("content", "") or tool_input.get("new_string", "")
    if not is_report_write(file_path):
        return
    ledger_path = os.path.join(".taskstate", "evidence.md")
    ledger_text = ""
    if os.path.exists(ledger_path):
        with open(ledger_path) as f:
            ledger_text = f.read()
    bad = []
    for label, cell in verified_rows(content):
        if not cell or not has_matching_entry(cell, ledger_text):
            bad.append(label)
    if bad:
        reason = (
            "Evidence lint (build-it hardened mode): report rejected — these rows "
            "are marked VERIFIED with an empty evidence cell or no matching entry "
            "in .taskstate/evidence.md: %s. VERIFIED is a ledger lookup: append the "
            "real tool result to the ledger, or demote the row to "
            "IMPLEMENTED-NOT-VERIFIED." % "; ".join(bad)
        )
        log("DENY report write: rows=%s" % bad)
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        }))
        return
    log("allow report write: all VERIFIED rows matched the ledger")


if __name__ == "__main__":
    try:
        main()
        sys.exit(0)
    except Exception as e:  # fail-open: never brick a run
        log("ERROR (fail-open): %r" % e)
        sys.exit(0)
