// T02: approval lifecycle, self-approval, binding, expiry, revocation, replay and races.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalService, type ExportPayload } from '../src/approvals.ts';
import { InterleavingStore, MemoryStore } from '../src/store.ts';
import { CASE, OTHER_CASE, USERS, APPEND_ONLY_TABLES, human, agent, deps } from './helpers.ts';

const T0 = new Date('2026-11-18T16:00:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);
const PAYLOAD: ExportPayload = { evidence: [{ evidenceId: 'BW-001', versionId: 'v-1' }], destination: 'internal:case-export-store' };

function setup(store = new MemoryStore({ appendOnlyTables: APPEND_ONLY_TABLES })) {
  const d = deps(store);
  return { d, svc: new ApprovalService(d, { ttlMs: 60 * 60 * 1000 }) };
}

async function approvedBy(svc: ApprovalService, requester: string, approver: string) {
  const req = await svc.requestExport(human(requester, T0), CASE, PAYLOAD);
  assert.ok(req.ok);
  const app = await svc.approve(human(approver, later(1000)), req.value.approvalId);
  assert.ok(app.ok, JSON.stringify(app));
  return req.value.approvalId;
}

async function consume(svc: ApprovalService, store: { transact: MemoryStore['transact'] }, userId: string, id: string, payload = PAYLOAD, caseId = CASE, when = later(2000)) {
  const w = await svc.consumptionWrite(userId, when, id, caseId, payload);
  if (!w.ok) return w;
  const r = await store.transact([w.value]);
  return r.ok ? { ok: true as const } : { ok: false as const, code: 'DENIED_APPROVAL_INVALID', detail: 'lost the race' };
}

test('L05: independent supervisor approval, consumed once by the requester', async () => {
  const { d, svc } = setup();
  const id = await approvedBy(svc, USERS.investigator, USERS.supervisor);
  assert.equal((await consume(svc, d.store, USERS.investigator, id)).ok, true);
  assert.equal((await svc.getUnchecked(id))?.approval.status, 'consumed');
});

test('A06: a requester cannot approve their own request, even a supervisor', async () => {
  const { svc } = setup();
  const req = await svc.requestExport(human(USERS.supervisor, T0), CASE, PAYLOAD);
  assert.ok(req.ok);
  const self = await svc.approve(human(USERS.supervisor, later(1)), req.value.approvalId);
  assert.equal(!self.ok && self.code, 'DENIED_SELF_APPROVAL');
  const other = await svc.approve(human(USERS.supervisor2, later(1)), req.value.approvalId);
  assert.equal(other.ok, true, 'a second supervisor can approve');
});

test('only supervisors approve; auditors, investigators, outsiders and the agent cannot', async () => {
  const { svc } = setup();
  const req = await svc.requestExport(human(USERS.investigator, T0), CASE, PAYLOAD);
  assert.ok(req.ok);
  for (const [ctx, code] of [
    [human(USERS.auditor), 'DENIED_ROLE'],
    [human(USERS.outsider), 'NOT_FOUND'], // re-review N3: non-members cannot tell an existing ID from a missing one
    [agent(), 'DENIED_AGENT'],
  ] as const) {
    const r = await svc.approve(ctx, req.value.approvalId);
    assert.equal(!r.ok && r.code, code);
  }
});

test('the agent cannot request exports', async () => {
  const { svc } = setup();
  const r = await svc.requestExport(agent(), CASE, PAYLOAD);
  assert.equal(!r.ok && r.code, 'DENIED_AGENT');
});

test('A07: a consumed approval cannot be replayed', async () => {
  const { d, svc } = setup();
  const id = await approvedBy(svc, USERS.investigator, USERS.supervisor);
  assert.equal((await consume(svc, d.store, USERS.investigator, id)).ok, true);
  const again = await consume(svc, d.store, USERS.investigator, id);
  assert.equal(again.ok, false);
});

test('A07: 25 concurrent consumers with interleaved reads produce exactly one winner', async () => {
  const inner = new MemoryStore({ appendOnlyTables: APPEND_ONLY_TABLES });
  const store = new InterleavingStore(inner);
  const { svc } = setup(inner);
  const id = await approvedBy(svc, USERS.investigator, USERS.supervisor);
  const racing = new ApprovalService({ ...deps(store) }, { ttlMs: 3600000 });
  const results = await Promise.all(Array.from({ length: 25 }, () => consume(racing, store, USERS.investigator, id)));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal((await svc.getUnchecked(id))?.approval.status, 'consumed');
});

test('A08: changing evidence version, adding evidence or changing destination after approval is denied', async () => {
  const { d, svc } = setup();
  const id = await approvedBy(svc, USERS.investigator, USERS.supervisor);
  const variants: ExportPayload[] = [
    { ...PAYLOAD, evidence: [{ evidenceId: 'BW-001', versionId: 'v-2' }] },
    { ...PAYLOAD, evidence: [...PAYLOAD.evidence, { evidenceId: 'BW-007', versionId: 'v-1' }] },
    { ...PAYLOAD, destination: 'internal:other' },
  ];
  for (const p of variants) {
    const r = await consume(svc, d.store, USERS.investigator, id, p);
    assert.equal(!r.ok && r.code, 'DENIED_APPROVAL_INVALID');
  }
  assert.equal((await svc.getUnchecked(id))?.approval.status, 'approved', 'failed attempts do not consume it');
});

test('approval is bound to the requester and the case', async () => {
  const { d, svc } = setup();
  const id = await approvedBy(svc, USERS.investigator, USERS.supervisor);
  assert.equal((await consume(svc, d.store, USERS.auditor, id)).ok, false);
  assert.equal((await consume(svc, d.store, USERS.investigator, id, PAYLOAD, OTHER_CASE)).ok, false);
});

test('V08: expired approvals cannot be approved or used', async () => {
  const { d, svc } = setup();
  const req = await svc.requestExport(human(USERS.investigator, T0), CASE, PAYLOAD);
  assert.ok(req.ok);
  const lateApprove = await svc.approve(human(USERS.supervisor, later(2 * 3600000)), req.value.approvalId);
  assert.equal(!lateApprove.ok && lateApprove.code, 'DENIED_APPROVAL_INVALID');
  const id = await approvedBy(svc, USERS.investigator, USERS.supervisor);
  const lateUse = await consume(svc, d.store, USERS.investigator, id, PAYLOAD, CASE, later(2 * 3600000));
  assert.equal(!lateUse.ok && lateUse.code, 'DENIED_APPROVAL_INVALID');
});

test('V09: revoked approvals cannot be used; only requester or a supervisor may revoke', async () => {
  const { d, svc } = setup();
  const id = await approvedBy(svc, USERS.investigator, USERS.supervisor);
  const byAuditor = await svc.revoke(human(USERS.auditor), id);
  assert.equal(!byAuditor.ok && byAuditor.code, 'DENIED_ROLE');
  assert.equal((await svc.revoke(human(USERS.investigator), id)).ok, true);
  assert.equal((await consume(svc, d.store, USERS.investigator, id)).ok, false);
});

test('V07: external export destinations and malformed payloads are rejected at request time', async () => {
  const { svc } = setup();
  for (const payload of [
    { ...PAYLOAD, destination: 's3://attacker-bucket/loot' },
    { ...PAYLOAD, destination: 'https://example.com' },
    { ...PAYLOAD, approved: true },
    { evidence: [], destination: 'internal:case-export-store' },
    { evidence: [{ evidenceId: '../etc', versionId: 'v' }], destination: 'internal:case-export-store' },
  ]) {
    const r = await svc.requestExport(human(USERS.investigator), CASE, payload);
    assert.equal(!r.ok && r.code, 'INVALID_REQUEST', JSON.stringify(payload));
  }
});

test('stored approvals are immutable snapshots (callers cannot mutate them)', async () => {
  const { svc } = setup();
  const id = await approvedBy(svc, USERS.investigator, USERS.supervisor);
  const got = await svc.getUnchecked(id);
  assert.throws(() => { (got!.approval as { status: string }).status = 'approved-by-me'; }, TypeError);
});
