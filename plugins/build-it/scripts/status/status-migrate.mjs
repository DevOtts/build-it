#!/usr/bin/env node
// status-migrate: one-time STATUS.md -> status.json (schema 1) migration (ST-07, D-14).
// Zero-dep ESM. Never overwrites an existing status.json. Output is marked approximate.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STATUS_RANK = ['not-started', 'in-progress', 'done', 'verified'];

// ---------- markdown helpers ----------
const stripMd = (s) =>
  String(s ?? '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '`') inCode = !inCode;
    if (c === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const isSeparator = (cells) => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')) || c === '');

export function parseTables(text) {
  const lines = String(text).split(/\r?\n/);
  const tables = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\|/.test(l)) {
      const cells = splitRow(l);
      if (!cur) { cur = { header: cells, rows: [], line: i + 1, heading: null }; }
      else if (cur.rows.length === 0 && !cur.sepSeen && isSeparator(cells)) { cur.sepSeen = true; }
      else cur.rows.push({ cells, line: i + 1 });
    } else if (cur) { tables.push(cur); cur = null; }
  }
  if (cur) tables.push(cur);
  return tables.filter((t) => t.sepSeen);
}

const norm = (h) => stripMd(h).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function mapColumns(header) {
  const names = header.map(norm);
  const find = (cands) => { for (const c of cands) { const i = names.indexOf(c); if (i >= 0) return i; } return -1; };
  return {
    id: find(['eid', 'id', 'task id', 'key', 'card', 'card id']),
    title: find(['epic', 'task', 'title', 'name', 'summary', 'description']),
    wave: find(['wave', 'phase']),
    status: find(['status', 'state']),
    disposition: find(['disposition', 'notes', 'note']),
    squad: find(['squad', 'owner', 'assignee']),
    tests: find(['tests green total', 'tests', 'cases']),
  };
}

export function mapStatus(raw) {
  const up = stripMd(raw).toUpperCase();
  const m = up.match(/(?<![A-Z-])(IMPLEMENTED[-_ ]NOT[-_ ]VERIFIED|NOT[-_ ]STARTED|IN[-_ ]PROGRESS|VERIFIED)(?![A-Z]|-[A-Z])/);
  if (!m) return null;
  return { 'IMPLEMENTED-NOT-VERIFIED': 'done', 'NOT-STARTED': 'not-started', 'IN-PROGRESS': 'in-progress', VERIFIED: 'verified' }[m[1].replace(/[_ ]/g, '-')];
}

export function waveId(raw) {
  const t = stripMd(raw);
  const m = t.match(/\bW(?:ave)?\s*-?\s*(\d+)\b/i) || t.match(/^(\d+)$/);
  return m ? `W${m[1]}` : 'W1';
}

// ---------- evidence ----------
function underDir(child, parent) {
  const r = path.relative(parent, child);
  return r !== '' && !r.startsWith('..') && !path.isAbsolute(r);
}

function pathCandidates(text) {
  const out = [];
  const re = /(?<![\w./*~-])((?:\.?[A-Za-z0-9_@-][A-Za-z0-9_.@-]*\/|\.\/)*\.?[A-Za-z0-9_@-][A-Za-z0-9_.@-]*\.[A-Za-z0-9]{1,6})(?![\w*/-])/g;
  let m;
  const plain = String(text).replace(/`/g, ' ');
  while ((m = re.exec(plain))) {
    const tok = m[1];
    const before = plain.slice(Math.max(0, m.index - 6), m.index);
    out.push({ tok, pri: /log\s*$/i.test(before) ? 0 : /(live|run)\s*:\s*$/i.test(plain.slice(Math.max(0, m.index - 10), m.index)) ? 1 : 2, pos: m.index });
  }
  // dedupe, priority then position
  const seen = new Set();
  return out.sort((a, b) => a.pri - b.pri || a.pos - b.pos).filter((c) => !seen.has(c.tok) && seen.add(c.tok)).map((c) => c.tok);
}

export function resolveEvidence(text, { repoRoot, implDir }) {
  if (!repoRoot) return null;
  let rootReal;
  try { rootReal = fs.realpathSync(repoRoot); } catch { return null; }
  const implReal = implDir ? safeReal(implDir) : null;
  for (const tok of pathCandidates(text)) {
    if (path.isAbsolute(tok) || tok.split('/').includes('..')) continue;
    for (const base of [repoRoot, implDir].filter(Boolean)) {
      const abs = path.join(base, tok);
      let real;
      try {
        const st = fs.statSync(abs);
        if (!st.isFile() || st.size === 0) continue;
        real = fs.realpathSync(abs);
      } catch { continue; }
      if (!underDir(real, rootReal)) continue;
      const rel = path.relative(rootReal, real).split(path.sep).join('/');
      const bn = path.basename(rel);
      if (['status.json', 'status.json.tmp', 'status.json.lock', 'status.md', 'status.md.tmp'].includes(bn.toLowerCase())) continue;
      const ok = (implReal && underDir(real, implReal)) || rel.split('/').includes('.taskstate');
      if (!ok) continue;
      try { if (!/\S/.test(fs.readFileSync(real).toString('latin1'))) continue; } catch { continue; }
      return rel;
    }
  }
  return null;
}
function safeReal(p) { try { return fs.realpathSync(p); } catch { return null; } }

// ---------- migrate ----------
const iso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

export function migrate(markdownText, { implementation, title, repoRoot, implDir } = {}) {
  const now = iso();
  const tables = parseTables(markdownText);
  const report = { tasksFound: 0, counts: {}, preDowngradeCounts: {}, downgrades: [], unparsed: [], notes: [], mainTableLine: null };
  let main = null, cols = null;
  for (const t of tables) {
    const c = mapColumns(t.header);
    if (c.id >= 0 && c.status >= 0) { main = t; cols = c; break; }
  }
  const residuals = {};
  for (const t of tables) {
    if (t === main) continue;
    const names = t.header.map(norm);
    if (names.includes('item')) {
      for (const r of t.rows) residuals[stripMd(r.cells[0] ?? '')] = r.cells.join(' | ');
    }
  }
  const h1 = String(markdownText).match(/^#\s+(.+)$/m);
  const finalTitle = title || (h1 ? stripMd(h1[1]).replace(/^status\s*:\s*/i, '') : implementation) || implementation;
  const doc = {
    schema: 1, implementation, title: finalTitle, updated_at: now, approximate: true, closed: false,
    waves: [], sessions: [], pieces: [], history: [],
  };
  if (!main) {
    report.notes.push('no status table found (needs ID and Status columns)');
    return { doc, report };
  }
  report.mainTableLine = main.line;
  const waveMap = new Map();
  const seenIds = new Set();
  const cell = (cells, i) => (i >= 0 && i < cells.length ? cells[i] : '');
  for (const row of main.rows) {
    const cells = row.cells;
    const id = stripMd(cell(cells, cols.id)).replace(/\s+/g, '');
    if (!id || seenIds.has(id)) {
      report.unparsed.push({ line: row.line, reason: id ? `duplicate id ${id}` : 'missing id', row: cells.join(' | ').slice(0, 120) });
      continue;
    }
    seenIds.add(id);
    let status = mapStatus(cell(cells, cols.status));
    if (!status) {
      report.unparsed.push({ line: row.line, id, reason: `unknown status "${stripMd(cell(cells, cols.status))}"`, row: cells.join(' | ').slice(0, 120) });
      status = 'not-started';
    }
    const dispRaw = cell(cells, cols.disposition);
    const dispClean = stripMd(dispRaw);
    const rowTitle = stripMd(cell(cells, cols.title)) || id;
    const squad = stripMd(cell(cells, cols.squad));
    let blockedOn = null;
    if (/^owner-gated/i.test(dispClean)) {
      status = 'blocked';
      blockedOn = dispClean;
      const resKey = Object.keys(residuals).find((k) => k && (k.split(/[,\s]+/).includes(id)));
      if (/residual/i.test(dispClean) && resKey) blockedOn += ` (Residuals: ${stripMd(residuals[resKey])})`;
    }
    const preStatus = status;
    report.preDowngradeCounts[preStatus] = (report.preDowngradeCounts[preStatus] ?? 0) + 1;
    const evSource = [dispRaw, ...cells.filter((_, i) => i !== cols.disposition && i !== cols.id && i !== cols.title)].join(' ');
    let evidence = (status === 'blocked' || status === 'not-started') && !/\blog\b|run\s*:/i.test(dispRaw) ? null : resolveEvidence(evSource, { repoRoot, implDir });
    if (status === 'blocked' || status === 'not-started') evidence = null;
    const history = [];
    if (status !== 'not-started') history.push({ at: now, task: id, from: 'not-started', to: status, by: 'migration', note: 'migrated from STATUS.md' });
    let cur = status;
    if (!evidence) {
      // one step per spec; a task cannot rest on done without evidence (validator), so continue to in-progress.
      const steps = [];
      if (cur === 'verified') { steps.push(['verified', 'done']); cur = 'done'; }
      if (cur === 'done') { steps.push(['done', 'in-progress']); cur = 'in-progress'; }
      for (const [from, to] of steps) {
        history.push({ at: now, task: id, from, to, by: 'migration', note: 'no resolvable evidence: downgraded' });
      }
      if (steps.length) report.downgrades.push({ id, from: preStatus, to: cur, via: steps.length > 1 ? 'done' : null });
    }
    status = cur;
    report.counts[status] = (report.counts[status] ?? 0) + 1;
    doc.history.push(...history);
    const wid = waveId(cell(cells, cols.wave));
    if (!waveMap.has(wid)) { const w = { id: wid, title: wid, tasks: [] }; waveMap.set(wid, w); doc.waves.push(w); }
    waveMap.get(wid).tasks.push({
      id, title: rowTitle, status, blocked_on: status === 'blocked' ? blockedOn : null,
      evidence: status === 'done' || status === 'verified' || (status === 'in-progress' && evidence) ? evidence : null,
      owner: squad || null, updated_at: now, note: null,
    });
    // piece
    const paren = stripMd(cell(cells, cols.tests)).match(/\(([^)]*)\)/);
    const left = status === 'verified' ? 'Nothing'
      : status === 'blocked' ? `Waiting on: ${(blockedOn || '').replace(/^owner-gated:?\s*/i, '')}`.replace(/%/g, ' pct')
      : status === 'done' ? (paren ? paren[1] : 'Verification pending')
      : status === 'in-progress' ? (paren ? paren[1] : 'Work in progress or evidence missing')
      : 'Not started';
    let pname = rowTitle;
    if (doc.pieces.some((p) => p.piece === pname)) pname = `${rowTitle} (${id})`;
    doc.pieces.push({ piece: pname, status, blocked_on: status === 'blocked' ? blockedOn : null, whats_left: left.replace(/%/g, ' pct') });
    report.tasksFound++;
  }
  return { doc, report };
}

export function formatReport(report, { from, out } = {}) {
  const L = [];
  L.push(`status-migrate report${from ? ` (${from})` : ''}`);
  L.push(`tasks found: ${report.tasksFound}`);
  L.push(`pre-downgrade counts: ${fmt(report.preDowngradeCounts)}`);
  L.push(`final counts: ${fmt(report.counts)}`);
  L.push(`downgrades: ${report.downgrades.length}`);
  for (const d of report.downgrades) L.push(`  ${d.id}: ${d.from} -> ${d.to}${d.via ? ` (via ${d.via})` : ''}`);
  L.push(`unparsed rows: ${report.unparsed.length}`);
  for (const u of report.unparsed) L.push(`  line ${u.line}${u.id ? ` ${u.id}` : ''}: ${u.reason}`);
  for (const n of report.notes) L.push(`note: ${n}`);
  if (out) L.push(`wrote: ${out} (approximate: true)`);
  return L.join('\n');
}
const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' ') || 'none';

// ---------- CLI ----------
function findRepoRoot(dir) {
  let d = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const p = path.dirname(d);
    if (p === d) return path.resolve(dir);
    d = p;
  }
}

function localWriteAtomic(file, text) {
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  try { const dfd = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); } } catch { /* best effort */ }
}

async function loadLib() {
  const p = path.join(path.dirname(fileURLToPath(import.meta.url)), 'status-lib.mjs');
  if (!fs.existsSync(p)) return null;
  try { return await import(pathToFileURL(p).href); } catch { return null; }
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`unexpected argument ${k}`);
    const v = argv[++i];
    if (v === undefined) throw new Error(`missing value for ${k}`);
    a[k.slice(2)] = v;
  }
  return a;
}

export async function main(argv, io = { out: (s) => process.stdout.write(s + '\n'), err: (s) => process.stderr.write(s + '\n') }) {
  let a;
  try { a = parseArgs(argv); } catch (e) { io.err(e.message); return 2; }
  const src = a.from || a.board;
  if (!src || !a.out || !a.impl) { io.err('usage: status-migrate --from <STATUS.md> --out <status.json> --impl <name> [--title T] [--board <BOARD.md>]'); return 2; }
  const out = path.resolve(a.out);
  if (fs.existsSync(out)) { io.err('status.json already exists; migration never overwrites'); return 2; }
  if (!fs.existsSync(src)) { io.err(`source not found: ${src}`); return 2; }
  const text = fs.readFileSync(src, 'utf8');
  const implDir = path.dirname(out);
  const repoRoot = findRepoRoot(implDir);
  const { doc, report } = migrate(text, { implementation: a.impl, title: a.title, repoRoot, implDir });
  const lib = await loadLib();
  if (lib && typeof lib.validate === 'function') {
    // validate against a staged copy so evidence paths resolve relative to the real folder
    let res;
    try { res = lib.validate(doc, { dir: implDir, repoRoot }); } catch (e) { res = { errors: [`validate threw: ${e.message}`] }; }
    const errors = Array.isArray(res) ? res : res?.errors ?? [];
    if (errors.length) {
      io.err('migrated document failed validation; nothing written:');
      for (const e of errors) io.err(`  ${typeof e === 'string' ? e : JSON.stringify(e)}`);
      io.out(formatReport(report, { from: src }));
      return 1;
    }
  }
  fs.mkdirSync(implDir, { recursive: true });
  // writeAtomic(file, doc) serializes the object itself (tmp + fsync + rename).
  if (lib && typeof lib.writeAtomic === 'function') await lib.writeAtomic(out, doc);
  else localWriteAtomic(out, JSON.stringify(doc, null, 2) + '\n');
  io.out(formatReport(report, { from: src, out }));
  return 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.stack || e.message); process.exit(1); });
}
