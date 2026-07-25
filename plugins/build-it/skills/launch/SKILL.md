---
name: launch
description: Mission control for autonomous projects — analyzes tasks, recommends approaches (sub-agents/teams), sets up environment (features, evals, hooks, init.sh), suggests and configures tooling (MCPs), and launches the work.
author: DevOtts
author_url: https://github.com/DevOtts
---

# /launch — Mission Control

You are an autonomous project orchestrator. When the user invokes `/launch`, you guide them through a structured 4-phase process to set up and run any project with minimal human intervention.

**Your role:** Analyze the task, reason about the best approach and tooling, set up the full environment, and launch the work. You are proactive — you don't just follow a checklist, you actively suggest better tools and approaches the user may not have considered.

**Reference guide:** If available, look for an autonomous workflow guide in the project for detailed patterns (harness engineering, evals, Playwright testing, hooks).

---

## Invocation modes

- **Interactive (default)** — a human ran `/launch` directly. The approval gates in Phase 2 and Phase 4.2 present recommendations and WAIT.
- **Unattended** — invoked by the `/build-it` conductor (always) or explicitly flagged `unattended`. Every approval gate becomes **recommend, log, proceed**: write the recommendation and the chosen option to `.taskstate/decisions.md` (the shared decision contract), state it in one line, and continue without asking. An unattended run must reach Phase 4.3 with zero turns spent waiting on a human.

**State location rule (D9, stated once — this is the only statement):** all run state — features, progress, breakdowns, decisions, evidence, memory — lives in `.taskstate/` at the workspace root, versioned per project (e.g. `features-v3.json`). `.claude/` is reserved for hooks and evals that must live there (it also triggers extra permission prompts in VS Code). Every later mention of those files defers to this rule.

---

## Phase 1 — ANALYZE

Before making any recommendations, gather information. This phase is **read-only**.

### 1.1 Read the Task

Ask the user what they want to accomplish if not already clear. Accept any of:
- A PRD or spec document (file path or inline)
- A requirements document from a stakeholder
- A bug report or feature request
- A verbal description of what needs to be built

### 1.2 Classify the Task Type

| Type | Signal | Example |
|------|--------|---------|
| `spec` | Needs PRD, mockups, or design docs created | "Generate PRDs for 16 agents from this doc" |
| `build` | Has an approved PRD/spec, needs implementation | "Build the Instant Indexing Agent from this PRD" |
| `fix` | Specific bug or broken behavior | "Fix the mobile overflow on the dashboard" |
| `refactor` | Restructure without changing behavior | "Migrate from REST to GraphQL" |
| `research` | Explore options, no code output yet | "Evaluate auth providers for our platform" |

### 1.3 Assess Complexity

Count or estimate:
- Number of distinct features/deliverables
- Number of files/modules that will be touched
- Whether it crosses repo boundaries
- Whether it involves UI (needs visual testing)
- Whether it involves external APIs (needs mocks)
- Whether it involves multiple stakeholder outputs (PRDs, mockups, specs)

### 1.4 Inventory the Environment

Run these checks silently and compile results:

```
CHECK: ~/.claude/mcp.json                    → What MCPs are globally configured?
CHECK: .claude/settings.json                 → Project-level MCPs and hooks?
CHECK: ~/.claude/settings.json               → Global hooks?
CHECK: ~/.claude/skills/ and project skills  → What skills are available?
CHECK: .taskstate/features-*.json            → Existing feature tracking? (use latest by version)
CHECK: .taskstate/progress-*.md              → Existing progress tracking? (use latest by version)
CHECK: init.sh or similar                    → Existing environment setup?
CHECK: package.json / go.mod / Cargo.toml    → Tech stack and package manager?
CHECK: playwright.config.* or similar        → Testing infrastructure?
CHECK: .husky/ or .git/hooks/                → Pre-commit hooks?
CHECK: CLAUDE.md                             → Existing agent instructions?
CHECK: .claude/evals/                        → Existing eval scenarios?
```

Feature/progress file locations follow the state location rule (top of this file).

Present a summary table:

```
## Environment Status

| Component          | Status | Details                          |
|--------------------|--------|----------------------------------|
| MCPs               | ✓ / ✗  | [list configured MCPs]           |
| Hooks              | ✓ / ✗  | [list configured hooks]          |
| Skills             | ✓ / ✗  | [list available skills]          |
| Feature tracking   | ✓ / ✗  | .taskstate/features-*.json       |
| Progress tracking  | ✓ / ✗  | .taskstate/progress-*.md         |
| Init script        | ✓ / ✗  | init.sh exists/missing           |
| Testing infra      | ✓ / ✗  | Playwright/Jest/Vitest config    |
| Pre-commit hooks   | ✓ / ✗  | husky/lint-staged/etc.           |
| CLAUDE.md          | ✓ / ✗  | exists/missing                   |
| Eval scenarios     | ✓ / ✗  | .claude/evals/ exists/missing    |
```

---

## Phase 2 — RECOMMEND

Present the recommendations. **Direct human invocation: wait for approval before proceeding to Phase 3. Unattended: do not emit an approval question — log the recommendation + chosen approach to `.taskstate/decisions.md` and proceed straight to Phase 3.**

### 2.1 Approach Recommendation

Use this decision logic:

**Single session** when:
- Fewer than 5 features/deliverables
- Sequential dependencies (each step needs the previous)
- Simple scope, single repo
- Budget is a concern
- Estimated cost: $0.50-5 per feature

**Sub-agents** when:
- Tasks are independent (can run in parallel)
- Only the result matters, not the process
- No need for agents to communicate with each other
- Good for: batch PRD generation, parallel research, independent file edits
- Estimated cost: $1-8 per complex task

**Agent team** when:
- 5+ features with multiple distinct components
- Needs built-in QA/review (e.g., QA agent tests what Frontend agent builds)
- Cross-layer work (backend + frontend + tests)
- Quality matters more than speed
- Teammates need to share findings or challenge each other
- Estimated cost: $5-20 per session
- Requires: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings

For teams, suggest composition based on task type:

| Task Type | Suggested Team |
|-----------|---------------|
| `spec` (PRDs + mockups) | Spec Writer + UX Designer + Reviewer |
| `build` (full app) | Backend + Frontend + QA + Reviewer |
| `build` (API only) | Backend + Tester |
| `build` (UI only) | Frontend + QA (mobile + desktop) |
| `fix` (complex bug) | Investigator A + Investigator B (competing hypotheses) |

### 2.2 Tooling Recommendations

**This is where you add the most value.** Don't just check what exists — actively suggest tools that would make the task better.

#### UI Mockups / Design

```
Task involves creating UI mockups or design specs?
├── Yes → Is Stitch MCP configured? (check mcp.json for "stitch")
│   ├── Yes → "Stitch MCP is ready. Agents will generate mockups directly
│   │          from descriptions instead of just writing Stitch prompts."
│   └── No → RECOMMEND: "I suggest installing Stitch MCP so agents can
│             generate actual UI mockups from Google Stitch, not just text prompts.
│             This turns a 'write prompts for Stitch' task into a
│             'generate mockups directly' task.
│             Want me to add it to ~/.claude/mcp.json?"
│
│             Installation:
│             Add to ~/.claude/mcp.json:
│             {
│               "stitch": {
│                 "command": "npx",
│                 "args": ["-y", "stitch-mcp"]
│               }
│             }
└── No → skip
```

#### UI Development / Testing

```
Task involves building or modifying UI?
├── Yes → Is Playwright MCP configured? (check mcp.json for "playwright")
│   ├── Yes → "Playwright MCP is ready for UI/UX testing.
│   │          Will test on mobile (375x667) and desktop (1280x720)."
│   │
│   │          Is playwright.config.* present in the project?
│   │          ├── Yes → "Playwright test config found. ✓"
│   │          └── No → RECOMMEND: "Create playwright.config.ts with
│   │                    mobile, desktop, and tablet viewport projects."
│   │
│   └── No → RECOMMEND: "Install Playwright MCP for browser-based UI testing.
│             Agents will be able to navigate, click, screenshot, and verify
│             layouts on mobile and desktop — catching visual bugs that
│             code-only testing misses.
│             Want me to add it to ~/.claude/mcp.json?"
│
│             Installation:
│             1. npm install -D @playwright/test
│             2. npx playwright install
│             3. Add to ~/.claude/mcp.json:
│             {
│               "playwright": {
│                 "command": "npx",
│                 "args": ["@playwright/mcp@latest"]
│               }
│             }
└── No → skip
```

#### External API Integration

```
Task involves calling external APIs? (Google APIs, Slack, payment providers, etc.)
├── Yes → RECOMMEND: "Create mock/simulated versions of external services
│          (digital twins) so agents can test without hitting real APIs,
│          rate limits, or production data.
│          Services to mock: [list detected from PRD/spec]"
└── No → skip
```

#### Research / Content Synthesis

```
Task involves research or content analysis?
├── Yes → Is NotebookLM skill available?
│   ├── Yes → "Can use /notebooklm to create a research notebook,
│   │          add sources, and synthesize findings before starting work."
│   └── No → skip
└── No → skip
```

#### Code Quality

```
Task touches an existing codebase?
├── Yes → Are pre-commit hooks configured? (check .husky/, .git/hooks/)
│   ├── Yes → "Pre-commit hooks found. ✓"
│   └── No → RECOMMEND: "Set up pre-commit hooks (husky + lint-staged)
│             for type checking and linting. This prevents agents from
│             committing broken code."
└── No (greenfield) → RECOMMEND: "Set up ESLint + Prettier + TypeScript
                        strict mode from the start. Agents work better
                        with strong guardrails."
```

#### LLM Observability / Tracing

```
Task involves LLM calls? (OpenAI SDK, OpenRouter, LangChain, direct API calls)
├── Yes → Is LangSmith configured? (check for LANGSMITH_API_KEY in .env or env vars)
│   ├── Yes → "LangSmith tracing is configured. ✓"
│   │
│   │          Is `wrapOpenAI` used? (check for langsmith/wrappers import)
│   │          ├── Yes → "Token + cost tracking via wrapOpenAI. ✓"
│   │          └── No → RECOMMEND: "Upgrade from @traceable to wrapOpenAI
│   │                    for automatic token counts (input/output/total)
│   │                    and cost estimates per call. @traceable alone
│   │                    captures inputs/outputs/latency but NOT tokens."
│   │
│   └── No → RECOMMEND: "Install LangSmith for LLM observability.
│             Captures token usage, cost estimates, latency, and
│             full input/output traces for every LLM call.
│             Want me to set it up?"
│
│             Setup:
│             1. Install: `npm install langsmith` (or `uv add langsmith`)
│             2. Add to .env:
│                LANGSMITH_TRACING=true
│                LANGSMITH_ENDPOINT=https://api.smith.langchain.com
│                LANGSMITH_API_KEY=<key from https://smith.langchain.com/settings>
│                LANGSMITH_PROJECT=<project-name>
│                LANGCHAIN_PROJECT=<project-name>  # JS SDK reads THIS, not LANGSMITH_PROJECT
│
│             3. Wrap the OpenAI client (works with OpenRouter too):
│                import { wrapOpenAI } from 'langsmith/wrappers';
│                export const client = wrapOpenAI(new OpenAI({ ... }));
│
│             4. For accurate cost tracking, pass ls_model_name:
│                await client.chat.completions.create(
│                  { model, messages, ... },
│                  { langsmithExtra: { metadata: { ls_model_name: model.replace(/^[^/]+\//, '').replace(/\./g, '-') } } }
│                );
│
│             Key insight: wrapOpenAI emits LLM-flavored LangSmith runs
│             with token counts + cost. @traceable only gets latency + I/O.
│             When using OpenRouter, costs are directional (LangSmith's
│             built-in price table, not OpenRouter's margin); token counts
│             are always correct.
└── No → skip
```

#### Domain Skills

```
Are there project-specific skills available? (check .claude/skills/ in the project)
├── Yes → List them and recommend the most relevant one for the task.
│          Example: "Found /some-skill — will use it for [purpose]."
└── No → "No domain-specific skill detected. Will use generic approach."
```

### 2.3 Quality Gate Recommendations

Present which hooks should be configured:

| Hook | Type | Purpose | Recommended? |
|------|------|---------|-------------|
| Stop | agent | Verify tests pass before Claude stops | Always |
| TaskCompleted | agent | Require Playwright evidence for UI tasks | When UI involved |
| PostToolUse (Edit\|Write) | command | Auto-format with Prettier | When Prettier available |
| Notification | command | Desktop alert when Claude needs attention | Always |
| SessionStart (compact) | command | Re-inject critical context after compaction | Always |

### 2.4 Present Summary

Format your recommendation as:

```
## Launch Plan

**Task:** [one-line summary]
**Type:** [spec | build | fix | refactor | research]
**Approach:** [single session | sub-agents | agent team (N members)]

### Team (if applicable)
- [Role 1]: [responsibility] (tier: [cheap/mid/top] — [one-line reason])
- [Role 2]: [responsibility] (tier: …)
- ...

Tiers come from the **delegation routing rule** — the canonical table in `../references/model-tiers.md` §2–3 (relative to this skill's base directory; ships with the plugin — reference it; never copy it). Gates: default = inherit the session model when unsure; never downgrade the verifier, anything writing to `decisions.md`, or a packet locking an interface others consume; escalate on struggle rather than pre-paying — a lower-tier worker that fails its contract after one corrected re-dispatch, or thrashes, is re-run one tier up; log each tier choice, reason, and escalation to `.taskstate/run-memory.md`.

### Tooling Changes
- [ ] [Install/configure X — reason]
- [ ] [Install/configure Y — reason]
- [x] [Z already configured ✓]

### Environment Setup
- [ ] Create features.json (N features)
- [ ] Create progress.md
- [ ] Create init.sh
- [ ] Create eval scenarios
- [ ] Configure hooks
- [ ] Update CLAUDE.md

Approve this plan to proceed with setup.
```

(Unattended: replace the closing line with "Proceeding — plan logged to `.taskstate/decisions.md`.")

---

## Phase 3 — SETUP

After user approves the plan, execute the setup. Do each step, report progress.

### 3.1 Create features.json

Parse the PRD/spec into granular features:

```json
{
  "project": "[project name]",
  "created": "[date]",
  "total": N,
  "completed": 0,
  "features": [
    {
      "id": "F001",
      "name": "[feature name]",
      "group": "[backend | frontend | integration | config]",
      "status": "fail",
      "spec": "[one-line specification]",
      "depends_on": [],
      "test": "[how to verify this feature works]",
      "completed_at": null
    }
  ]
}
```

Rules:
- ALL features start as `"status": "fail"`
- Break into 10-50 features (too few = too vague, too many = overhead)
- Include dependency chains where they exist
- Group by logical area for team assignment
- Each feature must have a clear test criterion

Save to `.taskstate/features-[version].json` (per the state location rule).

### 3.2 Create progress.md

```markdown
# Project Progress

## Status
- **Project:** [name]
- **Started:** [date]
- **Features file:** [absolute path to .taskstate/features-*.json]
- **Features:** 0 / [N] completed
- **Last session:** none
- **Current blocker:** none

## Session Log
<!-- Each session adds an entry here -->
```

Save to `.taskstate/progress-[version].md` (per the state location rule).

### 3.3 Create init.sh

Auto-detect the project and generate:

```bash
#!/bin/bash
set -e

echo "=== Setting up environment ==="

# Detect and install dependencies
if [ -f "bun.lockb" ]; then
  bun install
elif [ -f "pnpm-lock.yaml" ]; then
  pnpm install
elif [ -f "yarn.lock" ]; then
  yarn install
elif [ -f "package.json" ]; then
  npm install
fi

# Build (if applicable)
if grep -q '"build"' package.json 2>/dev/null; then
  npm run build
fi

# Start dev server (if applicable)
if grep -q '"dev"' package.json 2>/dev/null; then
  npm run dev &
  DEV_PID=$!
  echo "Dev server started (PID: $DEV_PID)"

  # Wait for server to be ready
  echo "Waiting for server..."
  for i in $(seq 1 30); do
    if curl -s http://localhost:${PORT:-3000}/api/health > /dev/null 2>&1; then
      echo "Server ready on :${PORT:-3000}"
      break
    fi
    sleep 1
  done
fi

echo "=== Environment ready ==="
```

Customize based on detected tech stack. Make executable with `chmod +x init.sh`.

### 3.4 Create Eval Scenarios

Create `.claude/evals/scenarios/` with behavior-based test scenarios.

For each major feature area, create a scenario file:

```markdown
# S001: [Scenario Name]

## Preconditions
- [what must be true before testing]

## Steps
1. [observable action from user perspective]
2. [next action]
...

## Expected Results
- [what the user should see/experience]
- [specific measurements if applicable — viewport sizes, element sizes, etc.]

## Viewports
- Desktop: 1280x720
- Mobile: 375x667
```

Create `.claude/evals/runner.sh`:

```bash
#!/bin/bash
# Run AFTER the build is complete, in a SEPARATE session
# This is the external eval — agents don't see these during development

claude -p "You are a QA evaluator. Read each scenario in .claude/evals/scenarios/
and test it against the running app using Playwright MCP.
For each scenario, report PASS or FAIL with evidence (screenshots).
Do NOT read any source code. Only interact with the app through the browser.
Output results to .claude/evals/results.json"
```

### 3.5 Configure Hooks

Add to `.claude/settings.json` (create if needed):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Check: 1) Has .taskstate/features-[version].json been updated with current progress? 2) Has .taskstate/progress-[version].md been updated? 3) Was the last completed feature committed to git? If any are missing, respond with {\"ok\": false, \"reason\": \"describe what's missing\"}."
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "osascript -e 'display notification \"Claude Code needs your attention\" with title \"Claude Code\"' 2>/dev/null; exit 0"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "compact",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'CONTEXT REMINDER: Read [ABSOLUTE_PATH]/.taskstate/features-[version].json for feature status. Read [ABSOLUTE_PATH]/.taskstate/progress-[version].md for current state. Pick the next FAILING feature and work on it. Commit after completing each feature.'"
          }
        ]
      }
    ]
  }
}
```

**Note:** Replace `[ABSOLUTE_PATH]` with the actual absolute path to the workspace root and `[version]` with the project version (e.g. `v3`). Use absolute paths in the SessionStart hook so it works regardless of working directory.

If the task involves UI, add TaskCompleted and Playwright-aware Stop hooks:

```json
{
  "hooks": {
    "TaskCompleted": [
      {
        "hooks": [
          {
            "type": "agent",
            "prompt": "Verify this task is complete: check that relevant tests pass on both mobile (375x667) and desktop (1280x720) viewports. If tests fail or layout is broken, respond with {\"ok\": false, \"reason\": \"what needs fixing\"}.",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

### 3.6 Install Recommended MCPs

For each accepted MCP recommendation from Phase 2:

1. Read current `~/.claude/mcp.json`
2. Add the new MCP entry
3. Inform the user they need to restart Claude Code for MCPs to take effect
4. Add usage notes to CLAUDE.md

### 3.7 Create/Update CLAUDE.md

If no CLAUDE.md exists, create a minimal one. If one exists, append the project section.

Template:

```markdown
# [Project Name]

## Quick Start
- Run `./init.sh` to set up the environment
- Read `.taskstate/features-[version].json` for feature list and status
- Read `.taskstate/progress-[version].md` for current state
- Read `[path to PRD]` for the full specification

## Rules
- Pick the highest-priority FAILING feature from features.json
- Implement the feature, then verify it works
- Commit after each completed feature with a descriptive message
- Update progress.md and features.json after each feature
- A feature's status may move to "pass" only with tool-result evidence from this session (test output, response body, screenshot) appended to `.taskstate/evidence.md` — "should work" is not evidence
- No unrequested refactors, no speculative abstractions — build the feature the spec asks for, nothing past it
- If you encounter something surprising, note it here

## Testing
[auto-generated based on detected test infrastructure]

## Available Tools
[auto-generated based on configured MCPs and skills]
```

### 3.8 Pre-flight Check

Before proceeding to Phase 4, verify:

```
PRE-FLIGHT CHECKLIST
[✓/✗] features.json is valid JSON with all features
[✓/✗] progress.md exists and is initialized
[✓/✗] init.sh exists and is executable
[✓/✗] Eval scenarios created in .claude/evals/scenarios/
[✓/✗] Hooks configured in .claude/settings.json
[✓/✗] CLAUDE.md exists with project instructions
[✓/✗] All recommended MCPs are configured (may need restart)
[✓/✗] Git repo is clean (no uncommitted changes)
```

Report any failures and fix them before proceeding.

---

## Phase 4 — LAUNCH

### 4.1 Compose the Launch Prompt

Based on the chosen approach, compose the prompt:

#### For Sub-agents (parallel independent tasks)

> **Safe parallel (v3):** if the sub-agents will *write to the repo*, isolate each in its own `git worktree`/`agent/<lane>` branch and merge back sequentially with an integration check per lane — never two writers on one `.git`. Read-only research agents may share the tree. Protocol: `../references/parallel-safety.md`.

```
I'll now spawn [N] sub-agents to work on these tasks in parallel:

[For each batch of tasks:]
- Sub-agent 1: [task description, file references]
- Sub-agent 2: [task description, file references]
...

Each sub-agent should:
1. Read the relevant section of [PRD path]
2. Implement the feature(s) assigned — no unrequested refactors, nothing beyond the assigned spec
3. [If domain skill exists:] Follow the [skill name] skill
4. Return the results when done; a feature reports "pass" only with tool-result evidence (test output, response, screenshot) — "should work" is not evidence
```

#### For Agent Teams

```
Create an agent team for [project name].

Specification: Read [PRD path]
Feature tracking: Read [ABSOLUTE_PATH]/.taskstate/features-[version].json
Progress: Read [ABSOLUTE_PATH]/.taskstate/progress-[version].md

Team:
[For each role from the recommendation:]
- [Role] (tier per the routing rule in `../references/model-tiers.md` §2–3): [Responsibilities]. Work in [file paths].

Rules:
- Require plan approval before implementation
- [Role A] and [Role B] work in parallel on independent features
- No unrequested refactors, no speculative abstractions — build what the feature spec asks, nothing past it
- [QA Role] tests every feature after implementation on mobile (375x667) and desktop (1280x720)
- features.json moves to "pass" only when QA confirms with tool-result evidence appended to .taskstate/evidence.md — "should work" is not evidence
- Commit after each completed feature with descriptive messages
- Update .taskstate/progress-[version].md after each feature

[If domain skill exists:]
- Follow the [skill name] skill at [path]

[If Stitch MCP is available:]
- Use Stitch MCP to generate UI mockups directly (mcp__stitch__* tools)

[If Playwright MCP is available:]
- QA: Use Playwright MCP to test on both mobile and desktop viewports
- Take screenshots of any issues found
```

#### For Single Session

```
Read the specification at [PRD path].
Read the feature list at [ABSOLUTE_PATH]/.taskstate/features-[version].json.
Run ./init.sh to set up the environment.

Work through features in priority order (respect depends_on chains).
No unrequested refactors — implement the feature as specified, nothing past it.
After each feature:
1. Verify it works [with Playwright if UI task]
2. Update features.json status to "pass" only with the verification's tool-result evidence appended to .taskstate/evidence.md
3. Update progress.md
4. Commit with a descriptive message

[If domain skill exists:]
Follow the [skill name] skill at [path] for implementation patterns.
```

### 4.2 Present and Confirm

**Direct human invocation:** show the composed prompt to the user and ask:
- "Ready to launch? I'll start with this prompt."
- Or: "Here's the headless command if you want to run it in the background:"

**Unattended:** do not ask. Log the composed prompt to `.taskstate/decisions.md` and go straight to 4.3.

```bash
claude -p "$(cat .claude/prompts/launch-[project].md)" \
  --dangerously-skip-permissions
```

### 4.3 Execute

Once cleared (user confirmed, or unattended — already logged in 4.2), execute the launch:
- For sub-agents: start spawning them
- For agent teams: create the team with the composed prompt
- For single session: begin working through features

---

## Appendix: Common Patterns

### Batch PRD Generation (Case 1)

When the task is "generate N PRDs from a requirements doc":

1. Analyze: type=`spec`, complexity=N deliverables
2. Recommend: sub-agents (PRDs are independent), suggest Stitch MCP for mockups
3. Setup: create features.json with one feature per PRD
4. Launch: spawn sub-agents in batches of 3-4, each writing one PRD

Template for each PRD sub-agent:
```
Read [requirements doc path] and extract the specification for [Agent N].
Write a comprehensive PRD following the format in [template PRD path].

The PRD must include:
- Summary, Classification, User Stories
- Data Flow (sources, outputs, flow diagram)
- Processing Logic (validation, API calls, error handling)
- Database Schema (if applicable)
- UI Specification (page layouts, components, interactions)
- [If Stitch MCP available:] Generate a Stitch mockup for each UI page
- [If Stitch MCP not available:] Write a Stitch prompt for each UI page
- Error Handling & Edge Cases (table format)
- Events (listens/emits)
- Configuration Schema
- Success Criteria (checkboxes)
- App Manifest (JSON)

Save to: [output path]/[agent-slug]-prd.md
```

### Full App Development (Case 2)

When the task is "build an app from an approved PRD":

1. Analyze: type=`build`, assess feature count from PRD
2. Recommend: agent team (Backend + Frontend + QA), Playwright for testing
3. Setup: features.json, init.sh, eval scenarios, hooks
4. Launch: team with plan approval required
5. If domain skill exists: agents follow the relevant skill for implementation patterns

### Bug Fix with Competing Hypotheses

When the root cause is unclear:

1. Analyze: type=`fix`, multiple possible causes
2. Recommend: agent team with 3-5 investigators, each testing a different hypothesis
3. Setup: minimal — just progress.md and hooks
4. Launch: adversarial team where investigators challenge each other's theories

---
_Authored by [DevOtts](https://github.com/DevOtts)._
