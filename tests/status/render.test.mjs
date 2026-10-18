// ST-06 — renderStatusMd tests. Doc and view are built by hand (no status-lib import).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStatusMd, RENDER_MARKER } from '../../plugins/build-it/scripts/status/status-render.mjs';

const MARKER = '<!-- generated from status.json by status-write; do not edit by hand -->';

function makeDoc(overrides = {}) {
  return {
    schema: 1,
    implementation: 'demo-impl',
    title: 'Demo implementation',
    updated_at: '2026-10-15T14:02:11Z',
    approximate: false,
    closed: false,
    waves: [
      {
        id: 'W1',
        title: 'Writer',
        tasks: [
          { id: 'ST-01', title: 'Schema', status: 'verified', blocked_on: null,
            evidence: '.taskstate/results/ST-01.md', owner: 'build-it:sonnet',
            updated_at: '2026-10-15T13:40:00Z', note: null },
          { id: 'ST-03', title: 'Hook point', status: 'blocked', blocked_on: 'owner: Fernando decides',
            evidence: null, owner: 'Fernando', updated_at: '2026-10-15T13:55:00Z', note: null },
        ],
      },
    ],
    sessions: [
      { session_id: 'sess-1', alias: 'claudeanm', name: 'harness-status-build', role: 'build',
        started_at: '2026-10-15T12:10:00Z', ended_at: null },
    ],
    pieces: [
      { piece: 'Shared writer', status: 'verified', blocked_on: null, whats_left: 'Nothing' },
      { piece: 'build-it hook', status: 'blocked', blocked_on: 'owner decision', whats_left: 'Wire the writer' },
    ],
    history: [
      { at: '2026-10-15T13:40:00Z', task: 'ST-01', from: 'done', to: 'verified', by: 'review-it', note: null },
    ],
    ...overrides,
  };
}

function makeView(overrides = {}) {
  return {
    percent: 50,
    approximate: false,
    closed: false,
    counts: { 'not-started': 0, 'in-progress': 0, blocked: 1, done: 0, verified: 1 },
    total: 2,
    blocked_list: [{ id: 'ST-03', title: 'Hook point', blocked_on: 'owner: Fernando decides' }],
    stale: false,
    ...overrides,
  };
}

const lines = (s) => s.split('\n');

test('ST-06 marker is line 1 and equals RENDER_MARKER', () => {
  const out = renderStatusMd(makeDoc(), makeView());
  assert.equal(RENDER_MARKER, MARKER);
  assert.equal(lines(out)[0], MARKER);
});

test('ST-06 title heading uses title, falls back to implementation', () => {
  assert.ok(lines(renderStatusMd(makeDoc(), makeView())).includes('# Demo implementation — status'));
  const noTitle = makeDoc({ title: undefined });
  assert.ok(lines(renderStatusMd(noTitle, makeView())).includes('# demo-impl — status'));
});

test('ST-06 percent and counts lines match the view', () => {
  const out = lines(renderStatusMd(makeDoc(), makeView({ percent: 62 })));
  assert.ok(out.includes('Progress: 62%'));
  assert.ok(out.includes('Tasks: 2 · verified 1 (claims) · done 0 · in-progress 0 · blocked 1 · not-started 0'));
  assert.ok(out.includes('Updated: 2026-10-15T14:02:11Z'));
});

test('ST-06 renders percent from view and never recomputes it', () => {
  // Counts would give 50 if computed; the view says 37, so the render must print 37.
  const out = renderStatusMd(makeDoc(), makeView({ percent: 37 }));
  assert.ok(out.includes('Progress: 37%'));
  assert.ok(!out.includes('Progress: 50%'));
});

test('ST-06 approximate suffix appears only when view.approximate', () => {
  const approx = lines(renderStatusMd(makeDoc(), makeView({ approximate: true })));
  assert.ok(approx.includes('Progress: 50% (approximate)'));
  const exact = lines(renderStatusMd(makeDoc(), makeView({ approximate: false })));
  assert.ok(exact.includes('Progress: 50%'));
});

test('ST-06 unknown percent renders Progress: unknown', () => {
  const out = lines(renderStatusMd(makeDoc({ waves: [] }), makeView({
    percent: 'unknown', total: 0,
    counts: { 'not-started': 0, 'in-progress': 0, blocked: 0, done: 0, verified: 0 }, blocked_list: [],
  })));
  assert.ok(out.includes('Progress: unknown'));
  assert.ok(!out.some((l) => l.startsWith('Progress: 0%') || l.startsWith('Progress: 100%')));
});

test('ST-06 Closed line appears only when view.closed', () => {
  assert.ok(lines(renderStatusMd(makeDoc(), makeView({ closed: true }))).includes('Closed: yes'));
  assert.ok(!lines(renderStatusMd(makeDoc(), makeView({ closed: false }))).includes('Closed: yes'));
});

test('ST-06 blocked section lists blocked_on', () => {
  const out = renderStatusMd(makeDoc(), makeView());
  assert.match(out, /## Blocked\n\n- ST-03 Hook point — blocked on: owner: Fernando decides/);
});

test('ST-06 blocked section says None when nothing is blocked', () => {
  const out = renderStatusMd(makeDoc(), makeView({ blocked_list: [] }));
  assert.match(out, /## Blocked\n\nNone/);
});

test('ST-06 pipe characters in cells are escaped', () => {
  const doc = makeDoc({
    pieces: [{ piece: 'A | B', status: 'done', blocked_on: null, whats_left: 'x | y' }],
  });
  const out = renderStatusMd(doc, makeView());
  assert.ok(out.includes('| A \\| B | done | — | x \\| y |'));
});

test('ST-06 newlines in cells are flattened to spaces', () => {
  const doc = makeDoc({
    pieces: [{ piece: 'Line one\nLine two', status: 'done', blocked_on: null, whats_left: 'Nothing' }],
  });
  const out = renderStatusMd(doc, makeView());
  assert.ok(out.includes('| Line one Line two | done | — | Nothing |'));
});

test('ST-06 task with evidence shows the path in backticks; without shows dash', () => {
  const out = renderStatusMd(makeDoc(), makeView());
  assert.ok(out.includes('| ST-01 | Schema | verified | `.taskstate/results/ST-01.md` | build-it:sonnet | 2026-10-15T13:40:00Z |'));
  assert.ok(out.includes('| ST-03 | Hook point | blocked | — | Fernando | 2026-10-15T13:55:00Z |'));
});

test('ST-06 wave heading and per-wave table are rendered', () => {
  const out = lines(renderStatusMd(makeDoc(), makeView()));
  assert.ok(out.includes('## W1 Writer'));
  assert.ok(out.includes('| Task | Title | Status | Evidence | Owner | Updated |'));
});

test('ST-06 empty waves, pieces, sessions and history render None without crashing', () => {
  const doc = makeDoc({ waves: [], pieces: [], sessions: [], history: [] });
  const view = makeView({
    percent: 'unknown', total: 0, blocked_list: [],
    counts: { 'not-started': 0, 'in-progress': 0, blocked: 0, done: 0, verified: 0 },
  });
  let out;
  assert.doesNotThrow(() => { out = renderStatusMd(doc, view); });
  const text = out;
  assert.match(text, /## Pieces\n\nNone/);
  assert.match(text, /## Waves\n\nNone/);
  assert.match(text, /## Sessions\n\nNone/);
  assert.match(text, /## History \(latest 20\)\n\nNone/);
  assert.match(text, /## Blocked\n\nNone/);
});

test('ST-06 empty tasks in a wave render None', () => {
  const doc = makeDoc({ waves: [{ id: 'W2', title: 'Empty', tasks: [] }] });
  const out = renderStatusMd(doc, makeView());
  assert.match(out, /## W2 Empty\n\nNone/);
});

test('ST-06 sessions table renders when present', () => {
  const out = renderStatusMd(makeDoc(), makeView());
  assert.ok(out.includes('| Session | Alias | Name | Role | Started | Ended |'));
  assert.ok(out.includes('| sess-1 | claudeanm | harness-status-build | build | 2026-10-15T12:10:00Z | — |'));
});

test('ST-06 history lists newest first with note', () => {
  const doc = makeDoc({
    history: [
      { at: '2026-10-15T13:00:00Z', task: 'ST-01', from: 'not-started', to: 'in-progress', by: 'build-it', note: null },
      { at: '2026-10-15T14:00:00Z', task: 'ST-01', from: 'done', to: 'in-progress', by: 'review-it', note: 'failed case 3' },
    ],
  });
  const out = lines(renderStatusMd(doc, makeView()));
  const i = out.indexOf('- 2026-10-15T14:00:00Z ST-01: done → in-progress by review-it — failed case 3');
  const j = out.indexOf('- 2026-10-15T13:00:00Z ST-01: not-started → in-progress by build-it');
  assert.ok(i >= 0 && j >= 0 && i < j, 'newest entry must come first');
});

test('ST-06 history keeps only the latest 20 entries', () => {
  const history = Array.from({ length: 25 }, (_, n) => ({
    at: `2026-10-15T00:${String(n).padStart(2, '0')}:00Z`, task: `T${n}`, from: 'not-started', to: 'in-progress', by: 'build-it', note: null,
  }));
  const out = renderStatusMd(makeDoc({ history }), makeView());
  assert.ok(out.includes('T24:'));
  assert.ok(out.includes('T5:'));
  assert.ok(!out.includes('T4:'));
});

test('ST-06 output is identical across two calls', () => {
  const a = renderStatusMd(makeDoc(), makeView({ percent: 62, approximate: true }));
  const b = renderStatusMd(makeDoc(), makeView({ percent: 62, approximate: true }));
  assert.equal(a, b);
});
