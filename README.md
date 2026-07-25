<div align="center">

<h1>/build-it</h1>

<h3>
  <strong>plan-it plans it, build-it builds it.</strong>
</h3>

<p>
  Hand Claude a goal and a numbered Definition of Done.<br>
  <strong>Go to sleep. Wake up to an honest report.</strong>
</p>

<p>
  <em>Formerly <code>fable-it</code>. Behavior transfers. That's what makes overnight jobs survivable.</em>
</p>


<a href="#how-it-works">
  <img src="assets/build-it-header.gif" alt="build-it process flow — goal, DoD, autonomous run, honest report" width="100%">
</a>

<p>
  <a href="#installation"><img src="https://img.shields.io/badge/Quick%20Start-Install-blue?style=for-the-badge" alt="Quick Start"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge" alt="License: MIT"></a>
  <a href="https://claude.ai/code"><img src="https://img.shields.io/badge/Works%20with-Claude%20Code-orange?style=for-the-badge&logo=anthropic" alt="Works with Claude Code"></a>
  <a href="https://claude.ai/code"><img src="https://img.shields.io/badge/tuned%20for-Sonnet%205-blueviolet?style=for-the-badge" alt="Tuned for Sonnet 5"></a>
  <a href="https://claude.ai/code"><img src="https://img.shields.io/badge/tuned%20for-Opus%204.8-blueviolet?style=for-the-badge" alt="Tuned for Opus 4.8"></a>
  <a href="https://github.com/DevOtts"><img src="https://img.shields.io/badge/author-DevOtts-181717?style=for-the-badge&logo=github" alt="Author: DevOtts"></a>
</p>


<p>
  <a href="#installation">Install</a>
  &nbsp;·&nbsp;
  <a href="#the-honest-claim">The honest claim</a>
  &nbsp;·&nbsp;
  <a href="#how-it-works">How it works</a>
  &nbsp;·&nbsp;
  <a href="#whats-bundled">What's bundled</a>
  &nbsp;·&nbsp;
  <a href="#platform-compatibility">Platform compatibility</a>
  &nbsp;·&nbsp;
  <a href="#sources">Sources</a>
  &nbsp;·&nbsp;
  <a href="CHANGELOG.md">Changelog</a>
</p>


> [!IMPORTANT]
> **📛 v3.1.0 (2026-07-24) — fable-it is now build-it.** Same plugin, new name: what began as model-specific branding ("make your model behave like Fable") grew into the build stage of the *-it lifecycle — plan-it plans it, build-it builds it, review-it reviews it. GitHub redirects from `DevOtts/fable-it` stay in place, the old `/fable-it` trigger still routes here, and new runs write to `.build-it-reports/` (a legacy `.fable-it-reports/lessons.md` is still read).

> [!IMPORTANT]
> **🔒 v3.0.1 (2026-07-08) — safe parallel execution, now proven under contention.** A build-it run that fans out parallel *mutating* agents — or shares a repo with another session — is now safe **by construction**: an atomic run lock ([G-INTERLOCK](plugins/build-it/skills/references/parallel-safety.md)), one `git worktree` per mutating lane (G-WORKTREE), and a merged-tree integration gate (G-INTEGRATE), hardened in v3.0.1 with TOCTOU-free lock acquire, timer heartbeats, dead-owner-only reclaim, and crash-leftover lane cleanup. Validated by two A/B rounds against v2.1.0: identical deliverable quality single-lane, and a 60/46 rubric win on an adversarial parallel run — v2's failure mode (confident false completion with leftover worktrees) is structurally eliminated. Details in the [CHANGELOG](CHANGELOG.md).

> [!NOTE]
> **Optimized for long tasks** — research, browser tasks and mainly **vibe coding**.

> [!NOTE]
> **The lifecycle family** — [`plan-it`](https://github.com/DevOtts/plan-it) plans → **build-it** builds → [`review-it`](https://github.com/DevOtts/review-it) verifies. review-it is the QA front door: it runs the plan-phase Test Contract against what build-it built (the independent review stage), enforces an 11-rule gate catalog against false-VERIFIED claims, and shares build-it's evidence-ledger report format.

<br>
</div>

When you watch Fable run a long, multi-step task, the thing that stands out isn't raw cleverness. It's that it **holds the thread**: it doesn't contradict a decision it made an hour ago, it tests its own work before claiming it's done, it reports honestly when it couldn't verify something, and it doesn't wander off building things you never asked for.

That's *behavior*, not IQ — and behavior transfers. build-it v2 encodes that behavioral contract — captured firsthand from a live Fable 5 session and cross-checked against Anthropic's "Prompting Claude Fable 5" guide — as **checkable gates with disk-backed state**, model-adaptive for **Sonnet 5 and Opus 4.8**, so your model runs long, unattended jobs the way Fable does.

**What v2 adds:** a 5-gate catalog replacing posture prose (turn-end, claim, state-change, phase-boundary, delegation) · an evidence ledger that makes `VERIFIED` a lookup, not a vibe · a fresh-context verifier that audits every report before it ships · a model-adaptive posture applied at Step 0 · cost-aware delegation routing · optional [hardened-mode hooks](plugins/build-it/hooks/README.md) (opt-in, fail-open) that mechanically block promise-endings and evidence-free VERIFIED rows on Claude Code.

**What v3 adds:** three gates that make parallel and multi-session runs safe **by construction** — an atomic `.taskstate/RUNLOCK` interlock (two runs can never co-mutate one tree), per-lane `git worktree` isolation for every mutating subagent, and a merged-tree integration gate so a slice that's green in isolation but breaks the build is reopened, not accepted. The full protocol lives in [`parallel-safety.md`](plugins/build-it/skills/references/parallel-safety.md).

## The honest claim

It does **not** turn Sonnet or Opus into Fable, and anyone who tells you a skill can do that is selling something. It makes your model **behave** like Fable on long work — which is most of what you actually felt when you used Fable. Precisely: evidence-grounded status reporting and reference verification measurably suppress the failure modes that bite overnight runs (Anthropic reports the claim-grounding snippet "nearly eliminated fabricated status reports"). It does not make a model "more honest" in general.

| Ports to your model ✓ | Stays with Fable ✕ |
|---|---|
| Coherence across a long run, holding early constraints | Raw reasoning ceiling on genuinely hard problems |
| Self-verification before declaring a step done | One-shotting a complex system from a thin prompt |
| Honest, evidence-backed progress reporting — **prompt-induced on Fable too** (the claim-grounding rule is published prompt text, the best possible news for a skill that ports it) | The deepest long-context retention quality |
| Autonomous-turn discipline, no needless pausing | Anything that comes from the weights, not the prompt |
| Restraint — doing the job, not inventing scope | |

The line is real (evidence: the [Sources](#sources) below). But the part that ports over is the part that makes overnight jobs survivable: your model runs them far more like Fable than it did yesterday.

## Installation

build-it ships as both a **Claude Code plugin** and a standard repo-root **`SKILL.md`**, so it installs across the whole agent ecosystem. Pick your tool below.

> [!TIP]
> **Two universal installers** understand the `SKILL.md` standard and drop build-it into the right directory for 70+ tools — use these if your agent isn't listed:
> ```sh
> npx skills add DevOtts/build-it -a <agent>   # e.g. -a codex, -a cursor, -a github-copilot ; add -g for global
> gh skill install DevOtts/build-it            # GitHub CLI (project or user scope)
> ```
> Peek first with `npx skills add DevOtts/build-it --list`.

### Claude Code  ·  *native, full experience*

```sh
# 1. Register the marketplace
/plugin marketplace add DevOtts/build-it

# 2. Install the plugin (plugin-name@marketplace-name)
/plugin install build-it@devotts
```

The marketplace name `devotts` comes from the `name` field in [marketplace.json](.claude-plugin/marketplace.json). This is the **only** target that gets the full bundle — the conductor *plus* `launch`, `iterate`, `full-qa` and `chrome-cdp-control`, with slash-command invocation and auto-activation. (Skills-CLI alternative: `npx skills add DevOtts/build-it -a claude-code`.)

### Codex  ·  *OpenAI Codex CLI*

```sh
npx skills add DevOtts/build-it -a codex
# or:  gh skill install DevOtts/build-it
```

Installs to the shared `.agents/skills/build-it/` that Codex reads. Codex doesn't carry the bundled sibling skills, so build-it runs the launch/iterate/QA phases **inline** (graceful degradation) — you still get the autonomous posture, pre-grounding gate, coherence guardrails and the honest per-criterion report.

### OpenClaw

```sh
npx skills add DevOtts/build-it -a openclaw
```

Lands in `.openclaw/skills/build-it/SKILL.md`.

### Cursor

```sh
npx skills add DevOtts/build-it -a cursor      # add -g for a global install
```

Installs into Cursor's `.agents/skills/` and is auto-discovered.

### VS Code + GitHub Copilot

```sh
npx skills add DevOtts/build-it -a github-copilot
# or:  gh skill install DevOtts/build-it
```

Copilot auto-discovers skills under `.agents/skills/`.

### Copilot CLI

```sh
gh skill install DevOtts/build-it
# or:  npx skills add DevOtts/build-it -a github-copilot
```

### Kiro CLI / IDE

```sh
gh skill install DevOtts/build-it
```

If your Kiro build doesn't yet read the shared skills path, drop the skill in manually:

```sh
git clone https://github.com/DevOtts/build-it /tmp/build-it
mkdir -p "<kiro-skills-dir>/build-it" && cp /tmp/build-it/SKILL.md "<kiro-skills-dir>/build-it/"
```

### Others  ·  *OpenCode · Cline · Windsurf · Zed · Gemini CLI · Antigravity · Amp · Warp …*

```sh
npx skills add DevOtts/build-it -a <agent>
```

Run `npx skills add DevOtts/build-it --list`, then target your agent — the CLI knows the correct path for each. **Manual fallback for any tool:** clone the repo and copy the root [`SKILL.md`](SKILL.md) into your agent's skills/instructions directory.

> [!NOTE]
> On every target **except Claude Code**, build-it installs as a single behavior skill (the root `SKILL.md`). The delegated `/launch`, `/iterate`, `/full-qa` and `/chrome-cdp-control` are Claude Code plugin skills; elsewhere build-it executes those phases inline and notes the absence in its report. The thing that ports everywhere is the **behavior** — and that's the whole point.

## How it works

You hand build-it a **goal** and a **numbered Definition of Done**. It does the rest — unattended.

```
Goal: Ship the Shopify → Postgres sync for the analytics dashboard.

DoD:
1. Shopify orders sync to postgres.orders with correct schema
2. Incremental sync works (only new orders since last run)
3. Dashboard /analytics page shows real data, not mocks
4. All three pass in the QA report
```

build-it is a **conductor, not a replacement**. If you already run Claude Code with skills like `/launch`, `/iterate`, `/full-qa` and `/chrome-cdp-control`, it routes each piece of work to the right one at the right moment — and never pastes a worse copy of their logic. Improve `/iterate`, and build-it inherits the improvement.

![build-it process flow diagram](assets/build-it-flow.png)


On top of routing, it enforces the layer that otherwise gets hand-written into every overnight prompt:

- **Autonomous posture** — keeps moving instead of stopping to ask permission, clamped by two counter-rules: don't fake confidence, don't gold-plate. Irreversible actions still need prior authorization.
- **Pre-grounding gate** — reads the real source of truth (the actual schema, the real endpoint) *before* writing a line of code, so hour-3 work doesn't drift from hour-1 reality.
- **Three coherence guardrails** that stop long, parallel runs from quietly falling out of sync:
  1. **Shared decision contract** — parallel agents read and write one shared file for every cross-cutting decision, so a renderer is never built for schema A while a connector saves schema B.
  2. **Cross-session interface file** — when this run assumes work another session is still building, it writes the contract both sides agree on instead of guessing.
  3. **Honest per-criterion status** — every DoD item gets a state with evidence: `VERIFIED`, `IMPLEMENTED-NOT-VERIFIED`, or `BLOCKED`. No green result is ever reported off a mock or an assumption.

The coherence problem on long jobs isn't raw capability — it's decisions made in hour 1 contradicting work done in hour 3. The guardrails exist for exactly that.

## Use

You don't have to type a command — the skill **auto-activates** when you describe a goal-to-DoD delivery:

> *"work autonomously until done"* · *"I'm going to bed, finish this"* · *"run to DoD"* · *"green light, take decisions"* · or a goal followed by numbered acceptance criteria.

To invoke it explicitly (plugin skills are namespaced by the plugin name):

```
/build-it:build-it Build the Shopify multi-store connector.
  DoD:
  1. Backfill shows all records in connector-logs
  2. Pooling enabled in UI, records appear in logs
  3. New interactions visible on the timeline page
  4. ShopifyRenderer shows details for a clicked item
```

Only two things are required: the **goal** and a **numbered DoD**. Everything else has a sensible default — credentials, tooling inferred from the DoD, parallelism, report location. The status report and any credentials artifact are written to `.build-it-reports/` at the workspace root (not the repo root), so the run leaves a clean tree behind — `.gitignore` that one folder if you'd rather not track it. It's built to run unattended: a long silence means it's working, not stuck.

## What's bundled

| Skill | Role |
|-------|------|
| `build-it` | The conductor — owns posture, guardrails, and the final report |
| `launch` | Mission control: environment inventory, approach selection, agent topology |
| `iterate` | Diagnosis → fix → test → evaluate cycles |
| `full-qa` | Autonomous QA suite: reads a test plan, runs CDP + iterate, produces a pass/fail report |
| `chrome-cdp-control` | Step-by-step control of your real, logged-in Chrome via Playwright over CDP |

Because the skills it delegates to ship inside the plugin, there are no missing dependencies. And if a delegated skill is absent in some environment, build-it **degrades gracefully** — it runs that phase inline and notes the absence in its report, rather than failing.

## What the report looks like

```
# Build-it Report — Shopify → Postgres analytics sync
Run window: 02:14 → 05:47  |  Approach: single session

## DoD status
| # | Criterion                          | Status                    | Evidence              |
|---|------------------------------------|---------------------------|-----------------------|
| 1 | Orders sync with correct schema    | VERIFIED                  | 1,847 rows, schema ✓  |
| 2 | Incremental sync works             | VERIFIED                  | delta query confirmed |
| 3 | Dashboard shows real data          | IMPLEMENTED-NOT-VERIFIED  | service was down      |
| 4 | All three pass in QA report        | BLOCKED                   | depends on #3         |

## Recommended next actions
- Restart the dashboard service and re-run /full-qa for criterion 3
```

`VERIFIED` means real data, a real endpoint, real evidence — never a mock dressed up as a pass.

## Status

Honest, like the skill itself: v2 ships against a **26-case binding test contract** (`delivery/epics-build-it-v2.md`) — tabletop-golden scenarios judged by fresh-context agents against transcripts registered before implementation, scripted grep-lints (`tests/lints/`), and executable hook unit tests (`plugins/build-it/hooks/tests/`). Live-run `[REAL]` cases were exercised on Sonnet 5 and Opus 4.8 sessions; per-epic status lives in `delivery/STATUS.md`.

v3's parallel-safety protocol adds its own gate: **6 goldens (T30–T35)**, each independently judged by a fresh-context verifier with a citation-lint over the transcripts, plus two **A/B validation rounds against v2.1.0** — identical deliverable quality on a single-lane run, and a 60/46 rubric win on an adversarial parallel run where v2 confidently reported false completion. The interlock itself was exercised live: two concurrent build-it sessions on this very repo, with the loser blocking and resuming cleanly.

It has not yet been hammered end-to-end in every environment. Validate the plugin locally before relying on it:

```sh
claude plugin validate ./plugins/build-it
claude plugin validate .
```

## Sources

The claims above are researched, not vibes — the ports/stays table and every v2 design decision trace to two documents in this repo:

- [`docs/research/01-fable5-vs-opus.md`](docs/research/01-fable5-vs-opus.md) — what makes Fable 5 better than Opus and which parts a skill can port (advantage catalog F1–F17, with evidence classes: first-party docs, benchmarks, live introspection of a Fable 5 session, community analysis)
- [`docs/research/02-gap-analysis.md`](docs/research/02-gap-analysis.md) — build-it v1 audited against that catalog (gaps, structural defects D1–D9, priority tiers that became the v2 epics)

## Security considerations

- **No secrets are required to install or run the skill.** You supply credentials only for the specific job you ask it to do.
- It reads `.full.credentials` and `.env` **locally only** — these are never transmitted anywhere and are not committed.
- Browser automation uses **your own Chrome** via the Chrome DevTools Protocol (CDP) on a local port, reusing your existing logged-in session. build-it does not store or exfiltrate your cookies or session.
- Any credential created during a run (e.g. an admin token, a registry login) is **isolated in a dedicated credentials artifact** with rotation notes — never buried inside the prose report.
- Irreversible actions (dropping tables, force-push, destructive migrations on shared/prod state) always require explicit prior authorization; autonomy covers reversible work only.

## Platform compatibility

build-it is a `SKILL.md` at its core, so it runs anywhere the open [Agent Skills](https://github.com/vercel-labs/skills) standard does. **Claude Code** gets the full plugin (conductor **+** the four bundled skills); every other tool gets the portable **behavior layer** — posture, pre-grounding gate, guardrails and honest report — with the delegated phases running inline.

Every `skills add -a <agent>` row below is shorthand for `npx skills add DevOtts/build-it -a <agent>` (append `-g` for a global install). Don't see your tool? Run `npx skills add DevOtts/build-it --list` — the CLI supports 70+ agents.

| Platform | Status | Install Method |
|----------|--------|----------------|
| Claude Code | ✅ Native | Plugin marketplace |
| Cursor | ✅ Supported | Auto-discovery |
| VS Code + GitHub Copilot | ✅ Supported | Auto-discovery |
| Copilot CLI | ✅ Supported | `gh skill install` |
| Codex | ✅ Supported | `skills add -a codex` |
| OpenCode | ✅ Supported | `skills add -a opencode` |
| OpenClaw | ✅ Supported | `skills add -a openclaw` |
| Antigravity | ✅ Supported | `skills add -a antigravity` |
| Gemini CLI | ✅ Supported | `skills add -a gemini-cli` |
| Pi Agent | ✅ Supported | `skills add -a pi` |
| Vibe CLI | ✅ Supported | `skills add -a mistral-vibe` |
| Hermes | ✅ Supported | `skills add -a hermes-agent` |
| Cline | ✅ Supported | `skills add -a cline` |
| KIMI CLI | ✅ Supported | `skills add -a kimi-code-cli` |
| Trae | ✅ Supported | `skills add -a trae` |
| Nanobot | ✅ Supported | Manual — copy `SKILL.md` |
| Kiro CLI / IDE | ✅ Supported | `skills add -a kiro-cli` |
| Windsurf · Zed · Amp · Warp · Roo · Goose · Junie · Qwen · …50+ more | ✅ Supported | `npx skills add DevOtts/build-it --list` |

**Legend** — **✅ Native:** the complete plugin (conductor + all four bundled skills, slash-command + auto-activation). **✅ Supported:** the root `SKILL.md` behavior layer installs and runs; Claude-specific delegated skills execute inline rather than being routed.

## License

MIT — see [LICENSE](LICENSE) and [plugin.json](plugins/build-it/.claude-plugin/plugin.json). Use it, fork it, ship with it.

---

Thank you for contribution:
- [andre2654](https://github.com/andre2654)
- [mBidarra](https://github.com/mBidarra)
- [her0 Studio](https://github.com/her0-studio/)

---

_Built by [DevOtts](https://github.com/DevOtts)._