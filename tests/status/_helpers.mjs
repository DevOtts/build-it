import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plugins/build-it/scripts/status');
export const WRITE = path.join(SCRIPTS, 'status-write.mjs');
export const LIB = path.join(SCRIPTS, 'status-lib.mjs');

export function mkRepo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'st-')));
  fs.mkdirSync(path.join(root, '.git'));
  return root;
}

export function cliEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.DOIT_STATUS_FILE;
  if (!('STATUS_WRITE_TEST_CRASH' in extra)) delete env.STATUS_WRITE_TEST_CRASH;
  return env;
}

export function run(args, env = {}) {
  const r = spawnSync(process.execPath, [WRITE, ...args], { encoding: 'utf8', env: cliEnv(env) });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

export function runAsync(args, env = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [WRITE, ...args], { env: cliEnv(env) });
    let err = '';
    c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => resolve({ code, err }));
  });
}

// Creates <root>/docs/implementations/demo with a status.json initialised via the writer.
export function mkImpl({ tasks = ['T-1', 'T-2', 'T-3'], name = 'demo' } = {}) {
  const root = mkRepo();
  const dir = path.join(root, 'docs', 'implementations', name);
  fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true });
  const file = path.join(dir, 'status.json');
  const plan = {
    implementation: name, title: 'Demo',
    waves: [{ id: 'W1', title: 'Wave one', tasks: tasks.map((id) => ({ id, title: `Task ${id}` })) }],
    pieces: [{ piece: 'Core', whats_left: 'Everything' }],
  };
  const planFile = path.join(root, 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify(plan));
  const r = run(['init', '--file', file, '--plan', planFile, '--by', 'plan-it']);
  if (r.code !== 0) throw new Error(`init failed: ${r.err}`);
  const ev = (rel, text = 'test output: all green\n') => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return path.relative(root, p); };
  const w = (args) => run([...args, '--file', file]);
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const bytes = () => fs.readFileSync(file);
  const task = (id) => read().waves.flatMap((x) => x.tasks).find((t) => t.id === id);
  const residue = () => fs.readdirSync(dir).filter((f) => f.endsWith('.lock') || f.endsWith('.tmp'));
  return { root, dir, file, planFile, ev, w, read, bytes, task, residue };
}

export function verdictText(id, verdict = 'PASS') { return `# review-it verdict\ntask: ${id}\nverdict: ${verdict}\n`; }
