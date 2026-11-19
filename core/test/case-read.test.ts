// T17: human read views (timeline with chain check, drafts, approvals).

import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLES } from '../src/tables.ts';
import { AGENT, CASE, OTHER_CASE, USERS, agent, anonymous, human, makeWorld, registerFixtures } from './helpers.ts';

async function world() {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  return { w, versions };
}

test('a case member sees the whole timeline, an intact chain and the head', async () => {
  const { w } = await world();
  assert.ok((await w.checkpoints.issue(CASE, new Date('2026-11-18T17:00:00.000Z'))).ok);
  const r = await w.caseRead.timeline(human(USERS.auditor), CASE);
  assert.ok(r.ok, JSON.stringify(r));
  const head = await w.ledger.head(CASE);
  assert.equal(r.value.events.length, head.sequence);
  assert.deepEqual(r.value.head, { sequence: head.sequence, hash: head.hash });
  assert.equal(r.value.chain.intact, true);
  assert.equal(r.value.checkpoint?.body.sequence, head.sequence);
});

// Rebuilds a world whose store holds the given event rows and head, simulating
// a privileged store edit the domain itself can never make.
async function worldWith(rows: Array<{ key: string; item: { value: unknown } }>, head: { sequence: number; hash: string }) {
  const t = makeWorld();
  for (const row of rows) await t.store.transact([{ table: TABLES.events, key: row.key, value: row.item.value, expectVersion: null }]);
  await t.store.transact([{ table: TABLES.heads, key: CASE, value: head, expectVersion: null }]);
  return t;
}

test('the chain check names an edited event', async () => {
  const { w } = await world();
  const rows = await w.store.list<Record<string, unknown>>(TABLES.events, `${CASE}#`);
  const head = await w.ledger.head(CASE);
  const edited = rows.map((r, i) => (i === 2 ? { key: r.key, item: { value: { ...r.item.value, recordedAt: '2021-01-01T00:00:00.000Z' } } } : r));
  const r = await (await worldWith(edited, { sequence: head.sequence, hash: head.hash })).caseRead.timeline(human(USERS.auditor), CASE);
  assert.ok(r.ok);
  assert.equal(r.value.chain.intact, false);
  assert.deepEqual(r.value.chain.problems.map((p) => [p.sequence, p.problem]), [[3, 'EVENT_HASH_MISMATCH']]);
});

test('the chain check names a removed event: gap, broken link and head mismatch', async () => {
  const { w } = await world();
  const rows = await w.store.list<Record<string, unknown>>(TABLES.events, `${CASE}#`);
  const head = await w.ledger.head(CASE);
  const r = await (await worldWith(rows.filter((_, i) => i !== 2), { sequence: head.sequence, hash: head.hash })).caseRead.timeline(human(USERS.auditor), CASE);
  assert.ok(r.ok);
  const problems = r.value.chain.problems.map((p) => `${p.sequence}:${p.problem}`);
  assert.ok(problems.includes('4:SEQUENCE_GAP'), problems.join(' '));
  assert.ok(problems.includes('4:PREV_HASH_MISMATCH'), problems.join(' '));
  assert.ok(problems.includes(`${head.sequence}:HEAD_MISMATCH`), problems.join(' '));
});

test('timeline, drafts and approvals are denied to the agent, outsiders and anonymous callers, and every read is audited', async () => {
  const { w } = await world();
  for (const read of [w.caseRead.timeline.bind(w.caseRead), w.caseRead.proposals.bind(w.caseRead), w.caseRead.approvals.bind(w.caseRead)]) {
    const a = await read(agent(), CASE);
    assert.equal(a.ok ? 'ok' : a.code, 'DENIED_AGENT');
    const o = await read(human(USERS.outsider), CASE);
    assert.equal(o.ok, false);
    assert.match(o.ok ? '' : o.code, /^DENIED_/);
    const n = await read(anonymous(), CASE);
    assert.equal(n.ok ? 'ok' : n.code, 'DENIED_NO_IDENTITY');
  }
  const reads = w.audit.events.filter((e) => e.operation === 'read_metadata');
  assert.ok(reads.some((e) => e.outcome === 'failed' && e.code === 'DENIED_AGENT' && e.principal === `agent:${AGENT}`));
  assert.ok(reads.some((e) => e.outcome === 'denied' && e.principal === `human:${USERS.outsider}`));
});

test('drafts list only this case, oldest first, with their status', async () => {
  const { w, versions } = await world();
  const propose = (reason: string) => w.agentTools.call(agent(), CASE, 'propose_custody_event', {
    evidence_id: 'BW-007', event_kind: 'transfer', reason, version_id: versions.get('BW-007/original'), from: 'locker', to: 'audit review',
  });
  assert.ok((await propose('first draft')).ok);
  assert.ok((await propose('second draft')).ok);
  const r = await w.caseRead.proposals(human(USERS.investigator), CASE);
  assert.ok(r.ok);
  assert.equal(r.value.length, 2);
  assert.ok(r.value.every((p) => p.caseId === CASE && p.status === 'draft' && p.proposedBy === AGENT));
  const other = await w.caseRead.proposals(human(USERS.outsider), OTHER_CASE);
  assert.ok(other.ok);
  assert.equal(other.value.length, 0, 'another case sees none of these drafts');
});

test('approvals list shows this case only, with status changes', async () => {
  const { w, versions } = await world();
  const payload = { evidence: [{ evidenceId: 'BW-001', versionId: versions.get('BW-001/original')! }], destination: 'internal:case-export-store' };
  const req = await w.approvals.requestExport(human(USERS.investigator), CASE, payload);
  assert.ok(req.ok);
  assert.ok((await w.approvals.approve(human(USERS.supervisor), req.value.approvalId)).ok);
  const r = await w.caseRead.approvals(human(USERS.auditor), CASE);
  assert.ok(r.ok);
  assert.deepEqual(r.value.map((a) => [a.requester, a.status, a.approver]), [[USERS.investigator, 'approved', USERS.supervisor]]);
});

test('audit log: supervisors only; the agent, other roles, outsiders and anonymous callers are refused', async () => {
  const { w } = await world();
  const cases: Array<[ReturnType<typeof human>, string]> = [
    [human(USERS.investigator), 'DENIED_ROLE'], [human(USERS.auditor), 'DENIED_ROLE'],
    [agent(), 'DENIED_AGENT'], [human(USERS.outsider), 'DENIED_NOT_MEMBER'], [anonymous(), 'DENIED_NO_IDENTITY'],
  ];
  for (const [ctx, code] of cases) {
    const r = await w.caseRead.auditLog(ctx, CASE);
    assert.equal(!r.ok && r.code, code, code);
  }
  const ok = await w.caseRead.auditLog(human(USERS.supervisor), CASE);
  assert.ok(ok.ok, JSON.stringify(ok));
});

test('audit log: this case only, newest first, refusals included, and the read itself is the newest entry', async () => {
  const { w } = await world();
  await w.caseRead.timeline(human(USERS.investigator), CASE);
  await w.caseRead.timeline(human(USERS.outsider), CASE); // denied, filed under this case
  await w.caseRead.timeline(human(USERS.supervisor), OTHER_CASE); // denied, filed under the other case
  await w.caseRead.auditLog(human(USERS.auditor), CASE); // denied read of the log, recorded too
  const r = await w.caseRead.auditLog(human(USERS.supervisor), CASE);
  assert.ok(r.ok);
  const ev = r.value.events;
  assert.ok(ev.every((e) => e.caseId === CASE), 'no other case and no (unknown) records');
  assert.deepEqual([ev[0]!.operation, ev[0]!.outcome, ev[0]!.principal], ['read_audit_log', 'attempted', `human:${USERS.supervisor}`]);
  assert.deepEqual([ev[1]!.operation, ev[1]!.outcome, ev[1]!.code, ev[1]!.principal], ['read_audit_log', 'denied', 'DENIED_ROLE', `human:${USERS.auditor}`]);
  assert.ok(ev.some((e) => e.principal === `human:${USERS.outsider}` && e.outcome === 'denied' && e.code === 'DENIED_NOT_MEMBER'));
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i - 1]!.at >= ev[i]!.at, 'newest first');
  assert.equal(r.value.total, w.audit.events.filter((e) => e.caseId === CASE).length - 1, 'total counted before this read completed');
  assert.equal(r.value.truncated, r.value.total > 200);
  assert.equal(w.audit.events.at(-1)!.operation, 'read_audit_log');
  assert.equal(w.audit.events.at(-1)!.outcome, 'completed');
});

test('audit log: keeps the newest 200 and says it was cut; an unavailable log fails closed', async () => {
  const { w } = await world();
  for (let i = 0; i < 260; i++) await w.caseRead.proposals(human(USERS.auditor), CASE);
  const r = await w.caseRead.auditLog(human(USERS.supervisor), CASE);
  assert.ok(r.ok);
  assert.equal(r.value.events.length, 200);
  assert.equal(r.value.truncated, true);
  assert.ok(r.value.total > 520);
  w.audit.available = false;
  const down = await w.caseRead.auditLog(human(USERS.supervisor), CASE);
  assert.equal(!down.ok && down.code, 'DENIED_AUDIT_UNAVAILABLE');
});
