// Renders the Integrity Challenge report. All values are set with textContent:
// the report contains attacker-shaped strings and planted evidence text, and
// none of it may ever be interpreted as HTML.
'use strict';

const $ = (id) => document.getElementById(id);

function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

function short(hash) {
  return typeof hash === 'string' && hash.length > 20 ? `${hash.slice(0, 12)}...${hash.slice(-8)}` : String(hash);
}

function verdictCell(v, label) {
  const cls = v.verdict === 'refused' ? 'verdict--refused' : v.verdict === 'allowed' ? 'verdict--allowed' : 'verdict--na';
  const word = v.verdict === 'refused' ? 'Refused' : v.verdict === 'allowed' ? (label === 'Core' && v.detail === 'executed' ? 'Executed' : 'Allowed') : 'Not applicable';
  return el('td', { attrs: { 'data-label': label } }, [
    el('span', { className: `verdict ${cls}`, text: word }),
    el('span', { className: 'reason', text: v.detail }),
  ]);
}

function row(r) {
  const tr = el('tr');
  tr.append(el('td', { className: 'entry', text: r.id, attrs: { 'data-label': 'Entry' } }));
  const attempt = el('td', { attrs: { 'data-label': 'Attempt' } }, [
    el('p', { className: 'attempt-title', text: r.title }),
    el('span', { className: 'actor', text: r.actor === 'agent' ? 'Agent tool call' : 'Human or store access' }),
    el('details', {}, [el('summary', { text: 'Show the exact call' }), el('code', { text: r.call })]),
  ]);
  tr.append(attempt);
  tr.append(verdictCell(r.gateway, 'Gateway (Cedar)'));
  tr.append(verdictCell(r.core, 'Core'));
  const result = el('td', { attrs: { 'data-label': 'Result' } }, [
    el('span', { className: `stamp stamp--${r.outcome}`, text: r.outcome === 'refused' ? 'Refused' : 'Executed' }),
  ]);
  if (r.stoppedBy) result.append(el('span', { className: 'stopped', text: `Stopped by: ${r.stoppedBy}` }));
  if (!r.asExpected) result.append(el('span', { className: 'stopped verdict--refused', text: 'Unexpected result' }));
  tr.append(result);
  return tr;
}

function group(label) {
  return el('tr', { className: 'group' }, [el('td', { text: label, attrs: { colspan: '5' } })]);
}

function render(report) {
  $('case-id').textContent = report.caseId;
  const before = $('head-before');
  const after = $('head-after');
  before.textContent = `before  #${report.before.ledgerSequence}  ${short(report.before.ledgerHead)}`;
  after.textContent = `after   #${report.after.ledgerSequence}  ${short(report.after.ledgerHead)}`;
  const changedFiles = report.before.evidence.filter((b, i) => b.sha256 !== report.after.evidence[i]?.sha256).length;
  $('evidence-summary').textContent = `${report.after.evidence.length} versions re-read and re-hashed after the run. ${changedFiles === 0 ? 'Every byte matches.' : `${changedFiles} changed.`}`;
  const stamp = $('unchanged-stamp');
  stamp.className = `stamp ${report.unchanged ? 'stamp--unchanged' : 'stamp--changed'}`;
  stamp.textContent = report.unchanged ? 'Unchanged' : 'Changed';

  const t = report.totals;
  const tally = $('tally');
  tally.replaceChildren(...[
    ['Attacks refused', `${t.refused} of ${t.attacks}`],
    ['Legitimate work executed', `${t.executed} of ${t.legitimate}`],
    ['Denials in the audit log', String(t.auditDenials)],
    ['Findings recorded', String(t.findings)],
    ['Drafts awaiting a human', String(t.drafts)],
  ].map(([k, v]) => el('div', {}, [el('dt', { text: k }), el('dd', { text: v })])));

  const body = $('rows');
  const legit = report.rows.filter((r) => r.kind === 'legitimate');
  const agentAttacks = report.rows.filter((r) => r.kind === 'attack' && r.actor === 'agent');
  const humanAttacks = report.rows.filter((r) => r.actor === 'human');
  body.replaceChildren(
    group('Legitimate audit work: must succeed'),
    ...legit.map(row),
    group('Agent attacks and prompt-injection attempts: must be refused'),
    ...agentAttacks.map(row),
    group('Attacks from outside the agent: must be refused'),
    ...humanAttacks.map(row),
  );

  $('notes').replaceChildren(...report.notes.map((n) => el('li', { text: n })));
  const ran = $('ran-at');
  ran.textContent = report.ranAt;
  ran.setAttribute('datetime', report.ranAt);
  const ok = t.asExpected === report.rows.length && report.unchanged;
  $('status').textContent = ok
    ? `Challenge complete: ${report.rows.length} entries, all as expected.`
    : `Challenge complete with ${report.rows.length - t.asExpected} unexpected result(s).`;
}

async function run() {
  const button = $('rerun');
  button.disabled = true;
  $('status').textContent = 'Running the challenge...';
  try {
    const res = await fetch('/api/challenge', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    render(await res.json());
  } catch (err) {
    $('status').textContent = `The challenge could not run: ${err.message}`;
  } finally {
    button.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('rerun').addEventListener('click', run);
  run();
});
