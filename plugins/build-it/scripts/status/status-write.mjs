#!/usr/bin/env node
// status-write.mjs - the single writer for status.json (schema 1). Zero dependencies.
// Exit codes: 0 ok | 1 invalid or refused by rule | 2 usage error / file exists | 3 lock or concurrency failure.
// Authored by DevOtts (https://github.com/DevOtts).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  SCHEMA_VERSION, STATUSES, ROLES, SESSION_ROLES, FORBIDDEN_KEYS, RENDER_MARKER,
  validate, computeView, checkEvidence, resolveRepoRoot, resolveStatusFile,
  withLock, writeAtomic, nowIso, allTasks, newestActivity, movedEvidence,
} from './status-lib.mjs';

class Refusal extends Error { constructor(msg, code = 1) { super(msg); this.exitCode = code; } }

const BOOL_FLAGS = new Set(['merge', 'json', 'force', 'end-sessions', 'move']);
const USAGE = `usage: status-write <init|set|piece|rename|remove|session|close|reopen|validate|view|render> [args] --file <status.json> [--by ROLE]
  see plugins/build-it/scripts/status/README.md`;

function parseArgs(argv) {
  const pos = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (BOOL_FLAGS.has(k)) flags[k] = true;
      else { if (i + 1 >= argv.length) throw new Refusal(`flag --${k} needs a value`, 2); flags[k] = argv[++i]; }
    } else pos.push(a);
  }
  return { pos, flags };
}

const readText = (file) => fs.readFileSync(file, 'utf8');
function loadDoc(file) {
  let text;
  try { text = readText(file); } catch { throw new Refusal(`status file not found: ${file}`, 1); }
  try { return { doc: JSON.parse(text), text }; } catch (e) { throw new Refusal(`invalid JSON in ${file}: ${e.message}`, 1); }
}

function needBy(flags) {
  if (!flags.by) throw new Refusal('--by <role> is required', 2);
  if (!ROLES.includes(flags.by)) throw new Refusal(`unknown --by "${flags.by}" (allowed: ${ROLES.join(', ')})`, 1);
  return flags.by;
}
function allow(by, roles, what) {
  if (!roles.includes(by)) throw new Refusal(`role ${by} may not ${what} (allowed: ${roles.join(', ')})`, 1);
}
function rejectForbiddenFlags(flags) {
  for (const k of Object.keys(flags)) if (FORBIDDEN_KEYS.includes(k.toLowerCase())) throw new Refusal(`forbidden key "${k}": computed values are never written by a model`, 1);
}
function scanForbidden(o, where) {
  if (Array.isArray(o)) return o.forEach((x) => scanForbidden(x, where));
  if (o && typeof o === 'object') {
    for (const k of Object.keys(o)) if (FORBIDDEN_KEYS.includes(k.toLowerCase())) throw new Refusal(`forbidden key "${k}" in ${where}`, 1);
    Object.values(o).forEach((x) => scanForbidden(x, where));
  }
}
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
function frozen(doc) { if (doc.closed === true) throw new Refusal('implementation is closed (frozen); only "reopen --by conclude-it --note ..." is allowed', 1); }
function findTask(doc, id) {
  const t = allTasks(doc).find((x) => x.id === id);
  if (!t) throw new Refusal(`unknown task ${id}`, 1);
  return t;
}
function pushHistory(doc, e) { doc.history.push({ at: nowIso(), task: e.task, from: e.from, to: e.to, by: e.by, note: e.note ?? null }); }

// ---------- render (D-11) ----------
function renderTarget(dir) {
  const d = path.join(dir, 'delivery');
  return fs.existsSync(d) && fs.statSync(d).isDirectory() ? path.join(d, 'STATUS.md') : path.join(dir, 'STATUS.md');
}
async function renderStatus(file, doc, { force = false, out, auto = true } = {}) {
  const dir = path.dirname(file);
  const modPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'status-render.mjs');
  if (!fs.existsSync(modPath)) { if (!auto) throw new Refusal('status-render.mjs is not installed', 1); return; }
  const target = out ? path.resolve(out) : renderTarget(dir);
  if (!out && !force && fs.existsSync(target)) {
    const first = readText(target).split('\n', 1)[0].trim();
    if (first !== RENDER_MARKER) { process.stderr.write(`status-write: ${target} is hand-written; not overwriting (use "render --force")\n`); return; }
  }
  try {
    const mod = await import(pathToFileURL(modPath).href);
    const view = computeView(doc, { dir });
    const body = mod.renderStatusMd(doc, view);
    const tmp = `${target}.tmp`;
    try { fs.unlinkSync(tmp); } catch { /* absent */ }
    fs.writeFileSync(tmp, body.endsWith('\n') ? body : body + '\n', { flag: 'wx' });
    fs.renameSync(tmp, target);
  } catch (e) {
    if (!auto) throw new Refusal(`render failed: ${e.message}`, 1);
    process.stderr.write(`status-write: render skipped (${e.message})\n`);
  }
}

// ---------- mutation pipeline ----------
async function mutate(file, apply, { mustExist = true } = {}) {
  if (mustExist && !fs.existsSync(file)) throw new Refusal(`status file not found: ${file}`, 1);
  let result;
  try {
    result = await withLock(file, async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        let before = null; let doc;
        if (fs.existsSync(file)) { const l = loadDoc(file); doc = l.doc; before = l.text; }
        else if (mustExist) throw new Refusal(`status file not found: ${file}`, 1);
        if (doc) { frozen0(doc); }
        const out = await apply(doc);
        const next = out.doc;
        scanForbidden(next, 'the resulting document');
        next.updated_at = nowIso();
        const dir = path.dirname(file);
        const v = validate(next, { dir, repoRoot: resolveRepoRoot(dir) });
        if (!v.ok) throw new Refusal(`resulting document is invalid:\n  ${v.errors.join('\n  ')}`, 1);
        const nowText = fs.existsSync(file) ? readText(file) : null;
        if (nowText !== before) continue; // changed under us: re-read and re-apply
        writeAtomic(file, next);
        return { ...out, doc: next };
      }
      throw new Refusal('concurrent modification: gave up after 3 retries', 3);
    });
  } catch (e) {
    if (e.code === 'ELOCK') throw new Refusal(e.message, 3);
    throw e;
  }
  return result;
  function frozen0(d) { if (d && out_allow_frozen.has(currentCmd)) return; frozen(d); }
}
let currentCmd = '';
const out_allow_frozen = new Set(['reopen']);

// ---------- commands ----------
function buildInit(plan, by, dir) {
  scanForbidden(plan, 'plan.json');
  const impl = plan.implementation || path.basename(dir);
  const tasks = (w) => (w.tasks || []).map((t) => ({
    id: t.id, title: t.title, status: 'not-started', blocked_on: null, evidence: null, owner: t.owner ?? null, updated_at: nowIso(), note: null,
  }));
  return {
    schema: SCHEMA_VERSION, implementation: impl, title: plan.title || impl, updated_at: nowIso(), approximate: false, closed: false,
    waves: (plan.waves || []).map((w) => ({ id: w.id, title: w.title, tasks: tasks(w) })),
    sessions: [],
    pieces: (plan.pieces || []).map((p) => ({ piece: p.piece, status: 'not-started', blocked_on: null, whats_left: p.whats_left || 'Everything' })),
    history: [],
  };
}

async function cmdInit(file, flags) {
  const by = needBy(flags); allow(by, ['plan-it'], 'init');
  if (!flags.plan) throw new Refusal('--plan <plan.json> is required', 2);
  let plan;
  try { plan = JSON.parse(readText(flags.plan)); } catch (e) { throw new Refusal(`cannot read plan: ${e.message}`, 2); }
  if (fs.existsSync(file) && !flags.merge) throw new Refusal(`status.json already exists: ${file} (use --merge to add new items)`, 2);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = await mutate(file, (doc) => {
    const fresh = buildInit(plan, by, path.dirname(file));
    if (!doc) return { doc: fresh };
    frozen(doc);
    for (const w of fresh.waves) {
      const ew = doc.waves.find((x) => x.id === w.id);
      if (!ew) { doc.waves.push(w); continue; }
      for (const t of w.tasks) if (!allTasks(doc).some((x) => x.id === t.id)) ew.tasks.push(t);
    }
    for (const p of fresh.pieces) if (!doc.pieces.some((x) => x.piece === p.piece)) doc.pieces.push(p);
    return { doc };
  }, { mustExist: false });
  await renderStatus(file, r.doc);
  say(`initialised ${file} (${allTasks(r.doc).length} tasks)`);
}

const SET_ROLES = {
  'not-started': ['build-it'], 'in-progress': ['build-it', 'review-it'], blocked: ['build-it'], done: ['build-it'], verified: ['review-it', 'conclude-it'],
};

async function cmdSet(file, pos, flags) {
  const id = pos[0]; if (!id) throw new Refusal('set <TASK> ...', 2);
  const by = needBy(flags); rejectForbiddenFlags(flags);
  if (flags.status && !STATUSES.includes(flags.status)) throw new Refusal(`invalid status "${flags.status}" (allowed: ${STATUSES.join(', ')})`, 1);
  if (!flags.status && !('owner' in flags) && !('note' in flags)) throw new Refusal('set needs --status, --owner or --note', 2);
  if (flags.status) allow(by, SET_ROLES[flags.status], `set status ${flags.status}`);
  else allow(by, ['build-it', 'review-it'], 'edit task fields');
  if (by === 'review-it' && flags.status === 'in-progress' && !nonEmpty(flags.note)) throw new Refusal('review-it sending a task back to in-progress requires --note "<failed case>"', 1);
  const r = await mutate(file, (doc) => {
    const t = findTask(doc, id);
    const dir = path.dirname(file); const root = resolveRepoRoot(dir);
    const to = flags.status || t.status; const from = t.status;
    if (from === 'verified' && to !== 'verified' && !nonEmpty(flags.note)) throw new Refusal('lowering a verified task requires --note', 1);
    if (to === 'blocked' && !nonEmpty(flags['blocked-on'])) throw new Refusal('blocked requires --blocked-on', 1);
    if (to === 'done' || to === 'verified') {
      const ev = flags.evidence ?? movedEvidence(root, dir, t.evidence);
      const c = checkEvidence(root, dir, ev, to === 'verified' ? { verdictFor: id } : {});
      if (!c.ok) throw new Refusal(`${to} refused: ${c.reason}`, 1);
      t.evidence = ev;
    } else if (flags.evidence !== undefined) {
      const c = checkEvidence(root, dir, flags.evidence);
      if (!c.ok) throw new Refusal(`evidence refused: ${c.reason}`, 1);
      t.evidence = flags.evidence;
    }
    if (flags.status) { t.status = to; t.blocked_on = to === 'blocked' ? flags['blocked-on'] : null; t.note = flags.note ?? null; }
    else if ('note' in flags) t.note = flags.note;
    if ('owner' in flags) t.owner = flags.owner;
    t.updated_at = nowIso();
    if (from !== to) pushHistory(doc, { task: id, from, to, by, note: flags.note });
    return { doc };
  });
  await renderStatus(file, r.doc);
  say(`${id} ok`);
}

async function cmdPiece(file, pos, flags) {
  const name = pos[0]; if (!name) throw new Refusal('piece <PIECE> ...', 2);
  const by = needBy(flags); rejectForbiddenFlags(flags);
  if (flags.status && !STATUSES.includes(flags.status)) throw new Refusal(`invalid status "${flags.status}"`, 1);
  // Pieces follow the task role rules (ST-08): verified only by review-it/conclude-it, blocked needs --blocked-on,
  // lowering verified needs --note.
  if (flags.status) allow(by, SET_ROLES[flags.status], `set piece status ${flags.status}`);
  else allow(by, ['build-it'], 'update pieces');
  if (by === 'review-it' && flags.status === 'in-progress' && !nonEmpty(flags.note)) throw new Refusal('review-it sending a piece back to in-progress requires --note "<failed case>"', 1);
  if (flags['whats-left'] !== undefined && /\d\s*%/.test(flags['whats-left'])) throw new Refusal('--whats-left must not be a percent', 1);
  const r = await mutate(file, (doc) => {
    const p = doc.pieces.find((x) => x.piece === name);
    if (!p) throw new Refusal(`unknown piece "${name}"`, 1);
    const to = flags.status || p.status;
    if (p.status === 'verified' && to !== 'verified' && !nonEmpty(flags.note)) throw new Refusal('lowering a verified piece requires --note', 1);
    if (to === 'blocked' && !nonEmpty(flags['blocked-on'] ?? (flags.status ? undefined : p.blocked_on))) throw new Refusal('blocked requires --blocked-on', 1);
    if (flags.status) p.status = flags.status;
    if (to === 'blocked') { if ('blocked-on' in flags) p.blocked_on = flags['blocked-on']; } else p.blocked_on = null;
    if ('whats-left' in flags) p.whats_left = flags['whats-left'];
    if ('note' in flags) p.note = flags.note;
    return { doc };
  });
  await renderStatus(file, r.doc);
  say(`piece "${name}" ok`);
}

async function cmdRenameRemove(cmd, file, pos, flags) {
  const id = pos[0]; if (!id) throw new Refusal(`${cmd} <TASK> ...`, 2);
  const by = needBy(flags); allow(by, ['plan-it'], cmd);
  if (cmd === 'rename' && !nonEmpty(flags.title)) throw new Refusal('rename needs --title', 2);
  const r = await mutate(file, (doc) => {
    const t = findTask(doc, id);
    if (t.status !== 'not-started') throw new Refusal(`${cmd} refused: task ${id} is ${t.status} (task ids and work past not-started are stable)`, 1);
    if (cmd === 'rename') { t.title = flags.title; t.updated_at = nowIso(); }
    else {
      for (const w of doc.waves) w.tasks = w.tasks.filter((x) => x.id !== id);
      // A task with history leaves a "removed" entry, so a hand deletion stays detectable (ST-08).
      if (doc.history.some((h) => h.task === id)) pushHistory(doc, { task: id, from: 'not-started', to: 'removed', by, note: flags.note });
    }
    return { doc };
  });
  await renderStatus(file, r.doc);
  say(`${cmd} ${id} ok`);
}

async function cmdSession(file, pos, flags) {
  const sub = pos[0];
  const by = needBy(flags);
  let r;
  if (sub === 'add') {
    allow(by, ['init-it'], 'session add');
    for (const k of ['session-id', 'alias', 'name', 'role']) if (!nonEmpty(flags[k])) throw new Refusal(`session add needs --${k}`, 2);
    if (!SESSION_ROLES.includes(flags.role)) throw new Refusal(`invalid --role (allowed: ${SESSION_ROLES.join(', ')})`, 1);
    r = await mutate(file, (doc) => {
      if (!doc.sessions.some((s) => s.session_id === flags['session-id'])) {
        doc.sessions.push({ session_id: flags['session-id'], alias: flags.alias, name: flags.name, role: flags.role, started_at: nowIso(), ended_at: null });
      }
      return { doc };
    });
  } else if (sub === 'end') {
    allow(by, ['init-it', 'conclude-it'], 'session end');
    if (!nonEmpty(flags['session-id'])) throw new Refusal('session end needs --session-id', 2);
    r = await mutate(file, (doc) => {
      const s = doc.sessions.find((x) => x.session_id === flags['session-id']);
      if (!s) throw new Refusal(`unknown session ${flags['session-id']}`, 1);
      if (!s.ended_at) s.ended_at = nowIso();
      return { doc };
    });
  } else throw new Refusal('session <add|end> ...', 2);
  await renderStatus(file, r.doc);
  say(`session ${sub} ok`);
}

async function cmdClose(file, flags) {
  const by = needBy(flags); allow(by, ['conclude-it'], 'close');
  const dir = path.dirname(file);
  const r = await mutate(file, (doc) => {
    const open = allTasks(doc).filter((t) => t.status !== 'verified');
    if (open.length && !nonEmpty(flags['owner-note'])) {
      throw new Refusal(`close refused: ${open.length} task(s) not verified (${open.map((t) => t.id).join(', ')}); pass --owner-note to override`, 1);
    }
    if (flags.move && fs.existsSync(path.join(path.dirname(dir), '0-done', path.basename(dir)))) throw new Refusal('close --move refused: 0-done target already exists', 1);
    if (open.length) pushHistory(doc, { task: '*', from: 'open', to: 'closed', by, note: flags['owner-note'] });
    else pushHistory(doc, { task: '*', from: 'open', to: 'closed', by, note: null });
    doc.closed = true;
    if (flags['end-sessions']) for (const s of doc.sessions) if (!s.ended_at) s.ended_at = nowIso();
    return { doc };
  });
  await renderStatus(file, r.doc);
  if (flags.move) {
    const target = path.join(path.dirname(dir), '0-done', path.basename(dir));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(dir, target);
    say(`closed and moved to ${target}`);
  } else say('closed');
}

async function cmdReopen(file, flags) {
  const by = needBy(flags); allow(by, ['conclude-it'], 'reopen');
  if (!nonEmpty(flags.note)) throw new Refusal('reopen needs --note', 1);
  currentCmd = 'reopen';
  const r = await mutate(file, (doc) => {
    if (doc.closed !== true) throw new Refusal('reopen refused: implementation is not closed', 1);
    doc.closed = false;
    pushHistory(doc, { task: '*', from: 'closed', to: 'open', by, note: flags.note });
    return { doc };
  });
  await renderStatus(file, r.doc);
  say('reopened');
}

function cmdValidate(file) {
  const { doc } = loadDoc(file);
  const dir = path.dirname(file);
  const v = validate(doc, { dir, repoRoot: resolveRepoRoot(dir) });
  if (!v.ok) { for (const e of v.errors) process.stderr.write(`${e}\n`); return 1; }
  say('valid');
  return 0;
}

// One line of inert text: no newlines, no control or bidi characters (ST-08: a field must not forge a view line).
const oneLine = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]+/g, ' ').trim();

function cmdView(file, flags) {
  const { doc } = loadDoc(file);
  const view = computeView(doc, { dir: path.dirname(file) });
  if (view.error) { process.stderr.write(`${view.error}\n`); return 1; }
  const invalid = view.errors.length > 0;
  if (flags.json) { say(JSON.stringify(view, null, 2)); return invalid ? 1 : 0; }
  const c = view.counts;
  // An invalid file's percent is not trustworthy: say so on the same line, list the errors, exit 1 (ST-08).
  const pct = invalid ? `${view.percent}${view.percent === 'unknown' ? '' : '%'} INVALID (${view.errors.length} validation error(s); this percent is not trustworthy)` : `${view.percent}${view.percent === 'unknown' ? '' : '%'}`;
  say(`${oneLine(doc.implementation)}: ${pct}${view.approximate ? ' approximate' : ''}${view.stale ? ' (stale)' : ''}${view.closed ? ' [closed]' : ''}`);
  say(STATUSES.map((s) => `${s} ${c[s]}`).join(' | ') + ` | total ${view.total}`);
  for (const b of view.blocked_list) say(`blocked ${oneLine(b.id)}: ${oneLine(b.blocked_on)}`);
  for (const e of view.errors) say(`invalid: ${oneLine(e)}`);
  return invalid ? 1 : 0;
}

async function cmdRender(file, flags) {
  const { doc } = loadDoc(file);
  const dir = path.dirname(file);
  const v = validate(doc, { dir, repoRoot: resolveRepoRoot(dir) });
  if (!v.ok) throw new Refusal(`render refused: status.json fails validation, so its percent would be a lie:\n  ${v.errors.join('\n  ')}`, 1);
  await renderStatus(file, doc, { force: !!flags.force, out: flags.out, auto: false });
  say('rendered');
}

function say(s) { process.stdout.write(s + '\n'); }

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') { say(USAGE); return argv.length ? 0 : 2; }
  const cmd = argv[0];
  const { pos, flags } = parseArgs(argv.slice(1));
  const file = resolveStatusFile({ file: flags.file, impl: flags.impl });
  if (!file) throw new Refusal('--file <status.json> (or --impl <name>, or env DOIT_STATUS_FILE) is required', 2);
  currentCmd = cmd;
  switch (cmd) {
    case 'init': await cmdInit(file, flags); return 0;
    case 'set': await cmdSet(file, pos, flags); return 0;
    case 'piece': await cmdPiece(file, pos, flags); return 0;
    case 'rename': case 'remove': await cmdRenameRemove(cmd, file, pos, flags); return 0;
    case 'session': await cmdSession(file, pos, flags); return 0;
    case 'close': await cmdClose(file, flags); return 0;
    case 'reopen': await cmdReopen(file, flags); return 0;
    case 'validate': return cmdValidate(file);
    case 'view': return cmdView(file, flags);
    case 'render': await cmdRender(file, flags); return 0;
    default: throw new Refusal(`unknown command "${cmd}"\n${USAGE}`, 2);
  }
}

main().then((code) => { process.exitCode = code; }).catch((e) => {
  if (e instanceof Refusal) { process.stderr.write(`status-write: refused: ${e.message}\n`); process.exitCode = e.exitCode; }
  else { process.stderr.write(`status-write: error: ${e.stack || e.message}\n`); process.exitCode = 1; }
});
