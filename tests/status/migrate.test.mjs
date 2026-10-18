// ST-07 tests: STATUS.md -> status.json migration. Node built-ins only.
// Real boards are READ ONLY; each test copies them into a mkdtemp fixture laid out like its repo
// (fake .git dir). Evidence files the do-it board references that exist in the real repo
// (.taskstate/evidence.md, .taskstate/results/*.md|log) are copied with relative paths preserved,
// so downgrades reflect reality. Nothing is ever written under the real repos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { migrate } from '../../plugins/build-it/scripts/status/status-migrate.mjs';

const CLI = fileURLToPath(new URL('../../plugins/build-it/scripts/status/status-migrate.mjs', import.meta.url));
const DOIT = '/Users/macbook/Workspace/Devotts/do-it';
const DOIT_STATUS = `${DOIT}/delivery/STATUS.md`;
const LENS_STATUS = '/Users/macbook/Workspace/ANM/docs/implementations/lens-data-honesty/delivery/STATUS.md';

const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'st07-'));
// Layout: <root>/docs/implementations/<impl>/{status.json, delivery/STATUS.md}; status.json's folder
// must equal the implementation name (validator rule), so the board sits under its impl folder.
function fixture(srcStatus, { impl, copyEvidenceFrom = null, skip = [] } = {}) {
  const root = mk();
  fs.mkdirSync(path.join(root, '.git'));
  const implDir = path.join(root, 'docs', 'implementations', impl);
  const dir = path.join(implDir, 'delivery');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(srcStatus, path.join(dir, 'STATUS.md'));
  const copied = [];
  if (copyEvidenceFrom) {
    const text = fs.readFileSync(srcStatus, 'utf8');
    for (const rel of new Set(text.match(/\.taskstate\/[A-Za-z0-9_./-]+\.(?:md|log|txt)/g) ?? [])) {
      if (skip.includes(rel)) continue;
      const from = path.join(copyEvidenceFrom, rel);
      if (fs.existsSync(from) && fs.statSync(from).isFile()) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.copyFileSync(from, path.join(root, rel));
        copied.push(rel);
      }
    }
  }
  return { root, dir, implDir, out: path.join(implDir, 'status.json'), copied };
}
const cli = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const allTasks = (doc) => doc.waves.flatMap((w) => w.tasks);

const doitIt = fs.existsSync(DOIT_STATUS) ? test : test.skip;
const lensIt = fs.existsSync(LENS_STATUS) ? test : test.skip;

doitIt('AT-20 / T-B-19 do-it STATUS.md', () => {
  // (a) evidence copied: everything that references an existing log keeps its status.
  const fx = fixture(DOIT_STATUS, { impl: 'do-it-v1', copyEvidenceFrom: DOIT });
  assert.ok(fx.copied.includes('.taskstate/evidence.md'), `copied: ${fx.copied.join(', ')}`);
  const out = fx.out;
  const r = cli(['--from', path.join(fx.dir, 'STATUS.md'), '--out', out, '--impl', 'do-it-v1']);
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
  const tasks = allTasks(doc);
  assert.equal(tasks.length, 20);
  assert.equal(doc.approximate, true);
  assert.equal(doc.schema, 1);
  assert.equal(doc.closed, false);
  assert.deepEqual(doc.sessions, []);
  assert.match(r.stdout, /tasks found: 20/);
  assert.match(r.stdout, /pre-downgrade counts: .*verified=16/);
  assert.match(r.stdout, /done=4/);
  // with the evidence log present, all 16 VERIFIED keep their status; only unevidenced done rows drop
  assert.equal(tasks.filter((t) => t.status === 'verified').length, 16);
  assert.ok(tasks.filter((t) => t.status === 'verified').every((t) => t.evidence));
  // history invariant: last history entry per non-not-started task has to == status
  for (const t of tasks) {
    const h = doc.history.filter((x) => x.task === t.id);
    if (t.status !== 'not-started') assert.equal(h.at(-1).to, t.status, t.id);
    assert.ok(h.every((x) => x.by === 'migration'));
    if (t.status === 'done' || t.status === 'verified') assert.ok(t.evidence, `${t.id} needs evidence`);
  }
  // waves ordered by first appearance; W0 first
  assert.deepEqual(doc.waves.map((w) => w.id), ['W0', 'W1', 'W2', 'W3', 'W4']);
  assert.equal(doc.pieces.length, 20);
  // unevidenced done rows (R1 has no log path, only a glob) are downgraded and reported
  const r1 = tasks.find((t) => t.id === 'R1');
  assert.equal(r1.status, 'in-progress');
  assert.match(r.stdout, /R1: done -> in-progress/);

  // second run refuses, exit 2, file byte-identical
  const before = fs.readFileSync(out);
  const r2 = cli(['--from', path.join(fx.dir, 'STATUS.md'), '--out', out, '--impl', 'do-it-v1']);
  assert.equal(r2.status, 2);
  assert.match(r2.stderr, /status\.json already exists; migration never overwrites/);
  assert.ok(before.equals(fs.readFileSync(out)));
});

doitIt('AT-20 / T-B-19 do-it STATUS.md: every unevidenced VERIFIED is downgraded and reported', () => {
  // (b) fixture WITHOUT any evidence files: all 16 VERIFIED are unevidenced.
  const fx = fixture(DOIT_STATUS, { impl: 'do-it-v1' });
  const md = fs.readFileSync(path.join(fx.dir, 'STATUS.md'), 'utf8');
  const { doc, report } = migrate(md, { implementation: 'do-it-v1', repoRoot: fx.root, implDir: fx.dir });
  assert.equal(report.tasksFound, 20);
  assert.equal(report.preDowngradeCounts.verified, 16);
  assert.equal(report.downgrades.filter((d) => d.from === 'verified').length, 16);
  assert.equal(report.counts.verified ?? 0, 0);
  for (const d of report.downgrades) {
    const t = allTasks(doc).find((x) => x.id === d.id);
    assert.equal(t.status, d.to);
    const notes = doc.history.filter((h) => h.task === d.id && /downgraded/.test(h.note ?? ''));
    assert.ok(notes.length >= 1, d.id);
    assert.equal(doc.history.filter((h) => h.task === d.id).at(-1).to, t.status);
  }
  assert.equal(allTasks(doc).filter((t) => t.status === 'done' || t.status === 'verified').length, 0);
  assert.equal(report.unparsed.length, 0);
});

lensIt('AT-21 lens-data-honesty', () => {
  const fx = fixture(LENS_STATUS, { impl: 'lens-data-honesty' });
  const out = fx.out;
  const r = cli(['--from', path.join(fx.dir, 'STATUS.md'), '--out', out, '--impl', 'lens-data-honesty']);
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
  const tasks = allTasks(doc);
  assert.equal(tasks.length, 21);
  assert.equal(doc.approximate, true);
  const blocked = tasks.filter((t) => t.status === 'blocked').map((t) => t.id).sort();
  assert.deepEqual(blocked, ['LDH-01', 'LDH-02', 'LDH-03', 'LDH-21']);
  for (const t of tasks.filter((x) => x.status === 'blocked')) assert.match(t.blocked_on, /^owner-gated/i);
  assert.match(tasks.find((t) => t.id === 'LDH-02').blocked_on, /names the project/);
  assert.equal(tasks.filter((t) => t.status === 'not-started').length, 17);
  assert.equal(doc.history.length, 4); // only the four blocked rows moved off not-started
  assert.deepEqual(doc.waves.map((w) => w.id), ['W0', 'W1', 'W2', 'W3']);
  assert.match(r.stdout, /tasks found: 21/);
  assert.match(r.stdout, /unparsed rows: 0/);
});

const SYN = `# STATUS: synthetic

| Wave | Status | Disposition | Task | ID | Extra |
|---|---|---|---|---|---|
| Wave 2 | **VERIFIED** (review) | run: \`.taskstate/ok.md\` | Alpha | A-1 | x |
| W1 | in-progress | | Beta | A-2 | y |
| W1 | IMPLEMENTED-NOT-VERIFIED | log .taskstate/ok.md | Gamma | A-3 | z |
| W1 | OWNER-GATED-WEIRD | | Delta | A-4 | z |
| W1 | NOT-STARTED | **Owner-gated**: Fernando | Eps | A-5 | z |
|  | NOT-STARTED | | no id here |  | z |

## Residuals
| Item | Disposition |
|---|---|
| A-9 | whatever |
`;

test('synthetic: column order shuffled still parses', () => {
  const root = mk();
  fs.mkdirSync(path.join(root, '.git'));
  const dir = path.join(root, 'impl');
  fs.mkdirSync(path.join(root, '.taskstate'));
  fs.writeFileSync(path.join(root, '.taskstate/ok.md'), 'evidence\n');
  fs.mkdirSync(dir);
  const { doc, report } = migrate(SYN, { implementation: 'syn', repoRoot: root, implDir: dir });
  const byId = Object.fromEntries(allTasks(doc).map((t) => [t.id, t]));
  assert.equal(byId['A-1'].status, 'verified');
  assert.equal(byId['A-1'].evidence, '.taskstate/ok.md');
  assert.equal(byId['A-1'].title, 'Alpha');
  assert.equal(byId['A-2'].status, 'in-progress');
  assert.equal(byId['A-3'].status, 'done');
  assert.equal(byId['A-5'].status, 'blocked');
  assert.match(byId['A-5'].blocked_on, /^Owner-gated: Fernando/);
  assert.deepEqual(doc.waves.map((w) => w.id), ['W2', 'W1']);
  assert.equal(report.downgrades.length, 0);
  assert.equal(doc.pieces.find((p) => p.piece === 'Alpha').whats_left, 'Nothing');
  assert.ok(!JSON.stringify(doc.pieces).includes('%'));
});

test('synthetic: an unparsable row is reported', () => {
  const root = mk();
  fs.mkdirSync(path.join(root, '.git'));
  const { doc, report } = migrate(SYN, { implementation: 'syn', repoRoot: root, implDir: root });
  assert.equal(report.unparsed.length, 2);
  assert.ok(report.unparsed.some((u) => u.id === 'A-4' && /unknown status/.test(u.reason)));
  assert.ok(report.unparsed.some((u) => /missing id/.test(u.reason)));
  assert.equal(allTasks(doc).find((t) => t.id === 'A-4').status, 'not-started');
  // no evidence anywhere: verified A-1 -> done -> in-progress, A-3 done -> in-progress
  assert.deepEqual(report.downgrades.map((d) => `${d.id}:${d.from}>${d.to}`).sort(), ['A-1:verified>in-progress', 'A-3:done>in-progress']);
});
