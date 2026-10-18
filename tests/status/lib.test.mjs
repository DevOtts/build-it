import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LIB, mkRepo, mkImpl } from './_helpers.mjs';

const lib = await import(pathToFileURL(LIB).href);
const mk = (statuses) => ({
  schema: 1, implementation: 'x', updated_at: '2026-10-15T00:00:00Z', approximate: false,
  waves: [{ id: 'W1', title: 'w', tasks: statuses.map((s, i) => ({ id: `T-${i}`, title: 't', status: s, updated_at: '2026-10-15T00:00:00Z' })) }],
  sessions: [], pieces: [], history: [],
});

test('exports are present with the agreed names and values', () => {
  assert.equal(lib.SCHEMA_VERSION, 1);
  assert.equal(lib.DONE_UNVERIFIED_WEIGHT, 0.6);
  assert.equal(lib.STALE_THRESHOLD_MS, 86400000);
  assert.equal(lib.RENDER_MARKER, '<!-- generated from status.json by status-write; do not edit by hand -->');
  for (const n of ['percent', 'computeView', 'loadView', 'validate', 'checkEvidence', 'isStale', 'newestActivity', 'resolveRepoRoot', 'resolveStatusFile', 'withLock', 'writeAtomic', 'nowIso']) assert.equal(typeof lib[n], 'function', n);
});

test('AT-17 percent for the worked example is exactly 62', () => {
  const d = mk([...Array(5).fill('verified'), 'done', 'done', 'blocked', 'in-progress', 'not-started']);
  assert.equal(lib.percent(d), 62);
  assert.equal(lib.computeView(d).percent, 62);
  assert.equal(lib.computeView(d).counts.blocked, 1);
});

test('AT-18 / T-B-02 zero tasks gives unknown', () => {
  assert.equal(lib.percent(mk([])), 'unknown');
  assert.equal(lib.computeView(mk([])).percent, 'unknown');
  assert.equal(lib.percent({ ...mk([]), waves: [] }), 'unknown');
});

test('AT-19 one done task of one is 60, never 100', () => {
  assert.equal(lib.percent(mk(['done'])), 60);
  assert.equal(lib.percent(mk(['done', 'done', 'done', 'done', 'done', 'done', 'done', 'done', 'done', 'done', 'done', 'done'])), 60);
  assert.equal(lib.percent(mk(['verified'])), 100);
});

test('percent never rounds up to 100 while a task is below verified', () => {
  const d = mk([...Array(199).fill('verified'), 'done']); // (199+0.6)/200 = 99.8 -> 100 unless clamped
  assert.equal(lib.percent(d), 99);
});

test('T-B-01 four tasks (verified, done, in-progress, not-started) match the formula', () => {
  assert.equal(lib.percent(mk(['verified', 'done', 'in-progress', 'not-started'])), Math.round(((1 + 0.6) / 4) * 100));
  assert.equal(lib.percent(mk(['verified', 'done', 'in-progress', 'not-started'])), 40);
});

test('T-B-03 blocked task is listed, contributes 0 and is not hidden', () => {
  const d = mk(['verified', 'blocked']); d.waves[0].tasks[1].blocked_on = 'owner decision';
  const v = lib.computeView(d);
  assert.equal(v.percent, 50);
  assert.deepEqual(v.blocked_list, [{ id: 'T-1', title: 't', blocked_on: 'owner decision' }]);
  assert.equal(v.counts.blocked, 1);
});

test('AT-12 / T-B-11 validator names the forbidden keys (top level, task, wave)', () => {
  for (const k of lib.FORBIDDEN_KEYS) {
    const d = mk(['not-started']); d[k] = 1;
    const r = lib.validate(d);
    assert.equal(r.ok, false); assert.match(r.errors.join('\n'), new RegExp(`"${k}"`));
  }
  const d = mk(['not-started']); d.waves[0].tasks[0].percent = 5;
  assert.match(lib.validate(d).errors.join('\n'), /"percent" in task T-0/);
  const w = mk(['not-started']); w.waves[0].counts = {};
  assert.match(lib.validate(w).errors.join('\n'), /"counts"/);
  const p = mk([]); p.percent = 100;
  assert.equal(lib.computeView(p).percent, 'unknown', 'view ignores the stored value');
});

test('T-B-12 unsupported schema gives a view error and does not crash', () => {
  for (const s of [2, 0, '1', null]) {
    const v = lib.computeView({ ...mk([]), schema: s });
    assert.match(v.error, /unsupported schema/);
  }
  const r = lib.validate({ ...mk([]), schema: 9 });
  assert.equal(r.ok, false); assert.match(r.errors[0], /unsupported schema 9/);
  const root = mkRepo(); const f = path.join(root, 'status.json');
  fs.writeFileSync(f, JSON.stringify({ schema: 2 }));
  assert.match(lib.loadView(f).error, /unsupported schema 2/);
});

test('T-B-13 invalid JSON gives a loadView error and does not throw; other files still load', () => {
  const root = mkRepo();
  const bad = path.join(root, 'bad.json'); fs.writeFileSync(bad, '{ not json');
  const good = path.join(root, 'good.json'); fs.writeFileSync(good, JSON.stringify(mk(['verified', 'not-started'])));
  const missing = path.join(root, 'nope.json');
  const results = [bad, good, missing].map((f) => lib.loadView(f));
  assert.match(results[0].error, /invalid JSON/);
  assert.equal(results[1].error, undefined);
  assert.equal(results[1].percent, 50);
  assert.match(results[2].error, /cannot read/);
  const arr = path.join(root, 'arr.json'); fs.writeFileSync(arr, '[]');
  assert.ok(lib.loadView(arr).error);
});

test('T-B-20 isStale both ways (fresh vs stale), threshold boundary and nulls', () => {
  const upd = '2026-10-15T12:00:00Z';
  assert.equal(lib.isStale(upd, '2026-10-15T10:00:00Z'), false, 'newest commit older than updated_at');
  assert.equal(lib.isStale(upd, '2026-10-16T11:00:00Z'), false, 'within 24h');
  assert.equal(lib.isStale(upd, '2026-10-16T12:00:00Z'), false, 'exactly at threshold is not stale');
  assert.equal(lib.isStale(upd, '2026-10-16T12:00:01Z'), true, 'just past threshold');
  assert.equal(lib.isStale(upd, Date.parse('2026-10-20T00:00:00Z'), 1000), true);
  assert.equal(lib.isStale(upd, null), false);
  assert.equal(lib.isStale('garbage', upd), false);
  const d = mk(['done']);
  assert.equal(lib.computeView(d, { newestActivity: '2026-10-20T00:00:00Z' }).stale, true);
  assert.equal(lib.computeView(d, { newestActivity: '2026-10-14T00:00:00Z' }).stale, false);
});

test('newestActivity reads session times and tolerates a non-git dir', () => {
  const root = mkRepo();
  const d = mk([]); d.sessions = [{ session_id: 's', alias: 'a', name: 'n', role: 'build', started_at: '2026-10-15T10:00:00Z', ended_at: '2026-10-15T11:00:00Z' }];
  assert.equal(lib.newestActivity(root, d), Date.parse('2026-10-15T11:00:00Z'));
  assert.equal(lib.newestActivity(root, mk([])), null);
});

test('validate: bad enums, missing fields, blocked without blocked_on, duplicate ids, folder mismatch', () => {
  const s = mkImpl();
  const base = s.read();
  const dup = structuredClone(base); dup.waves[0].tasks[1].id = 'T-1';
  assert.match(lib.validate(dup, { dir: s.dir }).errors.join('\n'), /duplicate task id T-1/);
  const bad = structuredClone(base); bad.waves[0].tasks[0].status = 'finished';
  assert.match(lib.validate(bad, { dir: s.dir }).errors.join('\n'), /status must be one of/);
  const nofield = structuredClone(base); delete nofield.history;
  assert.match(lib.validate(nofield, { dir: s.dir }).errors.join('\n'), /history must be an array/);
  const blk = structuredClone(base); blk.waves[0].tasks[0].status = 'blocked'; blk.history.push({ at: 'x', task: 'T-1', from: 'a', to: 'blocked', by: 'build-it' });
  assert.match(lib.validate(blk, { dir: s.dir }).errors.join('\n'), /blocked requires blocked_on/);
  const mismatch = structuredClone(base); mismatch.implementation = 'other';
  assert.match(lib.validate(mismatch, { dir: s.dir }).errors.join('\n'), /does not equal folder/);
  assert.equal(lib.validate(base, { dir: s.dir }).ok, true);
});

test('writeAtomic serialises as 2-space JSON plus a trailing newline; withLock releases on throw', async () => {
  const root = mkRepo(); const f = path.join(root, 'status.json');
  const doc = mk(['not-started']);
  lib.writeAtomic(f, doc);
  assert.equal(fs.readFileSync(f, 'utf8'), JSON.stringify(doc, null, 2) + '\n');
  assert.ok(!fs.existsSync(`${f}.tmp`));
  await assert.rejects(lib.withLock(f, () => { throw new Error('boom'); }), /boom/);
  assert.ok(!fs.existsSync(`${f}.lock`));
  assert.equal(await lib.withLock(f, () => 42), 42);
});

test('withLock reclaims a stale lock and times out on a fresh one', async () => {
  const root = mkRepo(); const f = path.join(root, 'status.json');
  fs.writeFileSync(`${f}.lock`, '1 1\n'); const old = new Date(Date.now() - 60000); fs.utimesSync(`${f}.lock`, old, old);
  assert.equal(await lib.withLock(f, () => 'ok'), 'ok');
  fs.writeFileSync(`${f}.lock`, '1 1\n');
  await assert.rejects(lib.withLock(f, () => 'no', { timeoutMs: 150 }), (e) => e.code === 'ELOCK');
  fs.unlinkSync(`${f}.lock`);
});

test('resolveRepoRoot and resolveStatusFile (plural, singular fallback, env, explicit file)', () => {
  const root = mkRepo();
  const sub = path.join(root, 'a', 'b'); fs.mkdirSync(sub, { recursive: true });
  assert.equal(lib.resolveRepoRoot(sub), root);
  fs.mkdirSync(path.join(root, 'docs', 'implementation', 'foo'), { recursive: true });
  assert.equal(lib.resolveStatusFile({ impl: 'foo', cwd: sub }), path.join(root, 'docs', 'implementation', 'foo', 'status.json'));
  fs.mkdirSync(path.join(root, 'docs', 'implementations', 'foo'), { recursive: true });
  assert.equal(lib.resolveStatusFile({ impl: 'foo', cwd: sub }), path.join(root, 'docs', 'implementations', 'foo', 'status.json'));
  assert.equal(lib.resolveStatusFile({ file: 'x/status.json', cwd: root }), path.join(root, 'x', 'status.json'));
  assert.equal(lib.resolveStatusFile({}), null);
});

test('checkEvidence rejects status.json and STATUS.md as evidence', () => {
  const s = mkImpl();
  fs.writeFileSync(path.join(s.dir, 'STATUS.md'), 'x\n');
  assert.equal(lib.checkEvidence(s.root, s.dir, 'docs/implementations/demo/status.json').ok, false);
  assert.equal(lib.checkEvidence(s.root, s.dir, 'docs/implementations/demo/STATUS.md').ok, false);
});

test('schema file parses and carries the forbidden-key and conditional rules', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(path.dirname(LIB), 'status.schema.json'), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.deepEqual(schema.$defs.forbidden.anyOf.map((x) => x.required[0]).sort(), [...lib.FORBIDDEN_KEYS].sort());
  assert.equal(schema.$defs.task.allOf.length, 2);
});
