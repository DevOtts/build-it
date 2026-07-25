---
session: build-it-rename-v3.1.0
alias: claudinho
session_id: 7f3cfc86-78cc-43c8-ad06-c796222278f1
project: build-it (repo folder still fable-it at close; mv pending)
cwd: /Users/macbook/Workspace/Devotts/fable-it
date: 2026-07-25
status: done
tags: [rename, release, build-it, lifecycle-family, marketplaces, build-it-run]
---

## Objective
Rename fable-it → build-it (user-confirmed spelling), ship v3.1.0, and sweep every sibling *-it plugin's living docs to the new name.

## Key results
- build-it v3.1.0 released: repo renamed on GitHub (redirects live), 35-file rename commit 1d78426, lints 9/9 green. https://github.com/DevOtts/build-it/releases/tag/v3.1.0
- Sibling sweep pushed to main: plan-it b264b06 (32f, incl. build-it:<preset> tier vocab + fixed pre-existing version-triple-match.mjs), review-it 15f, prompt-it 6f, master-loop 2f, parallel-lifecycle 1f.
- Local skills: /build-it live, /fable-it = deprecated pointer; 10 referencing user skills swept; project memory pre-staged at the future -build-it path key.
- Repaired corrupted devotts marketplace registration (installLocation pointed into .claude-anm); re-added from DevOtts/review-it; review-it@devotts reinstalled. Stale fable-it@devotts v0.1.0 intentionally not restored (no current source).
- Historical artifacts deliberately keep the old name (records, not docs).

## Files touched/created
- fable-it repo: plugins/build-it/**, SKILL.md, marketplace.json, CHANGELOG 3.1.0, docs/v3.1.0-followup-KICKOFF.md (asset-regen handoff)
- .build-it-reports/report-v3.1.0-rename.md — full DoD report (6/6 VERIFIED)
- ~/.claude/skills/{build-it,fable-it}/SKILL.md — new skill + deprecation stub

## Pointers
- Report: .build-it-reports/report-v3.1.0-rename.md · Decisions: .taskstate/decisions.md D5–D11 · Memory: build-it-rename-v3.1.0.md (both path keys)

## Next
- Fernando: mv fable-it→build-it folder, then fresh session runs docs/v3.1.0-followup-KICKOFF.md prompt (asset regen — pixels still say fable-it).
- Later: prompt-it eval refresh at its next release; decide which repo owns the "devotts" marketplace name (build-it plugin currently not installable from it); field-guide PDF regenerate-vs-drop.
