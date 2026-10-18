import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkImpl, mkRepo, run, verdictText } from './_helpers.mjs';

const done = (s, id, evRel) => s.w(['set', id, '--status', 'done', '--evidence', evRel, '--by', 'build-it']);
function refused(s, r, re) {
  assert.notEqual(r.code, 0, `expected refusal, got ${r.code}`);
  if (re) assert.match(r.err, re);
}

test('AT-03 / T-B-04 done without evidence is refused and file byte-identical', () => {
  const s = mkImpl(); const before = s.bytes();
  const r = s.w(['set', 'T-1', '--status', 'done', '--by', 'build-it']);
  refused(s, r, /evidence/);
  assert.deepEqual(s.bytes(), before);
  assert.deepEqual(s.residue(), []);
});

test('AT-04 / T-B-05 done with a nonexistent evidence path is refused', () => {
  const s = mkImpl(); const before = s.bytes();
  refused(s, done(s, 'T-1', 'docs/implementations/demo/evidence/nope.md'), /does not exist/);
  assert.deepEqual(s.bytes(), before);
});

test('AT-05 / T-B-06 done with an empty evidence file is refused', () => {
  const s = mkImpl(); const before = s.bytes();
  const rel = s.ev('evidence/empty.md', '');
  refused(s, done(s, 'T-1', rel), /empty/);
  assert.deepEqual(s.bytes(), before);
});

test('AT-05b whitespace-only evidence is refused', () => {
  const s = mkImpl(); const before = s.bytes();
  const rel = s.ev('evidence/ws.md', ' \n\t \n');
  refused(s, done(s, 'T-1', rel), /whitespace/);
  assert.deepEqual(s.bytes(), before);
});

test('AT-06 done with valid evidence is accepted, updated_at set by script, history appended', () => {
  const s = mkImpl(); const t0 = s.read().updated_at;
  const rel = s.ev('evidence/T-1.md');
  const r = done(s, 'T-1', rel);
  assert.equal(r.code, 0, r.err);
  const doc = s.read();
  assert.equal(s.task('T-1').status, 'done');
  assert.equal(s.task('T-1').evidence, rel);
  assert.match(doc.updated_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.ok(doc.updated_at >= t0);
  const h = doc.history.at(-1);
  assert.deepEqual([h.task, h.from, h.to, h.by], ['T-1', 'not-started', 'done', 'build-it']);
  assert.ok(h.at);
  assert.equal(s.w(['validate']).code, 0);
  assert.deepEqual(s.residue(), []);
});

test('AT-07 / T-B-07 build-it asking for verified is refused (role check)', () => {
  const s = mkImpl();
  done(s, 'T-1', s.ev('evidence/T-1.md'));
  const v = s.ev('evidence/verdict-T-1.md', verdictText('T-1')); const before = s.bytes();
  refused(s, s.w(['set', 'T-1', '--status', 'verified', '--evidence', v, '--by', 'build-it']), /may not/);
  assert.deepEqual(s.bytes(), before);
});

test('AT-08 / T-B-08 review-it verified with a verdict path is accepted', () => {
  const s = mkImpl();
  done(s, 'T-1', s.ev('evidence/T-1.md'));
  const v = s.ev('evidence/verdict-T-1.md', verdictText('T-1'));
  const r = s.w(['set', 'T-1', '--status', 'verified', '--evidence', v, '--by', 'review-it']);
  assert.equal(r.code, 0, r.err);
  assert.equal(s.task('T-1').status, 'verified');
  assert.equal(s.read().history.at(-1).to, 'verified');
  assert.equal(s.w(['validate']).code, 0);
});

test('AT-08b verified with a non-verdict file (no verdict line / wrong task) is refused', () => {
  const s = mkImpl();
  done(s, 'T-1', s.ev('evidence/T-1.md'));
  const generic = s.ev('evidence/plain.md', 'all good\n');
  const other = s.ev('evidence/other.md', verdictText('T-2'));
  const fail = s.ev('evidence/fail.md', verdictText('T-1', 'FAIL'));
  for (const e of [generic, other, fail]) refused(s, s.w(['set', 'T-1', '--status', 'verified', '--evidence', e, '--by', 'review-it']));
  assert.equal(s.task('T-1').status, 'done');
});

function verifiedTask() {
  const s = mkImpl();
  done(s, 'T-1', s.ev('evidence/T-1.md'));
  s.w(['set', 'T-1', '--status', 'verified', '--evidence', s.ev('evidence/v.md', verdictText('T-1')), '--by', 'review-it']);
  assert.equal(s.task('T-1').status, 'verified');
  return s;
}

test('AT-09 / T-B-09 lowering verified without a note is refused', () => {
  const s = verifiedTask(); const before = s.bytes();
  refused(s, s.w(['set', 'T-1', '--status', 'in-progress', '--by', 'build-it']), /note/);
  assert.deepEqual(s.bytes(), before);
});

test('AT-10 / T-B-10 lowering verified with a note is accepted and appends history', () => {
  const s = verifiedTask(); const n = s.read().history.length;
  const r = s.w(['set', 'T-1', '--status', 'in-progress', '--note', 'case 4 failed', '--by', 'review-it']);
  assert.equal(r.code, 0, r.err);
  const doc = s.read();
  assert.equal(doc.history.length, n + 1);
  const h = doc.history.at(-1);
  assert.deepEqual([h.from, h.to, h.by, h.note], ['verified', 'in-progress', 'review-it', 'case 4 failed']);
  assert.equal(s.w(['validate']).code, 0);
});

test('AT-11 blocked without blocked_on is refused; with it accepted', () => {
  const s = mkImpl(); const before = s.bytes();
  refused(s, s.w(['set', 'T-1', '--status', 'blocked', '--by', 'build-it']), /blocked-on/);
  assert.deepEqual(s.bytes(), before);
  const r = s.w(['set', 'T-1', '--status', 'blocked', '--blocked-on', 'owner decides', '--by', 'build-it']);
  assert.equal(r.code, 0, r.err);
  assert.equal(s.task('T-1').blocked_on, 'owner decides');
});

test('AT-12 / T-B-11 writing a forbidden computed key is rejected naming the key', () => {
  const s = mkImpl(); const before = s.bytes();
  const r = s.w(['set', 'T-1', '--status', 'in-progress', '--percent', '100', '--by', 'build-it']);
  refused(s, r, /"percent"/);
  assert.deepEqual(s.bytes(), before);
  const bad = path.join(s.dir, 'bad.json'); // validator on a file containing percent (see lib.test)
  const doc = s.read(); doc.percent = 100; fs.writeFileSync(s.file, JSON.stringify(doc, null, 2));
  const v = s.w(['validate']);
  assert.equal(v.code, 1); assert.match(v.err, /"percent"/);
  assert.ok(!fs.existsSync(bad));
});

test('AT-15 unknown extra keys survive a rewrite', () => {
  const s = mkImpl();
  const doc = s.read(); doc.x_custom = { a: 1 }; doc.waves[0].tasks[0].x_tag = 'keep'; doc.waves[0].x_w = 7;
  fs.writeFileSync(s.file, JSON.stringify(doc, null, 2) + '\n');
  assert.equal(s.w(['set', 'T-1', '--status', 'in-progress', '--by', 'build-it']).code, 0);
  const after = s.read();
  assert.deepEqual(after.x_custom, { a: 1 });
  assert.equal(s.task('T-1').x_tag, 'keep');
  assert.equal(after.waves[0].x_w, 7);
});

test('AT-16 renaming or removing a task already past not-started is refused', () => {
  const s = mkImpl();
  done(s, 'T-1', s.ev('evidence/T-1.md')); const before = s.bytes();
  refused(s, s.w(['rename', 'T-1', '--title', 'New', '--by', 'plan-it']), /stable/);
  refused(s, s.w(['remove', 'T-1', '--by', 'plan-it']), /stable/);
  assert.deepEqual(s.bytes(), before);
  assert.equal(s.w(['rename', 'T-2', '--title', 'Renamed', '--by', 'plan-it']).code, 0);
  assert.equal(s.task('T-2').title, 'Renamed');
  assert.equal(s.w(['remove', 'T-3', '--by', 'plan-it']).code, 0);
  assert.equal(s.task('T-3'), undefined);
});

test('AT-14 / T-B-15 crash between tmp write and rename leaves previous file intact; next write succeeds', () => {
  const s = mkImpl(); const before = s.bytes();
  const r = run(['set', 'T-1', '--status', 'in-progress', '--by', 'build-it', '--file', s.file], { STATUS_WRITE_TEST_CRASH: 'after-tmp' });
  assert.equal(r.code, 137);
  assert.deepEqual(s.bytes(), before);
  assert.ok(fs.existsSync(`${s.file}.tmp`), 'tmp left by the simulated crash');
  const ok = s.w(['set', 'T-1', '--status', 'in-progress', '--by', 'build-it']);
  assert.equal(ok.code, 0, ok.err);
  assert.equal(s.task('T-1').status, 'in-progress');
  assert.ok(!fs.existsSync(`${s.file}.tmp`));
  assert.equal(s.w(['validate']).code, 0);
});

test('D-07 hand edit that skips history is flagged by validate', () => {
  const s = mkImpl();
  const doc = s.read(); doc.waves[0].tasks[0].status = 'in-progress'; fs.writeFileSync(s.file, JSON.stringify(doc, null, 2));
  const v = s.w(['validate']);
  assert.equal(v.code, 1); assert.match(v.err, /history/);
});

test('D-04 evidence outside impl folder and .taskstate is refused', () => {
  const s = mkImpl(); const before = s.bytes();
  fs.writeFileSync(path.join(s.root, 'README.md'), 'hello\n');
  refused(s, done(s, 'T-1', 'README.md'), /must live under/);
  assert.deepEqual(s.bytes(), before);
  fs.mkdirSync(path.join(s.root, '.taskstate', 'results'), { recursive: true });
  fs.writeFileSync(path.join(s.root, '.taskstate', 'results', 'T-1.md'), 'ok\n');
  assert.equal(done(s, 'T-1', '.taskstate/results/T-1.md').code, 0);
});

test('D-04 ".." escape and absolute evidence are refused', () => {
  const s = mkImpl(); const before = s.bytes();
  const outside = path.join(path.dirname(s.root), 'outside-evidence.md'); fs.writeFileSync(outside, 'x\n');
  refused(s, done(s, 'T-1', '../outside-evidence.md'), /\.\./);
  refused(s, done(s, 'T-1', path.join(s.dir, 'evidence', 'x.md')), /relative/);
  refused(s, done(s, 'T-1', 'docs/implementations/demo/../../../../outside-evidence.md'), /\.\./);
  assert.deepEqual(s.bytes(), before);
  fs.rmSync(outside);
});

test('D-04 symlink pointing outside the repo is refused', () => {
  const s = mkImpl(); const before = s.bytes();
  const outside = path.join(path.dirname(s.root), 'outside-link-target.md'); fs.writeFileSync(outside, 'x\n');
  fs.symlinkSync(outside, path.join(s.dir, 'evidence', 'link.md'));
  refused(s, done(s, 'T-1', 'docs/implementations/demo/evidence/link.md'), /outside the repo/);
  assert.deepEqual(s.bytes(), before);
  fs.rmSync(outside);
});

test('D-05 unknown --by is refused; missing --by is a usage error', () => {
  const s = mkImpl(); const before = s.bytes();
  const r = s.w(['set', 'T-1', '--status', 'in-progress', '--by', 'mallory']);
  refused(s, r, /unknown --by/);
  assert.equal(s.w(['set', 'T-1', '--status', 'in-progress']).code, 2);
  assert.deepEqual(s.bytes(), before);
});

test('D-05 init refuses an existing file and leaves it byte-identical', () => {
  const s = mkImpl(); const before = s.bytes();
  const r = run(['init', '--file', s.file, '--plan', s.planFile, '--by', 'plan-it']);
  assert.equal(r.code, 2); assert.match(r.err, /already exists/);
  assert.deepEqual(s.bytes(), before);
});

test('D-05 init --merge adds only missing tasks and refuses non plan-it callers', () => {
  const s = mkImpl({ tasks: ['T-1'] });
  const plan = { waves: [{ id: 'W1', title: 'x', tasks: [{ id: 'T-1', title: 'dup' }, { id: 'T-9', title: 'new' }] }] };
  fs.writeFileSync(s.planFile, JSON.stringify(plan));
  assert.equal(run(['init', '--merge', '--file', s.file, '--plan', s.planFile, '--by', 'build-it']).code, 1);
  assert.equal(run(['init', '--merge', '--file', s.file, '--plan', s.planFile, '--by', 'plan-it']).code, 0);
  const ids = s.read().waves.flatMap((w) => w.tasks.map((t) => t.id));
  assert.deepEqual(ids, ['T-1', 'T-9']);
  assert.equal(s.task('T-1').title, 'Task T-1');
});

test('init with a forbidden key in plan.json is rejected', () => {
  const root = mkRepo(); const file = path.join(root, 'docs', 'implementations', 'demo', 'status.json');
  const plan = path.join(root, 'p.json'); fs.writeFileSync(plan, JSON.stringify({ waves: [], pieces: [], percent: 5 }));
  const r = run(['init', '--file', file, '--plan', plan, '--by', 'plan-it']);
  assert.equal(r.code, 1); assert.match(r.err, /"percent"/);
  assert.ok(!fs.existsSync(file));
});

test('frozen after close: mutations refused, reopen needs a note; close needs verified or owner-note', () => {
  const s = mkImpl({ tasks: ['T-1'] });
  refused(s, s.w(['close', '--by', 'conclude-it']), /not verified/);
  assert.equal(s.read().closed, false);
  assert.equal(s.w(['close', '--by', 'conclude-it', '--owner-note', 'shipping partial']).code, 0);
  assert.equal(s.read().closed, true);
  const before = s.bytes();
  refused(s, s.w(['set', 'T-1', '--status', 'in-progress', '--by', 'build-it']), /closed/);
  assert.deepEqual(s.bytes(), before);
  refused(s, s.w(['reopen', '--by', 'conclude-it']), /note/);
  assert.equal(s.w(['reopen', '--by', 'conclude-it', '--note', 'oops']).code, 0);
  assert.equal(s.read().closed, false);
  assert.equal(s.w(['set', 'T-1', '--status', 'in-progress', '--by', 'build-it']).code, 0);
});

test('sessions, pieces, owner and blocked clearing', () => {
  const s = mkImpl();
  assert.equal(s.w(['session', 'add', '--session-id', 'S1', '--alias', 'a', '--name', 'n', '--role', 'build', '--by', 'init-it']).code, 0);
  assert.equal(s.w(['session', 'add', '--session-id', 'S1', '--alias', 'a', '--name', 'n', '--role', 'build', '--by', 'init-it']).code, 0);
  assert.equal(s.read().sessions.length, 1);
  assert.equal(s.w(['session', 'end', '--session-id', 'S1', '--by', 'conclude-it']).code, 0);
  assert.ok(s.read().sessions[0].ended_at);
  assert.equal(s.w(['session', 'add', '--session-id', 'S2', '--alias', 'a', '--name', 'n', '--role', 'build', '--by', 'build-it']).code, 1);
  refused(s, s.w(['piece', 'Core', '--whats-left', '40% left', '--by', 'build-it']), /percent/);
  assert.equal(s.w(['piece', 'Core', '--status', 'in-progress', '--whats-left', 'two tasks', '--by', 'build-it']).code, 0);
  s.w(['set', 'T-1', '--status', 'blocked', '--blocked-on', 'x', '--owner', 'Fernando', '--by', 'build-it']);
  s.w(['set', 'T-1', '--status', 'in-progress', '--by', 'build-it']);
  assert.equal(s.task('T-1').blocked_on, null);
  assert.equal(s.task('T-1').owner, 'Fernando');
  assert.equal(s.w(['validate']).code, 0);
});

test('view command prints percent and blocked list; render without renderer fails cleanly', () => {
  const s = mkImpl();
  s.w(['set', 'T-1', '--status', 'blocked', '--blocked-on', 'waiting', '--by', 'build-it']);
  const v = s.w(['view', '--json']);
  const j = JSON.parse(v.out);
  assert.equal(j.counts.blocked, 1); assert.equal(j.blocked_list[0].blocked_on, 'waiting'); assert.equal(j.percent, 0);
});

test('init records a created history entry per task, validate passes; merge adds only for new tasks', () => {
  const s = mkImpl({ tasks: ['A-1', 'A-2', 'A-3'] });
  const created = (id) => s.read().history.filter((e) => e.task === id);
  for (const id of ['A-1', 'A-2', 'A-3']) {
    const h = created(id);
    assert.equal(h.length, 1);
    assert.deepEqual([h[0].from, h[0].to, h[0].by, h[0].note], ['not-started', 'not-started', 'plan-it', 'created']);
  }
  assert.equal(s.w(['validate']).code, 0);
  const plan = { implementation: 'demo', title: 'Demo', waves: [{ id: 'W1', title: 'Wave one', tasks: ['A-1', 'A-4'].map((id) => ({ id, title: id })) }] };
  fs.writeFileSync(s.planFile, JSON.stringify(plan));
  assert.equal(s.w(['init', '--plan', s.planFile, '--by', 'plan-it', '--merge']).code, 0);
  assert.equal(created('A-1').length, 1);
  assert.equal(created('A-4').length, 1);
  assert.equal(s.w(['validate']).code, 0);
});

test('EV-01 sent back by review-it: done/verified without a fresh --evidence is refused, stored evidence is not reused', () => {
  const s = verifiedTask();
  assert.equal(s.w(['set', 'T-1', '--status', 'in-progress', '--note', 'case C-3 failed on re-review', '--by', 'review-it']).code, 0);
  let before = s.bytes();
  const d = s.w(['set', 'T-1', '--status', 'done', '--by', 'build-it']);
  refused(s, d, /done refused: T-1 needs an explicit --evidence/);
  assert.deepEqual(s.bytes(), before);
  assert.equal(s.task('T-1').status, 'in-progress');
  // reach done with fresh evidence, then verified without evidence is refused too
  assert.equal(done(s, 'T-1', s.ev('evidence/T-1-redo.md')).code, 0);
  before = s.bytes();
  const v = s.w(['set', 'T-1', '--status', 'verified', '--by', 'review-it']);
  refused(s, v, /verified refused: T-1 needs an explicit --evidence/);
  assert.deepEqual(s.bytes(), before);
  assert.equal(s.w(['set', 'T-1', '--status', 'verified', '--evidence', s.ev('evidence/v2.md', verdictText('T-1')), '--by', 'review-it']).code, 0);
  assert.equal(s.task('T-1').status, 'verified');
});

test('EV-02 a note-only set on a done task still works without evidence', () => {
  const s = mkImpl();
  done(s, 'T-1', s.ev('evidence/T-1.md'));
  assert.equal(s.w(['set', 'T-1', '--note', 'fyi', '--by', 'build-it']).code, 0);
  assert.equal(s.task('T-1').status, 'done');
});
