// status-lib.mjs - schema 1 status.json: constants, validator, view, atomic write, lock.
// Pure ESM, zero dependencies. Authored by DevOtts (https://github.com/DevOtts).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

export const SCHEMA_VERSION = 1;
export const STATUSES = ['not-started', 'in-progress', 'blocked', 'done', 'verified'];
export const ROLES = ['plan-it', 'build-it', 'review-it', 'conclude-it', 'init-it'];
export const SESSION_ROLES = ['plan', 'build', 'review', 'conclude', 'other'];
export const FORBIDDEN_KEYS = ['percent', 'counts', 'computed', 'blocked_list', 'stale'];
export const DONE_UNVERIFIED_WEIGHT = 0.6;
export const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
export const LOCK_STALE_MS = 30 * 1000;
export const RENDER_MARKER = '<!-- generated from status.json by status-write; do not edit by hand -->';
export const VERIFY_ROLES = ['review-it', 'conclude-it'];
export const MIGRATION = 'migration';
export const FUTURE_SKEW_MS = 60 * 60 * 1000;
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

const real = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };
// Compared case-insensitively (APFS/NTFS are case-insensitive) on both the given and the resolved name (ST-08).
const BAD_EVIDENCE_NAMES = ['status.json', 'status.json.tmp', 'status.json.lock', 'status.md', 'status.md.tmp'];
const isBadEvidenceName = (p) => BAD_EVIDENCE_NAMES.includes(path.basename(p).toLowerCase()) || /\.lock\.\d+\.\d+\.stale$/.test(p);
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const VERDICT_ANY_RE = /^\s*(verdict|result)\s*[:=]\s*(\S+)/gim;
const TASK_LINE_RE = /^\s*task\s*[:=]\s*(.+?)\s*$/gim;

// After "close --move" the folder lives at <parent>/0-done/<name>, while evidence paths still name
// <parent>/<name>/...: map them so a closed board keeps validating (ST-08).
export function movedEvidence(repoRoot, implDir, relPath) {
  if (!isStr(relPath) || !implDir || !repoRoot) return relPath;
  const d = path.resolve(implDir);
  if (path.basename(path.dirname(d)) !== '0-done') return relPath;
  const oldRel = path.relative(repoRoot, path.join(path.dirname(path.dirname(d)), path.basename(d))).split(path.sep).join('/');
  const norm = relPath.split('\\').join('/').replace(/^(\.\/)+/, '');
  if (!norm.startsWith(oldRel + '/')) return relPath;
  return path.relative(repoRoot, d).split(path.sep).join('/') + norm.slice(oldRel.length);
}

// Evidence must be a repo-relative regular, non-empty file under the impl folder or any .taskstate dir.
export function checkEvidence(repoRoot, implDir, relPath, { verdictFor } = {}) {
  if (!isStr(relPath) || relPath.trim() === '') return { ok: false, reason: 'evidence path is empty' };
  if (/[\\/]$/.test(relPath)) return { ok: false, reason: `evidence path must name a file, not end in a separator: ${relPath}` };
  if (path.isAbsolute(relPath) || /^[A-Za-z]:[\\/]/.test(relPath)) return { ok: false, reason: `evidence path must be repo-relative: ${relPath}` };
  if (relPath.split(/[\\/]/).includes('..')) return { ok: false, reason: `evidence path escapes the repo ("..") : ${relPath}` };
  if (isBadEvidenceName(relPath)) return { ok: false, reason: `evidence may not be ${path.basename(relPath)}` };
  const abs = path.resolve(repoRoot, relPath);
  const rRoot = real(repoRoot);
  const rAbs = real(abs);
  if (!rAbs) return { ok: false, reason: `evidence file does not exist: ${relPath}` };
  if (isBadEvidenceName(rAbs)) return { ok: false, reason: `evidence resolves to ${path.basename(rAbs)} (status files are not evidence): ${relPath}` };
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
    // The id must stand alone: "T-1" does not match inside "T-10", "T-1.2" or "T-1b" (ST-08).
    const idRe = new RegExp(`(^|[^A-Za-z0-9_.-])${reEsc(verdictFor)}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`);
    if (!idRe.test(text)) return { ok: false, reason: `verdict file does not name task ${verdictFor}: ${relPath}` };
    const taskLines = [...text.matchAll(TASK_LINE_RE)].map((m) => m[1].replace(/[`*]/g, '').trim());
    if (taskLines.length && !taskLines.some((v) => v === String(verdictFor) || v.split(/[\s,]+/).includes(String(verdictFor)))) {
      return { ok: false, reason: `verdict file is for task ${taskLines.join(', ')}, not ${verdictFor}: ${relPath}` };
    }
    const bad = [...text.matchAll(VERDICT_ANY_RE)].map((m) => m[2].replace(/[`*.,;]+$/g, '').replace(/^[`*]+/, '')).filter((v) => !/^(PASS|VERIFIED)$/i.test(v));
    if (bad.length) return { ok: false, reason: `verdict file has a non-PASS verdict line (${bad.join(', ')}): ${relPath}` };
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

export function validate(doc, opts = {}) {
  const { dir, repoRoot } = opts;
  const errors = [];
  const err = (m) => errors.push(m);
  if (!isObj(doc)) return { ok: false, errors: ['status.json must be a JSON object'] };
  if (doc.schema !== SCHEMA_VERSION) return { ok: false, errors: [`unsupported schema ${JSON.stringify(doc.schema)}`] };
  const checked = new WeakSet();
  const forbid = (o, where) => {
    if (!isObj(o)) return;
    checked.add(o);
    for (const k of Object.keys(o)) if (FORBIDDEN_KEYS.includes(k.toLowerCase())) err(`forbidden key "${k}" ${where} (computed values are never stored)`);
  };
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
  const nowMs = opts.now ?? Date.now();
  const future = (v, where) => { const m = isStr(v) && ISO_RE.test(v) ? Date.parse(v) : NaN; if (m > nowMs + FUTURE_SKEW_MS) err(`${where} is in the future (${v}); timestamps come from the writer's clock`); };
  future(doc.updated_at, 'updated_at');
  // History integrity (ST-08): known roles, verified only by review-it/conclude-it, lowering verified needs a note,
  // each task's entries chain (from == previous to), migration entries only as a prefix and only with approximate.
  let lastStar = null;
  let sawWriter = false;
  const sameState = (a, b) => (a === 'removed' ? 'not-started' : a) === (b === 'removed' ? 'not-started' : b);
  if (Array.isArray(doc.history)) {
    doc.history.forEach((h, i) => {
      if (!isObj(h)) return err(`history[${i}] must be an object`);
      for (const k of ['at', 'task', 'from', 'to', 'by']) if (!isStr(h[k])) err(`history[${i}].${k} must be a string`);
      if (!isStr(h.task)) return;
      future(h.at, `history[${i}].at`);
      if (h.by === MIGRATION) {
        if (sawWriter) err(`history[${i}]: a "migration" entry after writer entries (migration only creates a file; forged?)`);
        if (doc.approximate !== true) err(`history[${i}]: a "migration" entry requires "approximate": true`);
      } else {
        sawWriter = true;
        if (!ROLES.includes(h.by)) err(`history[${i}].by "${h.by}" is not a known role`);
      }
      if (h.task === '*') { lastStar = h; return; }
      if (h.to === 'verified' && !VERIFY_ROLES.includes(h.by) && h.by !== MIGRATION) err(`history[${i}]: ${h.by} may not set ${h.task} verified (only ${VERIFY_ROLES.join(' or ')})`);
      if (h.from === 'verified' && h.to !== 'verified' && !(isStr(h.note) && h.note.trim())) err(`history[${i}]: ${h.task} lowered from verified without a note`);
      const prev = lastHist.has(h.task) ? lastHist.get(h.task).to : 'not-started';
      if (!sameState(h.from, prev)) err(`history[${i}]: ${h.task} moves from "${h.from}" but its previous state was "${prev}" (history edited by hand?)`);
      lastHist.set(h.task, h);
    });
  }
  if ((doc.closed === true) !== (lastStar !== null && lastStar.to === 'closed')) {
    err(doc.closed === true ? 'closed is true but no "close" history entry backs it (set by hand?)' : 'history says closed but "closed" is not true (reopened by hand?)');
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
        else future(t.updated_at, `${at}: updated_at`);
        for (const k of ['blocked_on', 'evidence', 'note']) if (t[k] != null && !isStr(t[k])) err(`${at}: ${k} must be a string or null`);
        if (t.owner != null && !isStr(t.owner)) err(`${at}: owner must be a string`);
        if (t.check !== undefined) { const ce = checkShapeError(t.check); if (ce) err(`${at}: ${ce}`); }
        if (t.status === 'blocked' && !(isStr(t.blocked_on) && t.blocked_on.trim())) err(`${at}: blocked requires blocked_on`);
        if (t.status === 'done' || t.status === 'verified') {
          if (!(isStr(t.evidence) && t.evidence.trim())) err(`${at}: ${t.status} requires evidence`);
          else if (dir && root) {
            const lh = lastHist.get(t.id);
            // The verdict check is skipped only for a migrated row, and only while the file says approximate (ST-08).
            const migrated = lh && lh.by === MIGRATION && doc.approximate === true;
            const r = checkEvidence(root, dir, movedEvidence(root, dir, t.evidence), t.status === 'verified' && !migrated ? { verdictFor: t.id } : {});
            if (!r.ok) err(`${at}: ${r.reason}`);
          }
        }
        const h = isStr(t.id) ? lastHist.get(t.id) : undefined;
        if (t.status !== 'not-started') {
          if (!h || h.to !== t.status) err(`${at}: status "${t.status}" has no matching history entry (edited without the writer?)`);
        } else if (h && !sameState(h.to, 'not-started')) err(`${at}: status "not-started" but its last history entry says "${h.to}" (reset by hand?)`);
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
      if (p.status === 'blocked' && !(isStr(p.blocked_on) && p.blocked_on.trim())) err(`pieces[${i}]: blocked requires blocked_on`);
    });
  }
  if (doc.rechecks !== undefined) {
    if (!Array.isArray(doc.rechecks)) err('rechecks must be an array');
    else doc.rechecks.forEach((r, i) => {
      if (!isObj(r)) return err(`rechecks[${i}] must be an object`);
      if (!isStr(r.task) || !r.task) err(`rechecks[${i}].task must be a non-empty string`);
      if (!isStr(r.at) || !ISO_RE.test(r.at)) err(`rechecks[${i}].at must be an ISO 8601 UTC string`);
      else future(r.at, `rechecks[${i}].at`);
      if (!RECHECK_RESULTS.includes(r.result)) err(`rechecks[${i}].result must be one of ${RECHECK_RESULTS.join(', ')}`);
      if (!isStr(r.sha) || !/^[0-9a-f]{7,64}$/.test(r.sha)) err(`rechecks[${i}].sha must be a git sha`);
      if (!isStr(r.command_sha)) err(`rechecks[${i}].command_sha must be a string`);
    });
  }
  // A task that has history but is gone from the waves was deleted by hand (the writer records "removed").
  for (const [id, h] of lastHist) if (!seen.has(id) && h.to !== 'removed') err(`task ${id} has history (last "${h.to}") but is missing from the waves (deleted by hand?)`);
  // Forbidden keys anywhere else (sessions, history, nested objects), any letter case.
  const deep = (o, where) => {
    if (Array.isArray(o)) return o.forEach((x, i) => deep(x, `${where}[${i}]`));
    if (!isObj(o)) return;
    if (!checked.has(o)) for (const k of Object.keys(o)) if (FORBIDDEN_KEYS.includes(k.toLowerCase())) err(`forbidden key "${k}" at ${where} (computed values are never stored)`);
    for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') deep(v, `${where}.${k}`);
  };
  deep(doc, '$');
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
  for (const t of tasks) if (Object.hasOwn(counts, t.status)) counts[t.status] += 1;
  const blocked_list = tasks.filter((t) => t.status === 'blocked').map((t) => ({ id: t.id, title: t.title, blocked_on: t.blocked_on }));
  const newest = opts.newestActivity !== undefined ? opts.newestActivity : (opts.dir ? newestActivity(opts.dir, doc) : null);
  const repoRoot = opts.repoRoot ?? (opts.dir ? resolveRepoRoot(opts.dir) : null);
  return {
    percent: percent(doc),
    approximate: doc.approximate === true,
    closed: doc.closed === true,
    counts,
    total: tasks.length,
    blocked_list,
    claims: tasks.filter((t) => t.status === 'verified').map((t) => claimOf(doc, t, repoRoot)),
    // R-1: what the last explicit `recheck` found. Reading the view never runs a check.
    rechecks: recheckView(doc, opts.head !== undefined ? opts.head : (opts.dir ? gitHead(opts.dir) : null)),
    stale: isStale(doc.updated_at, newest, opts.thresholdMs ?? STALE_THRESHOLD_MS),
    errors: validate(doc, { dir: opts.dir, repoRoot: opts.repoRoot }).errors,
  };
}

// D-28: `verified` is a claim by the role that wrote it, not a proof (the writer cannot authenticate --by).
// Readers show who claimed it, the verdict path, when, and a short sha256 of the verdict as read now.
export function claimOf(doc, task, repoRoot) {
  const h = Array.isArray(doc.history) ? doc.history.filter((e) => isObj(e) && e.task === task.id && e.to === 'verified').pop() : null;
  let sha = null;
  if (repoRoot && typeof task.evidence === 'string') {
    try { sha = crypto.createHash('sha256').update(fs.readFileSync(path.resolve(repoRoot, task.evidence))).digest('hex').slice(0, 12); } catch { sha = null; }
  }
  return { id: task.id, by: h ? h.by : null, at: h ? h.at : null, evidence: task.evidence ?? null, sha };
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

// ---------- check commands + re-checks (R-1) ----------
// A task's `check` is copied from the committed plan at init: { kind: 'command', command, cases?, unchecked? }
// or { kind: 'none', reason?, unchecked? }. The recheck runner always reads the command from the plan
// committed at HEAD (<impl dir>/plan.json), never from status.json; status.json carries a copy for display
// and tamper detection only.
export const CHECK_KINDS = ['command', 'none'];
export const RECHECK_RESULTS = ['pass', 'fail', 'timeout'];
export const PLAN_FILE = 'plan.json';
export const RECHECK_KEEP_PER_TASK = 10;

// Returns null when ok, or a reason string.
export function checkShapeError(c) {
  if (!isObj(c)) return 'check must be an object';
  if (!CHECK_KINDS.includes(c.kind)) return `check.kind must be one of ${CHECK_KINDS.join(', ')}`;
  if (c.kind === 'command' && !(isStr(c.command) && c.command.trim())) return 'check.kind "command" needs a non-empty command string';
  if (c.kind === 'none' && c.command !== undefined && c.command !== null) return 'check.kind "none" may not carry a command';
  if (c.cases !== undefined && !(Array.isArray(c.cases) && c.cases.every(isStr))) return 'check.cases must be an array of strings';
  if (c.unchecked !== undefined && !Array.isArray(c.unchecked)) return 'check.unchecked must be an array';
  if (c.reason !== undefined && c.reason !== null && !isStr(c.reason)) return 'check.reason must be a string';
  return null;
}

// The only fields carried into status.json from a plan task's check.
export function normalizeCheck(c) {
  if (c === undefined || c === null) return undefined;
  const out = { kind: c.kind };
  if (c.kind === 'command') out.command = c.command;
  if (Array.isArray(c.cases)) out.cases = [...c.cases];
  if (Array.isArray(c.unchecked)) out.unchecked = c.unchecked.map((u) => (isObj(u) ? { case: String(u.case ?? ''), reason: String(u.reason ?? '') } : { case: String(u), reason: '' }));
  if (isStr(c.reason)) out.reason = c.reason;
  return out;
}

export const sameCheck = (a, b) => JSON.stringify(normalizeCheck(a) ?? null) === JSON.stringify(normalizeCheck(b) ?? null);
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function gitHead(dir) {
  try { return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString().trim() || null; } catch { return null; }
}

// Latest recheck entry per task (array order is append order).
export function latestRechecks(doc) {
  const m = new Map();
  if (isObj(doc) && Array.isArray(doc.rechecks)) for (const r of doc.rechecks) if (isObj(r) && isStr(r.task)) m.set(r.task, r);
  return m;
}

// View of the re-checks: never runs anything. `head` is the current git sha (or null).
export function recheckView(doc, head) {
  const tasks = allTasks(doc);
  const latest = latestRechecks(doc);
  const byTask = [];
  for (const t of tasks) {
    const r = latest.get(t.id);
    if (!r) continue;
    byTask.push({ id: t.id, status: t.status, result: r.result, exit: r.exit ?? null, sha: r.sha ?? null, at: r.at ?? null, dirty: r.dirty === true, at_head: !!head && r.sha === head });
  }
  const verifiedIds = new Set(tasks.filter((t) => t.status === 'verified').map((t) => t.id));
  const passed = (id) => latest.get(id)?.result === 'pass';
  return {
    head: head ?? null,
    rechecked: [...verifiedIds].filter(passed).length,
    failed: byTask.filter((b) => b.result !== 'pass').map((b) => b.id),
    by_task: byTask,
    unchecked: tasks.filter((t) => isObj(t.check) && t.check.kind === 'none').map((t) => ({ id: t.id, reason: t.check.reason ?? null })),
    has_checks: tasks.some((t) => isObj(t.check)),
  };
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
        let seenText = null;
        try { seenText = fs.readFileSync(lock, 'utf8'); const pid = parseInt(seenText, 10); if (pid > 0) { try { process.kill(pid, 0); } catch (k) { dead = k.code === 'ESRCH'; } } } catch { /* unreadable */ }
        if (age > staleMs || dead) {
          // Reclaim by rename, then confirm we moved the lock we judged stale. If another writer re-took the
          // lock in between, put its lock back instead of deleting it (ST-08: no unlink of a fresh lock).
          process.stderr.write(`status-write: reclaiming stale/dead-holder lock ${lock}\n`);
          const grave = `${lock}.${process.pid}.${Date.now()}.stale`;
          try { fs.renameSync(lock, grave); } catch { continue; }
          let movedText = null;
          try { movedText = fs.readFileSync(grave, 'utf8'); } catch { /* gone */ }
          if (seenText !== null && movedText !== seenText) { try { fs.linkSync(grave, lock); } catch { /* a third writer holds it */ } }
          try { fs.unlinkSync(grave); } catch { /* gone */ }
          continue;
        }
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
  // Never write through a planted file or symlink at the tmp path (ST-08): remove it, then create exclusively.
  try { fs.unlinkSync(tmp); } catch { /* absent */ }
  const fd = fs.openSync(tmp, 'wx');
  try { fs.writeSync(fd, JSON.stringify(doc, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (process.env.STATUS_WRITE_TEST_CRASH === 'after-tmp') process.exit(137); // test-only hook (AT-14)
  fs.renameSync(tmp, file);
  try { const dfd = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); } } catch { /* best effort */ }
}
