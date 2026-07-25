# build-it hardened mode (optional hooks)

Prose gates are the baseline on every host. On Claude Code you can additionally
**opt in** to mechanical enforcement of the two most load-bearing gates. Both hooks
are fail-open (any script error allows the action and logs it — they never brick a
run), log every firing to `.taskstate/hooks.log`, and can be disabled with one line:
`export BUILD_IT_HOOKS_DISABLED=1` (the legacy `FABLE_IT_HOOKS_DISABLED=1` is still honored).

| Hook | Event | What it enforces |
|---|---|---|
| `turn-end-gate.py` | `Stop` | Final paragraph is a promise/plan ("I'll …", "Next I will …", "Let me know when …") while `.taskstate/dod.md` shows unfinished criteria → stop is blocked with a bounce message: execute the promise or report BLOCKED. An honest BLOCKED report is a valid terminal state and always allowed. |
| `evidence-lint.py` | `PreToolUse` (Write\|Edit) | Writing `.build-it-reports/report.md` with any row marked VERIFIED whose evidence cell is empty or matches nothing in `.taskstate/evidence.md` → the write is rejected, naming the offending rows. |

## Opt-in (add deliberately to your settings)

Add to `.claude/settings.json` (project) or `~/.claude/settings.json` (global),
replacing `<PLUGIN_ROOT>` with the absolute path to `plugins/build-it`:

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "python3 <PLUGIN_ROOT>/hooks/turn-end-gate.py" } ] }
    ],
    "PreToolUse": [
      { "matcher": "Write|Edit", "hooks": [ { "type": "command", "command": "python3 <PLUGIN_ROOT>/hooks/evidence-lint.py" } ] }
    ]
  }
}
```

Remove those entries (or set `BUILD_IT_HOOKS_DISABLED=1`) to turn hardened mode off.

## The `dod.md` convention

The turn-end gate needs a machine-readable DoD state. Hardened-mode runs maintain
`.taskstate/dod.md` as a checkbox list, one line per DoD criterion:

```markdown
- [x] 1. API returns 200 on /health
- [ ] 2. Backfill writes 30 days of rows
```

If the file is absent the gate cannot know the DoD state and allows the stop
(fail-open by design).

## Tests

```bash
plugins/build-it/hooks/tests/run-tests.sh
```

Covers the E7 test contract: T21 (evidence lint: empty-evidence rejection with named
row, matching-entry pass, crash → fail-open + logged) and T22 (turn-end gate:
promise + unfinished DoD blocked, all-done allowed, honest BLOCKED allowed).

---
_Part of the build-it plugin · authored by [DevOtts](https://github.com/DevOtts)._
