// CP-03 adversarial review regressions (do-it 1.1, archive A1, G-2). Each case replays the reviewer's attack
// against status-write and asserts a refusal with nothing moved. Authored by DevOtts (https://github.com/DevOtts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkImpl, run } from './_helpers.mjs';

const targetOf = (s) => path.join(path.dirname(s.dir), '0-done', 'demo');
const hand = (s, f) => { const d = s.read(); f(d); fs.writeFileSync(s.file, JSON.stringify(d, null, 2) + '\n'); };
const closeEntries = (d) => d.history.filter((h) => h.task === '*' && h.to === 'closed');

test('A1-H1 a hand-set closed:true (T-1, T-2 not started, no close entry) is refused as tampered; nothing moved', () => {
  const s = mkImpl({ tasks: ['T-1', 'T-2'] });
  hand(s, (d) => { d.closed = true; });
  const b = s.bytes();
  const r = run(['close', '--by', 'conclude-it', '--move', '--file', s.file]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.err, /not a freeze recorded by status-write \(tampered\?\)/);
  assert.doesNotMatch(r.out, /PARTIAL_FAILED recovered/);
  assert.ok(fs.existsSync(s.file)); assert.equal(fs.existsSync(targetOf(s)), false, 'nothing reached 0-done');
  assert.deepEqual(s.bytes(), b);
  fs.rmSync(s.root, { recursive: true, force: true });
});

test('A1-H1 a forged close history entry without board_sha256 is refused; nothing moved', () => {
  const s = mkImpl({ tasks: ['T-1', 'T-2'] });
  hand(s, (d) => { d.closed = true; d.history.push({ at: d.updated_at, task: '*', from: 'open', to: 'closed', by: 'conclude-it', note: 'forged' }); });
  assert.equal(run(['validate', '--file', s.file]).code, 0, 'the forged entry chains (validate alone cannot see it)');
  const r = run(['close', '--by', 'conclude-it', '--move', '--file', s.file]);
  assert.equal(r.code, 1); assert.match(r.err, /no board_sha256/);
  assert.equal(fs.existsSync(targetOf(s)), false);
  fs.rmSync(s.root, { recursive: true, force: true });
});

test('A1-H1 PARTIAL_FAILED, then the board is edited before the re-run: digest mismatch, refused; nothing moved', () => {
  const s = mkImpl({ tasks: ['T-1', 'T-2'] });
  const killed = run(['close', '--by', 'conclude-it', '--move', '--owner-note', 'owner accepts T-2 open', '--file', s.file], { STATUS_WRITE_TEST_CRASH: 'after-freeze' });
  assert.equal(killed.code, null);
  const e = closeEntries(s.read()).at(-1);
  assert.match(e.board_sha256, /^[0-9a-f]{64}$/, 'the freeze records a board digest');
  // Hand edit after the freeze: drop a piece (any edit counts).
  hand(s, (d) => { d.pieces = []; });
  const v = run(['validate', '--file', s.file]);
  assert.equal(v.code, 1); assert.match(v.err, /changed after it was closed/);
  const r = run(['close', '--by', 'conclude-it', '--move', '--file', s.file]);
  assert.equal(r.code, 1); assert.match(r.err, /tampered/);
  assert.equal(fs.existsSync(targetOf(s)), false);
  fs.rmSync(s.root, { recursive: true, force: true });
});

test('A1-H1 a real PARTIAL_FAILED with an owner note still resumes (the freeze is provable)', () => {
  const s = mkImpl({ tasks: ['T-1', 'T-2'] });
  run(['close', '--by', 'conclude-it', '--move', '--owner-note', 'owner accepts both open', '--file', s.file], { STATUS_WRITE_TEST_CRASH: 'after-freeze' });
  const r = run(['close', '--by', 'conclude-it', '--move', '--file', s.file]);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /PARTIAL_FAILED recovered/);
  assert.equal(run(['validate', '--file', path.join(targetOf(s), 'status.json')]).code, 0);
  fs.rmSync(s.root, { recursive: true, force: true });
});

test('A1-H2 an empty board (0 tasks) is refused by status-write close --move without an owner note; nothing moved', () => {
  const s = mkImpl({ tasks: ['T-1', 'T-2'] });
  hand(s, (d) => { d.waves = []; d.history = d.history.filter((h) => h.task === '*'); });
  assert.equal(run(['validate', '--file', s.file]).code, 0);
  const b = s.bytes();
  for (const args of [['--move'], []]) {
    const r = run(['close', '--by', 'conclude-it', ...args, '--file', s.file]);
    assert.equal(r.code, 1, r.out); assert.match(r.err, /no tasks, so nothing is verified; pass --owner-note/);
    assert.deepEqual(s.bytes(), b); assert.equal(fs.existsSync(targetOf(s)), false);
  }
  const ws = run(['close', '--by', 'conclude-it', '--move', '--owner-note', '   ', '--file', s.file]);
  assert.equal(ws.code, 1); assert.equal(fs.existsSync(targetOf(s)), false);
  const ok = run(['close', '--by', 'conclude-it', '--move', '--owner-note', 'owner: empty program, nothing was built', '--file', s.file]);
  assert.equal(ok.code, 0, ok.err); assert.ok(fs.existsSync(path.join(targetOf(s), 'status.json')));
  fs.rmSync(s.root, { recursive: true, force: true });
});

test('A1-L1 close --move through a symlinked package dir is refused; nothing moved', () => {
  const s = mkImpl({ tasks: ['T-1'] });
  const real = path.join(s.root, 'elsewhere', 'demo');
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.renameSync(s.dir, real);
  fs.symlinkSync(real, s.dir);
  const r = run(['close', '--by', 'conclude-it', '--move', '--owner-note', 'n', '--file', path.join(s.dir, 'status.json')]);
  assert.equal(r.code, 1); assert.match(r.err, /is a symlink/);
  assert.equal(fs.existsSync(targetOf(s)), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(real, 'status.json'), 'utf8')).closed, false, 'board not frozen');
  fs.rmSync(s.root, { recursive: true, force: true });
});
