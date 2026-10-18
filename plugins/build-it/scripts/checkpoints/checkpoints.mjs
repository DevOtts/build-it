#!/usr/bin/env node
// checkpoints: build-it's reader for the review-it checkpoints plan-it decided
// (`review_checkpoints` in plan/READINESS.json, schema review-checkpoints/1).
// Policy text: do-it docs/implementation/do-it-next/CHECKPOINT-POLICY.md (v1).
// build-it never decides the count; it reads it, runs review-it at each
// checkpoint, and refuses to cross a boundary without a PASS verdict file.
// Zero dependencies.
//
// Usage (every command takes --readiness <plan/READINESS.json>):
//   checkpoints.mjs plan              list the checkpoints
//   checkpoints.mjs due --at <ref>    checkpoints due at a boundary: a wave id
//                                     (W1), a task id, adversarial, pre-merge, pre-release
//   checkpoints.mjs check --id CP-01  is the verdict file there and a PASS?
//   checkpoints.mjs status            every checkpoint with its verdict state
// Exit: 0 ok/PASS · 1 FAIL or invalid · 2 missing (file, block or verdict) · 3 nothing due.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA = "review-checkpoints/1";
export const KINDS = ["phase", "wave", "adversarial", "pre-merge", "pre-release"];
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
  });
  if (block.inputs && block.inputs.tasks > 0 && !block.checkpoints.some((c) => c && c.kind === "pre-merge")) errs.push("no pre-merge checkpoint");
  return errs;
}

// Which checkpoints fire at a boundary reference.
export function dueAt(block, ref) {
  const r = String(ref);
  return block.checkpoints.filter((c) => c.kind === r || c.at === `after ${r}` || String(c.at).startsWith(`after ${r},`));
}

// Verdict file contract: non-empty, carries `checkpoint: <id>` and
// `verdict: PASS|FAIL` lines (review-it writes them in its report header).
export function readVerdict(file, id) {
  if (!fs.existsSync(file)) return { state: "missing", reason: `no verdict file at ${file}` };
  const text = fs.readFileSync(file, "utf8");
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
  if (!["plan", "due", "check", "status"].includes(cmd)) { out("usage: checkpoints.mjs <plan|due|check|status> --readiness <file> [--root <repo>]"); return done(1); }
  if (!fs.existsSync(file)) { out(`MISSING ${file}: plan-it writes plan/READINESS.json at G4`); return done(2); }
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { out(`INVALID ${file}: ${e.message}`); return done(1); }
  const block = doc.review_checkpoints;
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
    for (const c of block.checkpoints) out(`${c.id}  ${c.kind.padEnd(11)}  ${c.at}  ->  blocks ${c.blocks}  ->  ${c.evidence}`);
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
    if (v.state === "missing") { out(`MISSING ${c.id}: ${v.reason}. Do not cross: ${c.blocks}.`); return done(2); }
    out(`${v.state === "fail" ? "FAIL" : "INVALID"} ${c.id}: ${v.reason || "review-it verdict is FAIL"}. Do not cross: ${c.blocks}.`);
    return done(1);
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
