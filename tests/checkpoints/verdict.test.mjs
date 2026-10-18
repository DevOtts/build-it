// The verdict reader cannot be fooled: only report prose counts (no fenced or
// indented code, no HTML comments), the overall verdict must be unambiguous,
// and anything else is not a pass. Plus malformed depends_on/covers/gates and
// dependency cycles are plan errors (exit 1), never an accidental block or pass.
// Run: node --test 'tests/checkpoints/*.test.mjs'
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseVerdict } from "../../plugins/build-it/scripts/checkpoints/checkpoints.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "../../plugins/build-it/scripts/checkpoints/checkpoints.mjs");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/three-waves.READINESS.json"), "utf8"));
const EVIDENCE = FIXTURE.review_checkpoints.checkpoints[0].evidence;
const clone = (x) => JSON.parse(JSON.stringify(x));

function repo(doc = FIXTURE) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "buildit-verdict-"));
  fs.mkdirSync(path.join(d, "plan", "reviews"), { recursive: true });
  fs.writeFileSync(path.join(d, "plan", "READINESS.json"), JSON.stringify(doc));
  return d;
}
const cli = (root, ...a) => spawnSync(process.execPath, [SCRIPT, ...a, "--readiness", "plan/READINESS.json", "--root", root], { encoding: "utf8" });
const FENCE = "`".repeat(3);

const CASES = [
  ["PASS then FAIL", "checkpoint: CP-01\nverdict: PASS\nverdict: FAIL\n", "contradictory"],
  ["FAIL then PASS", "checkpoint: CP-01\nverdict: FAIL\n\nnotes\n\nverdict: PASS\n", "contradictory"],
  ["PASS only inside a fenced block, a real FAIL outside", `checkpoint: CP-01\n${FENCE}\nverdict: PASS\n${FENCE}\nverdict: FAIL\n`, "fail"],
  ["PASS only inside a ~~~ fence", "checkpoint: CP-01\n~~~text\nverdict: PASS\n~~~\n", "invalid"],
  ["PASS inside an HTML comment", "checkpoint: CP-01\n<!--\nverdict: PASS\n-->\n", "invalid"],
  ["PASS inside a one-line HTML comment", "checkpoint: CP-01\n<!-- verdict: PASS -->\n", "invalid"],
  ["PASS in 4-space indented code", "checkpoint: CP-01\n\n    verdict: PASS\n", "invalid"],
  ["checkpoint line only inside a fence", `${FENCE}\ncheckpoint: CP-01\n${FENCE}\nverdict: PASS\n`, "invalid"],
  ["two identical PASS lines", "checkpoint: CP-01\nverdict: PASS\n\nverdict: PASS\n", "pass"],
  ["lowercase pass", "checkpoint: CP-01\nverdict: pass\n", "invalid"],
  ["value GO", "checkpoint: CP-01\nverdict: GO\n", "invalid"],
  ["two different checkpoint ids", "checkpoint: CP-01\ncheckpoint: CP-02\nverdict: PASS\n", "invalid"],
  ["overall PASS with a FAIL task block", "checkpoint: CP-01\nverdict: PASS\n\ntask: B1\nverdict: FAIL\n", "contradictory"],
  ["overall PASS with PASS task blocks", "checkpoint: CP-01\nverdict: PASS\ncases: 4/4\n\ntask: B1\nverdict: PASS\n", "pass"],
  ["bold PASS with trailing text", "checkpoint: CP-01\nverdict: **PASS** (12/12)\n", "pass"],
];

for (const [name, body, want] of CASES) {
  test(`parseVerdict: ${name} -> ${want}`, () => {
    assert.equal(parseVerdict(body, "CP-01").state, want, JSON.stringify(parseVerdict(body, "CP-01")));
  });
}

test("gate and check never pass a contradictory, fenced-only or commented verdict", () => {
  for (const [name, body, want] of CASES) {
    if (want === "pass") continue;
    const d = repo();
    fs.writeFileSync(path.join(d, EVIDENCE), body);
    const g = cli(d, "gate", "--action", "start", "--slice", "B1");
    assert.equal(g.status, 2, `${name}: ${g.stdout}`);
    assert.match(g.stdout, new RegExp(`CP-01 wave ${want.toUpperCase()}`), name);
    const c = cli(d, "check", "--id", "CP-01");
    assert.equal(c.status, 1, `${name}: ${c.stdout}`);
    assert.equal(cli(d, "status").status, 1, name);
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test("two identical PASS lines open the gate", () => {
  const d = repo();
  fs.writeFileSync(path.join(d, EVIDENCE), "checkpoint: CP-01\nverdict: PASS\n\nverdict: PASS\n");
  assert.equal(cli(d, "gate", "--action", "start", "--slice", "B1").status, 0);
  fs.rmSync(d, { recursive: true, force: true });
});

test("depends_on that is a string, a number or holds null is a plan error naming the slice (exit 1)", () => {
  const rows = [["B1", "A0", /slice B1: depends_on must be a list of slice ids, got string/], ["B1", 7, /got number/], ["B1", ["A0", null], /slice B1: depends_on\[1\] must be a slice id string, got null/], ["A2", null, /slice A2: depends_on must be a list of slice ids, got null/]];
  for (const [id, value, re] of rows) {
    const doc = clone(FIXTURE);
    doc.slices.find((s) => s.id === id).depends_on = value;
    const d = repo(doc);
    const r = cli(d, "gate", "--action", "start", "--slice", "A1");
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, re);
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test("covers or gates that are not lists are invalid (exit 1), not walked by character", () => {
  for (const mutate of [(c) => { c.covers = "W0"; }, (c) => { c.gates = "dependents"; }, (c) => { c.covers = ["W0", 3]; }]) {
    const doc = clone(FIXTURE);
    mutate(doc.review_checkpoints.checkpoints[0]);
    const d = repo(doc);
    const r = cli(d, "gate", "--action", "start", "--slice", "B1");
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /INVALID checkpoints\[0\]\.(covers|gates)/);
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test("a dependency cycle is a plan error with the cycle printed (2-node and 3-node)", () => {
  const two = clone(FIXTURE);
  two.slices.find((s) => s.id === "A0").depends_on = ["B1"];
  let d = repo(two);
  let r = cli(d, "gate", "--action", "start", "--slice", "B1");
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /cycle .*: B1 -> A0 -> B1/);
  fs.rmSync(d, { recursive: true, force: true });

  const three = clone(FIXTURE);
  three.slices.find((s) => s.id === "A0").depends_on = ["A2"];
  d = repo(three);
  r = cli(d, "gate", "--action", "start", "--slice", "A2");
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /cycle .*: A2 -> B1 -> A0 -> A2/);
  // A slice outside the cycle that only reaches into it is told too.
  three.slices.push({ id: "C3", depends_on: ["A2"] });
  fs.writeFileSync(path.join(d, "plan", "READINESS.json"), JSON.stringify(three));
  r = cli(d, "gate", "--action", "start", "--slice", "C3");
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /A2 -> B1 -> A0 -> A2/);
  // The missing READINESS exit stays 2.
  fs.rmSync(path.join(d, "plan", "READINESS.json"));
  assert.equal(cli(d, "gate", "--action", "start", "--slice", "C3").status, 2);
  fs.rmSync(d, { recursive: true, force: true });
});
