# Changelog

All notable changes to build-it (formerly fable-it) are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

## [3.1.0] — 2026-07-24

**fable-it is now build-it.** What started as a single plugin ("make your model
behave like Fable") grew into the build stage of the *-it lifecycle family —
plan-it plans it, build-it builds it, review-it reviews it. The name now says
what it does. Gates, run-state contract, and verifier protocol are unchanged.

### Changed
- Renamed the plugin, skill, marketplace entry, and repository from
  `fable-it` to `build-it` (`plugins/fable-it/` → `plugins/build-it/`,
  `skills/fable-it/` → `skills/build-it/`). GitHub redirects from
  `DevOtts/fable-it` remain in place.
- Retired the "Make your model behave like Fable" tagline for the lifecycle
  positioning; the Fable-behavioral-contract research and sources are
  unchanged and still linked from the README.
- Report folder convention is now `.build-it-reports/`; a legacy
  `.fable-it-reports/lessons.md` is still read for cross-run memory.
- Hardened-mode hooks disable switch is now `BUILD_IT_HOOKS_DISABLED=1`; the
  legacy `FABLE_IT_HOOKS_DISABLED=1` is still honored.

### Kept for back-compat
- `/fable-it`, "fable it" and "fable-it" remain trigger phrases on the skill,
  and `fable-it` stays in the keywords, so existing prompts and muscle memory
  keep routing here.
- Historical artifacts (past reports, research docs, delivery/ planning docs,
  earlier CHANGELOG entries) keep the old name — they are records, not docs.

## [3.0.1] — 2026-07-08

**Interlock hardening** — fixes two protocol races found in the post-release
Fable 5 review (CONTRACT v1.1 amendment); gates unchanged. Validated by two
A/B rounds against v2.1.0: identical deliverable quality on a single-lane
run, and a 60/46 rubric win on an adversarial parallel run where v2 reported
confident false completion with leftover worktrees.

### Fixed
- **Atomic RUNLOCK acquisition**: the lock is created with exclusive-create
  semantics (`set -C` noclobber / `O_EXCL`), never read-then-check-then-write —
  two runs starting simultaneously can no longer both believe they own the tree
  (TOCTOU race).
- **Time-based heartbeat**: the heartbeat is refreshed on a timer (2–3 min) as
  well as at phase boundaries — a single long phase (big build, slow agent wave)
  can no longer make a live run look stale and get "reclaimed" mid-work.
- **Reclaim requires a dead owner**: same-host pid liveness overrides an aged
  heartbeat; a lock whose owner is provably alive is never reclaimed.

### Added
- **Stale lane-branch cleanup** (worktree gate): leftover `agent/<lane>` branches
  from a crashed run are detected before dispatch and salvaged/deleted with a
  logged note (or the lane is suffixed) — `git worktree add -b` no longer fails
  on crash leftovers.
- **Scope note**: the RUNLOCK protects one working tree; separate clones of the
  same repo coordinate at the remote (protected branches/PRs), not via the lock.

## [3.0.0] — 2026-07-08

**Safe parallel execution** — a fable-it run that fans out parallel *mutating*
agents, or that shares a repo with another session, was previously unprotected at
the level of the working tree itself: the delegation gate checked that a worker's
output *existed*, not that two workers weren't writing the same `.git`, nor that a
merged slice actually integrated. This release adds three gates that make parallel
and multi-session execution safe by construction. Grounded in the v3-research
dogfood findings (EC-B8 parallel-program interlock, EC-C8 workspace quiesce, EC-G5
per-slice integration) and a firsthand incident where two coordinators co-mutating
one repo's `.git` corrupted the tree.

### Added
- **Interlock gate (G-INTERLOCK)**: a run acquires a `.taskstate/RUNLOCK` (owner ·
  host · pid · startedAt · heartbeat) at start and before any mutating fan-out; a
  live lock held by another run makes this run BLOCK or wait rather than co-mutate;
  a stale lock (dead owner / expired heartbeat) is reclaimed with a logged note;
  released on the stop-hook. Treat the working tree like a database — serialize or
  isolate concurrent writers, never hope.
- **Worktree gate (G-WORKTREE)**: each parallel *mutating* agent runs in its own
  `git worktree` on an `agent/<lane>` branch; the coordinator alone merges lanes
  back, sequentially. Read-only fan-out may share the tree. No subagent runs
  `git merge`/`checkout`/`reset` in a shared tree.
- **Integration gate (G-INTEGRATE)**: after a slice merges back, acceptance requires
  the *merged* tree to pass the project's integration shape (build, lockfile present
  + consistent, declared tests/lints) — not merely "the worker's output exists." A
  slice green in isolation but integration-broken (canonical: a `package.json` added
  with no lockfile) is reopened, not accepted.
- New reference `plugins/fable-it/skills/references/parallel-safety.md` — the
  operational protocol (RUNLOCK schema, worktree fan-out/merge-back recipe,
  stale-lock reclaim, integration check) that the three gates and `/launch`,
  `/iterate` point at. Optional fail-open Claude Code preflight/stop hook noted.
- Six binding tabletop goldens (T30–T35) exercising each gate, including an incident
  replay proving the 2026-07-08 shared-`.git` collision is structurally prevented.

## [2.1.0] — 2026-07-05

**Tiering that actually ships** — closes the three gaps that forced users to keep
pasting a "use lower models for lower tasks" paragraph into every prompt.

### Added
- **Escalate-on-struggle routing gate**: a lower-tier packet that fails its
  contract (RED tests, delegation-gate output check, or a verifier challenge)
  after one corrected re-dispatch — or thrashes — is re-run one tier up, straight
  to the session model when it turns out judgment-shaped. Escalations are logged
  to `run-memory.md` and disclosed in the report's cost table (new `Escalated?`
  column); "zero escalations needed" is itself a reportable fact. The inverse
  discipline is explicit too: don't pre-pay top tier for struggle that hasn't
  happened.
- **`/iterate` model tiering**: its Subagent Strategy now routes by task shape
  (Explore reads and parallel test runs → cheap; spec'd multi-file fixes → mid;
  skeptic/adversarial-verify and Plan → session model, never downgraded), with
  the same escalation rule — standalone `/iterate` runs no longer default
  everything to the session model.

### Fixed
- **The canonical tier + posture tables now ship with the plugin** at
  [`plugins/fable-it/skills/references/model-tiers.md`](plugins/fable-it/skills/references/model-tiers.md).
  v2.0 skills referenced `docs/03-enhancement-spec.md` §4/§4.1, which lives at the
  repo root and is **not packaged** — on installed hosts the reference resolved
  nothing, exactly where tiering matters most. All skills now point at the
  shipped file; the spec keeps the design rationale and points forward.

### Changed
- **Model-agnostic conductor wording**: "top tier" is defined as *the session
  model — whatever the user chose to run* (Fable 5, Opus 4.8, Sonnet 5, …), never
  a hardcoded model name; the escalation target follows the same rule.
- `tests/lints/t24-launch-routing.sh` now checks the shipped canonical table
  (existence + escalation gate), rejects stale spec references, and requires the
  escalate-on-struggle rule in `/launch`.

## [2.0.0] — 2026-07-02

**"Make your model behave like Fable"** — v2 rebuilds the plugin from postures into
checkable gates, built from firsthand Fable 5 research (live harness introspection +
Anthropic's "Prompting Claude Fable 5" guide) instead of secondhand descriptions.
Evidence for every design decision: [`docs/research/01-fable5-vs-opus.md`](docs/research/01-fable5-vs-opus.md)
and [`docs/research/02-gap-analysis.md`](docs/research/02-gap-analysis.md).
Shipped against a 26-case binding test contract ([`delivery/STATUS.md`](delivery/STATUS.md)).

### Added
- **5-gate catalog** in the conductor, replacing posture prose: turn-end, claim,
  state-change, phase-boundary, and delegation gates — each a trigger + test + action
  checked at a decision point (PR #5).
- **Run-state contract**: four compaction-proof files in `.taskstate/`
  (`grounding.md`, `decisions.md`, `evidence.md`, `run-memory.md`) re-read at every
  phase boundary, plus cross-run memory in `.fable-it-reports/lessons.md` (PR #5).
- **Evidence ledger — VERIFIED is a lookup, not a vibe**: a criterion may only be
  reported VERIFIED if `evidence.md` holds a passing tool result from the session
  (the Anthropic-measured claim-grounding rule) (PR #5).
- **Fresh-context verifier step**: before delivery, a verifier that reads ONLY the
  DoD, the draft report, and the evidence ledger challenges every under-evidenced
  VERIFIED row; challenged rows get real evidence or a demotion. Degraded self-audit
  protocol for hosts without subagents (PR #7).
- **Model-adaptive posture** applied at Step 0 for Sonnet 5, Opus 4.8, and Fable 5
  (re-grounding cadence, gate verbosity, over-engineering suppressors) (PR #5).
- **Cost-aware delegation routing**: work packets routed to model tiers by task shape
  (cheap/mid/top), default-inherit when unsure, the verifier never downgraded, every
  choice logged and disclosed in a per-agent cost table (PRs #5, #8).
- **`/launch` unattended mode**: conductor-invoked runs recommend, log to
  `decisions.md`, and proceed — zero interactive stalls; direct human runs keep their
  approval gates (PR #8).
- **Loop upgrades**: delegation gate (idle ≠ delivered), adversarial verify before
  trusting a root cause, loop-until-dry exploratory QA (2 consecutive dry rounds),
  no-silent-caps sections in every report (PR #9).
- **Hardened mode (opt-in, fail-open)**: Claude Code hooks that mechanically block
  promise-endings (`turn-end-gate.py`) and evidence-free VERIFIED rows
  (`evidence-lint.py`), with unit tests and a documented settings snippet
  ([`plugins/fable-it/hooks/README.md`](plugins/fable-it/hooks/README.md)) (PR #10).
- **Shared CDP core** (`plugins/fable-it/skills/references/cdp-core.md`): connection
  template, tab selection, selector ladder, waits, and failure protocol in exactly one
  file; endpoints parameterized (`CDP_URL`/`APP_URL`) so parallel runs can't collide (PR #6).
- **Test infrastructure**: registered tabletop goldens (`delivery/goldens/`), scripted
  lints (`tests/lints/run-all.sh`), hook unit tests.

### Changed
- **Rebrand**: "Make Opus behave like Fable" → **"Make your model behave like Fable"**;
  badges and descriptions now name Sonnet 5 + Opus 4.8.
- **One report verdict**: `/iterate` and `/full-qa` reports are feeders into the
  conductor's unified report (Evidence column, per-agent cost table, no-silent-caps);
  full-qa's Go-Live verdict maps onto the DoD table instead of standing alone (PRs #5, #9).
- **Root `SKILL.md` (portable mode)** upgraded from descriptions to operational,
  host-agnostic mechanics: the full gates catalog, run-state files, claim rule, and
  degraded verifier protocol — what Cursor/Codex/Copilot users actually run (PR #11).
- **Honest claim narrowed and sourced**: evidence-grounded status reporting suppresses
  the failure modes that bite overnight runs — it does not make a model "more honest"
  in general; the ports/stays table now cites the research and corrects one row
  (honest reporting is prompt-induced on Fable too) (PR #11).
- **Route guard hardened**: authenticated real-Chrome work goes only to
  `/chrome-cdp-control` per-write gates; `/full-qa` autonomous mode is for test
  environments only (PR #6).
- State-location rule stated once: run state lives in `.taskstate/`; `.claude/` is
  reserved for hooks/evals (PR #8).

### Security
- No autonomous write path on authenticated browser sessions, ever (route guard, PR #6).
- Hardened-mode hooks are opt-in, fail-open, logged, and one-line disableable (PR #10).

## [0.1.0] — 2026-06-22

Initial release: the fable-it conductor (autonomous posture, pre-grounding gate,
three coherence guardrails, honest per-criterion report) bundled with `/launch`,
`/iterate`, `/full-qa` and `/chrome-cdp-control`; multi-platform install via the
root `SKILL.md`.

[3.0.1]: https://github.com/DevOtts/fable-it/releases/tag/v3.0.1
[3.0.0]: https://github.com/DevOtts/fable-it/releases/tag/v3.0.0
[2.1.0]: https://github.com/DevOtts/fable-it/releases/tag/v2.1.0
[2.0.0]: https://github.com/DevOtts/fable-it/releases/tag/v2.0.0
[0.1.0]: https://github.com/DevOtts/fable-it/commits/cb1b17a
