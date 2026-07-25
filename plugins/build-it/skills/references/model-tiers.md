# Model tiers — canonical posture + delegation routing tables

Canonical home of the model-adaptive posture table and the cost-aware delegation
routing rule (v2.1 — moved here from `docs/03-enhancement-spec.md` §4/§4.1 so it
ships with the plugin; the spec keeps the design rationale). Skills reference this
file; **no divergent copies** (copies drift).

The conductor (session model) is whatever the user chose to run — Fable 5,
Opus 4.8, Sonnet 5, or anything else. Nothing below assumes the conductor is
Fable; "top tier" always means *the session model*, and the escalation target is
the session model, not a hardcoded name.

## 1. Model-adaptive posture table

Detected at Step 0 (harness self-identification; else the kickoff prompt's
declaration; else assume the strictest posture). Applied as deltas on the shared
contract:

| Dimension | Sonnet 5 | Opus 4.8 | Fable 5 (if it's the runner) |
|---|---|---|---|
| Re-grounding cadence | every phase AND every ~10 tool calls within a phase | every phase | every phase (contract minimum) |
| Gate verbosity | gates restated inline at each trigger point | gates catalog referenced by name | catalog reference |
| Over-engineering suppressors | light | **full** (no-refactor, no-extra-abstraction, brevity snippets — Opus-class models over-build at high effort) | full at high effort |
| Verifier | mandatory fresh-context verifier | mandatory | optional (self-verification stronger, still recommended) |
| Decomposition granularity | smaller work packets, more checkpoints to disk | standard | standard |
| Cost note in report | standard | standard | flag: ~2x Opus token price — pacing/effort discipline matters |

## 2. Cost-aware tier table

When the conductor (or `/launch`, or `/iterate`) splits work into
subagents/teams, each work packet is routed to a model tier **by task shape**,
not by default to the session model:

| Tier | Use for | Typical packets |
|---|---|---|
| **Cheap** (Haiku 4.5 or host's cheapest) | mechanical, low-ambiguity, high-volume, easily-verified work | file sweeps/greps, running existing test suites, formatting/lint fixes, data extraction, screenshot-and-report browser loops, `Explore`-style codebase reads |
| **Mid** (Sonnet 5) | standard implementation and execution against a locked contract | feature build with clear spec, `/full-qa` test execution, multi-file fixes with exact instructions, research streams, doc drafting |
| **Top** (the session model — whatever the user chose as conductor) | judgment-heavy or error-amplifying work | architecture and decomposition, root-cause adjudication, **the fresh-context verifier**, skeptic/adversarial-verify subagents, cross-cutting decisions, final report reconciliation |

## 3. Routing gates

1. **Default = inherit the session model when unsure** — misrouting judgment work
   to a cheap tier costs more (rework + drift) than it saves.
2. **Never downgrade**: the verifier, skeptic/adversarial-verify subagents,
   anything writing to `decisions.md`, or any packet that locks an interface
   other packets consume.
3. **Escalate on struggle, don't pre-pay** — trigger: a lower-tier packet fails
   its contract (RED tests, delegation-gate output check, or a verifier
   challenge) after one corrected re-dispatch, or the agent thrashes (repeats a
   failed approach, or two cycles without progress) · action: re-run that slice
   one tier up — straight to the session model when the failure shows the packet
   was judgment-shaped all along — and log the escalation (packet, from-tier,
   to-tier, one-line reason) in `run-memory.md`. The inverse discipline holds
   too: do not route to the top tier "just in case" — the escalation path is
   what makes cheap-by-default safe.
4. **Effort tiers too**: where the host supports reasoning-effort settings, low
   effort for cheap mechanical stages, high only for verify/judge stages.
5. **Log the choice**: each delegation records model tier + one-line reason in
   `run-memory.md`.
6. **Disclose the spend**: the unified report's cost line becomes a per-agent
   table — packet, model tier, why, escalated? — so the human can audit the
   economics (sibling of the no-silent-caps rule). Zero escalations is itself a
   reportable fact ("zero escalations needed"), not an omission.

Degraded hosts without per-agent model selection: the rule collapses to effort
allocation and honest disclosure that tiering wasn't available.
