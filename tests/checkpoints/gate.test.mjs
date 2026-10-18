// `checkpoints.mjs gate`: a checkpoint holds only what its gates name, for the
// work it covers (finding H-10: wave checkpoints must not reintroduce the wave
// lock). Fixture: three waves, emitted by plan-it's review-checkpoints decide.
// Run: node --test 'tests/checkpoints/*.test.mjs'
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { effective } from "../../plugins/build-it/scripts/checkpoints/checkpoints.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "../../plugins/build-it/scripts/checkpoints/checkpoints.mjs");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/three-waves.READINESS.json"), "utf8"));
const CP = Object.fromEntries(FIXTURE.review_checkpoints.checkpoints.map((c) => [c.id, c]));

function repo(doc = FIXTURE) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "buildit-gate-"));
  fs.mkdirSync(path.join(d, "plan", "reviews"), { recursive: true });
  fs.writeFileSync(path.join(d, "plan", "READINESS.json"), JSON.stringify(doc));
  return d;
}
const gate = (root, ...a) => spawnSync(process.execPath, [SCRIPT, "gate", "--readiness", "plan/READINESS.json", "--root", root, ...a], { encoding: "utf8" });
const pass = (root, id, body) => fs.writeFileSync(path.join(root, CP[id].evidence), body || `checkpoint: ${id}\nverdict: PASS\n`);
const clone = (x) => JSON.parse(JSON.stringify(x));

// A plan written before gates/covers: plan-it 5.1.0 wording.
function legacy() {
  const doc = clone(FIXTURE);
  for (const c of doc.review_checkpoints.checkpoints) {
    delete c.gates;
    delete c.covers;
    if (c.kind === "wave") c.blocks = `start of W${Number(c.at.slice(-1)) + 1}`;
  }
  return doc;
}

test("fixture: the emitter wrote gates, covers and slice waves", () => {
  assert.deepEqual(CP["CP-01"].gates, ["dependents", "promotion"]);
  assert.deepEqual(CP["CP-01"].covers, ["W0"]);
  assert.ok(FIXTURE.slices.every((s) => /^W[012]$/.test(s.wave)));
});

test("AT-1: a W1 slice that depends on nothing in W0 starts although CP-01 has no verdict", () => {
  const d = repo();
  const r = gate(d, "--action", "start", "--slice", "A1");
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^ALLOWED start A1/);
  fs.rmSync(d, { recursive: true, force: true });
});

test("AT-2: a W1 slice that depends directly on a W0 slice is held by CP-01", () => {
  const d = repo();
  const r = gate(d, "--action", "start", "--slice", "B1");
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stdout, /BLOCKED start B1/);
  assert.match(r.stdout, /CP-01 wave MISSING: .*depends on covered work A0/);
  assert.doesNotMatch(r.stdout, /CP-0[234]/);
  pass(d, "CP-01");
  assert.equal(gate(d, "--action", "start", "--slice", "B1").status, 0);
  fs.rmSync(d, { recursive: true, force: true });
});

test("AT-3: a W2 slice that reaches W0 only through a W1 slice is held by CP-01 (transitive)", () => {
  const d = repo();
  pass(d, "CP-02");
  const r = gate(d, "--action", "start", "--slice", "A2");
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stdout, /CP-01 wave MISSING: .*depends on covered work A0/);
  // B2 depends on W1 work only: CP-01 does not hold it; CP-02 (PASS) does not either.
  assert.equal(gate(d, "--action", "start", "--slice", "B2").status, 0);
  fs.rmSync(path.join(d, CP["CP-02"].evidence));
  const b2 = gate(d, "--action", "start", "--slice", "B2");
  assert.equal(b2.status, 2);
  assert.match(b2.stdout, /CP-02 wave MISSING/);
  assert.doesNotMatch(b2.stdout, /CP-01/);
  fs.rmSync(d, { recursive: true, force: true });
});

test("AT-4: promote of W0 work is held while CP-01 is missing and allowed with a PASS", () => {
  const d = repo();
  const r = gate(d, "--action", "promote", "--slice", "A0");
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stdout, /CP-01 wave MISSING: .*slice A0 is covered work/);
  pass(d, "CP-01");
  assert.equal(gate(d, "--action", "promote", "--slice", "A0").status, 0);
  // W1 work is still held by CP-02; a promote of everything is held too.
  assert.equal(gate(d, "--action", "promote", "--slice", "A1").status, 2);
  assert.equal(gate(d, "--action", "promote").status, 2);
  fs.rmSync(d, { recursive: true, force: true });
});

test("AT-5: a verdict naming another checkpoint, a FAIL, or an unreadable file blocks (never 0)", () => {
  const d = repo();
  pass(d, "CP-01", "checkpoint: CP-02\nverdict: PASS\n");
  let r = gate(d, "--action", "start", "--slice", "B1");
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stdout, /CP-01 wave INVALID: .*does not name checkpoint CP-01/);
  pass(d, "CP-01", "checkpoint: CP-01\nverdict: FAIL\n");
  r = gate(d, "--action", "start", "--slice", "B1");
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stdout, /CP-01 wave FAIL: review-it verdict is FAIL/);
  fs.rmSync(path.join(d, CP["CP-01"].evidence));
  fs.mkdirSync(path.join(d, CP["CP-01"].evidence));
  r = gate(d, "--action", "start", "--slice", "B1");
  assert.ok(r.status === 1 || r.status === 2, r.stdout);
  assert.match(r.stdout, /CP-01 wave INVALID: cannot read .*EISDIR/);
  fs.rmSync(d, { recursive: true, force: true });
});

test("AT-6: a legacy READINESS (no gates/covers, blocks 'start of W1') gets the corrected meaning", () => {
  const doc = legacy();
  assert.equal(doc.review_checkpoints.checkpoints[0].blocks, "start of W1");
  assert.deepEqual(effective(doc.review_checkpoints.checkpoints[0]), { gates: ["dependents", "promotion"], covers: ["W0"], legacy: true });
  const d = repo(doc);
  assert.equal(gate(d, "--action", "start", "--slice", "A1").status, 0, "the independent W1 slice is allowed");
  const r = gate(d, "--action", "start", "--slice", "B1");
  assert.equal(r.status, 2);
  assert.match(r.stdout, /CP-01 wave MISSING: .*depends on covered work A0/);
  const c = spawnSync(process.execPath, [SCRIPT, "check", "--id", "CP-01", "--readiness", "plan/READINESS.json", "--root", d], { encoding: "utf8" });
  assert.match(c.stdout, /Holds until PASS: slices outside W0 that depend on it, and promotion of W0/);
  assert.doesNotMatch(c.stdout, /start of W1/);
  fs.rmSync(d, { recursive: true, force: true });
});

test("AT-7: a wave id in covers with slices that carry no wave cannot be evaluated (exit 1, says why)", () => {
  const doc = clone(FIXTURE);
  for (const s of doc.slices) delete s.wave;
  const d = repo(doc);
  const r = gate(d, "--action", "start", "--slice", "B1");
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /CANNOT EVALUATE start B1/);
  assert.match(r.stdout, /slice A0 carries no "wave", so covers W0 cannot be resolved/);
  // A slice with no dependencies needs nothing resolved.
  assert.equal(gate(d, "--action", "start", "--slice", "A1").status, 0);
  assert.equal(gate(d, "--action", "promote", "--slice", "A0").status, 1);
  fs.rmSync(d, { recursive: true, force: true });
});

test("merge and release: held by their own checkpoints only; release also needs every promotion gate", () => {
  const d = repo();
  let r = gate(d, "--action", "merge");
  assert.equal(r.status, 2);
  assert.match(r.stdout, /CP-03 pre-merge MISSING/);
  assert.doesNotMatch(r.stdout, /CP-0[124]/);
  pass(d, "CP-03");
  assert.equal(gate(d, "--action", "merge").status, 0, "wave verdicts do not hold the merge");
  pass(d, "CP-04");
  r = gate(d, "--action", "release");
  assert.equal(r.status, 2);
  assert.match(r.stdout, /CP-01 wave MISSING/);
  pass(d, "CP-01");
  pass(d, "CP-02");
  assert.equal(gate(d, "--action", "release").status, 0);
  fs.rmSync(d, { recursive: true, force: true });
});

test("gate fails loud on bad input: unknown slice, unknown dependency, no --slice for start, no block, bad action", () => {
  const d = repo();
  assert.match(gate(d, "--action", "start", "--slice", "Z9").stdout, /no slice Z9/);
  assert.equal(gate(d, "--action", "start", "--slice", "Z9").status, 1);
  assert.equal(gate(d, "--action", "start").status, 1);
  assert.equal(gate(d, "--action", "deploy").status, 1);
  const doc = clone(FIXTURE);
  doc.slices.find((s) => s.id === "A1").depends_on = ["GHOST"];
  const d2 = repo(doc);
  const r = gate(d2, "--action", "start", "--slice", "A1");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /depends on GHOST, which is not in READINESS.json slices/);
  const { review_checkpoints, ...old } = FIXTURE;
  const d3 = repo(old);
  assert.equal(gate(d3, "--action", "start", "--slice", "A1").status, 1);
  for (const x of [d, d2, d3]) fs.rmSync(x, { recursive: true, force: true });
});

test("a legacy phase checkpoint names no coverage: a dependent start cannot be evaluated", () => {
  const doc = clone(FIXTURE);
  doc.review_checkpoints.checkpoints[0] = { id: "CP-01", kind: "phase", at: "after B0", blocks: "the remaining tasks", evidence: "plan/reviews/CP-01-phase-b0.md" };
  const d = repo(doc);
  const r = gate(d, "--action", "start", "--slice", "B1");
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /CP-01 phase has no covers \(a plan written before gates\/covers/);
  fs.rmSync(d, { recursive: true, force: true });
});

test("status still exits 0 only when every checkpoint is PASS", () => {
  const d = repo();
  pass(d, "CP-01");
  pass(d, "CP-03");
  const r = spawnSync(process.execPath, [SCRIPT, "status", "--readiness", "plan/READINESS.json", "--root", d], { encoding: "utf8" });
  assert.equal(r.status, 2);
  pass(d, "CP-02");
  pass(d, "CP-04");
  assert.equal(spawnSync(process.execPath, [SCRIPT, "status", "--readiness", "plan/READINESS.json", "--root", d]).status, 0);
  fs.rmSync(d, { recursive: true, force: true });
});

// ---- H-21: a checkpoint cannot hold the start of the work it covers --------------------------
// Found by the first real run: CP-01 covers all of W0, so a W0 slice that needs another W0 slice waited on
// CP-01, a review that only runs once W0 has ended. Nothing in W0 could finish, so the wave never ended.
function sameWave() {
  const doc = clone(FIXTURE);
  doc.slices.push({ id: "C0", lane: "x", tier: "T3", class: "gather", depends_on: ["A0"], wave: "W0" });
  doc.slices.push({ id: "D1", lane: "x", tier: "T3", class: "gather", depends_on: ["A1"], wave: "W1" });
  return doc;
}

test("H-21: a W0 slice that depends on another W0 slice is not held by CP-01, which covers W0", () => {
  const d = repo(sameWave());
  const r = gate(d, "--action", "start", "--slice", "C0");
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^ALLOWED start C0/);
  fs.rmSync(d, { recursive: true, force: true });
});

test("H-21: the same inside W1: D1 needs A1, both in W1, and CP-02 covers W1", () => {
  const d = repo(sameWave());
  const r = gate(d, "--action", "start", "--slice", "D1");
  assert.equal(r.status, 0, r.stdout);
  fs.rmSync(d, { recursive: true, force: true });
});

test("H-21: a slice OUTSIDE the covered wave that depends on it is still held (B1 needs A0)", () => {
  const d = repo(sameWave());
  const r = gate(d, "--action", "start", "--slice", "B1");
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stdout, /CP-01 wave MISSING: .*depends on covered work A0/);
  fs.rmSync(d, { recursive: true, force: true });
});

test("H-21: promoting the covered slice C0 is still held by CP-01", () => {
  const d = repo(sameWave());
  const r = gate(d, "--action", "promote", "--slice", "C0");
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stdout, /CP-01/);
  fs.rmSync(d, { recursive: true, force: true });
});

test("H-21: with a PASS on CP-01 nothing changes for the dependents outside W0", () => {
  const d = repo(sameWave());
  pass(d, "CP-01");
  assert.equal(gate(d, "--action", "start", "--slice", "B1").status, 0);
  assert.equal(gate(d, "--action", "start", "--slice", "C0").status, 0);
  fs.rmSync(d, { recursive: true, force: true });
});

// ---- H-22: due --at merge / release ---------------------------------------------------------
// The pre-release checkpoint's text starts "after merge,", so a prefix match returned it for `--at merge`,
// and `--at release` matched nothing.
const due = (root, at) => spawnSync(process.execPath, [SCRIPT, "due", "--readiness", "plan/READINESS.json", "--root", root, "--at", at], { encoding: "utf8" });

test("H-22: due --at merge returns the pre-merge checkpoint and not the pre-release one", () => {
  const d = repo();
  const r = due(d, "merge");
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /DUE CP-03 pre-merge/);
  assert.doesNotMatch(r.stdout, /CP-04/);
  fs.rmSync(d, { recursive: true, force: true });
});

test("H-22: due --at release returns the pre-release checkpoint", () => {
  const d = repo();
  const r = due(d, "release");
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /DUE CP-04 pre-release/);
  assert.doesNotMatch(r.stdout, /CP-03/);
  fs.rmSync(d, { recursive: true, force: true });
});

test("H-22: the kind names and wave ids still work", () => {
  const d = repo();
  assert.match(due(d, "pre-merge").stdout, /DUE CP-03/);
  assert.match(due(d, "pre-release").stdout, /DUE CP-04/);
  assert.match(due(d, "W0").stdout, /DUE CP-01 wave/);
  assert.equal(due(d, "W9").status, 3);
  fs.rmSync(d, { recursive: true, force: true });
});
