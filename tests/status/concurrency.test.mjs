import test from 'node:test';
import assert from 'node:assert/strict';
import { mkImpl, runAsync } from './_helpers.mjs';

test('AT-13 / T-B-14 concurrent writers: valid file, every change present (10 rounds x 3 processes)', async () => {
  for (let round = 0; round < 10; round++) {
    const s = mkImpl({ tasks: ['A', 'B', 'C', 'D', 'E', 'F'] });
    const job = async (ids, owner) => {
      for (const id of ids) {
        const r = await runAsync(['set', id, '--status', 'in-progress', '--owner', owner, '--by', 'build-it', '--file', s.file]);
        assert.equal(r.code, 0, `round ${round} ${id}: ${r.err}`);
      }
    };
    await Promise.all([job(['A', 'B'], 'p1'), job(['C', 'D'], 'p2'), job(['E', 'F'], 'p3')]);
    const doc = s.read();
    for (const [id, owner] of [['A', 'p1'], ['B', 'p1'], ['C', 'p2'], ['D', 'p2'], ['E', 'p3'], ['F', 'p3']]) {
      assert.equal(s.task(id).status, 'in-progress', `${id} present`);
      assert.equal(s.task(id).owner, owner);
    }
    assert.equal(doc.history.length, 6);
    assert.equal(s.w(['validate']).code, 0);
    assert.deepEqual(s.residue(), []);
  }
});
