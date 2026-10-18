// status-render.mjs — renders a human STATUS.md from a status.json document.
// Pure and zero-dependency. The view (percent, counts, blocked_list, ...) is
// computed by the caller (status-lib computeView); this module never computes a percent.

export const RENDER_MARKER = '<!-- generated from status.json by status-write; do not edit by hand -->';

const NONE = 'None';
const DASH = '—';

// Flatten a value to one line of inert text: no line breaks (incl. U+2028/2029), no control or bidi
// characters, and "<" escaped so a field cannot open an HTML comment or tag that hides later rows (ST-08).
function flat(value) {
  if (value === null || value === undefined) return DASH;
  return String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]+/g, ' ')
    .replace(/</g, '&lt;')
    .trim() || DASH;
}

// Table cell: flattened, with pipes escaped.
function cell(value) {
  return flat(value).replace(/\|/g, '\\|');
}

function evidenceCell(path) {
  if (path === null || path === undefined || path === '') return DASH;
  return '`' + flat(path).replace(/\|/g, '\\|') + '`';
}

function table(headers, rows) {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  return [head, sep, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

function section(title, body) {
  return [`## ${title}`, '', body].join('\n');
}

export function renderStatusMd(doc, view) {
  const d = doc ?? {};
  const v = view ?? {};
  const counts = v.counts ?? {};
  const c = (k) => counts[k] ?? 0;
  const waves = Array.isArray(d.waves) ? d.waves : [];
  const pieces = Array.isArray(d.pieces) ? d.pieces : [];
  const sessions = Array.isArray(d.sessions) ? d.sessions : [];
  const history = Array.isArray(d.history) ? d.history : [];
  const blockedList = Array.isArray(v.blocked_list) ? v.blocked_list : [];

  const lines = [];
  lines.push(RENDER_MARKER);
  lines.push('');
  lines.push(`# ${flat(d.title || d.implementation)} — status`);
  lines.push('');

  const progress = v.percent === 'unknown' || v.percent === undefined || v.percent === null
    ? 'unknown'
    : `${v.percent}%`;
  const errs = Array.isArray(v.errors) ? v.errors : [];
  if (errs.length) lines.push(`Progress: not trustworthy (status.json fails validation: ${errs.length} error(s); run status-write validate)`);
  else lines.push(`Progress: ${progress}${v.approximate ? ' (approximate)' : ''}`);
  lines.push(
    `Tasks: ${v.total ?? 0} · verified ${c('verified')} · done ${c('done')} · ` +
      `in-progress ${c('in-progress')} · blocked ${c('blocked')} · not-started ${c('not-started')}`,
  );
  lines.push(`Updated: ${flat(d.updated_at)}`);
  if (v.closed) lines.push('Closed: yes');
  lines.push('');

  lines.push(section(
    'Blocked',
    blockedList.length === 0
      ? NONE
      : blockedList.map((b) => `- ${flat(b.id)} ${flat(b.title)} — blocked on: ${flat(b.blocked_on)}`).join('\n'),
  ));
  lines.push('');

  lines.push(section(
    'Pieces',
    pieces.length === 0
      ? NONE
      : table(
        ['Piece', 'Status', 'Blocked on', "What's left"],
        pieces.map((p) => [cell(p.piece), cell(p.status), cell(p.blocked_on), cell(p.whats_left)]),
      ),
  ));
  lines.push('');

  if (waves.length === 0) {
    lines.push(section('Waves', NONE));
    lines.push('');
  }
  for (const w of waves) {
    const tasks = Array.isArray(w.tasks) ? w.tasks : [];
    lines.push(`## ${flat(w.id)} ${flat(w.title)}`);
    lines.push('');
    lines.push(
      tasks.length === 0
        ? NONE
        : table(
          ['Task', 'Title', 'Status', 'Evidence', 'Owner', 'Updated'],
          tasks.map((t) => [
            cell(t.id),
            cell(t.title),
            cell(t.status),
            evidenceCell(t.evidence),
            cell(t.owner),
            cell(t.updated_at),
          ]),
        ),
    );
    lines.push('');
  }

  lines.push(section(
    'Sessions',
    sessions.length === 0
      ? NONE
      : table(
        ['Session', 'Alias', 'Name', 'Role', 'Started', 'Ended'],
        sessions.map((s) => [
          cell(s.session_id), cell(s.alias), cell(s.name), cell(s.role), cell(s.started_at), cell(s.ended_at),
        ]),
      ),
  ));
  lines.push('');

  const latest = history.slice(-20).reverse();
  lines.push(section(
    'History (latest 20)',
    latest.length === 0
      ? NONE
      : latest.map((h) => {
        const note = h.note ? ` — ${flat(h.note)}` : '';
        return `- ${flat(h.at)} ${flat(h.task)}: ${flat(h.from)} → ${flat(h.to)} by ${flat(h.by)}${note}`;
      }).join('\n'),
  ));

  return lines.join('\n') + '\n';
}
