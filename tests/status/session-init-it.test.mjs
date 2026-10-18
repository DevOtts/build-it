// init-it support in status-write: `session add --create` and role update on re-registration.
// Authored by DevOtts (https://github.com/DevOtts).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkRepo, mkImpl, run } from './_helpers.mjs';

const add = (file, extra = []) => run(['session', 'add', '--session-id', 'S1', '--alias', 'a', '--name', 'n', '--role', 'build', '--by', 'init-it', '--file', file, ...extra]);

test('session add --create makes a minimal valid board flagged created_by init-it', () => {
  const root = mkRepo();
  const dir = path.join(root, 'docs', 'implementations', 'alpha');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'status.json');
  assert.equal(add(file, ['--create']).code, 0);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(doc.schema, 1);
  assert.equal(doc.implementation, 'alpha');
  assert.equal(doc.created_by, 'init-it');
  assert.deepEqual(doc.waves, []);
  assert.equal(doc.sessions.length, 1);
  assert.equal(run(['validate', '--file', file]).code, 0);
});

test('session add without --create still refuses a missing file', () => {
  const root = mkRepo();
  const file = path.join(root, 'docs', 'implementations', 'beta', 'status.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = add(file);
  assert.equal(r.code, 1);
  assert.equal(fs.existsSync(file), false);
});

test('session add on an existing id with another role updates the role, keeps started_at, no duplicate', () => {
  const s = mkImpl();
  assert.equal(add(s.file).code, 0);
  const first = s.read().sessions[0];
  assert.equal(run(['session', 'add', '--session-id', 'S1', '--alias', 'a', '--name', 'n', '--role', 'review', '--by', 'init-it', '--file', s.file]).code, 0);
  const doc = s.read();
  assert.equal(doc.sessions.length, 1);
  assert.equal(doc.sessions[0].role, 'review');
  assert.equal(doc.sessions[0].started_at, first.started_at);
});

test('--create is only reachable through session add, which only init-it may call', () => {
  const root = mkRepo();
  const file = path.join(root, 'docs', 'implementations', 'gamma', 'status.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = run(['session', 'add', '--session-id', 'S1', '--alias', 'a', '--name', 'n', '--role', 'build', '--by', 'build-it', '--create', '--file', file]);
  assert.equal(r.code, 1);
  assert.equal(fs.existsSync(file), false);
});
