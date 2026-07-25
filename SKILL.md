---
name: build-it
description: 'Autonomous goal-to-DoD delivery orchestrator — the build stage of the *-it lifecycle ("plan-it plans it, build-it builds it"); formerly named fable-it. Hand it a goal and a numbered Definition of Done and it runs the whole job to completion, typically unattended, enforcing checkable gates (turn-end, claim, state-change, phase-boundary, delegation, and safe-parallel: interlock, worktree, integration), disk-backed run state, an evidence ledger that makes VERIFIED a lookup, a fresh-eyes verification pass, and an honest per-criterion report. Model-adaptive for Sonnet 5 and Opus 4.8; host-agnostic (Claude Code, Cursor, Codex, Copilot and any SKILL.md-compatible agent).'
version: 3.1.0
license: MIT
author: DevOtts
author_url: https://github.com/DevOtts
homepage: https://github.com/DevOtts/build-it
repository: https://github.com/DevOtts/build-it
metadata:
  platforms: [claude-code, cursor, openclaw, mcp, openai]
  category: "Agents & Orchestration"
keywords: [autonomous, orchestrator, agents, definition-of-done, workflow, claude-code, evidence-ledger, fable-it]
---

# build-it — Autonomous Delivery Orchestrator

**plan-it plans it, build-it builds it.** (Formerly `fable-it` — renamed in v3.1.0.) You hand build-it a **goal** and a **numbered Definition of Done (DoD)**; it runs the whole job to completion — typically unattended, overnight — and leaves an honest, evidence-backed report. This file is the portable behavior layer: everything below is host-agnostic mechanics you can run on any agent that reads a `SKILL.md`. (On Claude Code the plugin adds bundled sub-skills and optional enforcement hooks; nothing below depends on them.)

Three principles govern the run: **gates, not vibes** (every load-bearing behavior has a trigger, a test, and an action); **externalize state** (everything the run must not forget lives on disk and is re-read at phase boundaries); **verify with fresh eyes** (honesty is structural — a ledger and an audit pass — not motivational).

## The gates catalog

Check each gate at its decision point — they are self-audits, not standing exhortations:

- **Turn-end gate** — trigger: before ending any turn · test: is the last paragraph a plan, question, or promise ("I'll…", "next I would…", "let me know when…")? · action: do that work now, or report BLOCKED with the reason. Never end a turn on a promise.
- **Claim gate** — trigger: before reporting any DoD criterion status · test: does `.taskstate/evidence.md` contain a tool/command result **from this session** backing it? · action: no ledger entry → the status is IMPLEMENTED-NOT-VERIFIED, mechanically. VERIFIED is a ledger lookup, not a judgment call.
- **State-change gate** — trigger: before any state-changing command (restart, delete, config edit, migration) · test: does the evidence support *this specific action*, or does the signal merely pattern-match a known failure? · action: if it only pattern-matches, gather the missing evidence first.
- **Phase-boundary gate** — trigger: entering any phase (new epic, resumed session, post-compaction) · test: have `grounding.md`, `decisions.md`, `run-memory.md` been re-read in this phase? · action: re-read them before acting.
- **Delegation gate** — trigger: after any delegated worker or parallel task completes or goes idle · test: does its output exist on disk, non-empty and matching the assignment? · action: idle ≠ delivered — absent or wrong output means re-dispatch or take the work over; relay conclusions, not transcript dumps. (For parallel *mutating* work, existence is not enough — see the integration gate.)
- **Interlock gate** (safe parallel) — trigger: at run start, and before spawning any parallel *mutating* agent · test: does `.taskstate/RUNLOCK` show a **live** holder (heartbeat < 10 min) owned by another run? · action: acquire the RUNLOCK (owner · host · pid · startedAt · heartbeat) **atomically** (exclusive-create — never read-then-check-then-write) at run start and refresh its heartbeat **on a timer (2–3 min), not only at phase boundaries**; if another live run holds it, do **not** co-mutate the tree — report BLOCKED ("another run owns this tree: <owner>") or wait; a **stale** lock (expired heartbeat **and** owner not provably alive — same-host pid check first) may be reclaimed with a logged `run-memory.md` note; release on the stop-hook. The working tree is shared state — treat concurrent writes to it like concurrent writes to a database. See `references/parallel-safety.md`.
- **Worktree gate** (safe parallel) — trigger: before fanning out parallel agents that write/edit files · test: does each *mutating* agent have its own working tree, or are two sharing one `.git`? · action: give each parallel mutating agent its own `git worktree` on an `agent/<lane>` branch off the run base; the **coordinator alone** merges branches back, **sequentially**. Read-only fan-out (research, search, audit) may share the tree but still never mutates git. No worker runs `git merge`/`checkout`/`reset` in a shared tree — that is coordinator-only, one lane at a time. See `references/parallel-safety.md`.
- **Integration gate** (safe parallel) — trigger: after a slice/worktree merges back, before the wave is accepted · test: does the **merged** tree pass the project's integration shape (build, lockfile present + consistent, declared tests/lints green) — not merely "the worker's file exists"? · action: run the integration check on the merged result; a slice green in isolation but integration-broken (canonical case: a `package.json` added with no lockfile) is **reopened, not accepted**. Acceptance is integration, not existence. See `references/parallel-safety.md`.

## The run-state contract

Create these four files in `.taskstate/` before writing any code, and re-read the first three at every phase boundary:

| File | Contents |
|---|---|
| `grounding.md` | how the data is modeled and where it lives; per-DoD-item verification path + whether the target is reachable this session |
| `decisions.md` | every cross-cutting decision (schemas, interfaces, naming, ownership) — the shared contract; never re-litigate an entry, log disagreement instead |
| `evidence.md` | **the evidence ledger** — one entry per criterion per verification attempt: timestamp · command · quoted output · verdict, appended the moment it happens |
| `run-memory.md` | failed approaches (never retry blind), environment quirks, decision rationale, surprises |

Cross-run memory: at the end of a run, roll durable lessons into `.build-it-reports/lessons.md`; read it at the start of future runs on the same project (if the project has a legacy `.fable-it-reports/lessons.md` from pre-v3.1.0 runs, read that too).

**The claim-grounding rule:** a criterion may be reported VERIFIED **only if `evidence.md` holds a passing result from this session**. Anything else is IMPLEMENTED-NOT-VERIFIED (built, but the real check couldn't run — say what blocked it) or BLOCKED (couldn't complete — say what the user must provide). Never VERIFIED on a mock, an assumption, or memory.

## The run

1. **Lock the DoD.** Restructure a vague goal into numbered, individually verifiable criteria and show them. Declare the running model and apply its posture: weaker/smaller models re-ground more often and restate gates inline; stronger models at high effort apply over-engineering suppressors (no unrequested refactors, no speculative abstractions). Assume the strictest posture when unsure. **Acquire the RUNLOCK** (interlock gate) before touching the tree: if another run holds it live, BLOCK or wait — never two writers on one working tree.
2. **Autonomous posture.** Proceed without asking on reversible work; never take irreversible actions (drops, force-pushes, destructive migrations) without prior authorization — and approval from one context doesn't carry to another. Look before overwriting. Two-sided honesty: never fake green, and never hedge on a result whose evidence is in the ledger.
3. **Pre-ground.** Read the real source of truth (the actual schema, file, endpoint — not your memory of it), then write the four run-state files. A criterion with no nameable verification path gets flagged now.
4. **Decompose and route.** Break the goal into epics → stories → tasks mapped to DoD items (persist the breakdown to `.taskstate/`). Keep decision-coupled work in one thread; parallelize only genuinely independent parts, bound by `decisions.md`. **Parallel mutating work runs isolated** (worktree gate): each concurrent writer gets its own `git worktree`/`agent/<lane>` branch, and the coordinator merges lanes back **sequentially**, running the **integration gate** after each merge — never accept a wave on "output exists"; a slice that breaks the merged build/lockfile/tests is reopened. Read-only fan-out may share the tree. Where the host lets you choose worker models, route mechanical work to cheap tiers and judgment/verification to the top tier (the session model — whatever the user chose to run) — never downgrade the verification pass — and log each choice + reason in `run-memory.md`. Escalate on struggle rather than pre-paying: a lower-tier worker that fails its contract after one corrected re-dispatch, or thrashes, gets its slice re-run one tier up, with the escalation logged and disclosed in the report (zero escalations is itself a reportable fact).
5. **Run the cycles.** Diagnose before fixing (challenge a root cause before trusting it), test after fixing, append every result to the ledger. Before verifying any criterion, confirm its target is actually reachable — a QA pass against a mock is a false green; route it straight to IMPLEMENTED-NOT-VERIFIED instead. Resume from `.taskstate/` after any crash; infra failure is not task failure.
6. **Verify with fresh eyes, then report.** Draft the report, then audit it under the degraded verifier protocol below (or hand the audit to a fresh reviewer if the host has one — never skip it). Deliver the report plus, if any credential was created, a separate credentials artifact in `.build-it-reports/`.

## The degraded verifier protocol

Before delivery, audit the draft report as a separate pass. State explicitly: "setting aside the implementation context." Then, reading ONLY the DoD, the draft report, and `.taskstate/evidence.md` — never the implementation history — walk every row challenge-by-default: a VERIFIED row with no ledger entry, or whose quoted output doesn't actually demonstrate the criterion, is CHALLENGED. Every challenge is resolved before delivery: run the real check now and append the ledger entry, or demote the row to IMPLEMENTED-NOT-VERIFIED. Log any disagreement in the report; never silently override a challenge.

## The report

One verdict source. Per DoD criterion: `VERIFIED` (quote the ledger evidence) / `IMPLEMENTED-NOT-VERIFIED` (what blocked verification, what was used instead) / `BLOCKED` (what the user must decide or provide). Include: a **No silent caps** section (everything skipped, sampled, or bounded, and why), the delegation/cost choices made, decisions from `decisions.md`, surprises, and recommended next actions. Written for a teammate waking up: lead with the outcome, complete sentences, no invented shorthand.

## Install

**Claude Code plugin (recommended)** — adds the bundled `/launch`, `/iterate`, `/full-qa` and `/chrome-cdp-control` skills the conductor routes to, plus optional fail-open enforcement hooks:

```sh
/plugin marketplace add DevOtts/build-it
/plugin install build-it@build-it
```

**Any other agent (Cursor, Codex, Copilot, 70+ tools):**

```sh
npx skills add DevOtts/build-it -a <agent>
```

Without the bundled skills, run every phase inline per the mechanics above — the behavior layer is the product; degrade, never break.

## Security considerations

- **No secrets are required to install or run the skill.** You supply credentials only for the specific job you ask it to do.
- It reads `.full.credentials` and `.env` **locally only** — never transmitted, never committed.
- Browser automation uses **your own Chrome** via the Chrome DevTools Protocol on a local port, reusing your logged-in session; nothing is stored or exfiltrated. Work on authenticated accounts always goes through per-write confirmation — autonomous QA is for test environments only.
- Any credential created during a run is **isolated in a dedicated credentials artifact** with rotation notes — never buried in prose.
- Irreversible actions always require explicit prior authorization; autonomy covers reversible work only.

---
_Authored by [DevOtts](https://github.com/DevOtts)._
