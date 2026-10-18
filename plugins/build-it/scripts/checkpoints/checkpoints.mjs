#!/usr/bin/env node
// checkpoints: build-it's reader for the review-it checkpoints plan-it decided
// (`review_checkpoints` in plan/READINESS.json, schema review-checkpoints/1).
// Policy text: do-it docs/implementation/do-it-next/CHECKPOINT-POLICY.md (v1).
// build-it never decides the count; it reads it, runs review-it at each
// checkpoint, and asks `gate` before it starts, promotes, merges or releases.
// A checkpoint holds only what its `gates` name, for the work it `covers`: a
// wave checkpoint holds the slices that depend on that wave and the promotion
// of that wave's work, never independent work (finding H-10).
// Zero dependencies.
//
// Usage (every command takes --readiness <plan/READINESS.json>):
//   checkpoints.mjs plan              list the checkpoints
//   checkpoints.mjs due --at <ref>    checkpoints due at a boundary: a wave id
//                                     (W1), a task id, adversarial, pre-merge, pre-release
//   checkpoints.mjs check --id CP-01  is the verdict file there and a PASS?
//   checkpoints.mjs status            every checkpoint with its verdict state
//   checkpoints.mjs gate --action start|promote|merge|release [--slice <id>]
//                                     may this action go ahead now?
// Exit: 0 ok/PASS · 1 FAIL or invalid · 2 missing (file, block or verdict) · 3 nothing due.
// gate exits: 0 allowed · 2 blocked (every unmet checkpoint named) · 1 cannot evaluate.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA = "review-checkpoints/1";
export const KINDS = ["phase", "wave", "adversarial", "pre-merge", "pre-release"];
export const GATES = ["dependents", "promotion", "merge", "release"];
export const ACTIONS = ["start", "promote", "merge", "release"];
// Which gates each action must clear. A release publishes all the work, so it
// also needs every promotion gate.
const ACTION_GATES = { start: ["dependents"], promote: ["promotion"], merge: ["merge"], release: ["release", "promotion"] };
// What build-it does when an older plan has no block: one pre-merge review.
export const FALLBACK = { id: "CP-01", kind: "pre-merge", at: "before merge to main", evidence: "plan/reviews/CP-01-pre-merge.md" };

export function validateBlock(block) {
  const errs = [];
  if (!block || typeof block !== "object") return ["review_checkpoints must be an object"];
  if (block.schema !== SCHEMA) errs.push(`schema must be "${SCHEMA}"`);
  if (!Array.isArray(block.checkpoints)) return [...errs, "checkpoints must be an array"];
  if (block.count !== block.checkpoints.length) errs.push(`count ${JSON.stringify(block.count)} does not match ${block.checkpoints.length} checkpoint(s)`);
  block.checkpoints.forEach((c, i) => {
    if (!c || c.id !== `CP-${String(i + 1).padStart(2, "0")}`) errs.push(`checkpoints[${i}].id out of sequence`);
    if (!c || !KINDS.includes(c.kind)) errs.push(`checkpoints[${i}].kind invalid`);
    if (!c || typeof c.evidence !== "string" || !c.evidence.trim()) errs.push(`checkpoints[${i}].evidence missing`);
    if (c && c.gates !== undefined && (!Array.isArray(c.gates) || !c.gates.length || c.gates.some((g) => !GATES.includes(g)))) errs.push(`checkpoints[${i}].gates must be a non-empty subset of ${GATES.join(", ")}`);
    if (c && c.covers !== undefined && (!Array.isArray(c.covers) || c.covers.some((x) => typeof x !== "string" || !x.trim()))) errs.push(`checkpoints[${i}].covers must be a list of slice or wave ids`);
  });
  if (block.inputs && block.inputs.tasks > 0 && !block.checkpoints.some((c) => c && c.kind === "pre-merge")) errs.push("no pre-merge checkpoint");
  return errs;
}

// Which checkpoints fire at a boundary reference.
export function dueAt(block, ref) {
  const r = String(ref);
  return block.checkpoints.filter((c) => c.kind === r || c.at === `after ${r}` || String(c.at).startsWith(`after ${r},`));
}

// The gates and covers of a checkpoint. Plans written before these fields
// existed get the corrected meaning, never "hold the whole next wave": wave and
// phase hold dependents and promotion of the boundary they sit after;
// adversarial holds merge (dependents when its old blocks text was "start of",
// the case where it replaced a mid-plan wave boundary); pre-merge holds merge;
// pre-release holds release. covers: null means "not known".
export function effective(c) {
  const legacy = !Array.isArray(c.gates);
  let gates = c.gates;
  if (legacy) {
    if (c.kind === "wave" || c.kind === "phase") gates = ["dependents", "promotion"];
    else if (c.kind === "adversarial") gates = /^\s*start of\b/i.test(String(c.blocks || "")) ? ["dependents"] : ["merge"];
    else if (c.kind === "pre-merge") gates = ["merge"];
    else gates = ["release"];
  }
  let covers = Array.isArray(c.covers) ? c.covers.map(String) : null;
  if (!covers && (gates.includes("dependents") || gates.includes("promotion"))) {
    const m = /^after ([^,\s]+)(,|$)/.exec(String(c.at || ""));
    // A legacy phase checkpoint names only the lock task, not everything before
    // it, so its coverage is unknown rather than guessed.
    if (m && c.kind !== "phase") covers = [m[1]];
  }
  return { gates, covers, legacy };
}

// What a checkpoint holds, in words. A legacy `blocks` text ("start of W2")
// is not repeated, because it is the old, wrong meaning.
export function holdsText(c) {
  const e = effective(c);
  if (!e.legacy && c.blocks) return c.blocks;
  const what = e.covers ? e.covers.join(", ") : "the covered work (unknown)";
  const parts = e.gates.map((g) => (g === "dependents" ? `slices that depend on ${what}` : g === "promotion" ? `promotion of ${what}` : g === "merge" ? "merge to main" : "tag, publish or deploy"));
  return parts.join(", and ");
}

// Every slice the given slice depends on, directly or through others.
function ancestors(byId, id) {
  const seen = new Set();
  const unknown = new Set();
  const stack = [...(byId.get(id).depends_on || [])].map(String);
  while (stack.length) {
    const d = stack.pop();
    if (seen.has(d) || unknown.has(d)) continue;
    const s = byId.get(d);
    if (!s) { unknown.add(d); continue; }
    seen.add(d);
    for (const x of s.depends_on || []) stack.push(String(x));
  }
  return { seen, unknown };
}

// Does the covered set contain slice `id`? Returns true/false, or a string
// saying why it cannot be told.
function covered(cov, waveIds, s) {
  if (cov.includes(s.id)) return true;
  const waves = cov.filter((x) => waveIds.has(x));
  if (!waves.length) return false;
  if (typeof s.wave !== "string" || !s.wave) return `slice ${s.id} carries no "wave", so covers ${waves.join(", ")} cannot be resolved for it (plan-it's decide --write tags slices with their wave from the wave task lists; re-run it with waves that list task ids)`;
  return waves.includes(s.wave);
}

// Pure: may `action` go ahead? verdictOf(c) -> { state, reason }.
// Returns { exit, lines }.
export function gateDecision(doc, block, action, sliceId, verdictOf) {
  const lines = [];
  if (!ACTIONS.includes(action)) return { exit: 1, lines: [`gate: --action must be one of ${ACTIONS.join(", ")}`] };
  if (action === "start" && !sliceId) return { exit: 1, lines: ["gate: --action start needs --slice <id>: a start is held only by checkpoints covering what that slice depends on"] };
  const slices = Array.isArray(doc.slices) ? doc.slices.filter((s) => s && s.id !== undefined).map((s) => ({ ...s, id: String(s.id) })) : [];
  const byId = new Map(slices.map((s) => [s.id, s]));
  let target = null;
  if (sliceId) {
    target = byId.get(String(sliceId));
    if (!target) return { exit: 1, lines: [`gate: no slice ${sliceId} in READINESS.json slices (${slices.length ? slices.length + " slice(s)" : "the file has no slices list"})`] };
  }
  const waveIds = new Set([...(block.inputs && Array.isArray(block.inputs.waves) ? block.inputs.waves : []), ...slices.map((s) => s.wave).filter(Boolean)].map(String));
  const want = ACTION_GATES[action];
  const blocked = [];
  const unknown = [];
  let anc = null;
  if (action === "start") {
    anc = ancestors(byId, target.id);
    if (anc.unknown.size) unknown.push(`slice ${target.id} depends on ${[...anc.unknown].join(", ")}, which ${anc.unknown.size === 1 ? "is" : "are"} not in READINESS.json slices`);
  }
  for (const c of block.checkpoints) {
    const e = effective(c);
    const hit = e.gates.filter((g) => want.includes(g));
    if (!hit.length) continue;
    const v = verdictOf(c);
    if (v.state === "pass") continue;
    const why = `${c.id} ${c.kind} ${v.state.toUpperCase()}: ${v.reason || "review-it verdict is FAIL"}`;
    const scoped = hit.filter((g) => g === "dependents" || g === "promotion");
    // merge and release take the whole branch, and so does a promote with no
    // --slice: nothing to scope.
    const whole = action === "merge" || action === "release" || (action === "promote" && !target);
    if (whole || scoped.length < hit.length) { blocked.push(`${why}; holds ${holdsText(c)}`); continue; }
    if (!e.covers) { unknown.push(`${c.id} ${c.kind} has no covers${e.legacy ? " (a plan written before gates/covers; re-run plan-it's review-checkpoints decide)" : ""}, so what it holds cannot be told; its verdict is ${v.state}`); continue; }
    const pool = action === "start" ? [...anc.seen].map((x) => byId.get(x)) : [target];
    const hits = [];
    const cant = [];
    for (const s of pool) {
      const r = covered(e.covers, waveIds, s);
      if (r === true) hits.push(s.id);
      else if (typeof r === "string") cant.push(r);
    }
    if (hits.length) blocked.push(action === "start" ? `${why}; slice ${target.id} depends on covered work ${hits.join(", ")}` : `${why}; slice ${target.id} is covered work`);
    else if (cant.length) unknown.push(`${c.id} ${c.kind} (${v.state}): ${cant.join("; ")}`);
  }
  const subject = target ? `${action} ${target.id}` : action;
  if (blocked.length) {
    lines.push(`BLOCKED ${subject}: ${blocked.length} unmet checkpoint(s)`);
    for (const b of blocked) lines.push(`  ${b}`);
    for (const u of unknown) lines.push(`  ALSO CANNOT EVALUATE ${u}`);
    return { exit: 2, lines };
  }
  if (unknown.length) {
    lines.push(`CANNOT EVALUATE ${subject}:`);
    for (const u of unknown) lines.push(`  ${u}`);
    return { exit: 1, lines };
  }
  lines.push(`ALLOWED ${subject}: no unmet checkpoint holds it`);
  return { exit: 0, lines };
}

// Verdict file contract: non-empty, carries `checkpoint: <id>` and
// `verdict: PASS|FAIL` lines (review-it writes them in its report header).
export function readVerdict(file, id) {
  if (!fs.existsSync(file)) return { state: "missing", reason: `no verdict file at ${file}` };
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { return { state: "invalid", reason: `cannot read ${file}: ${e.code || e.message}` }; }
  if (!text.trim()) return { state: "invalid", reason: `${file} is empty` };
  const cp = /^\s*checkpoint:\s*(\S+)\s*$/im.exec(text);
  if (!cp || cp[1] !== id) return { state: "invalid", reason: `${file} does not name checkpoint ${id}` };
  const v = /^\s*verdict:\s*(PASS|FAIL)\b/im.exec(text);
  if (!v) return { state: "invalid", reason: `${file} has no "verdict: PASS|FAIL" line` };
  return { state: v[1] === "PASS" ? "pass" : "fail", reason: null };
}

function arg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export function main(argv, cwd = process.cwd()) {
  const [cmd, ...args] = argv;
  const lines = [];
  const out = (s) => lines.push(s);
  const done = (code) => { process.stdout.write(lines.join("\n") + (lines.length ? "\n" : "")); return code; };
  const readiness = arg(args, "--readiness") || "plan/READINESS.json";
  const root = arg(args, "--root") || cwd;
  const file = path.resolve(root, readiness);
  if (!["plan", "due", "check", "status", "gate"].includes(cmd)) { out("usage: checkpoints.mjs <plan|due|check|status|gate> --readiness <file> [--root <repo>]"); return done(1); }
  if (!fs.existsSync(file)) { out(`MISSING ${file}: plan-it writes plan/READINESS.json at G4`); return done(2); }
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { out(`INVALID ${file}: ${e.message}`); return done(1); }
  const block = doc.review_checkpoints;
  if (!block && cmd === "gate") {
    out(`CANNOT EVALUATE ${file} has no review_checkpoints (plan made before CHECKPOINT-POLICY v1); the one fallback checkpoint ${FALLBACK.id} ${FALLBACK.kind} holds merge only.`);
    return done(1);
  }
  if (!block) {
    out(`NO-BLOCK ${file} has no review_checkpoints (plan made before CHECKPOINT-POLICY v1).`);
    out(`FALLBACK run one review-it checkpoint: ${FALLBACK.id} ${FALLBACK.kind} (${FALLBACK.at}), verdict at ${FALLBACK.evidence}`);
    return done(2);
  }
  const errs = validateBlock(block);
  if (errs.length) { for (const e of errs) out(`INVALID ${e}`); return done(1); }

  if (cmd === "plan") {
    if (block.count === 0) { out("0 checkpoints: the plan has no tasks, so there is nothing to build or review."); return done(0); }
    out(`${block.count} checkpoint(s), level ${block.level}, score ${block.score ? block.score.total : "?"}`);
    for (const c of block.checkpoints) out(`${c.id}  ${c.kind.padEnd(11)}  ${c.at}  ->  holds ${holdsText(c)}  ->  ${c.evidence}`);
    return done(0);
  }
  if (cmd === "due") {
    const at = arg(args, "--at");
    if (!at) { out("due: --at <ref> is required"); return done(1); }
    const due = dueAt(block, at);
    if (!due.length) { out(`none due at ${at}`); return done(3); }
    for (const c of due) out(`DUE ${c.id} ${c.kind}: run review-it (${c.review}); write the verdict to ${c.evidence}`);
    return done(0);
  }
  if (cmd === "check") {
    const id = arg(args, "--id");
    const c = block.checkpoints.find((x) => x.id === id);
    if (!c) { out(`check: no checkpoint ${id}`); return done(1); }
    const v = readVerdict(path.resolve(root, c.evidence), c.id);
    if (v.state === "pass") { out(`PASS ${c.id} ${c.kind}: ${c.evidence}`); return done(0); }
    const holds = `Holds until PASS: ${holdsText(c)}. Work that does not depend on it goes on; ask \`gate\``;
    if (v.state === "missing") { out(`MISSING ${c.id}: ${v.reason}. ${holds}.`); return done(2); }
    out(`${v.state === "fail" ? "FAIL" : "INVALID"} ${c.id}: ${v.reason || "review-it verdict is FAIL"}. ${holds}.`);
    return done(1);
  }
  if (cmd === "gate") {
    const g = gateDecision(doc, block, arg(args, "--action"), arg(args, "--slice"), (c) => readVerdict(path.resolve(root, c.evidence), c.id));
    for (const l of g.lines) out(l);
    return done(g.exit);
  }
  // status
  // 0 only when every verdict is PASS; a FAIL or bad file outranks a missing one.
  let failed = false;
  let missing = false;
  for (const c of block.checkpoints) {
    const v = readVerdict(path.resolve(root, c.evidence), c.id);
    out(`${c.id}  ${c.kind.padEnd(11)}  ${v.state.toUpperCase().padEnd(7)}  ${c.evidence}`);
    if (v.state === "missing") missing = true;
    else if (v.state !== "pass") failed = true;
  }
  if (block.count === 0) out("0 checkpoints: nothing to review.");
  return done(failed ? 1 : missing ? 2 : 0);
}

function isMain() {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); }
}
if (isMain()) process.exit(main(process.argv.slice(2)));
