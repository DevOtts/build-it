// build-it's reader for review_checkpoints (CHECKPOINT-POLICY v1).
// Run: node --test tests/checkpoints/
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateBlock, dueAt, readVerdict } from "../../plugins/build-it/scripts/checkpoints/checkpoints.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "../../plugins/build-it/scripts/checkpoints/checkpoints.mjs");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/READINESS.json"), "utf8"));
const BLOCK = FIXTURE.review_checkpoints;

function repo(doc = FIXTURE) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "buildit-cp-"));
  fs.mkdirSync(path.join(d, "plan", "reviews"), { recursive: true });
  if (doc !== null) fs.writeFileSync(path.join(d, "plan", "READINESS.json"), JSON.stringify(doc));
  return d;
}
const run = (root, ...a) => spawnSync(process.execPath, [SCRIPT, ...a, "--root", root], { encoding: "utf8" });
const verdict = (root, rel, body) => fs.writeFileSync(path.join(root, rel), body);

test("the fixture block (harness-status-tracking) validates", () => {
  assert.deepEqual(validateBlock(BLOCK), []);
  assert.equal(BLOCK.count, 5);
});

test("validateBlock refuses tampering", () => {
  const rows = [
    [{ ...BLOCK, count: 2 }, /does not match/],
    [{ ...BLOCK, schema: "x" }, /schema/],
    [{ ...BLOCK, checkpoints: BLOCK.checkpoints.map((c, i) => (i === 1 ? { ...c, id: "CP-09" } : c)) }, /sequence/],
    [{ ...BLOCK, checkpoints: BLOCK.checkpoints.map((c, i) => (i === 0 ? { ...c, kind: "vibe" } : c)) }, /kind/],
    [{ ...BLOCK, checkpoints: BLOCK.checkpoints.map((c, i) => (i === 0 ? { ...c, evidence: "" } : c)) }, /evidence/],
  ];
  for (const [b, re] of rows) assert.match(validateBlock(b).join("\n"), re);
  const noMerge = { ...BLOCK, checkpoints: BLOCK.checkpoints.slice(0, 3), count: 3 };
  assert.match(validateBlock(noMerge).join("\n"), /pre-merge/);
});

test("dueAt maps boundaries to checkpoints", () => {
  const rows = [["W1", ["CP-01"]], ["W2", ["CP-02"]], ["W3", ["CP-03"]], ["adversarial", ["CP-03"]], ["pre-merge", ["CP-04"]], ["pre-release", ["CP-05"]], ["W9", []]];
  for (const [ref, ids] of rows) assert.deepEqual(dueAt(BLOCK, ref).map((c) => c.id), ids, ref);
});

test("readVerdict: missing, empty, wrong id, no verdict line, FAIL, PASS", () => {
  const d = repo();
  const f = path.join(d, "v.md");
  assert.equal(readVerdict(f, "CP-01").state, "missing");
  fs.writeFileSync(f, "  \n");
  assert.equal(readVerdict(f, "CP-01").state, "invalid");
  fs.writeFileSync(f, "checkpoint: CP-02\nverdict: PASS\n");
  assert.equal(readVerdict(f, "CP-01").state, "invalid");
  fs.writeFileSync(f, "checkpoint: CP-01\nall good\n");
  assert.equal(readVerdict(f, "CP-01").state, "invalid");
  fs.writeFileSync(f, "# review-it\ncheckpoint: CP-01\nverdict: FAIL\ncases: 3/5\n");
  assert.equal(readVerdict(f, "CP-01").state, "fail");
  fs.writeFileSync(f, "# review-it\ncheckpoint: CP-01\nverdict: PASS\ncases: 5/5\n");
  assert.equal(readVerdict(f, "CP-01").state, "pass");
  fs.rmSync(d, { recursive: true, force: true });
});

test("CLI plan lists every checkpoint; no READINESS is exit 2", () => {
  const d = repo();
  const r = run(d, "plan");
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /5 checkpoint\(s\), level heightened/);
  assert.equal(r.stdout.trim().split("\n").length, 6);
  const empty = repo(null);
  assert.equal(run(empty, "plan").status, 2);
  fs.rmSync(d, { recursive: true, force: true });
  fs.rmSync(empty, { recursive: true, force: true });
});

test("CLI: an older plan with no block is exit 2 and names the one-checkpoint fallback", () => {
  const { review_checkpoints, ...old } = FIXTURE;
  const d = repo(old);
  const r = run(d, "plan");
  assert.equal(r.status, 2);
  assert.match(r.stdout, /FALLBACK .*pre-merge/);
  fs.rmSync(d, { recursive: true, force: true });
});

test("CLI: zero-task plan says there is nothing to review", () => {
  const zero = { ...FIXTURE, review_checkpoints: { ...BLOCK, inputs: { ...BLOCK.inputs, tasks: 0 }, level: "none", count: 0, checkpoints: [] } };
  const d = repo(zero);
  const r = run(d, "plan");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /0 checkpoints/);
  assert.equal(run(d, "status").status, 0);
  fs.rmSync(d, { recursive: true, force: true });
});

test("CLI due: exit 0 with the verdict path, 3 when nothing is due", () => {
  const d = repo();
  const r = run(d, "due", "--at", "W1");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /DUE CP-01 wave: .*plan\/reviews\/CP-01-wave-w1\.md/);
  assert.equal(run(d, "due", "--at", "W3").status, 0);
  assert.equal(run(d, "due", "--at", "W7").status, 3);
  fs.rmSync(d, { recursive: true, force: true });
});

test("CLI check gates the boundary: missing 2, FAIL 1, PASS 0", () => {
  const d = repo();
  let r = run(d, "check", "--id", "CP-01");
  assert.equal(r.status, 2);
  assert.match(r.stdout, /Holds until PASS: slices outside W1 that depend on it, and promotion of W1/);
  assert.doesNotMatch(r.stdout, /start of W2/);
  verdict(d, "plan/reviews/CP-01-wave-w1.md", "checkpoint: CP-01\nverdict: FAIL\n");
  assert.equal(run(d, "check", "--id", "CP-01").status, 1);
  verdict(d, "plan/reviews/CP-01-wave-w1.md", "checkpoint: CP-01\nverdict: PASS\ncases: 12/12\n");
  r = run(d, "check", "--id", "CP-01");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^PASS CP-01/);
  assert.equal(run(d, "check", "--id", "CP-77").status, 1);
  fs.rmSync(d, { recursive: true, force: true });
});

test("CLI status is 0 only when every checkpoint has a PASS verdict", () => {
  const d = repo();
  assert.equal(run(d, "status").status, 2);
  for (const c of BLOCK.checkpoints) verdict(d, c.evidence, `checkpoint: ${c.id}\nverdict: PASS\n`);
  assert.equal(run(d, "status").status, 0);
  verdict(d, BLOCK.checkpoints[3].evidence, "checkpoint: CP-04\nverdict: FAIL\n");
  fs.rmSync(path.join(d, BLOCK.checkpoints[4].evidence));
  assert.equal(run(d, "status").status, 1, "a FAIL outranks a missing verdict");
  fs.rmSync(d, { recursive: true, force: true });
});
