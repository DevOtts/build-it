// ST-03: build-it writes status.json at every task boundary (AT-22, T-B-17).
// The boundary commands are parsed from the Status board section of the build-it
// SKILL.md files, so these tests fail if the documented commands drift or break.
// Authored by DevOtts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WRITE, mkImpl, cliEnv } from './_helpers.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLUGIN_SKILL = path.join(REPO, 'plugins/build-it/skills/build-it/SKILL.md');
const ROOT_SKILL = path.join(REPO, 'SKILL.md');
const BOUNDARIES = ['start', 'block', 'unblock', 'finish', 'piece', 'report'];

function section(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^## Status board \(status\.json\)\n([\s\S]*?)(?=^## |^---$)/m);
  assert.ok(m, `${path.basename(file)}: no "## Status board (status.json)" section`);
  return m[1];
}

// Returns { start: 'node "$W" set ...', ... } from the section's fenced block.
export function documentedCommands(file) {
  const sec = section(file);
  const block = sec.match(/```\n([\s\S]*?)```/);
  assert.ok(block, `${path.basename(file)}: Status board section has no command block`);
  const cmds = {};
  for (const line of block[1].split('\n')) {
    const m = line.match(/^(\w+)\s+(node .+)$/);
    if (m) cmds[m[1]] = m[2].trim();
  }
  for (const b of BOUNDARIES) assert.ok(cmds[b], `${path.basename(file)}: boundary "${b}" not documented`);
  return cmds;
}

// Minimal shell-word split with double quotes (all the documented commands need).
function words(s) {
  const out = []; const re = /"([^"]*)"|(\S+)/g; let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2]);
  return out;
}

function exec(cmd, vars, cwd) {
  let s = cmd;
  for (const [k, v] of Object.entries(vars)) s = s.split(k).join(v);
  assert.ok(!/<[^>]+>/.test(s), `unsubstituted placeholder left in: ${s}`);
  const argv = words(s);
  assert.equal(argv[0], 'node');
  const r = spawnSync(process.execPath, argv.slice(1), { cwd, encoding: 'utf8', env: cliEnv() });
  return { code: r.status, out: r.stdout, err: r.stderr, argv };
}

function varsFor(fx, id, extra = {}) {
  return { '"$W"': `"${WRITE}"`, '"$F"': `"${fx.file}"`, '<ID>': id, '<tier>': 'sonnet', ...extra };
}

const validate = (fx) => spawnSync(process.execPath, [WRITE, 'validate', '--file', fx.file], { encoding: 'utf8', env: cliEnv() });
const historyFor = (doc, id) => doc.history.filter((h) => h.task === id).length;

test('Status board section is present and identical in both SKILL.md files', () => {
  assert.deepEqual(documentedCommands(ROOT_SKILL), documentedCommands(PLUGIN_SKILL));
  for (const f of [ROOT_SKILL, PLUGIN_SKILL]) {
    const line = fs.readFileSync(f, 'utf8').split('\n').find((l) => l.includes('**Status-boundary gate**'));
    assert.ok(line && /trigger:/.test(line) && /test:/.test(line) && /action:/.test(line), `${path.basename(f)}: gate needs trigger/test/action`);
  }
  assert.match(fs.readFileSync(PLUGIN_SKILL, 'utf8'), /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/status\/status-write\.mjs/);
  assert.match(fs.readFileSync(ROOT_SKILL, 'utf8'), /plugins\/build-it\/scripts\/status\/status-write\.mjs/);
  assert.ok(fs.existsSync(path.join(REPO, 'plugins/build-it/scripts/status/status-write.mjs')));
});

test('AT-22 build-it run on a 3-task fixture', () => {
  const cmds = documentedCommands(PLUGIN_SKILL);
  const fx = mkImpl({ tasks: ['T-1', 'T-2', 'T-3'] });
  assert.equal(validate(fx).status, 0);
  let prev = fx.bytes();
  let prevAt = fx.read().updated_at;

  const boundary = (name, id, extra = {}, { taskWrite = true } = {}) => {
    const before = fx.read();
    const r = exec(cmds[name], varsFor(fx, id, extra), fx.root);
    assert.equal(r.code, 0, `${name} ${id} exit ${r.code}: ${r.err}`);
    const now = fx.bytes();
    assert.ok(!now.equals(prev), `${name} ${id}: status.json bytes did not change`);
    const doc = fx.read();
    assert.ok(doc.updated_at >= prevAt, `${name} ${id}: updated_at went backwards`);
    const gained = historyFor(doc, id) - historyFor(before, id);
    assert.equal(gained, taskWrite ? 1 : 0, `${name} ${id}: history gained ${gained} entries`);
    assert.equal(doc.history.length - before.history.length, taskWrite ? 1 : 0);
    const v = validate(fx);
    assert.equal(v.status, 0, `${name} ${id}: validate failed: ${v.stderr}`);
    prev = now; prevAt = doc.updated_at;
    return doc;
  };

  const order = [];
  for (const id of ['T-1', 'T-2', 'T-3']) {
    boundary('start', id); order.push([id, 'in-progress']);
    assert.equal(fx.task(id).owner, 'build-it:sonnet');
    if (id === 'T-2') {
      boundary('block', id, { '<who/what>': 'owner: Fernando picks the API key' }); order.push([id, 'blocked']);
      assert.equal(fx.task(id).blocked_on, 'owner: Fernando picks the API key');
      boundary('unblock', id); order.push([id, 'in-progress']);
      assert.equal(fx.task(id).blocked_on, null);
    }
    const ev = path.join('.taskstate', 'results', `${id}.md`);
    fs.mkdirSync(path.join(fx.root, '.taskstate', 'results'), { recursive: true });
    fs.writeFileSync(path.join(fx.root, ev), `${id}: node --test -> pass 1, fail 0\n`);
    boundary('finish', id, { '<evidence>': ev }); order.push([id, 'done']);
    assert.equal(fx.task(id).evidence, ev);
    boundary('piece', id, { '<piece>': 'Core', '<status>': id === 'T-3' ? 'done' : 'in-progress', '<one line>': id === 'T-3' ? 'Nothing' : `tasks after ${id}` }, { taskWrite: false });
  }

  const doc = fx.read();
  assert.ok(doc.history.length >= 6, `history has ${doc.history.length} entries`);
  assert.deepEqual(new Set(doc.history.map((h) => h.task)), new Set(['T-1', 'T-2', 'T-3']));
  assert.deepEqual(doc.history.map((h) => [h.task, h.to]), order, 'history is in boundary order');
  assert.ok(doc.history.every((h) => h.by === 'build-it'));
  const idx = (task, to) => doc.history.findIndex((h) => h.task === task && h.to === to);
  for (const id of ['T-1', 'T-2', 'T-3']) assert.ok(idx(id, 'in-progress') < idx(id, 'done'), `${id} start before done`);
  assert.ok(idx('T-1', 'done') < idx('T-2', 'in-progress'), 'T-1 done before T-2 start');
  assert.ok(idx('T-2', 'done') < idx('T-3', 'in-progress'), 'T-2 done before T-3 start');
  assert.deepEqual(doc.pieces[0], { piece: 'Core', status: 'done', blocked_on: null, whats_left: 'Nothing' });

  const rep = exec(cmds.report, varsFor(fx, 'T-1'), fx.root);
  assert.equal(rep.code, 0, rep.err);
  assert.match(rep.out, /demo: 60%/);
  assert.match(rep.out, /done 3/);
});

test('T-B-17 build-it marks T done with evidence', async () => {
  const cmds = documentedCommands(PLUGIN_SKILL);
  const fx = mkImpl({ tasks: ['T-1', 'T-2', 'T-3'] });
  const md = path.join(fx.dir, 'STATUS.md');
  assert.equal(exec(cmds.start, varsFor(fx, 'T-1'), fx.root).code, 0);
  const row = (text, id) => text.split('\n').find((l) => l.startsWith(`| ${id} |`));
  const before = fs.readFileSync(md, 'utf8');
  assert.equal(before.split('\n')[0], '<!-- generated from status.json by status-write; do not edit by hand -->');
  assert.match(row(before, 'T-1'), /\| in-progress \|/);
  const taskAt = fx.task('T-1').updated_at; const topAt = fx.read().updated_at;
  await new Promise((r) => setTimeout(r, 1100)); // timestamps have second resolution
  const ev = 'docs/implementations/demo/evidence/T-1.txt';
  fs.writeFileSync(path.join(fx.root, ev), 'pass 4, fail 0\n');
  const r = exec(cmds.finish, varsFor(fx, 'T-1', { '<evidence>': ev }), fx.root);
  assert.equal(r.code, 0, r.err);
  const after = fs.readFileSync(md, 'utf8');
  assert.equal(after.split('\n')[0], '<!-- generated from status.json by status-write; do not edit by hand -->');
  assert.match(row(after, 'T-1'), /\| done \|/);
  assert.ok(row(after, 'T-1').includes(ev), 'STATUS.md row shows the evidence path');
  assert.equal(row(after, 'T-2'), row(before, 'T-2'));
  assert.ok(fx.task('T-1').updated_at > taskAt, 'task updated_at changed');
  assert.ok(fx.read().updated_at > topAt, 'top-level updated_at changed');
});

test('documented finish without an evidence file is refused, file byte-identical', () => {
  const cmds = documentedCommands(PLUGIN_SKILL);
  const fx = mkImpl({ tasks: ['T-1', 'T-2', 'T-3'] });
  assert.equal(exec(cmds.start, varsFor(fx, 'T-1'), fx.root).code, 0);
  const snap = fx.bytes();
  const mdSnap = fs.readFileSync(path.join(fx.dir, 'STATUS.md'));
  // flag dropped entirely
  const noFlag = cmds.finish.replace(/\s--evidence <evidence>/, '');
  assert.notEqual(noFlag, cmds.finish, 'finish command documents --evidence <evidence>');
  let r = exec(noFlag, varsFor(fx, 'T-1'), fx.root);
  assert.notEqual(r.code, 0); assert.match(r.err, /evidence/);
  // path that does not exist
  r = exec(cmds.finish, varsFor(fx, 'T-1', { '<evidence>': '.taskstate/results/missing.md' }), fx.root);
  assert.notEqual(r.code, 0); assert.match(r.err, /does not exist/);
  // empty file
  fs.mkdirSync(path.join(fx.root, '.taskstate', 'results'), { recursive: true });
  fs.writeFileSync(path.join(fx.root, '.taskstate/results/empty.md'), '');
  r = exec(cmds.finish, varsFor(fx, 'T-1', { '<evidence>': '.taskstate/results/empty.md' }), fx.root);
  assert.notEqual(r.code, 0); assert.match(r.err, /empty/);
  assert.ok(fx.bytes().equals(snap), 'status.json byte-identical after refusals');
  assert.ok(fs.readFileSync(path.join(fx.dir, 'STATUS.md')).equals(mdSnap), 'STATUS.md unchanged');
  assert.equal(fx.task('T-1').status, 'in-progress');
  assert.deepEqual(fx.residue(), []);
});
