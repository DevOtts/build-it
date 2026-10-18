# status-write: the single writer for `status.json` (schema 1)

Zero dependencies, Node 18+. One copy lives here; other plugins call it by path (decision D-01).
Models never hand-edit `status.json` and never write a percent. The percent, counts, blocked list and stale flag are computed by `status-lib.mjs` (`computeView`).

Files: `status-lib.mjs` (importable lib), `status-write.mjs` (CLI), `status.schema.json` (JSON Schema 2020-12), `status-render.mjs` (STATUS.md, separate task), `status-migrate.mjs` (separate task).

## Usage

```
status-write init   --file F --plan plan.json --by plan-it [--merge]
status-write set    <TASK> --status S [--evidence P] [--blocked-on TEXT] [--note TEXT] [--owner TEXT] --by ROLE --file F
status-write piece  <PIECE> [--status S] [--blocked-on TEXT] [--whats-left TEXT] --by build-it --file F
status-write rename <TASK> --title T --by plan-it --file F        (refused past not-started)
status-write remove <TASK> --by plan-it --file F                  (refused past not-started)
status-write session add --session-id ID --alias A --name N --role R --by init-it --file F
status-write session end --session-id ID --by init-it|conclude-it --file F
status-write close  --by conclude-it [--owner-note TEXT] [--end-sessions] [--move] --file F
status-write reopen --by conclude-it --note TEXT --file F
status-write validate --file F
status-write view     --file F [--json]
status-write render   --file F [--out P] [--force]
```

`--file` may be replaced by env `DOIT_STATUS_FILE` or `--impl <name>` (resolves `docs/implementations/<name>/status.json`, then the singular `docs/implementation/<name>/`).
`plan.json`: `{ implementation, title?, waves:[{id,title,tasks:[{id,title}]}], pieces:[{piece, whats_left?}] }`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | invalid, or refused by a rule (role, evidence, missing note, frozen, forbidden key). The file is left byte-identical, with no lock or tmp residue. |
| 2 | usage error, or `init` on an existing file |
| 3 | lock or concurrency failure (lock not acquired in about 5 s, or 3 failed re-apply retries) |

## Rules enforced

- `--by` is required on mutating commands. Roles: plan-it (init, rename/remove not-started), build-it (not-started, in-progress, blocked, done, owner, pieces), review-it (verified, in-progress), conclude-it (close, reopen, session end, verified carry-forward), init-it (session add/end).
- `done` needs evidence: repo-relative, no `..`, no symlink out of the repo, a regular non-empty file with non-whitespace content, under the implementation folder or a `.taskstate/` dir. `blocked` needs `--blocked-on`.
- `verified` additionally needs a review-it verdict file: it contains `review-it`, the task id, and a `verdict: PASS` (or `result: VERIFIED`) line.
- Lowering `verified` needs `--note`. Every status change appends `history` `{at, task, from, to, by, note}`. `updated_at` comes from the clock.
- Forbidden keys (`percent`, `counts`, `computed`, `blocked_list`, `stale`) are rejected naming the key. Unknown other keys are preserved.
- After `close` the file is frozen until `reopen`. Lock: `status.json.lock` (`wx`, stale after 30 s or when the holder pid is dead). Write: tmp, fsync, rename. Test hook `STATUS_WRITE_TEST_CRASH=after-tmp` exits 137 before the rename (test-only).
- After each successful write `status-render.mjs` (if installed) re-renders STATUS.md, only when the target is absent or starts with the generated marker line. Hand-written boards are never overwritten (`render --force` overrides).
- `validate` also flags hand edits: any non-`not-started` task whose last history entry does not match its status.
- Residual risk: `--by` cannot authenticate the caller. It is a guardrail, not a security boundary.

## Callers

| Plugin | Commands it calls |
|---|---|
| plan-it | `init --by plan-it` (and `init --merge` to add new items), `rename`/`remove --by plan-it` for tasks still not-started. Never writes done/verified. |
| build-it | `set <TASK> --status in-progress\|blocked\|done --by build-it` at every task boundary (`done` with `--evidence`, `blocked` with `--blocked-on`), `set --owner`, `piece ... --by build-it`. Never `verified`. |
| review-it | `set <TASK> --status verified --evidence <verdict file> --by review-it`; `set <TASK> --status in-progress --note "<why>" --by review-it` on a failed case. |
| conclude-it | `close --by conclude-it [--owner-note ..] [--end-sessions] [--move]`, `reopen --by conclude-it --note ..`, `session end --by conclude-it`. |
| init-it | `session add ... --by init-it`, `session end ... --by init-it`. Nothing else. |

---
_Authored by [DevOtts](https://github.com/DevOtts)._
