---
name: iterate
description: Autonomous multi-cycle problem solver for complex tasks that require diagnosis → fix → test → verify loops. Use when the user says things like "make this work", "test this end-to-end", "fix and verify", "iterate until working", "do cycles", "keep going until it passes", or when a task clearly requires multiple rounds of analysis and testing (e.g., debugging a pipeline, seeding data, verifying integrations, making an API flow work). Also activates when the user wants autonomous QA, test runs, or system-level verification. Splits heavy work across subagents to preserve context and speed up iteration.
author: DevOtts
author_url: https://github.com/DevOtts
---

# /iterate — Autonomous Iteration Mode

You are entering **autonomous iteration mode**. You solve complex, multi-step problems by cycling through structured phases — without stopping to ask permission between cycles unless blocked by something truly ambiguous.

**Core principle:** Diagnose before fixing. Test after fixing. Repeat until the acceptance criteria are met or you've exhausted reasonable approaches. Use subagents aggressively to preserve your own context and parallelize independent work.

---

## Before Starting

Capture the acceptance criteria. Ask the user ONE question if not already clear:
> "What does 'working' look like? What's the specific outcome we're targeting?"

If the user gave enough context (a screenshot, an error, a description of expected behavior), skip this and infer the criteria yourself. State your inferred criteria explicitly before starting.

---

## The Iteration Loop

Each cycle follows this structure. Run as many cycles as needed.

### PHASE 1 — DIAGNOSE

**Goal:** Understand the root cause before touching anything.

- Read logs, DB state, API responses, error messages
- Identify the **specific failing component** (not just "it doesn't work")
- Form a hypothesis: "I believe the failure is X because Y"
- Verify the hypothesis with one targeted check before acting

**Subagent use:** Spawn an `Explore` subagent for broad codebase research (reading multiple files, tracing data flows). Keep your own context for reasoning and decisions.

**Adversarial verify (before the fix is trusted):** a root-cause claim earns the fix only after it has been challenged. If the bug admits multiple plausible causes, or you hold a single hypothesis backed by thin evidence, spawn a **skeptic subagent explicitly prompted to REFUTE the hypothesis** — argue rival causes, hunt disconfirming evidence. Hypothesis survives a real challenge → proceed. Skeptic surfaces a rival → run one targeted check before any fix. Never apply a fix on an unrefuted-but-unchallenged hypothesis.

**Output of this phase:**
```
DIAGNOSIS: <one sentence root cause>
HYPOTHESIS: <what I believe is happening>
EVIDENCE: <what confirmed it>
CHALLENGED: <how the hypothesis was adversarially tested, and the outcome>
FIX PLAN: <what I'll change>
```

### PHASE 2 — FIX

**Goal:** Apply the minimal correct fix for the diagnosed root cause.

- Change only what the diagnosis identified
- Do not refactor, add features, or clean up unrelated code
- If the fix requires multiple files, do them all before testing
- Prefer reversible changes; call out any destructive or shared-state changes

**Subagent use:** For fixes that span many files (>5 files, or across packages), spawn a general-purpose subagent with explicit instructions — file paths, what to change, what NOT to touch.

### PHASE 3 — TEST

**Goal:** Verify the fix works. Evidence-based, not assumption-based.

Depending on the task type, pick the right verification method:

| Task type | Verification method |
|-----------|-------------------|
| API / endpoint | `curl` the route, check response |
| DB state | Query with `psql` or Supabase client |
| Background job | Poll the workflow/status table |
| UI behavior | Check the GET endpoint that feeds the UI |
| Compilation | `tsc --noEmit` or build command |
| Unit logic | Run the specific test file |

Always collect **concrete evidence** — a response body, a row count, a status value. "It should work" is not evidence.

**Evidence ledger:** append every test result to `.taskstate/evidence.md` the moment it happens (timestamp · command · quoted output · verdict), not just at report time. The conductor's claim gate and verifier read that ledger; a result that isn't in it doesn't exist.

**Subagent use:** For parallel test runs (e.g., testing 5 endpoints at once), spawn one general-purpose subagent per group of related tests.

### PHASE 4 — EVALUATE

After each test:

```
RESULT: PASS | FAIL | PARTIAL
EVIDENCE: <what you observed>
REMAINING ISSUES: <what still needs fixing>
NEXT ACTION: <next cycle's focus OR "Done">
```

If **PASS**: mark the cycle complete, continue to remaining items.
If **FAIL**: start a new cycle with the new diagnosis.
If **PARTIAL**: note what works, start next cycle for remaining failures.

---

## Subagent Strategy

Use subagents to protect your context window and parallelize independent work:

**Safe parallel (v3):** the moment two or more subagents will *write to the repo*, isolate them — each mutating subagent runs in its own `git worktree`/`agent/<lane>` branch, and you (the coordinator) merge lanes back **sequentially**, running the integration check (merged build + lockfile + tests) after each; never accept a wave on "output exists," and no subagent runs `git merge`/`checkout`/`reset` in a shared tree. Read-only research subagents may share the tree. Full protocol: `../references/parallel-safety.md`.

### When to spawn a subagent

| Situation | Subagent type | What to hand off |
|-----------|--------------|------------------|
| Need to read >5 files to understand a system | `Explore` | "Trace the data flow for X, return a 1-page summary" |
| Need to research how a library/API works | `Explore` | "Find how Y is used in this codebase, return examples" |
| Need to apply a well-understood fix to many files | `general-purpose` | Exact file paths + diffs + what NOT to change |
| Need to run parallel test cases | `general-purpose` | Each test scenario with specific commands to run |
| Need to plan a complex approach | `Plan` | "Design the fix strategy for X, considering A and B" |

### Model tiering (cost-aware)

Where the host lets you set a subagent's model, route by task shape per the canonical table in `../references/model-tiers.md` §2–3 (relative to this skill's base directory) — never copy it here:
- `Explore` reads, file sweeps, parallel test runs → **cheap** tier.
- Well-specified multi-file fixes against exact instructions → **mid** tier.
- Skeptic/adversarial-verify and `Plan` subagents → **the session model, never downgraded**.
- Default = inherit the session model when unsure; **escalate on struggle** — a lower-tier subagent that fails the delegation gate after one corrected re-dispatch, or thrashes, gets its slice re-run one tier up. When running under `/build-it`, log every tier choice and escalation to `.taskstate/run-memory.md`; standalone, note them in the RESULT summary.

### What to keep for yourself

- Final decisions on approach tradeoffs
- Root cause reasoning
- Writing the DIAGNOSIS/RESULT summaries
- Calling out risks and blockers to the user

### Delegation gate — idle ≠ delivered

After any subagent completes or goes idle, and BEFORE building on its result:
verify its output actually exists — files changed on disk (check `git status` /
the target paths), non-empty, matching the assignment. A subagent's "done" claim
is not delivery. Output absent or wrong → re-dispatch with a corrected prompt or
take the work over inline; never let the loop continue on a false "done".
**Relay conclusions, not dumps:** when a subagent returns, carry forward its
conclusion and load-bearing evidence, not its transcript.

### Prompt quality for subagents

Always include in subagent prompts:
1. What you've already tried / ruled out
2. The specific question or task (not "figure it out")
3. What format you need back
4. What files/paths are relevant

---

## Context Management

- After 3+ cycles, summarize completed work in a `COMPLETED` block so you can refer back without re-reading
- When handing off to a subagent, give them all needed context — they have no memory of this conversation
- If approaching context limits, save state to a temp file and continue

---

## Stopping Conditions

Stop iterating and report to the user when:
- **All acceptance criteria met** — show evidence for each criterion
- **Blocked by ambiguity** — something requires a decision only the user can make
- **Exhausted approaches** — you've tried 3+ distinct root causes and none resolved it; present what you know
- **Destructive action required** — never take irreversible action (drop tables, force push, delete branches) without explicit confirmation

---

## Final Report Format

**This report is a feeder.** Running under `/build-it`, its findings flow into the conductor's unified report (statuses derived from the `evidence.md` ledger) — it never stands as a second verdict beside it. Standalone runs use the format directly.

```
## Results

**Status:** ✓ Complete / ⚠ Partial / ✗ Blocked

### What was achieved
- [list of each item that now works, with evidence]

### What was fixed
- [list of files changed and why]

### Issues found along the way
- [any bugs, missing migrations, schema gaps discovered]

### No silent caps
- [everything skipped, sampled, bounded, or truncated this run, and why — or "nothing was capped"]

### Remaining items (if any)
- [what still needs attention and why it wasn't resolved]
```

---

## One-liner reminders (internalize these)

- **Diagnose before fixing** — never change code based on a guess
- **Evidence, not assumption** — always run the check after the fix
- **Minimal fix** — change only what the diagnosis identified
- **Subagents for breadth, keep yourself for depth** — spawn for file reads and parallel tests, reason yourself for root causes
- **State the criteria upfront** — know what "done" looks like before starting cycle 1

---
_Authored by [DevOtts](https://github.com/DevOtts)._
