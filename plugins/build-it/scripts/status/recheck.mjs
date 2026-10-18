// recheck.mjs - R-1 helpers for `status-write recheck`: read the check command from the plan committed at HEAD,
// run it with a timeout in the repo root, and look up the (task, git sha, command) cache.
// Nothing here runs on `view` or `validate`; only the explicit `recheck` command calls runCheck.
// Pure ESM, zero dependencies. Authored by DevOtts (https://github.com/DevOtts).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { PLAN_FILE, sha256, normalizeCheck } from './status-lib.mjs';

export const DEFAULT_TIMEOUT_MS = 60 * 1000;
const TAIL_CHARS = 400;

const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, maxBuffer: 64 * 1024 * 1024 }).toString();

// "60s", "500ms", "2m", "90" (seconds). Returns ms or null when unparseable.
export function parseDuration(v) {
  if (v === undefined || v === null || v === '') return DEFAULT_TIMEOUT_MS;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m)?\s*$/.exec(String(v));
  if (!m) return null;
  const n = Number(m[1]);
  const ms = m[2] === 'ms' ? n : m[2] === 'm' ? n * 60000 : n * 1000;
  return ms > 0 ? Math.round(ms) : null;
}

export function gitToplevel(dir) {
  try { return fs.realpathSync(git(dir, ['rev-parse', '--show-toplevel']).trim()); } catch { return null; }
}

// The plan as committed at HEAD: { plan, rel, blob } or { error }. The working copy of plan.json is ignored on
// purpose: a check command counts only once it is in a commit.
export function readCommittedPlan(statusFile) {
  const dir = path.dirname(path.resolve(statusFile));
  const root = gitToplevel(dir);
  if (!root) return { error: `not inside a git repository: ${dir}` };
  let head;
  try { head = git(root, ['rev-parse', 'HEAD']).trim(); } catch { return { error: 'the repository has no commit yet (HEAD)' }; }
  const rel = path.relative(root, path.join(fs.realpathSync(dir), PLAN_FILE)).split(path.sep).join('/');
  let text; let blob;
  try {
    text = git(root, ['show', `HEAD:${rel}`]);
    blob = git(root, ['rev-parse', `HEAD:${rel}`]).trim();
  } catch { return { error: `${rel} is not committed at HEAD (check commands come only from the committed plan)`, root, head, rel }; }
  let plan;
  try { plan = JSON.parse(text); } catch (e) { return { error: `${rel} at HEAD is not valid JSON: ${e.message}`, root, head, rel }; }
  let workingDiffers = false;
  try { workingDiffers = fs.readFileSync(path.join(root, rel), 'utf8') !== text; } catch { workingDiffers = true; }
  return { plan, rel, blob, root, head, workingDiffers };
}

// Map task id -> normalized check (undefined when the plan task has no check field).
export function planChecks(plan) {
  const m = new Map();
  for (const w of (plan && Array.isArray(plan.waves) ? plan.waves : [])) {
    for (const t of (Array.isArray(w.tasks) ? w.tasks : [])) if (t && typeof t.id === 'string') m.set(t.id, normalizeCheck(t.check));
  }
  return m;
}

// Tracked changes outside the status files themselves. A dirty tree means the result does not describe the sha,
// so it is recorded with dirty: true and never served from the cache.
export function treeDirty(root, statusFile) {
  const dir = path.dirname(fs.realpathSync(statusFile));
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  const ex = [path.join(dir, 'status.json'), path.join(dir, 'STATUS.md'), path.join(dir, 'delivery', 'STATUS.md')].map((p) => `:(exclude)${rel(p)}`);
  try { return git(root, ['status', '--porcelain', '--untracked-files=no', '--', '.', ...ex]).trim() !== ''; } catch { return true; }
}

export const commandSha = (command) => sha256(String(command)).slice(0, 16);

// Latest entry with the same (task, sha, command) that may be reused: clean tree, and not a timeout
// (a timeout depends on --timeout and load, so it is always re-run).
export function findCached(doc, task, sha, cmdSha) {
  const list = Array.isArray(doc?.rechecks) ? doc.rechecks : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    if (r && r.task === task && r.sha === sha && r.command_sha === cmdSha && r.dirty !== true && r.result !== 'timeout') return r;
  }
  return null;
}

// Runs one check command through the shell in cwd. Kills the whole process group on timeout.
export function runCheck(command, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS, env = process.env } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const posix = process.platform !== 'win32';
    let child;
    try {
      child = spawn(command, { cwd, shell: true, detached: posix, stdio: ['ignore', 'pipe', 'pipe'], env });
    } catch (e) {
      resolve({ exit: null, signal: null, timed_out: false, stdout_sha: sha256('').slice(0, 16), duration_ms: 0, tail: `spawn failed: ${e.message}` });
      return;
    }
    const out = []; let tail = '';
    const keep = (d) => { tail = (tail + d.toString()).slice(-TAIL_CHARS); };
    child.stdout.on('data', (d) => { out.push(d); keep(d); });
    child.stderr.on('data', keep);
    let timedOut = false;
    const kill = () => {
      try { if (posix) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    let settled = false;
    const done = (code, signal, errMsg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (posix && !timedOut) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already gone */ } }
      resolve({
        exit: typeof code === 'number' ? code : null, signal: signal ?? null, timed_out: timedOut,
        stdout_sha: sha256(Buffer.concat(out)).slice(0, 16), duration_ms: Date.now() - started,
        tail: errMsg ? `${tail}\n${errMsg}`.slice(-TAIL_CHARS) : tail,
      });
    };
    child.on('error', (e) => done(null, null, `spawn error: ${e.message}`));
    child.on('close', (code, signal) => done(code, signal));
  });
}

export const resultOf = (r) => (r.timed_out ? 'timeout' : r.exit === 0 ? 'pass' : 'fail');
