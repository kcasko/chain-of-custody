// Investigation workspace. Every value from the server is set with textContent:
// evidence text, agent drafts and findings are untrusted and must never be
// interpreted as HTML. The server and the domain core make every authorization
// decision; this page only shows what they decided.
'use strict';

const $ = (id) => document.getElementById(id);
const state = { session: null, actor: null, evidence: [], titles: {}, payloads: new Map(), lastExport: null };

function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = String(opts.text);
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  for (const c of children) if (c) node.append(c);
  return node;
}
const short = (h) => (typeof h === 'string' && h.length > 20 ? `${h.slice(0, 10)}...${h.slice(-6)}` : String(h ?? ''));
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

function store(key, value) {
  try {
    if (value === undefined) return sessionStorage.getItem(key);
    sessionStorage.setItem(key, value);
  } catch { /* storage unavailable: the page still works without it */ }
  return null;
}

async function api(method, path, body) {
  const headers = { Accept: 'application/json', 'x-coc-csrf': state.session.csrf, 'x-coc-user': state.actor };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data;
  try { data = await res.json(); } catch { data = { ok: false, code: 'BAD_RESPONSE', detail: `server returned ${res.status}` }; }
  return data;
}

function notice(result, okText) {
  const box = $('notice');
  if (result.ok) {
    box.className = 'ws-notice ws-notice--ok';
    box.replaceChildren(el('span', { className: 'stamp stamp--executed', text: 'Done' }), el('span', { text: okText }));
  } else {
    box.className = 'ws-notice ws-notice--refused';
    box.replaceChildren(el('span', { className: 'stamp stamp--refused', text: 'Refused' }), el('code', { text: result.code }), el('span', { text: result.detail ?? '' }));
  }
}

function persona() {
  return state.session.personas.find((p) => p.userId === state.actor);
}

// ---- Overview (masthead) -------------------------------------------------

async function loadCase() {
  const r = await api('GET', '/api/case');
  const stamp = $('chain-stamp');
  if (!r.ok) {
    $('ledger-head').textContent = 'not visible to this person';
    $('ledger-checkpoint').textContent = '';
    stamp.className = 'stamp stamp--refused';
    stamp.textContent = r.code;
    return false;
  }
  const v = r.value;
  state.titles = v.titles;
  $('ledger-head').textContent = `#${v.head.sequence}  ${short(v.head.hash)}`;
  $('ledger-checkpoint').textContent = v.checkpoint ? `Signed checkpoint at #${v.checkpoint.sequence}, ${when(v.checkpoint.issuedAt)}` : 'No signed checkpoint yet';
  stamp.className = `stamp ${v.chain.intact ? 'stamp--unchanged' : 'stamp--changed'}`;
  stamp.textContent = v.chain.intact ? 'Chain intact' : 'Chain broken';
  return true;
}

// ---- Evidence ---------------------------------------------------------------

// Registration order per item: the first non-derivative is the original; later
// ones are numbered so two versions never share a label.
function versionLabel(e) {
  if (e.derivedFrom) return `derivative: ${e.derivedFrom.transformation}`;
  const own = state.evidence.filter((x) => x.evidenceId === e.evidenceId && !x.derivedFrom);
  const n = own.findIndex((x) => x.versionId === e.versionId) + 1;
  return n <= 1 ? 'original' : `version ${n}, added later`;
}

async function loadEvidence() {
  const r = await api('GET', '/api/evidence');
  const body = $('evidence-rows');
  if (!r.ok) {
    state.evidence = [];
    body.replaceChildren(el('tr', {}, [el('td', { text: `Not visible: ${r.code}`, attrs: { colspan: '4' } })]));
    return;
  }
  state.evidence = r.value;
  body.replaceChildren(...r.value.map((e) => {
    const open = el('button', { className: 'ws-quiet', text: 'Read', attrs: { type: 'button', 'aria-label': `Read ${e.evidenceId} ${versionLabel(e)}` } });
    open.addEventListener('click', () => readVersion(e));
    return el('tr', {}, [
      el('td', { attrs: { 'data-label': 'Item' } }, [el('span', { className: 'entry', text: e.evidenceId }), el('span', { className: 'reason', text: state.titles[e.evidenceId] ?? '' })]),
      el('td', { attrs: { 'data-label': 'Version' } }, [el('span', { text: versionLabel(e) }), el('span', { className: 'reason', text: `${e.mediaType}, ${e.size} bytes` })]),
      el('td', { className: 'hash', text: short(e.sha256), attrs: { 'data-label': 'SHA-256', title: e.sha256 } }),
      el('td', {}, [open]),
    ]);
  }));
  renderVersionChoices();
}

let reading = null;
async function readVersion(e) {
  const r = await api('GET', `/api/evidence/read?evidenceId=${encodeURIComponent(e.evidenceId)}&versionId=${encodeURIComponent(e.versionId)}`);
  const reader = $('reader');
  reader.hidden = false;
  $('reader-title').textContent = `${e.evidenceId}: ${state.titles[e.evidenceId] ?? ''}`;
  if (!r.ok) {
    reading = null;
    $('reader-meta').replaceChildren();
    $('reader-text').textContent = '';
    notice(r);
    return;
  }
  reading = r.value;
  const v = r.value;
  const rows = [['Version', versionLabel(v)], ['Version ID', v.versionId], ['SHA-256 (re-checked on this read)', v.sha256], ['Size', `${v.size} bytes`], ['Media type', v.mediaType]];
  if (v.derivedFrom) rows.push(['Derived from', `${v.derivedFrom.versionId} by ${v.derivedFrom.transformation}`]);
  $('reader-meta').replaceChildren(...rows.flatMap(([k, val]) => [el('dt', { text: k }), el('dd', { text: val, className: k.startsWith('SHA') || k.endsWith('ID') ? 'hash' : '' })]));
  $('reader-text').textContent = v.text + (v.truncated ? '\n[truncated]' : '');
  reader.scrollIntoView({ block: 'nearest' });
}

async function submitTransfer(ev) {
  ev.preventDefault();
  if (!reading) return;
  const f = new FormData(ev.target);
  const r = await api('POST', '/api/custody/transfer', { evidenceId: reading.evidenceId, versionId: reading.versionId, from: f.get('from'), to: f.get('to'), reason: f.get('reason') });
  notice(r, r.ok ? `Transfer appended as ledger entry #${r.value.sequence}.` : '');
  if (r.ok) {
    ev.target.reset();
    await loadCase();
  }
}

// ---- Timeline -------------------------------------------------------------

function eventSummary(e) {
  const b = e.body;
  switch (e.kind) {
    case 'evidence_registered': return `Registered ${b.evidenceId} (${versionLabel(b)}, ${b.size} bytes)`;
    case 'custody_transfer': return `${b.evidenceId} moved from "${b.from}" to "${b.to}". Reason: ${b.reason}`;
    case 'historical_assertion': return `Historical claim about ${b.evidenceId}: ${b.statement ?? ''} (claimed ${b.claimedTimeRaw ?? '?'}, clock ${b.sourceClock ?? '?'}, ${b.timezone ?? '?'}, uncertainty ${b.offsetUncertainty ?? '?'})`;
    case 'correction': return `Correction to #${b.targetSequence}: ${b.reason}`;
    default: return e.kind;
  }
}

async function loadTimeline() {
  const r = await api('GET', '/api/timeline');
  const list = $('timeline');
  const report = $('chain-report');
  if (!r.ok) {
    report.replaceChildren(el('p', { text: `Not visible: ${r.code}` }));
    list.replaceChildren();
    return;
  }
  const { events, chain } = r.value;
  report.className = `ws-chain ${chain.intact ? '' : 'ws-chain--broken'}`;
  report.replaceChildren(
    el('span', { className: `stamp ${chain.intact ? 'stamp--unchanged' : 'stamp--changed'}`, text: chain.intact ? 'Intact' : 'Broken' }),
    el('span', { text: chain.intact ? `All ${chain.length} entries re-hashed and linked.` : `Problems: ${chain.problems.map((p) => `#${p.sequence} ${p.problem}`).join(', ')}` }),
  );
  const correctedBy = new Map();
  for (const e of events) if (e.kind === 'correction') correctedBy.set(e.body.targetSequence, [...(correctedBy.get(e.body.targetSequence) ?? []), e.sequence]);
  list.replaceChildren(...events.map((e) => {
    const details = el('details', {}, [el('summary', { text: 'Append a correction' })]);
    const form = el('form', { className: 'ws-form ws-form--inline' }, [
      el('label', {}, [el('span', { text: 'What was wrong' }), el('input', { attrs: { name: 'reason', required: '', maxlength: '2000', autocomplete: 'off' } })]),
      el('button', { className: 'rerun', text: `Append correction to #${e.sequence}`, attrs: { type: 'submit' } }),
    ]);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const res = await api('POST', '/api/custody/correction', { targetSequence: e.sequence, targetHash: e.eventHash, reason: new FormData(form).get('reason') });
      notice(res, res.ok ? `Correction appended as #${res.value.sequence}; #${e.sequence} is unchanged.` : '');
      if (res.ok) await Promise.all([loadCase(), loadTimeline()]);
    });
    details.append(form);
    const fixes = correctedBy.get(e.sequence);
    return el('li', { className: `ws-event ws-event--${e.kind}` }, [
      el('div', { className: 'ws-event-head' }, [
        el('span', { className: 'entry', text: `#${e.sequence}` }),
        el('span', { className: 'ws-kind', text: e.kind.replace(/_/g, ' ') }),
        el('time', { text: when(e.recordedAt), attrs: { datetime: e.recordedAt } }),
        el('span', { className: 'actor', text: `${e.actor.userId} (${e.actor.role})` }),
      ]),
      el('p', { className: 'ws-event-body', text: eventSummary(e) }),
      fixes ? el('p', { className: 'ws-corrected', text: `Corrected by #${fixes.join(', #')}. This entry is kept as recorded.` }) : null,
      el('p', { className: 'hash ws-event-hash', text: `hash ${short(e.eventHash)}  links to ${e.sequence === 1 ? 'genesis' : `#${e.sequence - 1}`} ${short(e.prevHash)}` }),
      details,
    ]);
  }));
}

// ---- Findings and drafts ------------------------------------------------------

async function loadFindings() {
  const r = await api('GET', '/api/findings');
  const list = $('findings');
  if (!r.ok) return list.replaceChildren(el('li', { text: `Not visible: ${r.code}` }));
  if (r.value.length === 0) return list.replaceChildren(el('li', { className: 'ws-empty', text: 'No findings yet.' }));
  list.replaceChildren(...r.value.map((f) => el('li', { className: 'ws-entry' }, [
    el('p', { className: 'ws-entry-head' }, [el('span', { className: 'ws-kind', text: f.findingType.replace(/_/g, ' ') }), el('span', { className: 'reason', text: `uncertainty ${f.uncertainty}` })]),
    el('p', { text: f.summary }),
    el('p', { className: 'reason', text: `Cites ${f.citedEvidenceIds.join(', ')}. Recorded by ${f.recordedBy}, ${when(f.recordedAt)}.` }),
  ])));
}

function describeInput(input) {
  return el('dl', { className: 'ws-meta ws-meta--compact' }, Object.entries(input ?? {}).flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: typeof v === 'string' ? v : JSON.stringify(v) })]));
}

async function loadDrafts() {
  const r = await api('GET', '/api/proposals');
  const list = $('drafts');
  if (!r.ok) return list.replaceChildren(el('li', { text: `Not visible: ${r.code}` }));
  if (r.value.length === 0) return list.replaceChildren(el('li', { className: 'ws-empty', text: 'No drafts. Run the agent pass to create some.' }));
  list.replaceChildren(...r.value.map((p) => {
    const promote = el('button', { className: 'rerun', text: 'Promote to the ledger', attrs: { type: 'button' } });
    promote.disabled = p.status !== 'draft';
    promote.addEventListener('click', async () => {
      const res = await api('POST', '/api/proposals/promote', { proposalId: p.proposalId });
      notice(res, res.ok ? `Draft promoted as ledger entry #${res.value.sequence}, attributed to ${persona().name}.` : '');
      if (res.ok) await Promise.all([loadCase(), loadDrafts()]);
    });
    return el('li', { className: 'ws-entry' }, [
      el('p', { className: 'ws-entry-head' }, [
        el('span', { className: 'ws-kind', text: p.kind.replace(/_/g, ' ') }),
        el('span', { className: `stamp ${p.status === 'draft' ? 'stamp--pending' : 'stamp--executed'}`, text: p.status }),
      ]),
      describeInput(p.input),
      el('p', { className: 'reason', text: `Drafted by ${p.proposedBy}, ${when(p.createdAt)}.${p.promotedBy ? ` Promoted by ${p.promotedBy}.` : ''}` }),
      p.status === 'draft' ? promote : null,
    ]);
  }));
}

async function runAgent() {
  const button = $('agent-run');
  button.disabled = true;
  try {
    const r = await api('POST', '/api/agent/run', {});
    notice(r, r.ok ? r.value.notice : '');
    if (r.ok) {
      $('agent-calls').replaceChildren(...r.value.calls.map((c) => el('li', {}, [el('span', { className: 'entry', text: c.id }), el('span', { text: c.tool }), el('span', { className: c.outcome === 'executed' ? 'verdict--allowed' : 'verdict--refused', text: c.outcome })])));
      await Promise.all([loadFindings(), loadDrafts()]);
    }
  } finally {
    button.disabled = false;
  }
}

async function submitFinding(ev) {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const r = await api('POST', '/api/findings', { findingType: f.get('findingType'), uncertainty: f.get('uncertainty'), summary: f.get('summary'), citedEvidenceIds: f.getAll('cite') });
  notice(r, 'Finding recorded.');
  if (r.ok) {
    ev.target.reset();
    await loadFindings();
  }
}

// ---- Approvals and export ------------------------------------------------------

function renderVersionChoices() {
  const ids = [...new Set(state.evidence.map((e) => e.evidenceId))];
  $('finding-cites').replaceChildren(...ids.map((id) => el('label', {}, [el('input', { attrs: { type: 'checkbox', name: 'cite', value: id } }), el('span', { text: id })])));
  $('request-versions').replaceChildren(...state.evidence.map((e) => el('label', {}, [
    el('input', { attrs: { type: 'checkbox', name: 'version', value: `${e.evidenceId}|${e.versionId}` } }),
    el('span', { text: `${e.evidenceId} ${versionLabel(e)}` }),
  ])));
}

function savePayload(id, payload) {
  state.payloads.set(id, payload);
  store(`coc-payload-${id}`, JSON.stringify(payload));
}
function payloadFor(id) {
  if (state.payloads.has(id)) return state.payloads.get(id);
  try { const s = store(`coc-payload-${id}`); return s ? JSON.parse(s) : null; } catch { return null; }
}

async function submitRequest(ev) {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const evidence = f.getAll('version').map((v) => { const [evidenceId, versionId] = String(v).split('|'); return { evidenceId, versionId }; });
  const payload = { evidence, destination: f.get('destination') };
  const r = await api('POST', '/api/approvals/request', payload);
  notice(r, r.ok ? 'Export requested. A different supervisor must approve it.' : '');
  if (r.ok) {
    savePayload(r.value.approvalId, payload);
    ev.target.reset();
    await loadApprovals();
  }
}

async function loadApprovals() {
  const r = await api('GET', '/api/approvals');
  const list = $('approvals');
  if (!r.ok) return list.replaceChildren(el('li', { text: `Not visible: ${r.code}` }));
  if (r.value.length === 0) return list.replaceChildren(el('li', { className: 'ws-empty', text: 'No export requests yet.' }));
  list.replaceChildren(...r.value.map((a) => {
    const action = (label, fn) => {
      const b = el('button', { className: 'ws-quiet', text: label, attrs: { type: 'button' } });
      b.addEventListener('click', fn);
      return b;
    };
    const payload = payloadFor(a.approvalId);
    const exportBtn = action('Export', () => doExport(a.approvalId));
    if (!payload) {
      exportBtn.disabled = true;
      exportBtn.title = 'Only the browser tab that made the request knows its exact payload';
    }
    return el('li', { className: 'ws-entry' }, [
      el('p', { className: 'ws-entry-head' }, [
        el('span', { className: 'entry', text: short(a.approvalId) }),
        el('span', { className: `stamp ${a.status === 'approved' ? 'stamp--executed' : a.status === 'pending' ? 'stamp--pending' : a.status === 'consumed' ? 'stamp--unchanged' : 'stamp--refused'}`, text: a.status }),
      ]),
      el('p', { className: 'reason', text: `Requested by ${a.requester}, ${when(a.createdAt)}. ${a.approver ? `Decided by ${a.approver}.` : 'Awaiting a supervisor.'} Expires ${when(a.expiresAt)}.` }),
      payload ? el('p', { className: 'reason', text: `Versions: ${payload.evidence.map((x) => x.evidenceId).join(', ')} to ${payload.destination}` }) : null,
      // Offer only what the status allows; the core still decides who may do it.
      el('div', { className: 'ws-actions' }, [
        a.status === 'pending' ? action('Approve', async () => { const res = await api('POST', '/api/approvals/approve', { approvalId: a.approvalId }); notice(res, 'Approved.'); await loadApprovals(); }) : null,
        a.status === 'pending' || a.status === 'approved' ? action('Revoke', async () => { const res = await api('POST', '/api/approvals/revoke', { approvalId: a.approvalId }); notice(res, 'Revoked.'); await loadApprovals(); }) : null,
        a.status === 'approved' ? exportBtn : null,
      ]),
    ]);
  }));
}

async function doExport(approvalId) {
  const r = await api('POST', '/api/exports', { approvalId, payload: payloadFor(approvalId) });
  notice(r, r.ok ? 'Export created and verified independently.' : '');
  if (!r.ok) return;
  state.lastExport = r.value.package;
  const v = r.value.verification;
  const box = $('verification');
  box.hidden = false;
  const stamp = $('verify-stamp');
  stamp.className = `stamp ${v.status === 'FAILED' ? 'stamp--changed' : 'stamp--unchanged'}`;
  stamp.textContent = v.status.replace(/_/g, ' ');
  $('verify-meta').replaceChildren(...[
    ['Ledger valid through', `#${v.validThrough}`], ['Anchored by a signed checkpoint through', `#${v.anchoredThrough}`], ['Freshness', v.freshness],
    ['Evidence files verified', `${v.evidence.filter((e) => e.verified).length} of ${v.evidence.length}`],
  ].flatMap(([k, val]) => [el('dt', { text: k }), el('dd', { text: val })]));
  $('verify-findings').replaceChildren(...(v.findings.length ? v.findings : [{ code: 'NO_FINDINGS', detail: 'nothing to report' }]).map((f) => el('li', {}, [el('code', { text: f.code }), el('span', { text: ` ${f.detail ?? ''}` })])));
  await Promise.all([loadApprovals(), loadCase()]);
  box.scrollIntoView({ block: 'nearest' });
}

function download() {
  if (!state.lastExport) return;
  const blob = new Blob([JSON.stringify(state.lastExport, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { attrs: { href: url, download: `blackwater-export-${Date.now()}.json` } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Tabs, persona, startup ------------------------------------------------------

const TABS = ['evidence', 'timeline', 'findings', 'exports'];
const LOADERS = { evidence: loadEvidence, timeline: loadTimeline, findings: () => Promise.all([loadFindings(), loadDrafts()]), exports: loadApprovals };
let current = 'evidence';

function selectTab(name, focus = false) {
  current = name;
  for (const t of TABS) {
    const tab = $(`tab-${t}`);
    const on = t === name;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(`panel-${t}`).hidden = !on;
    if (on && focus) tab.focus();
  }
  store('coc-tab', name);
  return LOADERS[name]();
}

function wireTabs() {
  TABS.forEach((t, i) => {
    const tab = $(`tab-${t}`);
    tab.addEventListener('click', () => selectTab(t));
    tab.addEventListener('keydown', (ev) => {
      const next = ev.key === 'ArrowRight' ? (i + 1) % TABS.length : ev.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : ev.key === 'Home' ? 0 : ev.key === 'End' ? TABS.length - 1 : -1;
      if (next >= 0) {
        ev.preventDefault();
        selectTab(TABS[next], true);
      }
    });
  });
}

async function refreshAll() {
  await loadCase();
  await loadEvidence();
  await LOADERS[current]();
}

async function start() {
  const res = await fetch('/api/session', { headers: { Accept: 'application/json' } });
  state.session = (await res.json()).value;
  $('case-id').textContent = state.session.caseId;
  $('identity-notice').textContent = state.session.localIdentityNotice;
  const actor = $('actor');
  actor.replaceChildren(...state.session.personas.map((p) => el('option', { text: `${p.name}, ${p.role}`, attrs: { value: p.userId } })));
  const saved = store('coc-actor');
  state.actor = state.session.personas.some((p) => p.userId === saved) ? saved : state.session.personas[0].userId;
  actor.value = state.actor;
  $('actor-note').textContent = persona().note;
  actor.addEventListener('change', async () => {
    state.actor = actor.value;
    store('coc-actor', state.actor);
    $('actor-note').textContent = persona().note;
    notice({ ok: true }, `Now acting as ${persona().name}. The core decides what this person may see and do.`);
    await refreshAll();
  });
  $('finding-type').replaceChildren(...state.session.findingTypes.map((t) => el('option', { text: t.replace(/_/g, ' '), attrs: { value: t } })));
  $('finding-uncertainty').replaceChildren(...state.session.uncertainty.map((t) => el('option', { text: t, attrs: { value: t } })));
  $('request-destination').replaceChildren(...state.session.destinations.map((t) => el('option', { text: t, attrs: { value: t } })));

  wireTabs();
  $('transfer-form').addEventListener('submit', submitTransfer);
  $('finding-form').addEventListener('submit', submitFinding);
  $('request-form').addEventListener('submit', submitRequest);
  $('agent-run').addEventListener('click', runAgent);
  $('download').addEventListener('click', download);
  $('reset').addEventListener('click', async () => {
    const r = await api('POST', '/api/reset', {});
    notice(r, 'Demo data reset to the seeded synthetic record.');
    $('reader').hidden = true;
    $('verification').hidden = true;
    $('agent-calls').replaceChildren();
    await refreshAll();
  });

  await loadCase();
  await loadEvidence();
  const tab = store('coc-tab');
  await selectTab(TABS.includes(tab) ? tab : 'evidence');
}

document.addEventListener('DOMContentLoaded', () => {
  start().catch(() => {
    $('notice').className = 'ws-notice ws-notice--refused';
    $('notice').textContent = 'The workspace could not load. Is the local server running?';
  });
});
