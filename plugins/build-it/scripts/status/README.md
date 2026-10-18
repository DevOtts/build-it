# status-write: the single writer for `status.json` (schema 1)

Zero dependencies, Node 18+. One copy lives here; other plugins call it by path (decision D-01).
Models never hand-edit `status.json` and never write a percent. The percent, counts, blocked list and stale flag are computed by `status-lib.mjs` (`computeView`).

Files: `status-lib.mjs` (importable lib), `status-write.mjs` (CLI), `status.schema.json` (JSON Schema 2020-12), `status-render.mjs` (STATUS.md, separate task), `status-migrate.mjs` (separate task), `recheck.mjs` (re-check helpers, R-1).

## Usage

```
status-write init   --file F --plan plan.json --by plan-it [--merge]
status-write set    <TASK> --status S [--evidence P] [--blocked-on TEXT] [--note TEXT] [--owner TEXT] --by ROLE --file F
status-write piece  <PIECE> [--status S] [--blocked-on TEXT] [--whats-left TEXT] --by build-it --file F
status-write rename <TASK> --title T --by plan-it --file F        (refused past not-started)
status-write remove <TASK> --by plan-it --file F                  (refused past not-started)
status-write session add --session-id ID --alias A --name N --role R --by init-it [--create] --file F
status-write session end --session-id ID --by init-it|conclude-it --file F
status-write close  --by conclude-it [--owner-note TEXT] [--end-sessions] [--move] --file F
status-write reopen --by conclude-it --note TEXT --file F
status-write validate --file F
status-write view     --file F [--json]
status-write render   --file F [--out P] [--force]
status-write recheck  --file F [--task ID] [--timeout 60s] [--fresh]
```

`--file` may be replaced by env `DOIT_STATUS_FILE` or `--impl <name>` (resolves `docs/implementations/<name>/status.json`, then the singular `docs/implementation/<name>/`).
`plan.json`: `{ implementation, title?, waves:[{id,title,tasks:[{id,title,check?}]}], pieces:[{piece, whats_left?}] }`.
`check` (optional, R-1): `{ kind: "command", command: "<shell command>", cases?: [ids], unchecked?: [{case,reason}] }` or `{ kind: "none", reason?, unchecked? }`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | invalid, or refused by a rule (role, evidence, missing note, frozen, forbidden key). The file is left byte-identical, with no lock or tmp residue. |
| 2 | usage error, or `init` on an existing file |
| 3 | lock or concurrency failure (lock not acquired in about 5 s, or 3 failed re-apply retries) |
| 4 | `recheck` only: at least one check ran (or was served from the cache) and FAILED or timed out. The result is recorded. |

## Rules enforced

- `--by` is required on mutating commands. Roles: plan-it (init, rename/remove not-started), build-it (not-started, in-progress, blocked, done, owner, pieces), review-it (verified, in-progress), conclude-it (close, reopen, session end, verified carry-forward), init-it (session add/end).
- Every transition into `done` or `verified` (`set --status done|verified`) must carry an explicit `--evidence`; without it the write is refused (exit 1, file byte-identical). Evidence already stored on the task is never reused, so a task sent back by review-it cannot return to done/verified on the verdict from before the failure. A note-only `set` does not touch evidence.
- `done` needs evidence: repo-relative, no `..`, no symlink out of the repo, a regular non-empty file with non-whitespace content, under the implementation folder or a `.taskstate/` dir. `blocked` needs `--blocked-on`.
- `verified` additionally needs a review-it verdict file: it contains `review-it`, the task id, and a `verdict: PASS` (or `result: VERIFIED`) line.
- Lowering `verified` needs `--note`. `init` (and `init --merge` for tasks it adds) appends a `created` entry per new task: `{from: not-started, to: not-started, by: plan-it, note: created}`. Every status change appends `history` `{at, task, from, to, by, note}`. `updated_at` comes from the clock.
- Forbidden keys (`percent`, `counts`, `computed`, `blocked_list`, `stale`) are rejected naming the key. Unknown other keys are preserved.
- After `close` the file is frozen until `reopen`. Lock: `status.json.lock` (`wx`, stale after 30 s or when the holder pid is dead). Write: tmp, fsync, rename. Test hook `STATUS_WRITE_TEST_CRASH=after-tmp` exits 137 before the rename (test-only).
- After each successful write `status-render.mjs` (if installed) re-renders STATUS.md, only when the target is absent or starts with the generated marker line. Hand-written boards are never overwritten (`render --force` overrides).
- `validate` also flags hand edits: any non-`not-started` task whose last history entry does not match its status.
- `validate` also checks history integrity (ST-08): every `by` is a known role (or `migration`), only review-it/conclude-it move a task to `verified`, lowering from `verified` carries a note, each task's entries chain (`from` equals the previous `to`), a task reset to `not-started` by hand or deleted from the waves while it has history is flagged (`remove` records a `removed` entry), `closed` must match the last `*` entry, `migration` entries need `approximate: true` and may only precede writer entries, and timestamps may not lie in the future. Forbidden keys are matched in any letter case at any depth. Pieces follow the task role rules (`verified` only by review-it/conclude-it, `blocked` needs `--blocked-on`, lowering `verified` needs `--note`).
- Evidence may not be (or resolve through a symlink to) `status.json`, its `.tmp`/`.lock`, or `STATUS.md`, in any letter case. A verdict file is refused when any `verdict:`/`result:` line is not PASS/VERIFIED, or when its `task:` lines name another task. After `close --move`, evidence paths under the old folder are mapped into `0-done/<name>`.
- `view` prints `INVALID` with the errors and exits 1 when the file fails validation; `render` refuses an invalid file.
- Residual risk: `--by` cannot authenticate the caller. It is a guardrail, not a security boundary. Anyone who can run the writer as review-it, or write a verdict-shaped file plus a matching history entry by hand, can still fake `verified`; deleting a never-started task together with nothing else is not detectable from the file alone.

## Verified is a claim

The writer cannot authenticate `--by`, and there are no signing keys: any key on the machine is readable by the same agent. So readers never present `verified` as proof. `view`, `view --json` (`claims[]`) and the rendered STATUS.md label the count `verified N (claims)` and list, for each verified task, who claimed it, the verdict path, when, and a short sha256 of the verdict file as it reads now. If the sha changes, the verdict was edited after the claim.

## Re-check: run the Test Contract on demand (R-1)

A claim depends on trusting the verdict file. A re-check does not: it runs the task's check command again and records what happened. There is no secret and no signing key.

- **Where the command comes from.** plan-it writes `<impl dir>/plan.json` with a `check` per task (a command only for mechanical Test Contract cases; owner-gated, judgement, live and prod cases get `kind: "none"`). That file is committed with the package. `recheck` reads it with `git show HEAD:<impl dir>/plan.json`, so only a committed command counts; an uncommitted edit of the working copy is ignored (and reported on stderr).
- **status.json carries a copy only.** `init` copies each plan task's `check` into the task. After that, no write may add, change or drop it: `set --check` is refused, every non-init write that would change a check is refused, and `init --merge` may replace a check only while the task is still `not-started`, or fill one in where the task has none yet (a board from before checks existed); changing an existing check of started work is refused, so a re-plan cannot quietly swap the proof. If the copy in status.json differs from the committed plan (a hand edit), `recheck` refuses (exit 1, file byte-identical) and runs nothing.
- **What a run records.** The command runs through the shell in the repo root with a timeout (default 60 s, `--timeout 500ms|60s|2m`; the whole process group is killed on timeout). Each run appends to `rechecks[]`: `{at, task, sha (HEAD), dirty, plan_blob, command_sha, result: pass|fail|timeout, exit, signal, timeout_ms, duration_ms, stdout_sha, tail}` (`tail` is the last 300 characters of output, failures only). The latest 10 entries per task are kept.
- **Cache.** Keyed by (task, git sha, command). Same sha and same command reuses the last result and runs nothing. A new commit is a miss. A result taken on a dirty tree (tracked changes other than status.json/STATUS.md) is recorded with `dirty: true` and never reused; timeouts are never reused; `--fresh` bypasses the cache.
- **Never implicit.** `view`, `view --json`, `validate` and `render` only read `rechecks[]`. Only `status-write recheck` runs a command.
- **What readers show.** `view`: `verified N (claims) · re-checked M`, where M counts verified tasks whose latest re-check passed; one line per re-checked task (`re-check PASS|FAILED|FAILED (timeout): <id> · sha <12> (HEAD|older commit) · exit <n> · at <time>`); and `unchecked (no check command): ...` for `kind: "none"` tasks. STATUS.md gets the same count and a `## Re-checks` section. A FAILED re-check never changes the status and never changes the percent; it is shown so a human acts on it.
- **Closed boards.** `recheck` is allowed after `close` (it only appends to `rechecks[]`); every other write stays frozen.
- **Residual risk.** A re-check proves the command passed at that sha, not that the command tests the right thing: a weak command committed into plan.json passes weakly, so the command is shown in plan.json for review and its introduction is visible in git history. `rechecks[]` entries can be forged by hand like any field; `recheck --fresh` re-runs them in seconds.

### Functions for callers (mod, other plugins)

| Import | From | Use |
|---|---|---|
| `computeView(doc, { dir })` / `loadView(file)` | `status-lib.mjs` | `view.rechecks = { head, rechecked, failed: [ids], by_task: [{id, status, result, exit, sha, at, dirty, at_head}], unchecked: [{id, reason}], has_checks }`. Never runs a check. |
| `recheckView(doc, head)`, `latestRechecks(doc)` | `status-lib.mjs` | The same summary without the rest of the view; latest entry per task. |
| `readCommittedPlan(statusFile)`, `planChecks(plan)` | `recheck.mjs` | The plan at HEAD and its checks by task id. |
| `runCheck(command, { cwd, timeoutMs })`, `findCached(doc, task, sha, commandSha)`, `commandSha(cmd)`, `parseDuration(v)` | `recheck.mjs` | Building blocks. To record a result, call the CLI: `status-write recheck --impl <name> [--task ID] [--timeout 60s]` (exit 0 pass, 4 failed, 1 refused). |

## Callers

| Plugin | Commands it calls |
|---|---|
| plan-it | `init --by plan-it` (and `init --merge` to add new items), `rename`/`remove --by plan-it` for tasks still not-started. Never writes done/verified. |
| build-it | `set <TASK> --status in-progress\|blocked\|done --by build-it` at every task boundary (`done` with `--evidence`, `blocked` with `--blocked-on`), `set --owner`, `piece ... --by build-it`. Never `verified`. |
| review-it | `set <TASK> --status verified --evidence <verdict file> --by review-it --file F`. The verdict file lives under the implementation folder or a `.taskstate/` dir (repo-relative path) and contains the word `review-it`, the exact task id and a line `verdict: PASS`. On a failed case: `set <TASK> --status in-progress --note "<failed case>" --by review-it` (the note is mandatory; it is recorded in history). |
| conclude-it | In order: (1) `set <TASK> --status verified --evidence <existing review-it verdict> --by conclude-it` only to carry forward a verdict that already exists (same verdict check; it never invents one). (2) `close --by conclude-it [--owner-note "<why unverified tasks stay>"] [--end-sessions] [--move] --file F`. (3) `session end --session-id ID --by conclude-it` for single sessions. (4) `reopen --by conclude-it --note "<why>"` is the only command accepted after close. |
| init-it | `session add --session-id ID --alias A --name N --role plan\|build\|review\|conclude\|other --by init-it [--create]` and `session end --session-id ID --by init-it`. Nothing else. Re-adding a known `session_id` with another role updates the role in place (no duplicate, `started_at` kept). `--create` makes a missing `status.json` as a minimal schema-1 board (no waves, `created_by: "init-it"`); plan-it's `init --merge` later adds the waves. |

### What a refusal means (exit 1, file byte-identical, no `.tmp` or `.lock` left)

| Message contains | Meaning | What the caller does |
|---|---|---|
| `verdict file does not name task X` / `lacks a "verdict: PASS" line` / `lacks the token "review-it"` | Evidence is not a PASS verdict for this task | review-it: write a correct verdict first. conclude-it: do not carry forward; ask review-it. |
| `evidence must live under ...` / `does not exist` / `empty` | Bad evidence path | Fix the path (repo-relative, under the impl folder or `.taskstate/`). |
| `review-it sending a task back to in-progress requires --note` / `lowering a verified task requires --note` | A note naming the failed case is mandatory | Re-run with `--note`. |
| `close refused: N task(s) not verified (...)` | Unverified work remains | Run review-it, or pass `--owner-note` to close knowingly (history records task `*`). With `--move` nothing is moved. |
| `close --move refused: 0-done target already exists` | `<parent>/0-done/<name>` is taken | Resolve the clash by hand; the close did not happen. |
| `implementation is closed (frozen)` | Closed board | Only `reopen --by conclude-it --note ...`. |
| `role X may not ...` | Wrong `--by` for this command | Use the role in the table above. |

---
_Authored by [DevOtts](https://github.com/DevOtts)._
