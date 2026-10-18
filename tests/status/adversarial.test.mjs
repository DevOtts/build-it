// ST-08 adversarial regression tests: every attack that got a fake done/verified/100%, a hidden blocked
// task, or a silent lowering past the writer or the validator before ST-08, plus the defenses that held.
// Authored by DevOtts (https://github.com/DevOtts).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkImpl, run, runAsync, verdictText, LIB } from './_helpers.mjs';
import { migrate } from '../../plugins/build-it/scripts/status/status-migrate.mjs';
import { renderStatusMd } from '../../plugins/build-it/scripts/status/status-render.mjs';

const lib = await import(LIB);
const refused = (r, re) => { assert.notEqual(r.code, 0, `expected refusal, got 0 (${r.out})`); if (re) assert.match(r.err, re); };
const hand = (s, f) => { const d = s.read(); f(d); fs.writeFileSync(s.file, JSON.stringify(d, null, 2)); };
const verify = (s, id, rel, by = 'review-it') => s.w(['set', id, '--status', 'verified', '--evidence', rel, '--by', by]);
const errs = (s) => lib.validate(s.read(), { dir: s.dir, repoRoot: s.root }).errors.join('\n');
const T0 = '2026-10-18T00:00:00Z';

// ---------- writer: roles and pieces ----------
test('ST-08 piece verified by build-it is refused; review-it may verify a piece', () => {
  const s = mkImpl(); const before = s.bytes();
  refused(s.w(['piece', 'Core', '--status', 'verified', '--by', 'build-it']), /may not set piece status verified/);
  assert.deepEqual(s.bytes(), before);
  assert.equal(s.w(['piece', 'Core', '--status', 'verified', '--by', 'review-it']).code, 0);
  assert.equal(s.read().pieces[0].status, 'verified');
});

test('ST-08 piece blocked without --blocked-on is refused; blocked_on cleared off blocked', () => {
  const s = mkImpl(); const before = s.bytes();
  refused(s.w(['piece', 'Core', '--status', 'blocked', '--by', 'build-it']), /blocked requires --blocked-on/);
  refused(s.w(['piece', 'Core', '--status', 'blocked', '--blocked-on', '  ', '--by', 'build-it']), /blocked requires/);
  assert.deepEqual(s.bytes(), before);
  assert.equal(s.w(['piece', 'Core', '--status', 'blocked', '--blocked-on', 'owner', '--by', 'build-it']).code, 0);
  assert.equal(s.w(['piece', 'Core', '--status', 'done', '--blocked-on', 'stale', '--by', 'build-it']).code, 0);
  assert.equal(s.read().pieces[0].blocked_on, null);
});

test('ST-08 piece lowered from verified needs --note', () => {
  const s = mkImpl();
  assert.equal(s.w(['piece', 'Core', '--status', 'verified', '--by', 'review-it']).code, 0);
  refused(s.w(['piece', 'Core', '--status', 'done', '--by', 'build-it']), /lowering a verified piece requires --note/);
  assert.equal(s.w(['piece', 'Core', '--status', 'done', '--note', 'regressed', '--by', 'build-it']).code, 0);
});

test('ST-08 validator flags a hand-edited blocked piece without blocked_on', () => {
  const s = mkImpl();
  hand(s, (d) => { d.pieces[0].status = 'blocked'; });
  assert.match(errs(s), /pieces\[0\]: blocked requires blocked_on/);
});

test('ST-08 case and whitespace role variants are refused (defense held)', () => {
  const s = mkImpl();
  for (const by of ['Review-It', 'review-it ', 'REVIEW-IT', 'migration', '']) {
    refused(s.w(['set', 'T-1', '--status', 'in-progress', '--note', 'x', '--by', by]));
  }
});

test('ST-08 init-it and plan-it cannot touch task status (defense held)', () => {
  const s = mkImpl();
  refused(s.w(['set', 'T-1', '--status', 'in-progress', '--by', 'init-it']), /may not/);
  refused(s.w(['set', 'T-1', '--owner', 'x', '--by', 'init-it']), /may not/);
  refused(s.w(['set', 'T-1', '--status', 'done', '--by', 'plan-it']), /may not/);
});

test('ST-08 plan-it init ignores pre-set statuses and refuses forbidden keys in plan.json (defense held)', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'st08-')));
  fs.mkdirSync(path.join(root, '.git'));
  const file = path.join(root, 'docs', 'implementations', 'p', 'status.json');
  const plan = { implementation: 'p', waves: [{ id: 'W1', title: 'w', tasks: [{ id: 'A-1', title: 'a', status: 'verified', evidence: 'x', history: [] }] }], pieces: [] };
  fs.writeFileSync(path.join(root, 'plan.json'), JSON.stringify(plan));
  assert.equal(run(['init', '--file', file, '--plan', path.join(root, 'plan.json'), '--by', 'plan-it']).code, 0);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(doc.waves[0].tasks[0].status, 'not-started');
  assert.equal(doc.waves[0].tasks[0].evidence, null);
  for (const k of ['percent', 'Computed']) {
    const bad = { ...plan, waves: [{ ...plan.waves[0], tasks: [{ id: 'A-2', title: 'b', [k]: 100 }] }] };
    fs.writeFileSync(path.join(root, 'plan2.json'), JSON.stringify(bad));
    refused(run(['init', '--merge', '--file', file, '--plan', path.join(root, 'plan2.json'), '--by', 'plan-it']), /forbidden key/);
  }
});

// ---------- evidence ----------
test('ST-08 evidence symlink to status.json / STATUS.md is refused', () => {
  const s = mkImpl(); const before = s.bytes();
  fs.symlinkSync('../status.json', path.join(s.dir, 'evidence/ev.md'));
  refused(s.w(['set', 'T-1', '--status', 'done', '--evidence', 'docs/implementations/demo/evidence/ev.md', '--by', 'build-it']), /status files are not evidence/);
  fs.writeFileSync(path.join(s.dir, 'STATUS.md'), 'board\n');
  fs.symlinkSync('../STATUS.md', path.join(s.dir, 'evidence/ev2.md'));
  refused(s.w(['set', 'T-1', '--status', 'done', '--evidence', 'docs/implementations/demo/evidence/ev2.md', '--by', 'build-it']), /status files are not evidence/);
  assert.deepEqual(s.bytes(), before);
});

test('ST-08 evidence name case variants and the lock file are refused', () => {
  const s = mkImpl();
  fs.writeFileSync(`${s.file}.lock`, '999999 0\n');
  for (const rel of ['docs/implementations/demo/STATUS.JSON', 'docs/implementations/demo/Status.Md', 'docs/implementations/demo/status.json.lock', 'docs/implementations/demo/status.json.tmp']) {
    refused(s.w(['set', 'T-1', '--status', 'done', '--evidence', rel, '--by', 'build-it']), /may not be|not evidence|does not exist/);
  }
  fs.rmSync(`${s.file}.lock`, { force: true });
});

test('ST-08 evidence path shapes: ./ and // accepted; trailing slash, directory, FIFO, outside symlink refused', () => {
  const s = mkImpl();
  const rel = s.ev('evidence/T-1.md');
  assert.equal(s.w(['set', 'T-1', '--status', 'done', '--evidence', `./${rel.replace('evidence/', 'evidence//')}`, '--by', 'build-it']).code, 0);
  refused(s.w(['set', 'T-2', '--status', 'done', '--evidence', `${rel}/`, '--by', 'build-it']), /not end in a separator/);
  refused(s.w(['set', 'T-2', '--status', 'done', '--evidence', 'docs/implementations/demo/evidence', '--by', 'build-it']), /not a regular file/);
  const fifo = path.join(s.dir, 'evidence', 'pipe.md');
  if (spawnSync('mkfifo', [fifo]).status === 0) {
    refused(s.w(['set', 'T-2', '--status', 'done', '--evidence', 'docs/implementations/demo/evidence/pipe.md', '--by', 'build-it']), /not a regular file/);
  }
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'st08-out-'));
  fs.writeFileSync(path.join(outside, 'x.md'), 'x\n');
  fs.symlinkSync(path.join(outside, 'x.md'), path.join(s.dir, 'evidence', 'out.md'));
  refused(s.w(['set', 'T-2', '--status', 'done', '--evidence', 'docs/implementations/demo/evidence/out.md', '--by', 'build-it']), /outside the repo/);
});

test('ST-08 evidence deleted after done makes validate and view fail', () => {
  const s = mkImpl();
  const rel = s.ev('evidence/T-1.md');
  assert.equal(s.w(['set', 'T-1', '--status', 'done', '--evidence', rel, '--by', 'build-it']).code, 0);
  fs.unlinkSync(path.join(s.root, rel));
  refused(s.w(['validate']), /does not exist/);
  const v = s.w(['view']);
  assert.equal(v.code, 1);
  assert.match(v.out, /INVALID/);
  assert.match(v.out, /invalid: task T-1: evidence file does not exist/);
});

// ---------- verdicts ----------
test('ST-08 verdict with a FAIL line next to a PASS line is refused', () => {
  const s = mkImpl();
  refused(verify(s, 'T-1', s.ev('evidence/v.md', '# review-it\ntask: T-1\nverdict: FAIL\nresult: PASS\n')), /non-PASS verdict line \(FAIL\)/);
});

test('ST-08 verdict for another task id is refused (task: line, T-1 vs T-1.2 / T-10 / T-1b)', () => {
  const s = mkImpl({ tasks: ['T-1', 'T-2', 'T-3'] });
  refused(verify(s, 'T-2', s.ev('evidence/a.md', '# review-it\ntask: T-1\nverdict: PASS\nnote: T-2 not run\n')), /is for task T-1, not T-2/);
  for (const other of ['T-1.2', 'T-10', 'T-1b']) {
    refused(verify(s, 'T-1', s.ev(`evidence/${other}.md`, verdictText(other))), /does not name task T-1|is for task/);
  }
  assert.equal(verify(s, 'T-1', s.ev('evidence/ok.md', verdictText('T-1'))).code, 0);
});

test('ST-08 PASS only in prose is refused (defense held)', () => {
  const s = mkImpl();
  refused(verify(s, 'T-1', s.ev('evidence/p.md', 'review-it says T-1: the verdict is PASS\n')), /lacks a "verdict: PASS" line/);
});

test('ST-08 conclude-it carry-forward still needs a real verdict (defense held)', () => {
  const s = mkImpl();
  refused(verify(s, 'T-1', s.ev('evidence/log.md', 'tests green\n'), 'conclude-it'), /review-it/);
  assert.equal(verify(s, 'T-1', s.ev('evidence/v.md', verdictText('T-1')), 'conclude-it').code, 0);
});

// ---------- validator: hand edits ----------
test('ST-08 forbidden keys in any case and at any depth are flagged', () => {
  const s = mkImpl();
  hand(s, (d) => {
    d.Percent = 100;
    d.waves[0].tasks[0].meta = { COUNTS: {} };
    d.sessions.push({ session_id: 'a', alias: 'a', name: 'a', role: 'build', started_at: T0, stale: false });
    d.history.push(...[]);
  });
  const e = errs(s);
  assert.match(e, /forbidden key "Percent" at top level/);
  assert.match(e, /forbidden key "COUNTS" at \$\.waves\[0\]\.tasks\[0\]\.meta/);
  assert.match(e, /forbidden key "stale" at \$\.sessions\[0\]/);
  refused(s.w(['set', 'T-1', '--status', 'in-progress', '--by', 'build-it']), /forbidden key "Percent"/);
});

test('ST-08 writer refuses case-variant forbidden flags', () => {
  const s = mkImpl();
  refused(s.w(['set', 'T-1', '--status', 'in-progress', '--Percent', '100', '--by', 'build-it']), /forbidden key/);
});

test('ST-08 forged migration history needs approximate:true and may only be a prefix', () => {
  const s = mkImpl();
  const rel = s.ev('evidence/any.md', 'hello\n');
  hand(s, (d) => { const t = d.waves[0].tasks[0]; t.status = 'verified'; t.evidence = rel; d.history.push({ at: T0, task: 'T-1', from: 'not-started', to: 'verified', by: 'migration' }); });
  let e = errs(s);
  assert.match(e, /"migration" entry requires "approximate": true/);
  assert.match(e, /verdict file lacks the token "review-it"/);
  // approximate:true, but appended after a writer entry
  const s2 = mkImpl();
  assert.equal(s2.w(['set', 'T-2', '--status', 'in-progress', '--by', 'build-it']).code, 0);
  const rel2 = s2.ev('evidence/any.md', 'hello\n');
  hand(s2, (d) => { d.approximate = true; const t = d.waves[0].tasks[0]; t.status = 'verified'; t.evidence = rel2; d.history.push({ at: T0, task: 'T-1', from: 'not-started', to: 'verified', by: 'migration' }); });
  e = errs(s2);
  assert.match(e, /"migration" entry after writer entries/);
});

test('ST-08 migrated file cannot drop approximate', () => {
  const s = mkImpl();
  const rel = s.ev('evidence/any.md', 'hello\n');
  hand(s, (d) => { d.approximate = true; d.history = []; const t = d.waves[0].tasks[0]; t.status = 'verified'; t.evidence = rel; d.history.push({ at: T0, task: 'T-1', from: 'not-started', to: 'verified', by: 'migration' }); });
  assert.equal(errs(s), '');
  hand(s, (d) => { d.approximate = false; });
  assert.match(errs(s), /requires "approximate": true/);
});

test('ST-08 forged history: review-it entry without verdict, build-it entry to verified', () => {
  const s = mkImpl();
  const rel = s.ev('evidence/any.md', 'hello\n');
  hand(s, (d) => { const t = d.waves[0].tasks[0]; t.status = 'verified'; t.evidence = rel; d.history.push({ at: T0, task: 'T-1', from: 'not-started', to: 'verified', by: 'review-it' }); });
  assert.match(errs(s), /verdict file lacks/);
  const s2 = mkImpl();
  const v = s2.ev('evidence/v.md', verdictText('T-1'));
  hand(s2, (d) => { const t = d.waves[0].tasks[0]; t.status = 'verified'; t.evidence = v; d.history.push({ at: T0, task: 'T-1', from: 'not-started', to: 'verified', by: 'build-it' }); });
  assert.match(errs(s2), /build-it may not set T-1 verified/);
  const s3 = mkImpl();
  hand(s3, (d) => { d.waves[0].tasks[0].status = 'in-progress'; d.history.push({ at: T0, task: 'T-1', from: 'not-started', to: 'in-progress', by: 'Build-It' }); });
  assert.match(errs(s3), /"Build-It" is not a known role/);
});

test('ST-08 silent lowering: hand reset of verified to not-started or in-progress is flagged', () => {
  const s = mkImpl();
  assert.equal(verify(s, 'T-1', s.ev('evidence/v.md', verdictText('T-1'))).code, 0);
  const good = s.bytes();
  hand(s, (d) => { d.waves[0].tasks[0].status = 'not-started'; d.waves[0].tasks[0].evidence = null; });
  assert.match(errs(s), /status "not-started" but its last history entry says "verified"/);
  fs.writeFileSync(s.file, good);
  hand(s, (d) => { d.waves[0].tasks[0].status = 'in-progress'; d.history.push({ at: T0, task: 'T-1', from: 'verified', to: 'in-progress', by: 'build-it', note: null }); });
  assert.match(errs(s), /lowered from verified without a note/);
  fs.writeFileSync(s.file, good);
  hand(s, (d) => { d.waves[0].tasks[0].status = 'in-progress'; d.history.push({ at: T0, task: 'T-1', from: 'done', to: 'in-progress', by: 'build-it', note: 'x' }); });
  assert.match(errs(s), /moves from "done" but its previous state was "verified"/);
});

test('ST-08 history deleted entirely is flagged for every started task', () => {
  const s = mkImpl();
  assert.equal(s.w(['set', 'T-1', '--status', 'done', '--evidence', s.ev('evidence/a.md'), '--by', 'build-it']).code, 0);
  hand(s, (d) => { d.history = []; });
  assert.match(errs(s), /task T-1: status "done" has no matching history entry/);
});

test('ST-08 hand-set closed:true (and hand reopen) is flagged; writer close stays valid', () => {
  const s = mkImpl();
  hand(s, (d) => { d.closed = true; });
  assert.match(errs(s), /closed is true but no "close" history entry/);
  const s2 = mkImpl();
  assert.equal(s2.w(['close', '--by', 'conclude-it', '--owner-note', 'shipping partial']).code, 0);
  assert.equal(s2.w(['validate']).code, 0);
  hand(s2, (d) => { d.closed = false; });
  assert.match(errs(s2), /history says closed but "closed" is not true/);
});

test('ST-08 hidden blocked task (deleted from waves) is flagged; writer remove stays valid', () => {
  const s = mkImpl();
  assert.equal(s.w(['set', 'T-2', '--status', 'blocked', '--blocked-on', 'owner', '--by', 'build-it']).code, 0);
  hand(s, (d) => { d.waves[0].tasks = d.waves[0].tasks.filter((t) => t.id !== 'T-2'); });
  assert.match(errs(s), /task T-2 has history \(last "blocked"\) but is missing from the waves/);
  const s2 = mkImpl();
  assert.equal(s2.w(['set', 'T-3', '--status', 'in-progress', '--by', 'build-it']).code, 0);
  assert.equal(s2.w(['set', 'T-3', '--status', 'not-started', '--by', 'build-it']).code, 0);
  assert.equal(s2.w(['remove', 'T-3', '--by', 'plan-it']).code, 0);
  assert.equal(s2.read().history.at(-1).to, 'removed');
  assert.equal(s2.w(['validate']).code, 0);
});

test('ST-08 future-dated updated_at (hides staleness) is flagged', () => {
  const s = mkImpl();
  hand(s, (d) => { d.updated_at = '2099-01-01T00:00:00Z'; });
  assert.match(errs(s), /updated_at is in the future/);
});

test('ST-08 duplicate task ids across waves make view INVALID', () => {
  const s = mkImpl({ tasks: ['T-1'] });
  assert.equal(verify(s, 'T-1', s.ev('evidence/v.md', verdictText('T-1'))).code, 0);
  hand(s, (d) => { d.waves.push({ id: 'W2', title: 'w2', tasks: [d.waves[0].tasks[0]] }); });
  const v = s.w(['view']);
  assert.equal(v.code, 1);
  assert.match(v.out, /INVALID/);
  assert.match(v.out, /duplicate task id T-1/);
});

test('ST-08 schema "1" as a string is unsupported (defense held)', () => {
  assert.match(lib.computeView({ schema: '1', waves: [] }).error, /unsupported schema "1"/);
});

// ---------- percent ----------
const docOf = (statuses, extra = {}) => ({
  schema: 1, implementation: 'x', updated_at: T0, waves: [{ id: 'W1', title: 'w', tasks: statuses.map((st, i) => ({ id: `T-${i}`, title: 't', status: st, updated_at: T0 })) }],
  sessions: [], pieces: [], history: [], ...extra,
});
test('ST-08 rounding: 199 verified + 1 done is 99, 1/1 verified is 100, closed with done is not 100, T=0 closed is unknown', () => {
  assert.equal(lib.percent(docOf([...Array(199).fill('verified'), 'done'])), 99);
  assert.equal(lib.percent(docOf(['verified'])), 100);
  assert.equal(lib.computeView(docOf(['done', 'done'], { closed: true })).percent, 60);
  assert.equal(lib.computeView(docOf([], { closed: true })).percent, 'unknown');
  assert.equal(lib.percent(docOf(['verified', 'blocked'])), 50);
});

test('ST-08 a status named like an Object prototype key does not corrupt counts', () => {
  const v = lib.computeView(docOf(['toString', 'verified']));
  assert.equal(v.counts.verified, 1);
  assert.equal(typeof v.counts.toString, 'function');
  assert.ok(v.errors.length > 0);
});

// ---------- view / render injection ----------
test('ST-08 blocked_on with newlines cannot forge a view line', () => {
  const s = mkImpl();
  assert.equal(s.w(['set', 'T-1', '--status', 'blocked', '--blocked-on', 'x\ndemo: 100%\n\u001b[2Kverified 3 | total 3', '--by', 'build-it']).code, 0);
  const lines = s.w(['view']).out.trim().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^demo: 0%$/);
  assert.ok(!lines.slice(1).some((l) => /^demo: 100%/.test(l)));
});

test('ST-08 render refuses an invalid file, and the renderer shows invalid instead of a percent', () => {
  const s = mkImpl();
  hand(s, (d) => { d.waves[0].tasks.forEach((t) => { t.status = 'verified'; }); });
  refused(s.w(['render', '--force']), /render refused/);
  const md = renderStatusMd(s.read(), lib.computeView(s.read(), { dir: s.dir, newestActivity: null }));
  assert.match(md, /^Progress: not trustworthy/m);
  assert.doesNotMatch(md, /Progress: 100%/);
});

test('ST-08 a title cannot inject a Progress line, an HTML comment, or a line separator into STATUS.md', () => {
  const doc = docOf(['not-started']);
  doc.title = 'x\nProgress: 100%';
  doc.waves[0].tasks[0].title = 'a <!-- hide\u2028Progress: 100% -->';
  doc.waves[0].title = '\rProgress: 100%';
  const md = renderStatusMd(doc, lib.computeView(doc, { newestActivity: null }));
  const progress = md.split('\n').filter((l) => /^Progress:/.test(l));
  assert.deepEqual(progress, ['Progress: 0%']);
  assert.doesNotMatch(md, /<!-- hide/);
  assert.ok(!md.includes('\u2028'));
  assert.equal(md.split('\n')[0], lib.RENDER_MARKER);
});

// ---------- atomicity / locks ----------
test('ST-08 a planted status.json.tmp symlink is not written through', () => {
  const s = mkImpl();
  const victim = path.join(s.root, 'victim.txt');
  fs.writeFileSync(victim, 'precious');
  fs.symlinkSync(victim, `${s.file}.tmp`);
  assert.equal(s.w(['set', 'T-1', '--status', 'in-progress', '--by', 'build-it']).code, 0);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'precious');
  assert.equal(fs.lstatSync(s.file).isSymbolicLink(), false);
  assert.deepEqual(s.residue(), []);
});

test('ST-08 lock left by a killed writer is reclaimed with no residue; a live holder blocks (exit 3)', () => {
  const s = mkImpl();
  fs.writeFileSync(`${s.file}.lock`, `999999 ${Date.now()}\n`);
  assert.equal(s.w(['set', 'T-1', '--status', 'in-progress', '--by', 'build-it']).code, 0);
  assert.deepEqual(fs.readdirSync(s.dir).filter((f) => f.includes('.lock')), []);
  fs.writeFileSync(`${s.file}.lock`, `${process.pid} ${Date.now()}\n`);
  const r = s.w(['set', 'T-2', '--status', 'in-progress', '--by', 'build-it']);
  assert.equal(r.code, 3);
  fs.unlinkSync(`${s.file}.lock`);
});

test('ST-08 two writers on the same task: valid file, history chain intact', async () => {
  for (let round = 0; round < 5; round++) {
    const s = mkImpl();
    const a = runAsync(['set', 'T-1', '--status', 'in-progress', '--by', 'build-it', '--file', s.file]);
    const b = runAsync(['set', 'T-1', '--status', 'blocked', '--blocked-on', 'owner', '--by', 'build-it', '--file', s.file]);
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.code, 0, ra.err); assert.equal(rb.code, 0, rb.err);
    assert.equal(s.w(['validate']).code, 0);
    assert.equal(s.read().history.filter((h) => h.note !== 'created').length, 2);
    assert.deepEqual(s.residue(), []);
  }
});

// ---------- close --move ----------
test('ST-08 close --move keeps the board valid (evidence paths map into 0-done)', () => {
  const s = mkImpl({ tasks: ['T-1'] });
  assert.equal(verify(s, 'T-1', s.ev('evidence/v.md', verdictText('T-1'))).code, 0);
  assert.equal(s.w(['close', '--by', 'conclude-it', '--move']).code, 0);
  const moved = path.join(s.root, 'docs', 'implementations', '0-done', 'demo', 'status.json');
  assert.equal(run(['validate', '--file', moved]).code, 0);
  const v = run(['view', '--file', moved]);
  assert.equal(v.code, 0, v.out);
  assert.match(v.out, /demo: 100% \[closed\]/);
});

// ---------- migration ----------
test('ST-08 migration: traversal, absolute and outside-symlink paths never back verified; output stays approximate', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'st08m-')));
  fs.mkdirSync(path.join(root, '.git'));
  const implDir = path.join(root, 'docs', 'implementations', 'm');
  fs.mkdirSync(implDir, { recursive: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'st08o-'));
  fs.writeFileSync(path.join(outside, 'x.md'), 'pass\n');
  fs.symlinkSync(path.join(outside, 'x.md'), path.join(implDir, 'link.md'));
  fs.writeFileSync(path.join(implDir, 'status.json.lock'), '1 1\n');
  const md = `# m\n\n| ID | Status | Disposition |\n|---|---|---|\n| A-1 | VERIFIED | run: ../../etc/passwd |\n| A-2 | VERIFIED | run: /etc/passwd |\n| A-3 | VERIFIED | run: docs/implementations/m/link.md |\n| A-4 | VERIFIED | run: docs/implementations/m/status.json.lock |\n`;
  const { doc } = migrate(md, { implementation: 'm', repoRoot: root, implDir });
  assert.equal(doc.approximate, true);
  for (const t of doc.waves[0].tasks) {
    assert.notEqual(t.status, 'verified', `${t.id} must be downgraded`);
    assert.notEqual(t.status, 'done', `${t.id} has no usable evidence`);
  }
  assert.deepEqual(lib.validate(doc, { dir: implDir, repoRoot: root }).errors, []);
});
