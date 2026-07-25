#!/usr/bin/env python3
"""build-it hardened mode — turn-end gate (Claude Code Stop hook).

Blocks ending a turn whose final paragraph is a promise/plan pattern while
.taskstate/dod.md still shows unfinished DoD criteria. BLOCKED is a valid
terminal state, not a promise. Fail-open: any script error allows the stop and
logs to .taskstate/hooks.log. One-line disable: BUILD_IT_HOOKS_DISABLED=1 (legacy FABLE_IT_HOOKS_DISABLED=1 also honored).
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

PROMISE_PATTERNS = [
    r"\bI['’]ll\b",
    r"\bI will\b",
    r"\bnext,? I( am going to| will|['’]ll)\b",
    r"\blet me know when\b",
    r"\bI['’]m going to\b",
    r"\btomorrow\b",
    r"\bnext steps?\b",
]

LOG_PATH = os.path.join(".taskstate", "hooks.log")


def log(msg):
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a") as f:
            f.write("%s [turn-end-gate] %s\n" % (datetime.now(timezone.utc).isoformat(), msg))
    except Exception:
        pass


def last_assistant_text(transcript_path):
    text = None
    with open(transcript_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if entry.get("type") != "assistant":
                continue
            msg = entry.get("message", {})
            content = msg.get("content")
            if isinstance(content, str):
                text = content
            elif isinstance(content, list):
                parts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
                if parts:
                    text = "\n".join(parts)
    return text or ""


def dod_unfinished():
    """DoD state per the hardened-mode convention: .taskstate/dod.md is a
    checkbox list, one line per criterion. Missing file -> unknown -> fail-open."""
    path = os.path.join(".taskstate", "dod.md")
    if not os.path.exists(path):
        return False
    with open(path) as f:
        return "- [ ]" in f.read()


def main():
    if os.environ.get("BUILD_IT_HOOKS_DISABLED") == "1" or os.environ.get("FABLE_IT_HOOKS_DISABLED") == "1":
        return
    data = json.load(sys.stdin)
    if data.get("stop_hook_active"):
        return  # never loop on our own bounce
    text = last_assistant_text(data["transcript_path"])
    if not text:
        return
    last_para = [p for p in re.split(r"\n\s*\n", text.strip()) if p.strip()][-1]
    if re.search(r"\bBLOCKED\b", last_para):
        log("allow: final paragraph reports BLOCKED (honest terminal state)")
        return
    is_promise = any(re.search(p, last_para, re.IGNORECASE) for p in PROMISE_PATTERNS)
    if is_promise and dod_unfinished():
        reason = (
            "Turn-end gate (build-it hardened mode): the final paragraph is a "
            "promise/plan but .taskstate/dod.md shows unfinished DoD criteria. "
            "Execute the promised work now with tool calls, or report BLOCKED "
            "with the reason. Never end a turn on a promise."
        )
        log("BLOCK: promise pattern in final paragraph + unfinished DoD")
        print(json.dumps({"decision": "block", "reason": reason}))
        return
    log("allow: promise=%s dod_unfinished=%s" % (is_promise, dod_unfinished()))


if __name__ == "__main__":
    try:
        main()
        sys.exit(0)
    except Exception as e:  # fail-open: never brick a run
        log("ERROR (fail-open): %r" % e)
        sys.exit(0)
