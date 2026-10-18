// D-28: `verified` is shown as a claim with its provenance (who, verdict path, when, sha), never as proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { mkImpl, verdictText } from './_helpers.mjs';

function verifiedImpl() {
  const im = mkImpl({ tasks: ['T-1', 'T-2'] });
  assert.equal(im.w(['set', 'T-1', '--status', 'done', '--evidence', im.ev('evidence/T-1.md'), '--by', 'build-it']).code, 0);
  const verdict = im.ev('evidence/T-1.verdict.md', verdictText('T-1'));
  const r = im.w(['set', 'T-1', '--status', 'verified', '--evidence', verdict, '--by', 'review-it']);
  assert.equal(r.code, 0, r.err);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(im.root, verdict))).digest('hex').slice(0, 12);
  return { im, verdict, sha };
}

test('D-28 view labels verified as claims and shows provenance', () => {
  const { im, verdict, sha } = verifiedImpl();
  const r = im.w(['view']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /verified 1 \(claims\)/);
  const at = im.read().history.filter((e) => e.task === 'T-1' && e.to === 'verified').pop().at;
  assert.ok(r.out.includes(`claimed by review-it: T-1 · verdict ${verdict} · at ${at} · sha ${sha}`), r.out);
  const j = JSON.parse(im.w(['view', '--json']).out);
  assert.deepEqual(j.claims, [{ id: 'T-1', by: 'review-it', at, evidence: verdict, sha }]);
});

test('D-28 rendered STATUS.md has a Verified claims section with provenance', () => {
  const { im, verdict, sha } = verifiedImpl();
  const md = fs.readFileSync(path.join(im.dir, 'STATUS.md'), 'utf8');
  assert.match(md, /verified 1 \(claims\)/);
  assert.match(md, /## Verified claims/);
  assert.ok(md.includes(`- T-1 claimed by review-it · verdict \`${verdict}\``), md);
  assert.ok(md.includes(`sha ${sha}`));
});

test('D-28 a verdict edited after the claim shows a different sha', () => {
  const { im, verdict, sha } = verifiedImpl();
  fs.appendFileSync(path.join(im.root, verdict), 'edited later\n');
  const j = JSON.parse(im.w(['view', '--json']).out);
  assert.notEqual(j.claims[0].sha, sha);
});

test('D-28 no verified tasks gives no claims', () => {
  const im = mkImpl();
  const j = JSON.parse(im.w(['view', '--json']).out);
  assert.deepEqual(j.claims, []);
});
