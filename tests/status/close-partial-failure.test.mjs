// T-A1-06 (do-it 1.1 epic A1): "close --move" is crash-safe and idempotent.
// A real child process (status-write) is killed by SIGKILL at a deterministic point: after the board is frozen and
// before the folder move (test-only hook STATUS_WRITE_TEST_CRASH=after-freeze). Authored by DevOtts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkImpl, run, verdictText } from './_helpers.mjs';

function allVerified(s) {
  for (const id of ['T-1', 'T-2', 'T-3']) {
    assert.equal(s.w(['set', id, '--status', 'done', '--evidence', s.ev(`evidence/${id}.txt`), '--by', 'build-it']).code, 0);
    const v = s.ev(`evidence/${id}.verdict.md`, verdictText(id));
    assert.equal(s.w(['set', id, '--status', 'verified', '--evidence', v, '--by', 'review-it']).code, 0);
  }
}
// Every path under a directory, relative, sorted: a tree fingerprint.
function tree(dir) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); out.push(path.relative(dir, p)); if (e.isDirectory()) walk(p); } };
  walk(dir); return out.sort();
}
const closeEntries = (doc) => doc.history.filter((h) => h.task === '*' && h.to === 'closed');

test('T-A1-06 kill after freeze, before move: PARTIAL_FAILED; re-run completes the move; one close entry; never half-moved', () => {
  const s = mkImpl(); allVerified(s);
  const target = path.join(path.dirname(s.dir), '0-done', 'demo');
  const before = tree(s.dir);

  const killed = run(['close', '--by', 'conclude-it', '--move', '--file', s.file], { STATUS_WRITE_TEST_CRASH: 'after-freeze' });
  // The child really died (no exit code, killed by a signal) ...
  assert.equal(killed.code, null, `expected a killed process, got exit ${killed.code}: ${killed.err}`);
  // ... leaving PARTIAL_FAILED: board frozen, folder still in place, no 0-done tree at all.
  assert.equal(s.read().closed, true, 'board is frozen');
  assert.equal(closeEntries(s.read()).length, 1);
  assert.ok(fs.existsSync(s.dir), 'source folder intact');
  assert.equal(fs.existsSync(target), false, 'no half-moved tree in 0-done');
  const clean = (xs) => xs.filter((p) => !/\.lock|\.tmp$/.test(p));
  const afterKill = clean(tree(s.dir));
  assert.deepEqual(afterKill, clean([...new Set([...before, 'STATUS.md'])].sort()), 'folder content unchanged by the kill');

  // Recover by re-run.
  const again = run(['close', '--by', 'conclude-it', '--move', '--file', s.file]);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /PARTIAL_FAILED recovered/);
  assert.equal(fs.existsSync(s.dir), false, 'source gone after the move');
  const moved = JSON.parse(fs.readFileSync(path.join(target, 'status.json'), 'utf8'));
  assert.equal(moved.closed, true);
  assert.equal(closeEntries(moved).length, 1, 'exactly one close history entry');
  assert.deepEqual(clean(tree(target)), afterKill, 'the whole tree moved in one piece');
  for (const f of ['status.json', 'STATUS.md', 'evidence']) assert.ok(fs.existsSync(path.join(target, f)), `${f} moved`);
  assert.equal(run(['validate', '--file', path.join(target, 'status.json')]).code, 0, 'moved board still validates');

  // Idempotent: a third run neither moves nor writes (the package is in 0-done now).
  const b = fs.readFileSync(path.join(target, 'status.json'));
  const third = run(['close', '--by', 'conclude-it', '--move', '--file', path.join(target, 'status.json')]);
  assert.equal(third.code, 1); assert.match(third.err, /already in 0-done/);
  assert.deepEqual(fs.readFileSync(path.join(target, 'status.json')), b);
  fs.rmSync(s.root, { recursive: true, force: true });
});

test('T-A1-06 resume refuses when the 0-done target appeared meanwhile; nothing moved', () => {
  const s = mkImpl(); allVerified(s);
  run(['close', '--by', 'conclude-it', '--move', '--file', s.file], { STATUS_WRITE_TEST_CRASH: 'after-freeze' });
  const target = path.join(path.dirname(s.dir), '0-done', 'demo');
  fs.mkdirSync(target, { recursive: true });
  const r = run(['close', '--by', 'conclude-it', '--move', '--file', s.file]);
  assert.equal(r.code, 1); assert.match(r.err, /already exists/);
  assert.ok(fs.existsSync(s.file)); assert.deepEqual(fs.readdirSync(target), []);
  fs.rmSync(s.root, { recursive: true, force: true });
});

test('T-A1-06 close without --move closes a package already in 0-done in place; with --move it is refused', () => {
  const s = mkImpl();
  const target = path.join(path.dirname(s.dir), '0-done', 'demo');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(s.dir, target);
  const f = path.join(target, 'status.json');
  const b = fs.readFileSync(f);
  const mv = run(['close', '--by', 'conclude-it', '--move', '--owner-note', 'x', '--file', f]);
  assert.equal(mv.code, 1); assert.deepEqual(fs.readFileSync(f), b);
  const noNote = run(['close', '--by', 'conclude-it', '--file', f]);
  assert.equal(noNote.code, 1); assert.match(noNote.err, /not verified \(T-1, T-2, T-3\)/); assert.deepEqual(fs.readFileSync(f), b);
  const r = run(['close', '--by', 'conclude-it', '--owner-note', 'archived by hand earlier', '--file', f]);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /closed in place/);
  const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(doc.closed, true); assert.equal(closeEntries(doc).at(-1).note, 'archived by hand earlier');
  assert.ok(fs.existsSync(target)); assert.equal(fs.existsSync(path.join(target, '0-done')), false);
  fs.rmSync(s.root, { recursive: true, force: true });
});
