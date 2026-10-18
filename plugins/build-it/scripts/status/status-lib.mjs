// status-lib.mjs - schema 1 status.json: constants, validator, view, atomic write, lock.
// Pure ESM, zero dependencies. Authored by DevOtts (https://github.com/DevOtts).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const SCHEMA_VERSION = 1;
export const STATUSES = ['not-started', 'in-progress', 'blocked', 'done', 'verified'];
export const ROLES = ['plan-it', 'build-it', 'review-it', 'conclude-it', 'init-it'];
export const SESSION_ROLES = ['plan', 'build', 'review', 'conclude', 'other'];
export const FORBIDDEN_KEYS = ['percent', 'counts', 'computed', 'blocked_list', 'stale'];
export const DONE_UNVERIFIED_WEIGHT = 0.6;
export const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
export const LOCK_STALE_MS = 30 * 1000;
export const RENDER_MARKER = '<!-- generated from status.json by status-write; do not edit by hand -->';
export const VERDICT_RE = /^\s*(verdict|result)\s*[:=]\s*(PASS|VERIFIED)\b/im;

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ---------- paths ----------
export function resolveRepoRoot(dir) {
  let cur = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const up = path.dirname(cur);
    if (up === cur) return path.resolve(dir);
    cur = up;
  }
}

export function resolveStatusFile({ file, impl, cwd } = {}) {
  const f = file || process.env.DOIT_STATUS_FILE;
  if (f) return path.resolve(cwd || process.cwd(), f);
  if (!impl) return null;
  const root = resolveRepoRoot(cwd || process.cwd());
  const plural = path.join(root, 'docs', 'implementations', impl, 'status.json');
  const singular = path.join(root, 'docs', 'implementation', impl, 'status.json');
  if (fs.existsSync(plural)) return plural;
  if (fs.existsSync(singular)) return singular;
  if (fs.existsSync(path.dirname(plural))) return plural;
  if (fs.existsSync(path.dirname(singular))) return singular;
  return plural;
}

const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
const BAD_EVIDENCE_NAMES = ['status.json', 'status.json.tmp', 'status.json.lock', 'STATUS.md'];

// Evidence must be a repo-relative regular, non-empty file under the impl folder or any .taskstate dir.
export function checkEvidence(repoRoot, implDir, relPath, { verdictFor } = {}) {
  if (!isStr(relPath) || relPath.trim() === '') return { ok: false, reason: 'evidence path is empty' };
  if (path.isAbsolute(relPath) || /^[A-Za-z]:[\\/]/.test(relPath)) return { ok: false, reason: `evidence path must be repo-relative: ${relPath}` };
  if (relPath.split(/[\\/]/).includes('..')) return { ok: false, reason: `evidence path escapes the repo ("..") : ${relPath}` };
  if (BAD_EVIDENCE_NAMES.includes(path.basename(relPath))) return { ok: false, reason: `evidence may not be ${path.basename(relPath)}` };
  const abs = path.resolve(repoRoot, relPath);
  const rRoot = real(repoRoot);
  const rAbs = real(abs);
  if (!rAbs) return { ok: false, reason: `evidence file does not exist: ${relPath}` };
  const within = (base, p) => p === base || p.startsWith(base + path.sep);
  if (!rRoot || !within(rRoot, rAbs)) return { ok: false, reason: `evidence resolves outside the repo: ${relPath}` };
  const rImpl = implDir ? real(implDir) : null;
  const relReal = path.relative(rRoot, rAbs).split(path.sep);
  const underTaskstate = relReal.slice(0, -1).includes('.taskstate');
  if (!(rImpl && within(rImpl, rAbs)) && !underTaskstate) {
    return { ok: false, reason: `evidence must live under the implementation folder or a .taskstate dir: ${relPath}` };
  }
  let st;
  try { st = fs.statSync(rAbs); } catch { return { ok: false, reason: `evidence file does not exist: ${relPath}` }; }
  if (!st.isFile()) return { ok: false, reason: `evidence is not a regular file: ${relPath}` };
  if (st.size === 0) return { ok: false, reason: `evidence file is empty: ${relPath}` };
  const text = fs.readFileSync(rAbs, 'utf8');
  if (text.trim() === '') return { ok: false, reason: `evidence file has only whitespace: ${relPath}` };
  if (verdictFor !== undefined) {
    if (!text.includes('review-it')) return { ok: false, reason: `verdict file lacks the token "review-it": ${relPath}` };
    if (!text.includes(String(verdictFor))) return { ok: false, reason: `verdict file does not name task ${verdictFor}: ${relPath}` };
    if (!VERDICT_RE.test(text)) return { ok: false, reason: `verdict file lacks a "verdict: PASS" line: ${relPath}` };
  }
  return { ok: true };
}

// ---------- validation ----------
export function allTasks(doc) {
  const out = [];
  if (isObj(doc) && Array.isArray(doc.waves)) {
    for (const w of doc.waves) if (isObj(w) && Array.isArray(w.tasks)) for (const t of w.tasks) if (isObj(t)) out.push(t);
  }
  return out;
}

export function validate(doc, { dir, repoRoot } = {}) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!isObj(doc)) return { ok: false, errors: ['status.json must be a JSON object'] };
  if (doc.schema !== SCHEMA_VERSION) return { ok: false, errors: [`unsupported schema ${JSON.stringify(doc.schema)}`] };
  const forbid = (o, where) => { for (const k of FORBIDDEN_KEYS) if (isObj(o) && k in o) err(`forbidden key "${k}" ${where} (computed values are never stored)`); };
  forbid(doc, 'at top level');
  if (!isStr(doc.implementation) || !doc.implementation) err('implementation must be a non-empty string');
  if (dir && isStr(doc.implementation)) {
    const folder = path.basename(path.resolve(dir));
    if (folder !== doc.implementation && path.basename(path.dirname(path.resolve(dir))) !== '0-done') {
      err(`implementation "${doc.implementation}" does not equal folder name "${folder}"`);
    }
  }
  if (doc.title !== undefined && !isStr(doc.title)) err('title must be a string');
  if (!isStr(doc.updated_at) || !ISO_RE.test(doc.updated_at)) err('updated_at must be an ISO 8601 UTC string');
  for (const k of ['approximate', 'closed']) if (doc[k] !== undefined && typeof doc[k] !== 'boolean') err(`${k} must be a boolean`);
  for (const k of ['waves', 'sessions', 'pieces', 'history']) if (!Array.isArray(doc[k])) err(`${k} must be an array`);
  const root = repoRoot || (dir ? resolveRepoRoot(dir) : null);
  const seen = new Set();
  const lastHist = new Map();
  if (Array.isArray(doc.history)) {
    doc.history.forEach((h, i) => {
      if (!isObj(h)) return err(`history[${i}] must be an object`);
      for (const k of ['at', 'task', 'from', 'to', 'by']) if (!isStr(h[k])) err(`history[${i}].${k} must be a string`);
      if (isStr(h.task)) lastHist.set(h.task, h);
    });
  }
  if (Array.isArray(doc.waves)) {
    doc.waves.forEach((w, wi) => {
      if (!isObj(w)) return err(`waves[${wi}] must be an object`);
      forbid(w, `in waves[${wi}]`);
      if (!isStr(w.id) || !w.id) err(`waves[${wi}].id must be a non-empty string`);
      if (!isStr(w.title)) err(`waves[${wi}].title must be a string`);
      if (!Array.isArray(w.tasks)) return err(`waves[${wi}].tasks must be an array`);
      w.tasks.forEach((t, ti) => {
        const at = `task ${isObj(t) && t.id ? t.id : `waves[${wi}].tasks[${ti}]`}`;
        if (!isObj(t)) return err(`${at} must be an object`);
        forbid(t, `in ${at}`);
        if (!isStr(t.id) || !t.id) err(`${at}: id must be a non-empty string`);
        else if (seen.has(t.id)) err(`duplicate task id ${t.id}`);
        else seen.add(t.id);
        if (!isStr(t.title)) err(`${at}: title must be a string`);
        if (!STATUSES.includes(t.status)) { err(`${at}: status must be one of ${STATUSES.join(', ')}`); return; }
        if (!isStr(t.updated_at) || !ISO_RE.test(t.updated_at)) err(`${at}: updated_at must be an ISO 8601 UTC string`);
        for (const k of ['blocked_on', 'evidence', 'note']) if (t[k] != null && !isStr(t[k])) err(`${at}: ${k} must be a string or null`);
        if (t.owner != null && !isStr(t.owner)) err(`${at}: owner must be a string`);
        if (t.status === 'blocked' && !(isStr(t.blocked_on) && t.blocked_on.trim())) err(`${at}: blocked requires blocked_on`);
        if (t.status === 'done' || t.status === 'verified') {
          if (!(isStr(t.evidence) && t.evidence.trim())) err(`${at}: ${t.status} requires evidence`);
          else if (dir && root) {
            const lh = lastHist.get(t.id);
            const migrated = lh && lh.by === 'migration';
            const r = checkEvidence(root, dir, t.evidence, t.status === 'verified' && !migrated ? { verdictFor: t.id } : {});
            if (!r.ok) err(`${at}: ${r.reason}`);
          }
        }
        if (t.status !== 'not-started') {
          const h = lastHist.get(t.id);
          if (!h || h.to !== t.status) err(`${at}: status "${t.status}" has no matching history entry (edited without the writer?)`);
        }
      });
    });
  }
  if (Array.isArray(doc.sessions)) {
    doc.sessions.forEach((s, i) => {
      if (!isObj(s)) return err(`sessions[${i}] must be an object`);
      for (const k of ['session_id', 'alias', 'name']) if (!isStr(s[k])) err(`sessions[${i}].${k} must be a string`);
      if (!SESSION_ROLES.includes(s.role)) err(`sessions[${i}].role must be one of ${SESSION_ROLES.join(', ')}`);
      if (!isStr(s.started_at)) err(`sessions[${i}].started_at must be a string`);
      if (s.ended_at != null && !isStr(s.ended_at)) err(`sessions[${i}].ended_at must be a string or null`);
    });
  }
  if (Array.isArray(doc.pieces)) {
    doc.pieces.forEach((p, i) => {
      if (!isObj(p)) return err(`pieces[${i}] must be an object`);
      forbid(p, `in pieces[${i}]`);
      if (!isStr(p.piece)) err(`pieces[${i}].piece must be a string`);
      if (!STATUSES.includes(p.status)) err(`pieces[${i}].status must be one of ${STATUSES.join(', ')}`);
      if (!isStr(p.whats_left)) err(`pieces[${i}].whats_left must be a string`);
      else if (/\d\s*%/.test(p.whats_left)) err(`pieces[${i}].whats_left must not contain a percent`);
      if (p.blocked_on != null && !isStr(p.blocked_on)) err(`pieces[${i}].blocked_on must be a string or null`);
    });
  }
  return { ok: errors.length === 0, errors };
}

// ---------- view ----------
export function percent(doc) {
  const tasks = allTasks(doc);
  const T = tasks.length;
  if (T === 0) return 'unknown';
  const V = tasks.filter((t) => t.status === 'verified').length;
  const D = tasks.filter((t) => t.status === 'done').length;
  let p = Math.round(((V + D * DONE_UNVERIFIED_WEIGHT) / T) * 100);
  if (V < T && p >= 100) p = 99;
  return p;
}

export function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const n = Date.parse(v);
  return Number.isNaN(n) ? null : n;
}

export function isStale(updatedAt, newest, thresholdMs = STALE_THRESHOLD_MS) {
  const u = toMs(updatedAt);
  const n = toMs(newest);
  if (u === null || n === null) return false;
  return n - u > thresholdMs;
}

export function newestActivity(dir, doc) {
  let best = null;
  const take = (v) => { const m = toMs(v); if (m !== null && (best === null || m > best)) best = m; };
  if (dir) {
    try {
      const out = execFileSync('git', ['-C', dir, 'log', '-1', '--format=%cI', '--', '.'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString().trim();
      if (out) take(out);
    } catch { /* not a git repo or git missing */ }
  }
  if (isObj(doc) && Array.isArray(doc.sessions)) for (const s of doc.sessions) if (isObj(s)) { take(s.started_at); take(s.ended_at); }
  return best;
}

export function computeView(doc, opts = {}) {
  if (!isObj(doc)) return { error: 'status.json must be a JSON object' };
  if (doc.schema !== SCHEMA_VERSION) return { error: `unsupported schema ${JSON.stringify(doc.schema)}` };
  const tasks = allTasks(doc);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const t of tasks) if (t.status in counts) counts[t.status] += 1;
  const blocked_list = tasks.filter((t) => t.status === 'blocked').map((t) => ({ id: t.id, title: t.title, blocked_on: t.blocked_on }));
  const newest = opts.newestActivity !== undefined ? opts.newestActivity : (opts.dir ? newestActivity(opts.dir, doc) : null);
  return {
    percent: percent(doc),
    approximate: doc.approximate === true,
    closed: doc.closed === true,
    counts,
    total: tasks.length,
    blocked_list,
    stale: isStale(doc.updated_at, newest, opts.thresholdMs ?? STALE_THRESHOLD_MS),
    errors: validate(doc, { dir: opts.dir, repoRoot: opts.repoRoot }).errors,
  };
}

export function loadView(file, opts = {}) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { error: `cannot read ${file}: ${e.code || e.message}` }; }
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return { error: `invalid JSON: ${e.message}` }; }
  try {
    const view = computeView(doc, { dir: path.dirname(path.resolve(file)), ...opts });
    return view.error ? view : { ...view, doc };
  } catch (e) { return { error: `cannot compute view: ${e.message}` }; }
}

// ---------- lock + atomic write ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function withLock(file, fn, { timeoutMs = 5000, staleMs = LOCK_STALE_MS } = {}) {
  const lock = `${file}.lock`;
  const start = Date.now();
  let delay = 5;
  for (;;) {
    try {
      const fd = fs.openSync(lock, 'wx');
      fs.writeSync(fd, `${process.pid} ${Date.now()}\n`);
      fs.closeSync(fd);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const age = Date.now() - fs.statSync(lock).mtimeMs;
        let dead = false;
        try { const pid = parseInt(fs.readFileSync(lock, 'utf8'), 10); if (pid > 0) { try { process.kill(pid, 0); } catch (k) { dead = k.code === 'ESRCH'; } } } catch { /* unreadable */ }
        if (age > staleMs || dead) { process.stderr.write(`status-write: reclaiming stale/dead-holder lock ${lock}\n`); fs.unlinkSync(lock); continue; }
      } catch { continue; }
      if (Date.now() - start > timeoutMs) { const er = new Error(`could not acquire lock ${lock}`); er.code = 'ELOCK'; throw er; }
      await sleep(delay + Math.floor(Math.random() * delay));
      delay = Math.min(delay * 2, 100);
    }
  }
  try { return await fn(); } finally { try { fs.unlinkSync(lock); } catch { /* gone */ } }
}

export function writeAtomic(file, doc) {
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, JSON.stringify(doc, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (process.env.STATUS_WRITE_TEST_CRASH === 'after-tmp') process.exit(137); // test-only hook (AT-14)
  fs.renameSync(tmp, file);
  try { const dfd = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); } } catch { /* best effort */ }
}
