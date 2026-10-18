#!/usr/bin/env node
// real-verify.mjs - runs the 42 binding status cases (AT-01..AT-22, T-B-01..T-B-20) against REAL artifacts:
// a fresh git clone of the real do-it repo (its committed harness-status-tracking board, its real
// delivery/STATUS.md and delivery/epics), the real lens-data-honesty STATUS.md from ANM, the real plan-it
// scripts, the installed doit-status mod, real child processes (concurrent writers, SIGKILL mid-write) and a
// real review-it report. Nothing is written to the source repos: every mutation happens in the clone.
//
// Not part of `node --test tests/status/` (it needs the local repos). Run:
//   node tests/status/real/real-verify.mjs --doit <do-it checkout> --planit <plan-it scripts dir> \
//     --lens <lens STATUS.md> --out <dir> [--verdict <review-it checkpoint report>] \
//     [--verdict-plain <review-it report without checkpoint lines>] [--only CASE,CASE]
// Exit 0 when every case it ran passed, 1 otherwise. Authored by DevOtts (https://github.com/DevOtts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(HERE, '../../../plugins/build-it/scripts/status');
const WRITER = path.join(SCRIPTS, 'status-write.mjs');
const MIGRATE = path.join(SCRIPTS, 'status-migrate.mjs');
const lib = await import(pathToFileURL(path.join(SCRIPTS, 'status-lib.mjs')).href);

const A = {};
for (let i = 2; i < process.argv.length; i++) { const k = process.argv[i]; if (k.startsWith('--')) A[k.slice(2)] = process.argv[++i]; }
for (const k of ['doit', 'planit', 'lens', 'out']) if (!A[k]) { console.error(`--${k} is required`); process.exit(2); }
const OUT = path.resolve(A.out);
fs.mkdirSync(OUT, { recursive: true });
const ONLY = A.only ? new Set(A.only.split(',')) : null;
const MOD_LIB = A.mod || path.join(os.homedir(), '.claude/mods/doit-status/scripts/lib.mjs');
process.env.DOIT_STATUS_LIB = path.join(SCRIPTS, 'status-lib.mjs'); // the mod reads this lib (same code as main)
const mod = await import(pathToFileURL(MOD_LIB).href);
const { summaryLines } = await import(pathToFileURL(path.join(path.dirname(MOD_LIB), 'view.mjs')).href);
const PLAN_IT = path.join(A.planit, 'status-from-plan.mjs');

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sha12 = (p) => sha(p).slice(0, 12);
const node = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', ...opts });
const clean = (s) => String(s ?? '').replace(/\/(private\/)?var\/folders\/[^\s'"]+?\/rv-[A-Za-z0-9]+/g, '<clone-root>');
const env0 = () => { const e = { ...process.env }; delete e.STATUS_WRITE_TEST_CRASH; delete e.DOIT_STATUS_FILE; return e; };

// ---------- the clone of the real repo ----------
const WORK = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rv-')));
const CLONE = path.join(WORK, 'do-it');
execFileSync('git', ['clone', '-q', '--no-hardlinks', path.resolve(A.doit), CLONE]);
execFileSync('git', ['-C', CLONE, 'config', 'user.email', 'real-verify@localhost']);
execFileSync('git', ['-C', CLONE, 'config', 'user.name', 'real-verify']);
const HEAD = execFileSync('git', ['-C', CLONE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const BOARD_REL = 'docs/implementation/harness-status-tracking';
const BOARD_DIR = path.join(CLONE, BOARD_REL);
const BOARD = path.join(BOARD_DIR, 'status.json');
const SRC_BOARD = path.join(path.resolve(A.doit), BOARD_REL, 'status.json');
const SRC_BOARD_SHA = sha(SRC_BOARD);
const R2_REL = 'docs/implementation/do-it-v1';
const R2_DIR = path.join(CLONE, R2_REL);
const R2 = path.join(R2_DIR, 'status.json');
function reset() {
  execFileSync('git', ['-C', CLONE, 'reset', '-q', '--hard', HEAD]);
  execFileSync('git', ['-C', CLONE, 'clean', '-fdxq']);
}

// ---------- recording ----------
const rows = [];
let log = [];
const say = (s) => log.push(clean(s));
function w(args, { file = BOARD, env = {} } = {}) {
  const full = [...args, '--file', file];
  const r = node([WRITER, ...full], { env: { ...env0(), ...env } });
  say(`$ status-write ${full.map((x) => (/\s/.test(x) ? JSON.stringify(x) : x)).join(' ')}`);
  say(`  exit ${r.status}${r.stdout.trim() ? `\n  stdout: ${r.stdout.trim().split('\n').join('\n          ')}` : ''}${r.stderr.trim() ? `\n  stderr: ${r.stderr.trim().split('\n').join('\n          ')}` : ''}`);
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const read = (f = BOARD) => JSON.parse(fs.readFileSync(f, 'utf8'));
const task = (id, f = BOARD) => read(f).waves.flatMap((x) => x.tasks).find((t) => t.id === id);
const check = (cond, what) => { say(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`); return !!cond; };
const formula = (c, T) => (T === 0 ? 'unknown' : Math.min(Math.round(((c.verified + c.done * 0.6) / T) * 100), c.verified < T ? 99 : 100));

async function group(name, cases, artifact, fn) {
  if (ONLY && !cases.some((c) => ONLY.has(c))) return;
  reset();
  log = [];
  say(`# ${name}`);
  say(`cases: ${cases.join(', ')}`);
  say(`real artifact: ${artifact}`);
  say(`clone of ${path.resolve(A.doit)} at ${HEAD}; writer ${path.relative(path.resolve(HERE, '../../..'), WRITER)}`);
  say(`started ${new Date().toISOString()}`);
  say('');
  let results;
  try { results = await fn(); } catch (e) { say(`ERROR ${e.stack || e.message}`); results = Object.fromEntries(cases.map((c) => [c, false])); }
  const file = path.join(OUT, `${name}.txt`);
  say('');
  for (const c of cases) say(`${c}: ${results[c] ? 'PASS' : 'FAIL'}`);
  fs.writeFileSync(file, log.join('\n') + '\n');
  for (const c of cases) rows.push({ case: c, group: name, artifact, pass: !!results[c], output: path.basename(file) });
}

// ---------- G-planit: real plan-it on the real do-it epics ----------
function countChecklist(dir) {
  // Independent count: "- [ ]" or "- [x]" lines, per epic file, as a cross-check of plan-it's parser.
  let n = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) n += fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => /^\s*[-*]\s+\[[ xX]\]\s+/.test(l)).length;
  return n;
}
function runPlanIt() {
  const epics = path.join(CLONE, 'delivery/epics');
  const dry = node([PLAN_IT, '--package', R2_DIR, '--epics', epics, '--dry-run'], { env: { ...env0(), DOIT_STATUS_WRITE: WRITER } });
  let dryTasks = null;
  try { dryTasks = JSON.parse(dry.stdout).waves.flatMap((x) => x.tasks).length; } catch { /* not JSON */ }
  const r = node([PLAN_IT, '--package', R2_DIR, '--epics', epics], { env: { ...env0(), DOIT_STATUS_WRITE: WRITER } });
  say(`$ status-from-plan --package ${R2_REL} --epics delivery/epics   (plan-it main scripts, real do-it v1 epics)`);
  say(`  exit ${r.status}\n  stdout: ${r.stdout.trim().split('\n').slice(-6).join('\n          ')}\n  stderr: ${r.stderr.trim().split('\n').slice(-8).join('\n          ')}`);
  return { code: r.status, dryTasks, independent: countChecklist(epics) };
}

await group('G01-planit-real-epics', ['AT-01', 'T-B-16', 'AT-02'], 'do-it delivery/epics/*.md (5 real epics) -> docs/implementation/do-it-v1/status.json via plan-it status-from-plan', async () => {
  const p = runPlanIt();
  const ok0 = check(p.code === 0, 'plan-it exit 0');
  const doc = read(R2);
  const tasks = doc.waves.flatMap((x) => x.tasks);
  say(`  tasks=${tasks.length} dry-run tasks=${p.dryTasks} independent checklist-line count=${p.independent} waves=${doc.waves.map((x) => `${x.id}:${x.tasks.length}`).join(' ')}`);
  const renames = path.join(R2_DIR, 'id-renames.json');
  if (fs.existsSync(renames)) say(`  id-renames.json: ${fs.readFileSync(renames, 'utf8').trim().split('\n').length} lines (D-29 renames of duplicate ids in the real epics)`);
  let a = ok0;
  a = check(doc.schema === 1, 'schema 1') && a;
  a = check(tasks.length > 0 && tasks.length === p.dryTasks, `task count equals the dry-run plan (${tasks.length})`) && a;
  a = check(tasks.length === p.independent, `task count equals the independent checklist-line count (${p.independent})`) && a;
  a = check(tasks.every((t) => t.status === 'not-started'), 'every task not-started') && a;
  a = check(doc.sessions.length === 0 && doc.history.length === 0, 'sessions and history empty') && a;
  const v = w(['validate'], { file: R2 });
  a = check(v.code === 0, 'validate exit 0') && a;
  const md = path.join(R2_DIR, 'STATUS.md');
  const mdText = fs.existsSync(md) ? fs.readFileSync(md, 'utf8') : '';
  const b = check(mdText.startsWith(lib.RENDER_MARKER), 'STATUS.md rendered by the writer (marker on line 1)');
  const view = lib.loadView(R2);
  const m = /^Tasks: (\d+) · verified (\d+)(?: \(claims\))? · done (\d+) · in-progress (\d+) · blocked (\d+) · not-started (\d+)$/m.exec(mdText);
  say(`  STATUS.md line: ${m ? m[0] : '(missing)'}; Progress line: ${(/^Progress: .*$/m.exec(mdText) || ['(missing)'])[0]}`);
  say(`  view counts: ${JSON.stringify(view.counts)} total ${view.total} percent ${view.percent}`);
  const c = view.counts;
  const at02 = b && check(m && +m[1] === view.total && +m[2] === c.verified && +m[3] === c.done && +m[4] === c['in-progress'] && +m[5] === c.blocked && +m[6] === c['not-started'], 'STATUS.md counts equal the JSON counts');
  const rows2 = (mdText.match(/^\| [A-Z][A-Z0-9]*-\d+ \|/gm) || []).length;
  const at02b = check(rows2 === tasks.length, `STATUS.md has one task row per task (${rows2})`);
  return { 'AT-01': a, 'T-B-16': a && b, 'AT-02': at02 && at02b };
});

// ---------- G-evidence: done refusals and acceptance on the real plan-it board ----------
await group('G02-done-evidence-real-board', ['AT-03', 'T-B-04', 'AT-04', 'T-B-05', 'AT-05', 'T-B-06', 'AT-06', 'T-B-17'], 'docs/implementation/do-it-v1/status.json created by real plan-it from the real epics; evidence = a real tracked do-it run log', async () => {
  runPlanIt();
  const id = read(R2).waves[0].tasks[0].id;
  const md = path.join(R2_DIR, 'STATUS.md');
  const same = (b1, m1) => Buffer.compare(fs.readFileSync(R2), b1) === 0 && Buffer.compare(fs.readFileSync(md), m1) === 0;
  let b0 = fs.readFileSync(R2); let m0 = fs.readFileSync(md);
  say(`task under test: ${id} (first task of the real board)`);
  const r3 = w(['set', id, '--status', 'done', '--by', 'build-it'], { file: R2 });
  const at03 = check(r3.code !== 0, 'done with no evidence: exit non-zero') & check(same(b0, m0), 'status.json and STATUS.md byte-identical');
  const r4 = w(['set', id, '--status', 'done', '--evidence', `${R2_REL}/evidence/${id}.md`, '--by', 'build-it'], { file: R2 });
  const at04 = check(r4.code !== 0 && /does not exist/.test(r4.err), 'done with a path that does not exist: refused') & check(same(b0, m0), 'byte-identical');
  fs.mkdirSync(path.join(R2_DIR, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(R2_DIR, 'evidence', `${id}.md`), '');
  say(`  (created the empty file ${R2_REL}/evidence/${id}.md: no real empty evidence file exists in do-it)`);
  const r5 = w(['set', id, '--status', 'done', '--evidence', `${R2_REL}/evidence/${id}.md`, '--by', 'build-it'], { file: R2 });
  const at05 = check(r5.code !== 0 && /empty/.test(r5.err), 'done with an empty evidence file: refused') & check(same(b0, m0), 'byte-identical');
  const ev = '.taskstate/results/S1.log';
  const evAbs = path.join(CLONE, ev);
  const real = fs.existsSync(evAbs) && fs.statSync(evAbs).size > 0;
  say(`  evidence: ${ev} (tracked in do-it, ${real ? fs.statSync(evAbs).size : 0} bytes, sha ${real ? sha12(evAbs) : '-'})`);
  const si = w(['set', id, '--status', 'in-progress', '--owner', 'build-it:real-verify', '--by', 'build-it'], { file: R2 });
  check(si.code === 0, 'start boundary written (in-progress)');
  const before = task(id, R2).updated_at;
  const rowBefore = (fs.readFileSync(md, 'utf8').split('\n').find((l) => l.startsWith(`| ${id} |`)) || '');
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 1100));
  const r6 = w(['set', id, '--status', 'done', '--evidence', ev, '--by', 'build-it'], { file: R2 });
  const t1 = Date.now();
  const t = task(id, R2);
  const doc = read(R2);
  const h = doc.history.at(-1);
  const ua = Date.parse(t.updated_at);
  let at06 = check(real, 'evidence is a real non-empty tracked file');
  at06 = check(r6.code === 0, 'done with a valid file: accepted') && at06;
  at06 = check(t.status === 'done' && t.evidence === ev, 'task is done with that evidence') && at06;
  at06 = check(ua >= Math.floor(t0 / 1000) * 1000 && ua <= t1, `updated_at ${t.updated_at} set by the script clock during the call`) && at06;
  at06 = check(doc.updated_at === t.updated_at, 'top-level updated_at moved with it') && at06;
  at06 = check(h && h.task === id && h.from === 'in-progress' && h.to === 'done' && h.by === 'build-it', `history entry appended: ${JSON.stringify(h)}`) && at06;
  const rowAfter = (fs.readFileSync(md, 'utf8').split('\n').find((l) => l.startsWith(`| ${id} |`)) || '');
  say(`  STATUS.md row before: ${rowBefore}`);
  say(`  STATUS.md row after:  ${rowAfter}`);
  const tb17 = check(/\| done \|/.test(rowAfter) && rowAfter.includes(ev) && rowAfter.includes(t.updated_at), 'STATUS.md row shows done, the evidence and the new updated_at, with no hand edit') && check(t.updated_at !== before, `updated_at changed (${before} -> ${t.updated_at})`);
  return { 'AT-03': !!at03, 'T-B-04': !!at03, 'AT-04': !!at04, 'T-B-05': !!at04, 'AT-05': !!at05, 'T-B-06': !!at05, 'AT-06': at06, 'T-B-17': tb17 && at06 };
});

// ---------- G-roles: role, block, rename on the committed dogfood board ----------
await group('G03-roles-real-dogfood-board', ['AT-07', 'T-B-07', 'AT-11', 'AT-16'], `${BOARD_REL}/status.json as committed (8 tasks done by the real build-it run)`, async () => {
  const b0 = fs.readFileSync(BOARD);
  const r7 = w(['set', 'ST-01', '--status', 'verified', '--evidence', `${BOARD_REL}/evidence/ST-01.md`, '--by', 'build-it']);
  const at07 = check(r7.code !== 0 && /role build-it may not set status verified/.test(r7.err), 'build-it asking for verified: refused by the role check') & check(Buffer.compare(fs.readFileSync(BOARD), b0) === 0, 'byte-identical');
  const r11 = w(['set', 'ST-05', '--status', 'blocked', '--by', 'build-it']);
  let at11 = check(r11.code !== 0 && /blocked requires --blocked-on/.test(r11.err), 'blocked with no blocked_on: refused') & check(Buffer.compare(fs.readFileSync(BOARD), b0) === 0, 'byte-identical');
  const r11b = w(['set', 'ST-05', '--status', 'blocked', '--blocked-on', 'owner: Fernando wires conclude-it', '--by', 'build-it']);
  at11 = check(r11b.code === 0 && task('ST-05').blocked_on === 'owner: Fernando wires conclude-it', 'blocked with blocked_on: accepted') && at11;
  const b1 = fs.readFileSync(BOARD);
  const r16 = w(['rename', 'ST-01', '--title', 'Renamed', '--by', 'plan-it']);
  const r16b = w(['remove', 'ST-01', '--by', 'plan-it']);
  const at16 = check(r16.code !== 0 && /rename refused: task ST-01 is done/.test(r16.err), 'rename of a done task: refused') & check(r16b.code !== 0 && /remove refused/.test(r16b.err), 'remove of a done task: refused') & check(Buffer.compare(fs.readFileSync(BOARD), b1) === 0, 'byte-identical');
  return { 'AT-07': !!at07, 'T-B-07': !!at07, 'AT-11': !!at11, 'AT-16': !!at16 };
});

// ---------- G-verdict: a real review-it report through the writer ----------
await group('G04-review-it-verdict-real', ['AT-08', 'T-B-08', 'AT-09', 'T-B-09', 'AT-10', 'T-B-10'], `${BOARD_REL}/status.json + the real review-it report for ST-06 (${A.verdict ? path.basename(A.verdict) : 'none given'})`, async () => {
  if (!A.verdict || !fs.existsSync(A.verdict)) { say('no --verdict report given: AT-08 cannot be checked against a real review-it report'); return {}; }
  const dest = path.join(BOARD_DIR, 'evidence', 'review-it');
  fs.mkdirSync(dest, { recursive: true });
  const rel = `${BOARD_REL}/evidence/review-it/${path.basename(A.verdict)}`;
  fs.copyFileSync(A.verdict, path.join(CLONE, rel));
  say(`report: ${rel} sha ${sha12(A.verdict)} (${fs.statSync(A.verdict).size} bytes)`);
  if (A['verdict-plain'] && fs.existsSync(A['verdict-plain'])) {
    const relp = `${BOARD_REL}/evidence/review-it/${path.basename(A['verdict-plain'])}`;
    fs.copyFileSync(A['verdict-plain'], path.join(CLONE, relp));
    say('compatibility probe: the same review run as a plain (non-checkpoint) review-it report, which carries no "verdict:" line');
    const rp = w(['set', 'ST-06', '--status', 'verified', '--evidence', relp, '--by', 'review-it']);
    say(`  plain report accepted by the writer: ${rp.code === 0 ? 'yes' : 'no'} (finding, not a case: D-06 needs a "verdict: PASS" line, which review-it writes only in checkpoint reports)`);
    reset(); fs.mkdirSync(dest, { recursive: true }); fs.copyFileSync(A.verdict, path.join(CLONE, rel));
  }
  const r8 = w(['set', 'ST-06', '--status', 'verified', '--evidence', rel, '--by', 'review-it']);
  const t = task('ST-06');
  let at08 = check(r8.code === 0, 'review-it verified with the real verdict path: accepted');
  at08 = check(t.status === 'verified' && t.evidence === rel, 'ST-06 verified, evidence = the report') && at08;
  const vv = w(['view']);
  at08 = check(new RegExp(`claimed by review-it: ST-06 · verdict ${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · at \\S+ · sha ${sha12(A.verdict)}`).test(vv.out), 'view shows the claim with the verdict sha (D-28)') && at08;
  at08 = check(w(['validate']).code === 0, 'board still validates') && at08;
  const b0 = fs.readFileSync(BOARD);
  const r9 = w(['set', 'ST-06', '--status', 'in-progress', '--by', 'build-it']);
  const at09 = check(r9.code !== 0 && /lowering a verified task requires --note/.test(r9.err), 'lowering verified without a note: refused') & check(Buffer.compare(fs.readFileSync(BOARD), b0) === 0, 'byte-identical');
  const note = 'real-verify: lowered to prove AT-10 on a clone';
  const r10 = w(['set', 'ST-06', '--status', 'in-progress', '--note', note, '--by', 'build-it']);
  const h = read().history.at(-1);
  const at10 = check(r10.code === 0 && task('ST-06').status === 'in-progress', 'lowering with a note: accepted') & check(h.task === 'ST-06' && h.from === 'verified' && h.to === 'in-progress' && h.note === note, `history entry: ${JSON.stringify(h)}`) & check(w(['validate']).code === 0, 'board validates after the lowering');
  return { 'AT-08': at08, 'T-B-08': at08, 'AT-09': !!at09, 'T-B-09': !!at09, 'AT-10': !!at10, 'T-B-10': !!at10 };
});

// ---------- G-concurrency: real concurrent writer processes on the real board ----------
await group('G05-concurrent-processes-real-board', ['AT-13', 'T-B-14'], `${BOARD_REL}/status.json, 8 writer processes started together, 10 rounds`, async () => {
  const runAsync = (args) => new Promise((resolve) => {
    const c = spawn(process.execPath, [WRITER, ...args, '--file', BOARD], { env: env0() });
    let err = ''; c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => resolve({ code, err, pid: c.pid }));
  });
  let all = true;
  for (let round = 0; round < 10; round++) {
    reset();
    const h0 = read().history.length;
    const jobs = [
      ...['ST-01', 'ST-02', 'ST-03', 'ST-04'].map((id, i) => runAsync(['set', id, '--status', 'in-progress', '--owner', `proc-${round}-${i}`, '--by', 'build-it'])),
      ...['ST-05', 'ST-06', 'ST-07', 'ST-08'].map((id, i) => runAsync(['set', id, '--owner', `proc-${round}-${i + 4}`, '--by', 'build-it'])),
    ];
    const res = await Promise.all(jobs);
    const doc = read();
    const ids = ['ST-01', 'ST-02', 'ST-03', 'ST-04', 'ST-05', 'ST-06', 'ST-07', 'ST-08'];
    const present = ids.every((id, i) => task(id).owner === `proc-${round}-${i}`) && ids.slice(0, 4).every((id) => task(id).status === 'in-progress') && ids.slice(4).every((id) => task(id).status === 'done');
    const v = node([WRITER, 'validate', '--file', BOARD], { encoding: 'utf8', env: env0() });
    const residue = fs.readdirSync(BOARD_DIR).filter((f) => f.endsWith('.lock') || f.endsWith('.tmp'));
    const ok = res.every((r) => r.code === 0) && present && doc.history.length === h0 + 4 && v.status === 0 && residue.length === 0;
    say(`round ${round}: exits ${res.map((r) => r.code).join(',')} pids ${res.map((r) => r.pid).join(',')} all 8 changes present=${present} history +${doc.history.length - h0} validate=${v.status} residue=${JSON.stringify(residue)} -> ${ok ? 'ok' : 'FAIL'}`);
    for (const r of res) if (r.err.trim()) say(`  stderr: ${r.err.trim()}`);
    all = all && ok;
  }
  return { 'AT-13': all, 'T-B-14': all };
});

// ---------- G-kill: real SIGKILL between the tmp write and the rename ----------
await group('G06-sigkill-mid-write-real-board', ['AT-14', 'T-B-15'], `${BOARD_REL}/status.json and docs/implementation/do-it-v1/status.json (plan-it, real epics); writer child SIGKILLed the moment status.json.tmp appears; no test hook`, async () => {
  runPlanIt();
  const targets = [{ file: BOARD, id: 'ST-01' }, { file: R2, id: read(R2).waves[0].tasks[0].id }];
  const stats = { trials: 0, tmpLeft: 0, intactOld: 0, completedNew: 0, bad: 0, tmpComplete: 0, tmpPartial: 0, reclaimed: 0 };
  for (const tg of targets) {
    const dir = path.dirname(tg.file);
    const tmp = `${tg.file}.tmp`;
    for (let n = 0; n < 150; n++) {
      stats.trials++;
      const before = fs.readFileSync(tg.file);
      const owner = `kill-${n}`;
      const c = spawn(process.execPath, [WRITER, 'set', tg.id, '--owner', owner, '--by', 'build-it', '--file', tg.file], { env: env0(), stdio: ['ignore', 'ignore', 'pipe'] });
      let err = ''; c.stderr.on('data', (d) => { err += d; });
      const exited = new Promise((r) => c.on('exit', (code, sig) => r({ code, sig })));
      // Busy-poll for the tmp file; kill -9 the instant it exists. The child is never told; nothing in the
      // writer cooperates (STATUS_WRITE_TEST_CRASH is unset).
      // Odd trials: kill the instant the tmp file exists (mid-write). Even trials: wait until the tmp file has the
      // full size of the new document (write done, fsync/close/rename pending), then kill.
      const want = (() => { const d = JSON.parse(before); d.waves.flatMap((x) => x.tasks).find((x) => x.id === tg.id).owner = owner; return Buffer.byteLength(JSON.stringify(d, null, 2) + '\n'); })();
      const full = n % 2 === 0;
      const deadline = Date.now() + 3000; let seen = false;
      while (Date.now() < deadline) {
        let sz = -1; try { sz = fs.statSync(tmp).size; } catch { /* absent */ }
        if (sz >= 0 && (!full || sz >= want)) { process.kill(c.pid, 'SIGKILL'); seen = true; break; }
        if (c.exitCode !== null) break;
      }
      if (!seen) { try { process.kill(c.pid, 'SIGKILL'); } catch { /* gone */ } }
      const ex = await exited;
      if (/reclaiming stale\/dead-holder lock/.test(err)) stats.reclaimed++;
      const after = fs.readFileSync(tg.file);
      let parsed = null; try { parsed = JSON.parse(after); } catch { /* broken */ }
      const tmpLeft = fs.existsSync(tmp);
      const isOld = Buffer.compare(after, before) === 0;
      const t = parsed && parsed.waves.flatMap((x) => x.tasks).find((x) => x.id === tg.id);
      const isNew = parsed && t && t.owner === owner;
      if (tmpLeft) {
        stats.tmpLeft++;
        let tj = null; try { tj = JSON.parse(fs.readFileSync(tmp, 'utf8')); } catch { /* partial */ }
        if (tj) stats.tmpComplete++; else stats.tmpPartial++;
        if (isOld) stats.intactOld++; else stats.bad++;
        if (stats.tmpLeft <= 3 || (tj && stats.tmpComplete <= 3) || !isOld) say(`trial ${stats.trials} ${path.relative(CLONE, tg.file)}: killed (signal ${ex.sig}) with status.json.tmp on disk (${tj ? 'complete JSON, the new state, not renamed' : 'partial write'}); status.json ${isOld ? 'byte-identical to before' : 'CHANGED'}; valid JSON ${!!parsed}`);
        fs.unlinkSync(tmp);
      } else if (isNew) stats.completedNew++;
      else if (isOld) stats.intactOld++;
      else stats.bad++;
      if (!parsed) stats.bad++;
      // a lock left by the killed holder is reclaimed by the next writer (dead pid); remove leftovers between trials
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.lock')) fs.unlinkSync(path.join(dir, f));
    }
    const v = node([WRITER, 'validate', '--file', tg.file], { encoding: 'utf8', env: env0() });
    say(`${path.relative(CLONE, tg.file)} after all trials: validate exit ${v.status} ${v.stdout.trim()}${v.stderr.trim()}`);
    if (v.status !== 0) stats.bad++;
  }
  say(`summary: ${JSON.stringify(stats)}`);
  const ok = check(stats.tmpComplete >= 1, `at least one kill landed after the tmp write finished and before the rename (${stats.tmpComplete} of ${stats.trials}; ${stats.tmpPartial} more mid-write)`) && check(stats.bad === 0, 'every trial left status.json either byte-identical to before or fully renamed to the new state, always valid JSON');
  return { 'AT-14': ok, 'T-B-15': ok };
});

// ---------- G-unknown-key: a real non-schema key survives a writer rewrite ----------
await group('G07-unknown-key-real-producer', ['AT-15'], `${BOARD_REL}/status.json + review_checkpoints block computed by plan-it review-checkpoints.mjs from the real board`, async () => {
  const rc = path.join(A.planit, 'review-checkpoints.mjs');
  const inputs = path.join(WORK, 'rc-inputs.json');
  fs.writeFileSync(inputs, JSON.stringify({ epics: 1, flags: { cross_cutting: 'the writer is called by every lifecycle plugin' }, evidence_dir: `${BOARD_REL}/evidence` }));
  const r = node([rc, 'decide', '--inputs', inputs, '--status', BOARD, '--write', BOARD]);
  say(`$ review-checkpoints.mjs decide --inputs rc-inputs.json --status ${BOARD_REL}/status.json --write ${BOARD_REL}/status.json`);
  say(`  exit ${r.status} stderr: ${r.stderr.trim()}`);
  say('  (the documented --write target is READINESS.json; pointing it at status.json is how a real tool, not a hand edit, puts a key the writer does not know into the file)');
  const block = read().review_checkpoints;
  const before = JSON.stringify(block ?? null);
  const v0 = w(['validate']);
  const rr = w(['set', 'ST-03', '--owner', 'build-it:real-verify', '--by', 'build-it']);
  const after = JSON.stringify(read().review_checkpoints ?? null);
  const ok = check(r.status === 0 && block && typeof block === 'object', 'real block written by a real tool') & check(v0.code === 0, 'validator accepts the unknown key') & check(rr.code === 0, 'writer rewrite ok') & check(block && after === before, `review_checkpoints identical after the rewrite (${before.length} chars)`);
  return { 'AT-15': !!ok };
});

// ---------- G-validator-and-mod: real board copies with a model's hand edit ----------
await group('G08-validator-mod-real-board', ['AT-12', 'T-B-11', 'T-B-12', 'T-B-13'], `${BOARD_REL}/status.json hand-edited in the clone the way a model would; read by the installed doit-status mod (${MOD_LIB.replace(os.homedir(), '~')})`, async () => {
  runPlanIt();
  const implRoot = path.join(CLONE, 'docs/implementation');
  const orig = read();
  const doc = { ...orig, percent: 100 };
  fs.writeFileSync(BOARD, JSON.stringify(doc, null, 2) + '\n');
  say('edit: added "percent": 100 at top level of the real board');
  const v = w(['validate']);
  const at12 = check(v.code !== 0 && /forbidden key "percent"/.test(v.err), 'validator error naming the key "percent"');
  const ms = mod.readStatus(implRoot, 'harness-status-tracking');
  say(`  mod.readStatus: percent=${JSON.stringify(ms.percent)} notes=${JSON.stringify(ms.notes)} errors=${JSON.stringify(ms.errors ?? null)}`);
  const s = w(['set', 'ST-01', '--owner', 'x', '--by', 'build-it']);
  const s2 = w(['set', 'ST-01', '--percent', '100', '--by', 'build-it']);
  say(`  mod summary lines: ${JSON.stringify(summaryLines(ms))}`);
  const tb11 = at12 && check(ms.percent !== 100 && ms.invalid === true, `mod does not show the typed 100 (percent ${JSON.stringify(ms.percent)}, invalid ${ms.invalid})`) & check(s.code !== 0, 'writer refuses to write on top of the edited file') & check(s2.code !== 0 && /forbidden key/.test(s2.err), 'writer refuses a --percent flag');
  fs.writeFileSync(BOARD, JSON.stringify({ ...orig, schema: 2 }, null, 2) + '\n');
  say('edit: schema 1 -> 2 on the real board');
  let m2; let threw = null; try { m2 = mod.readStatus(implRoot, 'harness-status-tracking'); } catch (e) { threw = e.message; }
  const lv2 = lib.loadView(BOARD);
  say(`  mod.readStatus: ${threw ? `THREW ${threw}` : `percent=${JSON.stringify(m2.percent)} error=${JSON.stringify(m2.error)} unsupportedSchema=${m2.unsupportedSchema}`}; lib.loadView error=${JSON.stringify(lv2.error)}`);
  const tb12 = check(!threw && m2.percent == null && m2.unsupportedSchema === true && /unsupported schema/.test(m2.error), 'mod shows "unsupported schema", no crash') & check(lv2.error === 'unsupported schema 2', 'lib error unsupported schema 2');
  const txt = JSON.stringify(orig, null, 2);
  fs.writeFileSync(BOARD, txt.slice(0, Math.floor(txt.length / 2)));
  say(`edit: real board truncated to ${Math.floor(txt.length / 2)} of ${txt.length} bytes (a write cut in half)`);
  const names = mod.discover(implRoot).names;
  const all = {}; let threw3 = null;
  try { for (const n of names) all[n] = mod.readStatus(implRoot, n); } catch (e) { threw3 = e.message; }
  for (const n of names) say(`  ${n}: source=${all[n]?.source} percent=${JSON.stringify(all[n]?.percent)} total=${all[n]?.total} error=${JSON.stringify(all[n]?.error ?? null)} notes=${JSON.stringify(all[n]?.notes)}`);
  const broken = all['harness-status-tracking'];
  const sib = all['do-it-v1'];
  const tb13 = check(!threw3, 'mod lists every implementation without throwing') & check(broken && broken.jsonError === true && /not valid JSON/.test(broken.error) && broken.percent == null, 'the broken one carries a clear error and no percent') & check(sib && sib.source !== 'unknown' && sib.percent === 0 && sib.total > 0, `the real sibling do-it-v1 still lists (${sib?.total} tasks, ${JSON.stringify(sib?.percent)})`);
  return { 'AT-12': at12, 'T-B-11': !!tb11, 'T-B-12': !!tb12, 'T-B-13': !!tb13 };
});

// ---------- G-percent: the formula on real boards ----------
await group('G09-percent-real-boards', ['AT-17', 'AT-18', 'T-B-02', 'AT-19', 'T-B-01', 'T-B-03'], 'committed dogfood board; real do-it delivery/STATUS.md migrated; real lens-data-honesty STATUS.md migrated; real plan-it board emptied by plan-it remove; real board in a 4-status mix via the writer + real review-it verdict', async () => {
  const show = (label, file) => {
    const v = lib.loadView(file);
    const ms = mod.readStatus(path.dirname(path.dirname(file)), path.basename(path.dirname(file)));
    const f = formula(v.counts, v.total);
    say(`  ${label}: counts ${JSON.stringify(v.counts)} total ${v.total} -> lib ${JSON.stringify(v.percent)} mod ${JSON.stringify(ms.percent)} formula ${JSON.stringify(f)} blocked_list ${JSON.stringify(v.blocked_list.map((b) => b.id))} errors ${v.errors.length}`);
    return { v, ms, f };
  };
  const res = {};
  const d = show('dogfood board as committed', BOARD);
  res['AT-19'] = check(d.v.counts.done === 8 && d.v.percent === 60 && d.ms.percent === 60 && d.v.percent !== 100, 'every task done, none verified: 60, never 100 (spec AT-19 is T=1; the real board is T=8, same rule)');
  // migrate the real do-it delivery STATUS.md inside the clone (evidence resolves against the real tracked .taskstate)
  const mOut = path.join(CLONE, 'delivery', 'status.json');
  const mr = node([MIGRATE, '--from', path.join(CLONE, 'delivery/STATUS.md'), '--out', mOut, '--impl', 'delivery']);
  say(`$ status-migrate --from delivery/STATUS.md --out delivery/status.json --impl delivery -> exit ${mr.status}`);
  const dm = show('do-it delivery (migrated, 20 epics)', mOut);
  const lensRoot = path.join(WORK, 'lens'); fs.mkdirSync(path.join(lensRoot, '.git'), { recursive: true });
  const lensDir = path.join(lensRoot, 'docs/implementations/lens-data-honesty'); fs.mkdirSync(lensDir, { recursive: true });
  const lr = node([MIGRATE, '--from', path.resolve(A.lens), '--out', path.join(lensDir, 'status.json'), '--impl', 'lens-data-honesty']);
  say(`$ status-migrate --from <ANM>/docs/implementations/lens-data-honesty/delivery/STATUS.md (read only) -> exit ${lr.status}`);
  const lm = show('lens-data-honesty (migrated, 21 tasks)', path.join(lensDir, 'status.json'));
  res['T-B-03'] = check(lm.v.counts.blocked === 4 && lm.v.blocked_list.length === 4 && lm.v.percent === 0 && lm.f === 0, 'real owner-gated rows: 4 in the blocked list, contribute 0, shown separately');
  // T-B-01 mix on the real board: 1 verified (real review-it verdict), done, in-progress, not-started
  let mixOk = false;
  if (A.verdict && fs.existsSync(A.verdict)) {
    const rel = `${BOARD_REL}/evidence/review-it/${path.basename(A.verdict)}`;
    fs.mkdirSync(path.join(BOARD_DIR, 'evidence', 'review-it'), { recursive: true });
    fs.copyFileSync(A.verdict, path.join(CLONE, rel));
    const a1 = w(['set', 'ST-06', '--status', 'verified', '--evidence', rel, '--by', 'review-it']);
    const a2 = w(['set', 'ST-01', '--status', 'in-progress', '--by', 'build-it']);
    const a3 = w(['set', 'ST-02', '--status', 'not-started', '--by', 'build-it']);
    const mx = show('dogfood board in a 4-status mix', BOARD);
    mixOk = a1.code === 0 && a2.code === 0 && a3.code === 0 && mx.v.counts.verified === 1 && mx.v.counts['in-progress'] === 1 && mx.v.counts['not-started'] === 1 && mx.v.counts.done === 5;
    const vt = w(['view']);
    mixOk = check(mixOk && mx.v.percent === mx.f && mx.ms.percent === mx.f && vt.out.includes(`${mx.f}%`), `verified+done+in-progress+not-started: lib, mod and writer view all equal the formula (${mx.f})`);
  } else say('  no --verdict: the 4-status mix needs a real review-it verdict');
  res['T-B-01'] = mixOk && check(d.v.percent === d.f && dm.v.percent === dm.f && lm.v.percent === lm.f, 'formula matches to the digit on the three other real boards too');
  // AT-17: the spec's worked example. No real board has that shape; it is run through the real lib and mod
  // as the literal input, next to the real boards above.
  const ex = { schema: 1, implementation: 'worked-example', updated_at: lib.nowIso(), waves: [{ id: 'W1', title: 'w', tasks: ['verified', 'verified', 'verified', 'verified', 'verified', 'done', 'done', 'blocked', 'in-progress', 'not-started'].map((s, i) => ({ id: `T-${i + 1}`, title: `T-${i + 1}`, status: s })) }], sessions: [], pieces: [], history: [] };
  const exP = lib.percent(ex);
  say(`  spec worked example (literal input): lib.percent=${exP}`);
  res['AT-17'] = check(exP === 62, 'worked example is exactly 62') && check(dm.v.percent === dm.f && d.v.percent === d.f, 'and the same function gives the formula on the real boards');
  // AT-18 / T-B-02: real plan-it board, every task removed by plan-it's own remove command
  runPlanIt();
  const ids = read(R2).waves.flatMap((x) => x.tasks).map((t) => t.id);
  let rmOk = true;
  for (const id of ids) { const r = node([WRITER, 'remove', id, '--by', 'plan-it', '--file', R2], { encoding: 'utf8', env: env0() }); if (r.status !== 0) { rmOk = false; say(`  remove ${id} exit ${r.status} ${r.stderr}`); } }
  say(`$ status-write remove <each of ${ids.length} tasks> --by plan-it --file ${R2_REL}/status.json -> all ok: ${rmOk}`);
  const z = show('real plan-it board after removing every task', R2);
  const vz = w(['view'], { file: R2 });
  const zOk = check(rmOk && z.v.total === 0 && z.v.percent === 'unknown' && z.ms.percent == null && JSON.stringify(z.ms.notes).match(/unknown|no tasks/i) && /: unknown/.test(vz.out), 'zero tasks: lib "unknown", mod no number, writer view "unknown" (never 0, never 100)');
  res['AT-18'] = zOk; res['T-B-02'] = zOk;
  return res;
});

// ---------- G-migration: real STATUS.md boards ----------
await group('G10-migration-real-boards', ['AT-20', 'T-B-19', 'AT-21'], 'do-it delivery/STATUS.md (real, in the clone with its tracked .taskstate) and ANM lens-data-honesty delivery/STATUS.md (real, read only)', async () => {
  const src = path.join(CLONE, 'delivery/STATUS.md');
  const out = path.join(CLONE, 'delivery', 'status.json');
  const verifiedRows = (fs.readFileSync(src, 'utf8').match(/^\|[^\n]*\|\s*VERIFIED\s*\|/gm) || []).length;
  const r1 = node([MIGRATE, '--from', src, '--out', out, '--impl', 'delivery']);
  say(`$ status-migrate --from delivery/STATUS.md --out delivery/status.json --impl delivery\n  exit ${r1.status}\n  ${r1.stdout.trim().split('\n').join('\n  ')}\n  ${r1.stderr.trim()}`);
  const b = fs.readFileSync(out);
  const r2 = node([MIGRATE, '--from', src, '--out', out, '--impl', 'delivery']);
  say(`$ (again) -> exit ${r2.status} ${r2.stderr.trim()}`);
  const doc = JSON.parse(b);
  const tasks = doc.waves.flatMap((x) => x.tasks);
  const downs = doc.history.filter((h) => h.by === 'migration');
  const v = w(['validate'], { file: out });
  say(`  tasks ${tasks.length}; VERIFIED rows in the source ${verifiedRows}; statuses ${JSON.stringify(lib.computeView(doc).counts)}; migration history entries ${downs.length}`);
  for (const t of tasks.filter((x) => x.status !== 'verified')) say(`  ${t.id} -> ${t.status} evidence=${t.evidence}`);
  const at20 = check(r1.status === 0 && tasks.length === 20, '20 tasks') & check(doc.approximate === true, 'approximate: true') & check(/downgrad/i.test(r1.stdout + r1.stderr), 'downgrades reported') & check(r2.status === 2 && Buffer.compare(fs.readFileSync(out), b) === 0, 'second run refuses, file byte-identical') & check(v.code === 0, 'migrated file validates');
  const unev = tasks.filter((t) => doc.history.some((h) => h.task === t.id && h.by === 'migration' && h.from === 'verified'));
  const pre16 = check(/pre-downgrade counts: verified=16\b/.test(r1.stdout), 'CARD-B AC 8: 16 verified before the evidence downgrade');
  say(`  unevidenced VERIFIED rows in the real board: ${unev.length} (${unev.map((t) => t.id).join(', ') || 'none: every VERIFIED row cites a tracked file that exists'})`);
  const downDone = doc.history.filter((h) => h.by === 'migration' && h.from === 'done' && h.to === 'in-progress').map((h) => h.task);
  say(`  unevidenced rows downgraded by the real run: ${downDone.join(', ') || 'none'} (done -> in-progress)`);
  const tb19 = at20 && pre16 && check(unev.every((t) => t.status !== 'verified'), 'no unevidenced row stays verified') && check(tasks.filter((t) => t.status === 'verified').every((t) => t.evidence && lib.checkEvidence(CLONE, path.dirname(out), t.evidence).ok), 'every row still verified has a real resolvable evidence file in the repo') && check(downDone.length > 0, 'the real unevidenced row was downgraded');
  const lensRoot = path.join(WORK, 'lens2'); fs.mkdirSync(path.join(lensRoot, '.git'), { recursive: true });
  const lensDir = path.join(lensRoot, 'docs/implementations/lens-data-honesty'); fs.mkdirSync(lensDir, { recursive: true });
  const lsha = sha(path.resolve(A.lens));
  const lr = node([MIGRATE, '--from', path.resolve(A.lens), '--out', path.join(lensDir, 'status.json'), '--impl', 'lens-data-honesty']);
  say(`$ status-migrate --from ANM lens-data-honesty/delivery/STATUS.md -> exit ${lr.status}\n  ${lr.stdout.trim().split('\n').join('\n  ')}`);
  const ld = JSON.parse(fs.readFileSync(path.join(lensDir, 'status.json'), 'utf8'));
  const lt = ld.waves.flatMap((x) => x.tasks);
  const gated = (fs.readFileSync(path.resolve(A.lens), 'utf8').match(/^\|[^\n]*owner-gated[^\n]*$/gim) || []).map((l) => (/\|\s*(LDH-\d+)/.exec(l) || [])[1]).filter(Boolean);
  const blocked = lt.filter((t) => t.status === 'blocked');
  for (const t of blocked) say(`  ${t.id} blocked_on: ${t.blocked_on}`);
  say(`  rows with "owner-gated" in the source: ${gated.join(', ')}`);
  const at21 = check(lr.status === 0 && lt.length === 21, '21 tasks') & check(blocked.length > 0 && gated.every((id) => blocked.some((t) => t.id === id)), 'every owner-gated row is blocked') & check(sha(path.resolve(A.lens)) === lsha, 'ANM source untouched (sha unchanged)');
  return { 'AT-20': !!at20, 'T-B-19': !!tb19, 'AT-21': !!at21 };
});

// ---------- G-conclude: the close guard on the real board ----------
await group('G11-conclude-guard-real-board', ['T-B-18'], `${BOARD_REL}/status.json as committed (8 done, 0 verified)`, async () => {
  const b0 = fs.readFileSync(BOARD);
  const r = w(['close', '--move', '--by', 'conclude-it']);
  const refused = check(r.code !== 0 && /close refused: 8 task\(s\) not verified/.test(r.err), 'close --move refused: 8 tasks not verified') & check(Buffer.compare(fs.readFileSync(BOARD), b0) === 0 && !fs.existsSync(path.join(CLONE, 'docs/implementation/0-done')), 'file byte-identical, folder not moved');
  const r2 = w(['close', '--move', '--owner-note', 'real-verify: override on a clone only', '--by', 'conclude-it']);
  const moved = path.join(CLONE, 'docs/implementation/0-done/harness-status-tracking/status.json');
  const ok2 = check(r2.code === 0 && fs.existsSync(moved), 'with an owner note: closed and moved to 0-done') && check(node([WRITER, 'validate', '--file', moved], { env: env0() }).status === 0, 'moved board validates (evidence paths remapped)');
  return { 'T-B-18': !!(refused && ok2) };
});

// ---------- G-stale: real git state of the real board ----------
await group('G12-stale-real-git', ['T-B-20'], `${BOARD_REL} in the real do-it history (git log -1 of the folder) vs the board's updated_at`, async () => {
  const na = lib.newestActivity(BOARD_DIR, read());
  const commit = execFileSync('git', ['-C', BOARD_DIR, 'log', '-1', '--format=%h %cI %s', '--', '.'], { encoding: 'utf8' }).trim();
  const u = read().updated_at;
  const stale = lib.computeView(read(), { dir: BOARD_DIR }).stale;
  say(`  newest commit touching the board folder: ${commit}`);
  say(`  board updated_at ${u}; newest activity ${new Date(na).toISOString()}; gap ${((na - Date.parse(u)) / 3600000).toFixed(2)} h; threshold ${lib.STALE_THRESHOLD_MS / 3600000} h -> stale=${stale}`);
  const fresh = check(stale === false && na - Date.parse(u) <= lib.STALE_THRESHOLD_MS, 'fresh half: the real board is not flagged');
  const ms = mod.readStatus(path.join(CLONE, 'docs/implementation'), 'harness-status-tracking');
  say(`  mod.readStatus stale=${JSON.stringify(ms.stale)}`);
  const staleSeen = na - Date.parse(u) > lib.STALE_THRESHOLD_MS;
  say(staleSeen ? '  stale half: the real gap is over the threshold' : `  stale half: not observable on real data yet. It needs a real commit to the board folder later than ${new Date(Date.parse(u) + lib.STALE_THRESHOLD_MS).toISOString()} with no writer call (for example merging the do-it real-verify PR after that time), then re-run with --only T-B-20.`);
  return { 'T-B-20': fresh && staleSeen && stale === true ? true : false, 'T-B-20-fresh-half': fresh };
});

// ---------- G-boundaries: the real build-it run's own board history ----------
await group('G13-boundaries-real-run-history', ['AT-22'], `${BOARD_REL}/status.json history written by the real build-it run on 2026-10-18`, async () => {
  const doc = read();
  const byTask = new Map();
  for (const h of doc.history) { if (!byTask.has(h.task)) byTask.set(h.task, []); byTask.get(h.task).push(h); }
  const writes = [...new Set(doc.history.map((h) => h.at))];
  say(`  distinct write times in history: ${writes.join(', ')}; final updated_at ${doc.updated_at}`);
  let after = true;
  for (const [id, hs] of byTask) {
    const st = hs.find((h) => h.to === 'in-progress'); const dn = hs.find((h) => h.to === 'done');
    const boot = st && /bootstrap/.test(st.note || '');
    const separate = st && dn && st.at !== dn.at;
    say(`  ${id}: start ${st?.at}${boot ? ' (bootstrap note: started before the board existed)' : ''}, done ${dn?.at} -> ${separate ? 'start and finish written at separate boundaries' : boot ? 'written together at board creation' : 'NOT separate'}`);
    if (!boot && !separate) after = false;
  }
  const v = w(['validate']);
  const ok = check(writes.length >= 3, `history has ${writes.length} distinct write times, not one write at the end`) & check(after, 'every task started after the board existed has its start and finish at separate times') & check(v.code === 0, 'history chain validates');
  say('  caveat: W1 (ST-01, ST-02, ST-06, ST-07) ran before the writer existed and was recorded in one batch at board creation (D-16); per-task boundaries hold for W2 and W3 (4 tasks), where W2\'s three parallel tasks share wave-level timestamps.');
  return { 'AT-22': !!ok };
});

// ---------- summary ----------
const srcAfter = sha(SRC_BOARD);
const summary = { at: new Date().toISOString(), clone_head: HEAD, source_board_sha256_before: SRC_BOARD_SHA, source_board_sha256_after: srcAfter, source_board_untouched: srcAfter === SRC_BOARD_SHA, rows };
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
const lines = [`# real-verify summary (${summary.at})`, `clone of do-it at ${HEAD}; committed board sha256 before ${SRC_BOARD_SHA.slice(0, 12)} after ${srcAfter.slice(0, 12)} (untouched: ${summary.source_board_untouched})`, '', '| Case | Result | Output | Real artifact |', '| --- | --- | --- | --- |'];
for (const r of rows) lines.push(`| ${r.case} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.output} | ${r.artifact} |`);
fs.writeFileSync(path.join(OUT, 'summary.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
fs.rmSync(WORK, { recursive: true, force: true });
process.exitCode = rows.filter((r) => !r.case.endsWith('-half')).every((r) => r.pass) && summary.source_board_untouched ? 0 : 1;
