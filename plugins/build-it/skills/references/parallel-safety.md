# parallel-safety — the operational protocol for safe parallel & multi-session execution

Referenced by the conductor's **interlock**, **worktree**, and **integration** gates
(v3, CONTRACT §2). This is the mechanics; the gates are the triggers. Host-agnostic;
the optional Claude Code hook is noted at the end.

Governing idea: **the working tree is shared state.** Two agents writing one `.git`
corrupt it — detached HEADs, files reverting under you, a merge conflict landing
mid-work. Treat concurrent writers like concurrent writers to a database: **serialize
or isolate, never hope.**

---

## 1. RUNLOCK — one writer per working tree (interlock gate)

`.taskstate/RUNLOCK` (JSON), one live holder per tree:

```json
{ "owner": "<run/session id>", "host": "<hostname>", "pid": 12345,
  "startedAt": "<ISO8601>", "heartbeat": "<ISO8601, refreshed each phase>" }
```

- **Acquire atomically** at run start (Step 1): create the file with exclusive-create
  semantics — `(set -C; printf '%s' "$json" > .taskstate/RUNLOCK)` (shell noclobber)
  or `O_EXCL` — **never read-then-check-then-write**: two runs starting together must
  not both see "no lock" and both write. If exclusive create isn't available on the
  host, write, then re-read and confirm `owner` is you before touching the tree.
- **Refresh `heartbeat` on a timer — every 2–3 minutes — as well as at phase
  boundaries.** Phase-boundary-only refresh is a hole: one long phase (a big build,
  a slow agent wave) outlives the staleness window and a *live* run gets "reclaimed"
  mid-work — the exact corruption this gate exists to prevent.
- **Live** = `heartbeat` age < 10 min, **or** the owner pid is running on this host
  (same-host pid liveness overrides an aged heartbeat — never reclaim a lock whose
  owner is provably alive). If exclusive create fails, read the existing RUNLOCK:
  - held live by another owner → **do not co-mutate.** Report BLOCKED
    ("another run owns this tree: <owner> on <host>, pid <pid>") or wait for release,
    per the run's autonomy setting.
  - **stale** (heartbeat age ≥ 10 min **and** the owner is not provably alive — same
    host: pid not running; different host: no pid check is possible, the aged
    heartbeat governs) → reclaim it, writing a `run-memory.md` note:
    `reclaimed stale RUNLOCK from <owner> (heartbeat <age>)`. Never a silent takeover.
- **Release** on completion and on the stop-hook (delete the file). A crash leaves a
  stale lock, which the next run reclaims — so a crash never permanently blocks.
- Also treat a pre-existing `.git/MERGE_HEAD` (an unfinished merge) as "tree busy":
  resolve or abort it before starting, never start work on top of it.
- **Scope**: the RUNLOCK protects **one working tree**. Separate clones of the same
  repo are separate trees — this lock does not coordinate them; that coordination
  happens at the remote (protected branches, PRs), not here.

## 2. Worktree isolation — one tree per mutating agent (worktree gate)

When fanning out agents that **write/edit files**:

```
base=$(git branch --show-current)                      # the run base
for lane in A B C; do
  git worktree add -b agent/$lane .build-it/wt/$lane "$base"   # isolated tree + branch
done
# dispatch one mutating agent per worktree; its cwd is .build-it/wt/<lane>.
# each agent works ONLY inside its worktree and NEVER runs git merge/checkout/reset.
```

- **Read-only** fan-out (research, search, audit — no repo writes) **may share** the
  main tree; do not pay worktree overhead for it. It still never mutates git.
- **Merge-back is coordinator-only and sequential** (§3) — workers never merge.
- Prefer the harness's native isolation when available (e.g. an agent runner's
  `isolation: worktree` option) — same guarantee, auto-cleaned when unchanged.
- Clean up: `git worktree remove .build-it/wt/<lane>` after merge; `git worktree prune`.
- A crashed run can leave `agent/<lane>` branches behind, which makes the next
  `git worktree add -b agent/<lane>` fail. Before dispatch, check
  `git branch --list 'agent/*'`: salvage or delete the leftover **with a logged note**
  (like a stale-lock reclaim — never silently), or suffix the new lane
  (`agent/B-2`). Never reuse another run's lane branch in place.

## 3. Sequential merge-back + integration acceptance (integration gate)

The coordinator, alone, one lane at a time:

```
for lane in A B C; do
  git merge --no-ff agent/$lane          # resolve any conflict HERE, in the base
  <integration check>                    # build + lockfile + declared tests/lints
  #   green  → accept the lane, continue
  #   broken → REOPEN the lane (do not accept the wave); fix or re-dispatch
done
```

- The **integration check** is the project's real shape: it builds, a lockfile is
  present and consistent (the canonical miss: a `package.json` added with no lockfile
  → CI break), and the declared tests/lints pass on the **merged** tree.
- Acceptance is **integration, not existence**: the delegation gate confirms a worker's
  output exists; this gate confirms the *merged* result works. A slice green in its own
  worktree but broken after merge is reopened — never accepted on existence alone.

## 4. Optional hardened hook (Claude Code only, fail-open)

- **Preflight** (SessionStart/run-start): write+check the RUNLOCK per §1; refuse to
  proceed on a live foreign lock.
- **Stop hook**: release the RUNLOCK.
- Both fail-open on script error (never brick a run) and carry a one-line disable, in
  the v2 hook style. The prose gates above are the baseline on every host.

---
_Authored by [DevOtts](https://github.com/DevOtts)._
