import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkImpl, verdictText } from './_helpers.mjs';

const done = (s, id) => s.w(['set', id, '--status', 'done', '--evidence', s.ev(`evidence/${id}.md`), '--by', 'build-it']);
const verify = (s, id, by = 'review-it', ev) => s.w(['set', id, '--status', 'verified', '--evidence', ev ?? s.ev(`evidence/verdict-${id}.md`, verdictText(id)), '--by', by]);
function refused(s, r, re, before) {
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.err}`);
  if (re) assert.match(r.err, re);
  if (before) assert.deepEqual(s.bytes(), before);
  assert.deepEqual(s.residue(), []);
}
function allVerified(s, ids = ['T-1', 'T-2', 'T-3']) { for (const id of ids) { done(s, id); assert.equal(verify(s, id).code, 0); } }

test('ST-04 / AT-08 / T-B-08 review-it verified with a verdict file is accepted, history by review-it', () => {
  const s = mkImpl(); done(s, 'T-1');
  const r = verify(s, 'T-1'); assert.equal(r.code, 0, r.err);
  const h = s.read().history.at(-1);
  assert.deepEqual([h.task, h.from, h.to, h.by], ['T-1', 'done', 'verified', 'review-it']);
  assert.equal(s.w(['validate']).code, 0);
});

test('ST-04 verdict for a different task id is refused', () => {
  const s = mkImpl(); done(s, 'T-1'); const b = s.bytes();
  refused(s, verify(s, 'T-1', 'review-it', s.ev('evidence/v2.md', verdictText('T-2'))), /does not name task T-1/, b);
});

test('ST-04 verdict for T-10 does not verify T-1 (id match is token-exact)', () => {
  const s = mkImpl({ tasks: ['T-1', 'T-10'] }); done(s, 'T-1'); const b = s.bytes();
  refused(s, verify(s, 'T-1', 'review-it', s.ev('evidence/v10.md', verdictText('T-10'))), /does not name task/, b);
});

test('ST-04 FAIL verdict, empty file and file without review-it token are refused', () => {
  const s = mkImpl(); done(s, 'T-1'); const b = s.bytes();
  refused(s, verify(s, 'T-1', 'review-it', s.ev('evidence/f.md', verdictText('T-1', 'FAIL'))), /verdict/, b);
  refused(s, verify(s, 'T-1', 'review-it', s.ev('evidence/e.md', '')), /empty/, b);
  refused(s, verify(s, 'T-1', 'review-it', s.ev('evidence/n.md', 'task: T-1\nverdict: PASS\n')), /review-it/, b);
  assert.equal(s.task('T-1').status, 'done');
});

test('ST-04 verdict outside the implementation folder and .taskstate is refused', () => {
  const s = mkImpl(); done(s, 'T-1'); const b = s.bytes();
  fs.mkdirSync(path.join(s.root, 'elsewhere'));
  fs.writeFileSync(path.join(s.root, 'elsewhere', 'v.md'), verdictText('T-1'));
  refused(s, verify(s, 'T-1', 'review-it', 'elsewhere/v.md'), /must live under/, b);
});

test('ST-04 verdict under a .taskstate dir is accepted', () => {
  const s = mkImpl(); done(s, 'T-1');
  fs.mkdirSync(path.join(s.root, '.taskstate'));
  fs.writeFileSync(path.join(s.root, '.taskstate', 'v.md'), verdictText('T-1'));
  assert.equal(verify(s, 'T-1', 'review-it', '.taskstate/v.md').code, 0);
});

test('ST-04 failed case back to in-progress', () => {
  const s = mkImpl(); done(s, 'T-1'); verify(s, 'T-1');
  const b = s.bytes();
  refused(s, s.w(['set', 'T-1', '--status', 'in-progress', '--by', 'review-it']), /note/, b);
  const r = s.w(['set', 'T-1', '--status', 'in-progress', '--note', 'case 3 fails: empty input', '--by', 'review-it']);
  assert.equal(r.code, 0, r.err);
  assert.equal(s.task('T-1').status, 'in-progress');
  const h = s.read().history.at(-1);
  assert.deepEqual([h.from, h.to, h.by, h.note], ['verified', 'in-progress', 'review-it', 'case 3 fails: empty input']);
  assert.equal(s.w(['validate']).code, 0);
});

test('ST-04 review-it in-progress from done also needs a note', () => {
  const s = mkImpl(); done(s, 'T-1'); const b = s.bytes();
  refused(s, s.w(['set', 'T-1', '--status', 'in-progress', '--by', 'review-it']), /note/, b);
});

test('ST-04 role matrix: build-it and plan-it cannot verify; review-it cannot done/blocked/close', () => {
  const s = mkImpl(); done(s, 'T-1'); const b = s.bytes();
  for (const by of ['build-it', 'plan-it', 'init-it']) refused(s, verify(s, 'T-1', by), /may not/, b);
  refused(s, s.w(['set', 'T-2', '--status', 'done', '--evidence', s.ev('evidence/x.md'), '--by', 'review-it']), /may not/, b);
  refused(s, s.w(['set', 'T-2', '--status', 'blocked', '--blocked-on', 'x', '--by', 'review-it']), /may not/, b);
  refused(s, s.w(['close', '--by', 'review-it', '--owner-note', 'x']), /may not/, b);
});

test('ST-05 conclude-it verified carry-forward needs the same D-06 verdict', () => {
  const s = mkImpl(); done(s, 'T-1'); const b = s.bytes();
  refused(s, verify(s, 'T-1', 'conclude-it', s.ev('evidence/plain.md', 'looks fine\n')), /verdict/, b);
  refused(s, verify(s, 'T-1', 'conclude-it', s.ev('evidence/o.md', verdictText('T-2'))), /does not name/, b);
  assert.equal(verify(s, 'T-1', 'conclude-it').code, 0);
  assert.equal(s.read().history.at(-1).by, 'conclude-it');
});

test('ST-05 role matrix: build-it, plan-it, init-it cannot close or reopen', () => {
  const s = mkImpl(); allVerified(s); const b = s.bytes();
  for (const by of ['build-it', 'plan-it', 'init-it', 'review-it']) {
    refused(s, s.w(['close', '--by', by]), /may not/, b);
    refused(s, s.w(['reopen', '--by', by, '--note', 'x']), /may not/, b);
  }
});

test('ST-05 init-it can only do sessions', () => {
  const s = mkImpl(); const b = s.bytes();
  assert.equal(s.w(['session', 'add', '--session-id', 'S1', '--alias', 'a', '--name', 'n', '--role', 'build', '--by', 'init-it']).code, 0);
  assert.equal(s.w(['session', 'end', '--session-id', 'S1', '--by', 'init-it']).code, 0);
  const b2 = s.bytes(); assert.notDeepEqual(b2, b);
  refused(s, s.w(['set', 'T-1', '--status', 'in-progress', '--by', 'init-it']), /may not/, b2);
  refused(s, s.w(['set', 'T-1', '--owner', 'x', '--by', 'init-it']), /may not/, b2);
  refused(s, s.w(['piece', 'Core', '--status', 'done', '--by', 'init-it']), /may not/, b2);
});

test('ST-05 session end works for conclude-it and init-it only', () => {
  const s = mkImpl();
  s.w(['session', 'add', '--session-id', 'S1', '--alias', 'a', '--name', 'n', '--role', 'build', '--by', 'init-it']);
  const b = s.bytes();
  for (const by of ['build-it', 'plan-it', 'review-it']) refused(s, s.w(['session', 'end', '--session-id', 'S1', '--by', by]), /may not/, b);
  assert.equal(s.w(['session', 'end', '--session-id', 'S1', '--by', 'conclude-it']).code, 0);
  assert.ok(s.read().sessions[0].ended_at);
});

test('ST-05 / T-B-18 conclude-it with an unverified task: move refused without owner note', () => {
  const s = mkImpl(); done(s, 'T-1'); verify(s, 'T-1'); const b = s.bytes();
  const r = s.w(['close', '--by', 'conclude-it', '--move']);
  refused(s, r, /not verified/, b);
  assert.match(r.err, /T-2/);
  assert.ok(fs.existsSync(s.dir), 'impl folder must not move');
  assert.ok(!fs.existsSync(path.join(path.dirname(s.dir), '0-done')));
});

test('ST-05 close with owner note', () => {
  const s = mkImpl(); done(s, 'T-1'); verify(s, 'T-1');
  const r = s.w(['close', '--by', 'conclude-it', '--owner-note', 'T-2 and T-3 deferred by owner']);
  assert.equal(r.code, 0, r.err);
  assert.equal(s.read().closed, true);
  const h = s.read().history.at(-1);
  assert.deepEqual([h.task, h.by, h.note], ['*', 'conclude-it', 'T-2 and T-3 deferred by owner']);
  assert.equal(s.w(['validate']).code, 0);
});

test('ST-05 close with all verified needs no note', () => {
  const s = mkImpl(); allVerified(s);
  assert.equal(s.w(['close', '--by', 'conclude-it']).code, 0);
  assert.equal(s.read().closed, true);
});

test('ST-05 --move to 0-done', () => {
  const s = mkImpl(); allVerified(s);
  const r = s.w(['close', '--by', 'conclude-it', '--move']);
  assert.equal(r.code, 0, r.err);
  const target = path.join(path.dirname(s.dir), '0-done', 'demo');
  assert.ok(!fs.existsSync(s.dir)); assert.ok(fs.existsSync(path.join(target, 'status.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'status.json'), 'utf8')).closed, true);
  assert.equal(fs.readdirSync(target).filter((f) => /\.(lock|tmp)$/.test(f)).length, 0);
  assert.equal(fs.existsSync(path.join(target, 'evidence')), true);
});

test('ST-05 --move refused when the 0-done target exists; nothing moved or changed', () => {
  const s = mkImpl(); allVerified(s); const b = s.bytes();
  fs.mkdirSync(path.join(path.dirname(s.dir), '0-done', 'demo'), { recursive: true });
  refused(s, s.w(['close', '--by', 'conclude-it', '--move']), /already exists/, b);
  assert.ok(fs.existsSync(s.dir)); assert.equal(s.read().closed, false);
});

test('ST-05 frozen after close', () => {
  const s = mkImpl(); allVerified(s);
  s.w(['close', '--by', 'conclude-it']); const b = s.bytes();
  const cases = [
    ['set', 'T-1', '--status', 'in-progress', '--note', 'x', '--by', 'review-it'],
    ['set', 'T-1', '--status', 'in-progress', '--note', 'x', '--by', 'build-it'],
    ['set', 'T-1', '--owner', 'z', '--by', 'build-it'],
    ['piece', 'Core', '--status', 'done', '--by', 'build-it'],
    ['session', 'add', '--session-id', 'S9', '--alias', 'a', '--name', 'n', '--role', 'build', '--by', 'init-it'],
    ['session', 'end', '--session-id', 'S9', '--by', 'conclude-it'],
    ['close', '--by', 'conclude-it'],
    ['rename', 'T-1', '--title', 'z', '--by', 'plan-it'],
    ['init', '--merge', '--plan', s.planFile, '--by', 'plan-it'],
  ];
  for (const c of cases) refused(s, s.w(c), /closed|frozen|not found|may not|exists/, b);
  refused(s, s.w(['reopen', '--by', 'conclude-it']), /note/, b);
  const r = s.w(['reopen', '--by', 'conclude-it', '--note', 'found a bug']);
  assert.equal(r.code, 0, r.err);
  assert.equal(s.read().closed, false);
  assert.equal(s.read().history.at(-1).note, 'found a bug');
  assert.equal(s.w(['set', 'T-1', '--status', 'in-progress', '--note', 'redo', '--by', 'review-it']).code, 0);
});

test('ST-05 --end-sessions', () => {
  const s = mkImpl(); allVerified(s);
  for (const id of ['S1', 'S2']) s.w(['session', 'add', '--session-id', id, '--alias', 'a', '--name', 'n', '--role', 'build', '--by', 'init-it']);
  s.w(['session', 'end', '--session-id', 'S1', '--by', 'init-it']);
  const endedS1 = s.read().sessions[0].ended_at;
  assert.equal(s.w(['close', '--by', 'conclude-it', '--end-sessions']).code, 0);
  const ss = s.read().sessions;
  assert.ok(ss.every((x) => x.ended_at));
  assert.equal(ss[0].ended_at, endedS1, 'already-ended session untouched');
});

test('ST-05 close without --end-sessions leaves open sessions open', () => {
  const s = mkImpl(); allVerified(s);
  s.w(['session', 'add', '--session-id', 'S1', '--alias', 'a', '--name', 'n', '--role', 'build', '--by', 'init-it']);
  s.w(['close', '--by', 'conclude-it']);
  assert.equal(s.read().sessions[0].ended_at, null);
});
