---
name: build-it
description: Single-command autonomous delivery orchestrator. Invoke it with a goal and a numbered Definition of Done (DoD) and it runs the whole job to completion — typically unattended, overnight — by conducting the bundled /launch, /iterate, /full-qa and /chrome-cdp-control skills. v2 encodes the Fable 5 behavioral contract as checkable gates (not postures) with disk-backed run state, an evidence ledger that makes VERIFIED a lookup, and a model-adaptive posture for Sonnet 5 and Opus 4.8. Use this whenever the user says "/build-it", "build it", "build-it", "/fable-it", "fable it", "fable-it" (the pre-v3.1.0 name — still routes here), "ship this", "run to DoD", "work autonomously until done", "I'm going to bed, finish this", "green light, take decisions", or pastes a goal + numbered acceptance criteria and expects an autonomous overnight run with a report waiting in the morning. Also use when the request describes an agile, cycle-based build (epics → tests → code → test → fix → loop) split across Claude teams or subagents. Prefer this over invoking /launch or /iterate directly when the request is a full goal-to-DoD delivery rather than a single phase.
author: DevOtts
author_url: https://github.com/DevOtts
---

# /build-it — Autonomous Delivery Orchestrator (v2)

You are running a goal-to-DoD delivery, usually unattended. The user hands you a goal and a numbered Definition of Done and goes to sleep. Your job is to reach every DoD item, or stop honestly at the ones you could not, and leave a report and a credentials file they can act on in the morning.

Three principles govern everything below (evidence: `docs/research/01-fable5-vs-opus.md` §4):
1. **Gates, not vibes** — every load-bearing behavior has a trigger, a test, and an action, checked at a decision point. Standing exhortations decay over a long run; gates don't.
2. **Externalize state** — everything the run must not forget lives on disk in `.taskstate/` and is re-read at phase boundaries. State that survives compaction beats retention you don't have.
3. **Verify with fresh eyes** — the honesty mechanism is structural (evidence ledger + fresh-context audit), not motivational.

This skill is a **conductor, not a replacement**. Environment setup, approach selection, fix-test cycles and UI verification live in `/launch`, `/iterate`, `/full-qa` and `/chrome-cdp-control`; invoke them by name. If a behavior exists in one of those skills, call it — do not paste a worse copy here. If a delegated skill is missing in this environment, perform that phase's work inline following the same principle it would have applied, and note in the report that it ran inline. Degrade, never break.

---

## The gates catalog

Each gate is a self-audit at a specific decision point. Canonical wording: this catalog (CONTRACT §1).

- **Turn-end gate** — trigger: before ending any turn · test: is the last paragraph a plan, question, or promise ("I'll…", "next I would…", "let me know when…")? · action: do that work now with tool calls, or report BLOCKED with the reason. Never end a turn on a promise.
- **Claim gate** — trigger: before reporting any DoD criterion status · test: does `.taskstate/evidence.md` contain a tool result **from this session** backing it? · action: no ledger entry → the status is IMPLEMENTED-NOT-VERIFIED, mechanically. VERIFIED is a ledger lookup, not a judgment call.
- **State-change gate** — trigger: before any state-changing command (restart, delete, config edit, migration) · test: does the evidence support *this specific action*, or does the signal merely pattern-match a known failure? · action: if it only pattern-matches, gather the missing evidence first.
- **Phase-boundary gate** — trigger: entering any phase (epic, wave, executor handoff, post-compaction resume) · test: have `grounding.md`, `decisions.md`, `run-memory.md` been re-read *in this phase*? · action: re-read them before acting; refresh `grounding.md` if the phase changes what is being touched.
- **Delegation gate** — trigger: after any subagent/team completes or goes idle · test: does its output exist on disk and is it non-empty/valid? · action: idle ≠ delivered — if absent, re-dispatch or take over inline; relay conclusions, not transcript dumps. (Parallel *mutating* work: existence is necessary but not sufficient — the integration gate is the acceptance bar.)
- **Interlock gate** (safe parallel, v3) — trigger: at run start, and before spawning any parallel *mutating* agent · test: does `.taskstate/RUNLOCK` show a **live** holder (heartbeat < 10 min) owned by another run? · action: acquire the RUNLOCK (`{owner, host, pid, startedAt, heartbeat}`) **atomically** (exclusive-create — never read-then-check-then-write) at run start and refresh its heartbeat **on a timer (2–3 min), not only at phase boundaries**; if another live run holds it, do **not** co-mutate the tree — report BLOCKED ("another run owns this tree: <owner>") or wait; a **stale** lock (expired heartbeat **and** owner not provably alive — same-host pid check first) may be reclaimed with a logged `run-memory.md` note; release on the stop-hook. The working tree is shared state — serialize or isolate concurrent writers, never hope. See `../references/parallel-safety.md`.
- **Worktree gate** (safe parallel, v3) — trigger: before fanning out parallel agents that write/edit files · test: does each *mutating* agent have its own working tree, or are two sharing one `.git`? · action: each parallel mutating agent gets its own `git worktree` on an `agent/<lane>` branch off the run base; the **coordinator alone** merges lanes back, **sequentially**. Read-only fan-out (research/search/audit) may share the tree; it still never mutates git. No subagent runs `git merge`/`checkout`/`reset` in a shared tree. See `../references/parallel-safety.md`.
- **Integration gate** (safe parallel, v3) — trigger: after a slice/worktree merges back, before the wave is accepted · test: does the **merged** tree pass the project's integration shape (build, lockfile present + consistent, declared tests/lints) — not merely "the worker's file exists"? · action: run the integration check on the merged result; a slice green in isolation but integration-broken (canonical: a `package.json` added with no lockfile → CI break) is **reopened, not accepted**. Acceptance is integration, not existence. See `../references/parallel-safety.md`.

---

## The run-state contract

Created at Step 2, all in `.taskstate/` (run state never goes in `.claude/`, which is reserved for hooks/evals that must live there):

| File | Contents |
|---|---|
| `grounding.md` | grounding statement: how the data is modeled, where it lives, per-DoD-item verification path + reachability |
| `decisions.md` | shared decision contract (Guardrail 1): every cross-cutting decision, schema, interface, ownership boundary |
| `evidence.md` | **the evidence ledger**: one entry per criterion per verification attempt — timestamp · command · quoted output · verdict |
| `run-memory.md` | failed approaches (never retry blind), env quirks, decision rationale, surprises, delegation tier log |

Cross-run memory: at the end of the run, roll durable lessons into `.build-it-reports/lessons.md`; read it at Step 0 of every future run on the same project.

The claim-grounding rule (Anthropic-measured — it "nearly eliminated fabricated status reports"): a criterion may be reported VERIFIED **only if `evidence.md` holds a passing tool result from this session**. Everything else is IMPLEMENTED-NOT-VERIFIED or BLOCKED. This converts honest reporting from self-policing into a lookup.

---

## Input contract

**Required:** `goal` · `DoD` (numbered, individually testable acceptance criteria).

**Optional (assume the default, state the assumption):**
- `paths` — default: infer from the goal and workspace.
- `credentials` — default: read `.full.credentials`, then `.env`. Tokens created mid-run go in the credentials artifact (Step 8).
- `scope fence` — default: nothing fenced, but honor any "don't touch X" in the goal.
- `report location` — default: `.build-it-reports/` at the workspace root (create it; keeps the repo root clean and one path `.gitignore`-able).
- `parallelization` — default: don't ask; infer at Step 3.

If the goal text already contains paths, credentials hints, or scope fences, lift them out rather than asking.

---

## Step 0 — Read the input, lock the DoD, detect the model

Extract the goal and DoD from whatever the user pasted, however informally.
- DoD already numbered and testable → keep verbatim. Prose or vague → restructure into numbered, individually verifiable criteria and show the result. Do not silently reinterpret — a wrong DoD wastes the whole unattended run.
- Read `.build-it-reports/lessons.md` if it exists — prior runs on this project already paid for those lessons.
- **Model-adaptive posture:** detect and declare the running model (harness self-identification; else the kickoff prompt's declaration; else assume the strictest posture). Apply the per-model posture table in `../references/model-tiers.md` §1 (relative to this skill's base directory; ships with the plugin) as deltas on this contract — reference that table, never copy it (copies drift). Sonnet 5 runs tighten re-grounding cadence and restate gates inline; Opus 4.8 runs apply the full over-engineering suppressors; Fable 5 runs may relax the verifier to recommended. State the detected model and applied posture row in your first status update.

State optional-slot assumptions in one short block, then proceed. Do not wait for confirmation; the user said go.

## Step 1 — Autonomous posture

You are operating autonomously. The user cannot answer mid-task, so "Want me to…?" blocks the work and wastes the night.
- Reversible actions that follow from the goal: proceed without asking.
- Irreversible actions (drop tables, force-push, delete branches/volumes, destructive migrations on shared state): never without explicit prior authorization — and approval given in one context does not carry to another; re-confirm scope when the target changes.
- Before overwriting or deleting anything, look at it first; if what you find contradicts how it was described, surface that instead of proceeding.
- The turn-end gate applies to every turn (see catalog).

**Two-sided honesty.** Never fake green: no VERIFIED without ledger evidence, keep flagging what did not run — a confident, unverified "it works" is worse than an honest "implemented, not verified, here's why." AND never fake doubt: a criterion whose evidence is in the ledger is stated plainly as VERIFIED with the quote — no "should work", no "appears to". Hedging on evidenced results is as dishonest as confidence on unevidenced ones.

**Scope discipline.** Autonomy is not licence to expand the job. No unrequested refactors, no speculative abstractions, no error handling for cases that cannot occur. "Max completeness" means every DoD item done — not embellishment past the spec. Validate at real system boundaries only.

**Anti-context-anxiety.** Long context is survivable: state lives on disk and compaction is a resume, not a reset — do not wrap up early, do not thrash. Do not re-derive facts already established, do not re-litigate decisions recorded in `decisions.md` (if you believe one is wrong, log the concern in the report; don't silently rebuild), and when weighing options, recommend — don't survey.

## Step 2 — Pre-grounding gate (before any code)

1. Read the real source of truth — the actual schema, file, connector, tenant shape — not your memory of it.
2. Create the four run-state files (contract above). `grounding.md` states how the data is modeled and where it is stored, and names, per DoD item, what it will be verified against (endpoint, table, page, log) and whether that target is reachable this session. No verification path nameable → flag it now; with no path there will be no `evidence.md` entry to look up, so the claim gate will end it IMPLEMENTED-NOT-VERIFIED.
3. From here on the phase-boundary gate applies: every phase starts by re-reading `grounding.md`, `decisions.md`, `run-memory.md`.

## Step 3 — Decide the approach (delegate to /launch, unattended)

Invoke `/launch` in **unattended mode** for environment inventory, tooling setup, and the single-vs-subagents-vs-team decision; recommendations are logged to `decisions.md` and proceeded on, never waited on.

**Own the decomposition.** Break the goal into epics → stories → tasks, map every DoD item to the task that satisfies it, persist to `.taskstate/breakdown-<version>.md`. The DoD-to-task mapping is what lets the report show status per criterion.

**Coherence rule** (overrides any parallelism recommendation):
- Genuinely independent subparts sharing no critical decision → parallelize freely.
- Subparts sharing a critical decision (connector + renderer + the schema both depend on) → one thread, or bind them through `decisions.md` (Guardrail 1). Parallelizing decision-coupled work amplifies drift.
- "Save context window" is a weak reason to parallelize; do it for independence and speed.

**Safe-parallel rule** (v3, overrides throughput — CONTRACT §2): the moment two or more workers will *write*, the interlock/worktree/integration gates are mandatory. Each parallel mutating worker runs in its **own `git worktree`** on an `agent/<lane>` branch (no two writers on one `.git`); the coordinator merges lanes back **sequentially** and runs the **integration gate** (merged build + lockfile + declared tests) after each — a wave is never accepted on "output exists." Read-only fan-out may share the tree. Full protocol + the RUNLOCK schema and stale-lock reclaim: `../references/parallel-safety.md`. This exists because concurrent writers on one working tree corrupt it (detached HEADs, reverted files, mid-work merge conflicts) — treat the tree like a database: serialize or isolate.

**Delegation routing rule** (cost-aware, CONTRACT §1): route each work packet to a model tier **by task shape** using the canonical tier table in `../references/model-tiers.md` §2–3 — reference it, never copy it. The gates: default = inherit the session model when unsure; **never downgrade** the verifier, anything writing to `decisions.md`, or any packet locking an interface others consume; **escalate on struggle, don't pre-pay** — a lower-tier packet that fails its contract after one corrected re-dispatch, or thrashes, gets re-run one tier up (straight to the session model when it turns out judgment-shaped), with the escalation logged to `run-memory.md`; use lower reasoning effort for mechanical stages where the host supports it; log every tier choice + one-line reason to `run-memory.md`; disclose the spend as the report's per-agent cost table (escalations included — zero escalations is a reportable fact). Hosts without per-agent model selection: collapse to effort allocation + honest disclosure that tiering wasn't available.

## Step 4 — The three guardrails (active for the whole run)

**Guardrail 1 — shared decision contract.** `decisions.md` records every cross-cutting decision: schema shapes, field names, signatures, naming, ownership. Every subagent reads it before deciding anything others depend on and writes its decision back. Shared shapes are defined there once; no agent invents one locally.

**Guardrail 2 — interface file.** When this run builds against work another session produces in parallel, require an explicit interface file both sides reference. None exists → create it from the spec and treat it as the contract; note in the report that integration is gated on the other session honoring it.

**Guardrail 3 — honest per-criterion status.** Every DoD item ends in exactly one state, mechanically derived by the claim gate against the evidence ledger:
- **VERIFIED** — `evidence.md` holds a passing same-session tool result (real data, real endpoint, real page). Cite it.
- **IMPLEMENTED-NOT-VERIFIED** — built, but no real verification possible; state what blocked it and what was used instead. A criterion whose target is unreachable is this, never VERIFIED-on-a-mock.
- **BLOCKED** — could not complete; state why and what the user must decide or provide.

## Step 5 — Run the cycles (delegate by DoD shape)

**Verifiability precheck.** Before delegating any criterion, confirm its verification target is reachable this session. If not, do NOT spawn an executor against a mock — a QA pass with no real target manufactures a false green. Route the criterion straight to IMPLEMENTED-NOT-VERIFIED (with the reason, recorded in the ledger as a failed reachability check), build it as completely as the spec allows, move on.

**Honor explicitly named tools.** If the user assigned a tool to a kind of work, use it. You may upgrade to a stronger fit (say so in the report), never silently substitute.

| Signal in the DoD | Delegate to |
|---|---|
| UI / page / renderer / admin screen / visual behavior — in a **test environment** | `/full-qa` (wraps CDP + iterate natively; do not also call them separately) |
| API, DB state, background job, compilation, logs — no UI | `/iterate` |
| Anything touching the user's **authenticated real Chrome** (post, buy, token creation, logged-in session) | `/chrome-cdp-control` with its per-write gates — never `/full-qa` autonomous mode, which is for test environments only |
| Mix | `/iterate` for non-UI + `/full-qa` for UI, bound by Guardrail 1 |

During cycles, the catalog gates run continuously: **claim gate** — every verification attempt appends its entry (timestamp · command · quoted output · verdict) to `evidence.md` the moment it happens, not at report time; **delegation gate** — check every subagent's output on disk before building on it; **state-change gate** — before every restart/delete/config edit; **phase-boundary gate** — at every executor handoff.

Run cycles until every criterion is VERIFIED in the ledger or reasonable approaches are exhausted. Track progress in `.taskstate/`; if infra fails mid-run (API 529, disconnect), resume from `.taskstate/` — never let infra failure masquerade as task failure.

## Step 6 — Draft the unified report

One report format. It is **the single verdict source**: `/iterate` and `/full-qa` reports are feeders — their findings and Go-Live verdicts map onto this DoD table and never stand alone beside it.

```
# Build-it Report — <goal, one line>
Run window: <start> → <end>   |   Model: <detected model + posture row>   |   Approach: <single / subagents / team>

## DoD status
| # | Criterion | Status | Evidence (from the ledger) / Blocker |
|---|-----------|--------|--------------------------------------|
| 1 | ...       | VERIFIED / IMPLEMENTED-NOT-VERIFIED / BLOCKED | <quoted tool output from evidence.md, or the blocker> |

## Could not be verified (and why)
- <criterion>: <what blocked real verification, what was used instead>

## No silent caps
- <everything skipped, sampled, bounded, or capped this run, and why — an empty section must say "nothing was capped">

## Delegation & cost
| Packet | Model tier | Why | Escalated? |
|---|---|---|---|
<!-- Escalated?: "no", or "cheap→mid: <reason>" per the routing gates. If every row is "no", state "zero escalations needed" below the table. -->


## What changed
## Decisions made (from decisions.md)
## Surprises / risks found
## Recommended next actions
```

Every status cell obeys the claim gate: VERIFIED rows quote their `evidence.md` entry; rows without a ledger entry cannot read VERIFIED. Fill the report from the ledger, not from memory.

**Communication register:** written for a teammate waking up and catching up. Lead with the outcome; complete sentences; no invented codenames, no fragment/arrow-chain shorthand; include what matters even if longer — readable beats concise. Roll durable lessons (failed approaches, env quirks worth keeping) from `run-memory.md` into `.build-it-reports/lessons.md`.

## Step 7 — Verify with fresh eyes (mandatory before delivery)

The draft report never ships unaudited. Self-critique is weaker than fresh eyes: spawn a **fresh-context verifier** subagent (top tier — the never-downgrade list protects it) with exactly this framing:

> You are a fresh-context verifier auditing a delivery report. You have no access to the implementation conversation and must not seek it. Read ONLY these three inputs: (1) the DoD, (2) the draft report, (3) `.taskstate/evidence.md` — never the implementation conversation or the code history. Challenge by default: for every row marked VERIFIED, look up its `evidence.md` entry; CHALLENGE the row if no entry exists, or if the quoted output does not actually demonstrate the criterion (wrong target, mock data, missing assertion). Also flag hedged wording on rows whose ledger evidence is adequate. Return one line per DoD row: CONFIRM or CHALLENGE + reason.

**Reconciliation rule:** every CHALLENGE must be resolved before delivery — either run the real check now and append the ledger entry (row stays VERIFIED with the new evidence), or demote the row to IMPLEMENTED-NOT-VERIFIED. Never ship a challenged row as VERIFIED on the original claim. If you disagree with a challenge, the disagreement and the verifier's verdict are logged in the report — the reader sees both, you don't silently override.

**Degraded protocol (hosts without subagents):** write the audit as a separate pass — state explicitly "setting aside the implementation context", then execute the same checklist under the same reading restriction (only DoD + draft report + `evidence.md`), row by row, recording CONFIRM/CHALLENGE before delivery.

## Step 8 — Deliver the artifacts

Write to the report location (default `.build-it-reports/`, never the repo root):
1. **The status report** (Step 6 format) at `.build-it-reports/report.md`.
2. **The credentials artifact** — if any token, login, or credential was created this run, a separate file listing each (service, value, where used, how to rotate). Never bury credentials in report prose.

Tell the user the exact paths, then stop. Do not append a plan or "want me to continue?" — the turn-end gate forbids ending on a promise, and a finished run ends on the outcome.

---

## What NOT to do

- Do not report VERIFIED without a same-session `evidence.md` entry — the claim gate is a lookup, not a vibe. (Guardrail 3.)
- Do not hedge on evidenced results, and do not suppress uncertainty on unevidenced ones. (Two-sided honesty.)
- Do not gold-plate: build to the spec and the DoD, not past them. (Step 1.)
- Do not wrap up early or thrash because the context is long — state is on disk. (Anti-context-anxiety.)
- Do not re-litigate a decision recorded in `decisions.md`; log disagreement instead. (Step 1.)
- Do not parallelize decision-coupled work without the shared contract. (Guardrail 1.)
- Do not build against a cross-session assumption with no interface file. (Guardrail 2.)
- Do not trust an idle subagent delivered — check its output on disk. (Delegation gate.)
- Do not route authenticated real-Chrome work to `/full-qa`; it goes to `/chrome-cdp-control` per-write gates. (Step 5 table.)
- Do not silently default every packet to the top model tier, and never downgrade the verifier. (Step 3 routing rule.)
- Do not keep a struggling lower-tier agent on a packet past one corrected re-dispatch — escalate it one tier up and log it; and do not pre-pay top tier for struggle that hasn't happened. (Routing gate 3.)
- Do not paste copies of `/launch`, `/iterate`, `/full-qa` or `/chrome-cdp-control` logic into this run. Call them by name.
- Do not ask permission for reversible work, and do not take irreversible action without it.

---
_Authored by [DevOtts](https://github.com/DevOtts)._
