// R-1: re-run the Test Contract check on demand. The command comes from the plan committed at HEAD, never from
// status.json. Authored by DevOtts (https://github.com/DevOtts).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run, verdictText } from './_helpers.mjs';

const NODE = JSON.stringify(process.execPath);
const node = (js) => `${NODE} -e ${JSON.stringify(js)}`;

function git(root, ...args) {
  return execFileSync('git', ['-C', root, '-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// A real git repo with docs/implementations/demo/{plan.json,status.json}, committed.
function mkGitImpl(checks) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'r1-')));
  git(root, 'init', '-q');
  const dir = path.join(root, 'docs', 'implementations', 'demo');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'status.json');
  const plan = {
    implementation: 'demo', title: 'Demo',
    waves: [{ id: 'W1', title: 'Wave one', tasks: Object.entries(checks).map(([id, check]) => (check ? { id, title: `Task ${id}`, check } : { id, title: `Task ${id}` })) }],
    pieces: [],
  };
  const planFile = path.join(dir, 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2) + '\n');
  const r = run(['init', '--file', file, '--plan', planFile, '--by', 'plan-it']);
  if (r.code !== 0) throw new Error(`init failed: ${r.err}`);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'plan');
  const w = (args) => run([...args, '--file', file]);
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const task = (id) => read().waves.flatMap((x) => x.tasks).find((t) => t.id === id);
  const ev = (rel, text) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return path.relative(root, p); };
  // done + review-it verified, evidence files untracked (they do not make the tree dirty).
  const verify = (id) => {
    assert.equal(w(['set', id, '--status', 'done', '--evidence', ev(`evidence/${id}.txt`, 'green\n'), '--by', 'build-it']).code, 0);
    assert.equal(w(['set', id, '--status', 'verified', '--evidence', ev(`evidence/${id}.verdict.md`, verdictText(id)), '--by', 'review-it']).code, 0);
  };
  const commit = (msg) => { fs.writeFileSync(path.join(root, `${msg}.txt`), msg); git(root, 'add', `${msg}.txt`); git(root, 'commit', '-q', '-m', msg); };
  return { root, dir, file, planFile, w, read, task, verify, commit, head: () => git(root, 'rev-parse', 'HEAD') };
}

const counterCmd = (cnt) => node(`require('fs').appendFileSync(${JSON.stringify(cnt)},'x')`);
const counter = (cnt) => { try { return fs.readFileSync(cnt, 'utf8').length; } catch { return 0; } };
const tmpCounter = () => path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'r1c-'))), 'count');

test('R-1 plan check is copied into status.json at init', () => {
  const x = mkGitImpl({ 'T-1': { kind: 'command', command: node('0'), cases: ['T-1-01'] }, 'T-2': { kind: 'none', reason: 'owner-gated' }, 'T-3': null });
  assert.deepEqual(x.task('T-1').check, { kind: 'command', command: node('0'), cases: ['T-1-01'] });
  assert.deepEqual(x.task('T-2').check, { kind: 'none', reason: 'owner-gated' });
  assert.equal(x.task('T-3').check, undefined);
});

test('R-1 a passing check records exit 0, the git sha and a stdout hash; view counts it', () => {
  const x = mkGitImpl({ 'T-1': { kind: 'command', command: node("console.log('ok')") } });
  x.verify('T-1');
  const before = run(['view', '--json', '--file', x.file]);
  const pct = JSON.parse(before.out).percent;
  const r = x.w(['recheck', '--task', 'T-1']);
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /T-1 re-check PASS at sha [0-9a-f]{12}/);
  const doc = x.read();
  assert.equal(doc.rechecks.length, 1);
  const e = doc.rechecks[0];
  assert.equal(e.task, 'T-1'); assert.equal(e.result, 'pass'); assert.equal(e.exit, 0);
  assert.equal(e.sha, x.head()); assert.equal(e.dirty, false);
  assert.match(e.stdout_sha, /^[0-9a-f]{16}$/);
  assert.equal(x.task('T-1').status, 'verified');
  const v = run(['view', '--file', x.file]);
  assert.equal(v.code, 0, v.err + v.out);
  assert.match(v.out, /verified 1 \(claims\) · re-checked 1/);
  assert.match(v.out, /re-check PASS: T-1 · sha [0-9a-f]{12} \(HEAD\) · exit 0/);
  const j = JSON.parse(run(['view', '--json', '--file', x.file]).out);
  assert.equal(j.percent, pct, 'percent unchanged by a recheck');
  assert.equal(j.rechecks.rechecked, 1);
  assert.equal(run(['validate', '--file', x.file]).code, 0);
  const md = fs.readFileSync(path.join(x.dir, 'STATUS.md'), 'utf8');
  assert.match(md, /verified 1 \(claims\) · re-checked 1/);
  assert.match(md, /## Re-checks/);
});

test('R-1 a failing check is recorded and shown as FAILED; the status does not change', () => {
  const x = mkGitImpl({ 'T-1': { kind: 'command', command: node('process.exit(3)') } });
  x.verify('T-1');
  const r = x.w(['recheck', '--task', 'T-1']);
  assert.equal(r.code, 4, r.err + r.out);
  assert.match(r.out, /T-1 re-check FAILED/);
  const e = x.read().rechecks[0];
  assert.equal(e.result, 'fail'); assert.equal(e.exit, 3);
  assert.equal(x.task('T-1').status, 'verified', 'a failed recheck never silently changes status');
  const v = run(['view', '--file', x.file]);
  assert.match(v.out, /verified 1 \(claims\) · re-checked 0/);
  assert.match(v.out, /re-check FAILED: T-1 · sha [0-9a-f]{12} \(HEAD\) · exit 3/);
  const j = JSON.parse(run(['view', '--json', '--file', x.file]).out);
  assert.deepEqual(j.rechecks.failed, ['T-1']);
});

test('R-1 a check that runs past --timeout is killed and recorded as a timeout', () => {
  const x = mkGitImpl({ 'T-1': { kind: 'command', command: node('setTimeout(()=>{},20000)') } });
  const t0 = Date.now();
  const r = x.w(['recheck', '--task', 'T-1', '--timeout', '500ms']);
  assert.ok(Date.now() - t0 < 10000, 'the runner did not wait for the command');
  assert.equal(r.code, 4, r.err + r.out);
  assert.match(r.out, /FAILED \(timeout after 500 ms\)/);
  const e = x.read().rechecks[0];
  assert.equal(e.result, 'timeout'); assert.equal(e.timeout_ms, 500);
  assert.match(run(['view', '--file', x.file]).out, /re-check FAILED \(timeout\): T-1/);
  assert.equal(x.w(['recheck', '--task', 'T-1', '--timeout', 'soon']).code, 2, 'bad --timeout is a usage error');
});

test('R-1 a check command edited in status.json is refused and nothing runs', () => {
  const cnt = tmpCounter();
  const x = mkGitImpl({ 'T-1': { kind: 'command', command: counterCmd(cnt) } });
  // A model cannot add or edit a check through the writer.
  const s = x.w(['set', 'T-1', '--status', 'in-progress', '--check', 'true', '--by', 'build-it']);
  assert.equal(s.code, 1); assert.match(s.err, /check command cannot be set through status\.json/);
  // A hand edit of status.json is caught by recheck: refused, byte-identical, the command never runs.
  const doc = x.read();
  doc.waves[0].tasks[0].check.command = 'true';
  fs.writeFileSync(x.file, JSON.stringify(doc, null, 2) + '\n');
  const bytes = fs.readFileSync(x.file);
  const r = x.w(['recheck', '--task', 'T-1']);
  assert.equal(r.code, 1, r.err + r.out);
  assert.match(r.err, /differs from the committed plan/);
  assert.deepEqual(fs.readFileSync(x.file), bytes);
  assert.equal(counter(cnt), 0);
  // An uncommitted edit of plan.json is ignored: the committed command is the one that counts.
  doc.waves[0].tasks[0].check.command = counterCmd(cnt);
  fs.writeFileSync(x.file, JSON.stringify(doc, null, 2) + '\n');
  const plan = JSON.parse(fs.readFileSync(x.planFile, 'utf8'));
  plan.waves[0].tasks[0].check.command = 'true';
  fs.writeFileSync(x.planFile, JSON.stringify(plan));
  const r2 = x.w(['recheck', '--task', 'T-1', '--fresh']);
  assert.equal(r2.code, 0, r2.err + r2.out);
  assert.match(r2.err, /differs from HEAD; using the committed version/);
  assert.equal(counter(cnt), 1);
});

test('R-1 init --merge may not change the check of started work', () => {
  const x = mkGitImpl({ 'T-1': { kind: 'command', command: node('0') }, 'T-2': { kind: 'command', command: node('0') } });
  assert.equal(x.w(['set', 'T-1', '--status', 'in-progress', '--by', 'build-it']).code, 0);
  const plan = JSON.parse(fs.readFileSync(x.planFile, 'utf8'));
  plan.waves[0].tasks[0].check.command = 'true';
  const p2 = path.join(x.root, 'plan2.json');
  fs.writeFileSync(p2, JSON.stringify(plan));
  const before = fs.readFileSync(x.file);
  const r = run(['init', '--merge', '--file', x.file, '--plan', p2, '--by', 'plan-it']);
  assert.equal(r.code, 1); assert.match(r.err, /changes the check command of T-1, which is in-progress/);
  assert.deepEqual(fs.readFileSync(x.file), before);
  // A not-started task may be re-planned.
  plan.waves[0].tasks[0].check.command = node('0');
  plan.waves[0].tasks[1].check.command = node('1');
  fs.writeFileSync(p2, JSON.stringify(plan));
  assert.equal(run(['init', '--merge', '--file', x.file, '--plan', p2, '--by', 'plan-it']).code, 0);
  assert.equal(x.task('T-2').check.command, node('1'));
});

test('R-1 init --merge fills in a check on a started task that had none (board from before checks)', () => {
  const x = mkGitImpl({ 'T-1': null });
  assert.equal(x.w(['set', 'T-1', '--status', 'in-progress', '--by', 'build-it']).code, 0);
  const p2 = path.join(x.root, 'plan2.json');
  fs.writeFileSync(p2, JSON.stringify({ implementation: 'demo', waves: [{ id: 'W1', title: 'Wave one', tasks: [{ id: 'T-1', title: 'Task T-1', check: { kind: 'none', reason: 'owner-gated' } }] }], pieces: [] }));
  const r = run(['init', '--merge', '--file', x.file, '--plan', p2, '--by', 'plan-it']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(x.task('T-1').check, { kind: 'none', reason: 'owner-gated' });
});

test('R-1 a task with kind none is reported unchecked and nothing is recorded', () => {
  const x = mkGitImpl({ 'T-1': { kind: 'none', reason: 'owner-gated' }, 'T-2': null });
  const r = x.w(['recheck', '--task', 'T-1']);
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /T-1 unchecked: kind none \(owner-gated\)/);
  const r2 = x.w(['recheck']);
  assert.match(r2.out, /T-2 unchecked: no check in the committed plan/);
  assert.equal(x.read().rechecks, undefined);
  assert.match(run(['view', '--file', x.file]).out, /unchecked \(no check command\): T-1 \(owner-gated\)/);
});

test('R-1 same sha and command reuses the cached result; view and validate never run a check', () => {
  const cnt = tmpCounter();
  const x = mkGitImpl({ 'T-1': { kind: 'command', command: counterCmd(cnt) } });
  assert.equal(x.w(['recheck', '--task', 'T-1']).code, 0);
  assert.equal(counter(cnt), 1);
  const r = x.w(['recheck', '--task', 'T-1']);
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /cached from/);
  assert.equal(counter(cnt), 1, 'cache hit: the command did not run again');
  assert.equal(x.read().rechecks.length, 1);
  run(['view', '--file', x.file]); run(['view', '--json', '--file', x.file]); run(['validate', '--file', x.file]);
  assert.equal(counter(cnt), 1, 'view/validate never run a check');
  assert.equal(x.w(['recheck', '--task', 'T-1', '--fresh']).code, 0);
  assert.equal(counter(cnt), 2, '--fresh bypasses the cache');
});

test('R-1 a new commit is a cache miss; a dirty tree is never cached', () => {
  const cnt = tmpCounter();
  const x = mkGitImpl({ 'T-1': { kind: 'command', command: counterCmd(cnt) } });
  assert.equal(x.w(['recheck']).code, 0);
  const sha1 = x.head();
  x.commit('next');
  assert.notEqual(x.head(), sha1);
  const r = x.w(['recheck']);
  assert.equal(r.code, 0, r.err + r.out);
  assert.doesNotMatch(r.out, /cached/);
  assert.equal(counter(cnt), 2);
  const rs = x.read().rechecks;
  assert.deepEqual(rs.map((e) => e.sha), [sha1, x.head()]);
  // Dirty tracked file: runs every time and is flagged.
  fs.writeFileSync(path.join(x.root, 'next.txt'), 'changed');
  assert.equal(x.w(['recheck']).code, 0);
  assert.equal(x.w(['recheck']).code, 0);
  assert.equal(counter(cnt), 4);
  assert.equal(x.read().rechecks.at(-1).dirty, true);
  assert.match(run(['view', '--file', x.file]).out, /\(dirty tree\)/);
});

test('R-1 recheck refuses when the plan is not committed', () => {
  const x = mkGitImpl({ 'T-1': { kind: 'command', command: node('0') } });
  git(x.root, 'rm', '-q', '--cached', 'docs/implementations/demo/plan.json');
  git(x.root, 'commit', '-q', '-m', 'drop plan');
  const before = fs.readFileSync(x.file);
  const r = x.w(['recheck']);
  assert.equal(r.code, 1); assert.match(r.err, /not committed at HEAD/);
  assert.deepEqual(fs.readFileSync(x.file), before);
});

test('R-1 only recheck writes rechecks[]; other writes keep it and the check intact', () => {
  const x = mkGitImpl({ 'T-1': { kind: 'command', command: node('0') }, 'T-2': null });
  assert.equal(x.w(['recheck']).code, 0);
  assert.equal(x.w(['set', 'T-2', '--status', 'in-progress', '--by', 'build-it']).code, 0);
  assert.equal(x.read().rechecks.length, 1);
  assert.equal(x.task('T-1').check.command, node('0'));
  assert.equal(run(['validate', '--file', x.file]).code, 0);
});

test('R-1 recheck still works on a closed board and leaves it closed and valid', () => {
  const x = mkGitImpl({ 'T-1': { kind: 'command', command: node('0') } });
  assert.equal(x.w(['close', '--by', 'conclude-it', '--owner-note', 'owner accepts']).code, 0);
  const r = x.w(['recheck']);
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(x.read().closed, true);
  assert.equal(x.read().rechecks.length, 1);
  assert.equal(run(['validate', '--file', x.file]).code, 0);
  assert.equal(x.w(['set', 'T-1', '--status', 'in-progress', '--by', 'build-it']).code, 1, 'still frozen for status writes');
});
