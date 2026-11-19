// T17: investigation workflow API, end to end through the core.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO } from '../../core/src/local.ts';
import { Workflow } from '../src/workflow.ts';

const U = DEMO.users;
type Body = { ok: boolean; value?: any; code?: string; detail?: string };

async function setup() {
  const wf = await Workflow.create(() => new Date('2026-11-18T20:00:00.000Z'));
  const call = async (method: string, path: string, user: string | undefined, body?: unknown, extra: Record<string, string> = {}) => {
    const [p, q] = path.split('?');
    const r = await wf.handle({ method, path: p!, query: new URLSearchParams(q ?? ''), headers: { 'x-coc-csrf': wf.csrf, ...(user ? { 'x-coc-user': user } : {}), ...extra }, body });
    return { status: r.status, body: r.body as Body };
  };
  return { wf, call };
}

test('session gives the token and personas; everything else needs the token and a persona', async () => {
  const { wf, call } = await setup();
  const s = await wf.handle({ method: 'GET', path: '/api/session', query: new URLSearchParams(), headers: {} });
  assert.equal(s.status, 200);
  assert.equal((s.body as Body).value.csrf, wf.csrf);
  const noToken = await wf.handle({ method: 'GET', path: '/api/case', query: new URLSearchParams(), headers: { 'x-coc-user': U.auditor } });
  assert.deepEqual([noToken.status, (noToken.body as Body).code], [403, 'DENIED_SESSION']);
  const wrongToken = await call('GET', '/api/case', U.auditor, undefined, { 'x-coc-csrf': 'x'.repeat(wf.csrf.length) });
  assert.equal(wrongToken.status, 403);
  const noUser = await call('GET', '/api/case', undefined);
  assert.deepEqual([noUser.status, noUser.body.code], [401, 'DENIED_NO_IDENTITY']);
  const stranger = await call('GET', '/api/case', 'mallory');
  assert.equal(stranger.status, 401);
});

test('case overview: head, intact chain, a checkpoint at the head, evidence titles', async () => {
  const { call } = await setup();
  const r = await call('GET', '/api/case', U.auditor);
  assert.equal(r.status, 200);
  assert.equal(r.body.value.chain.intact, true);
  assert.equal(r.body.value.checkpoint.sequence, r.body.value.head.sequence);
  assert.equal(r.body.value.titles['BW-001'], 'Original incident report');
  const outsider = await call('GET', '/api/case', U.outsider);
  assert.equal(outsider.status, 403);
});

test('evidence: list, read an exact version as text with its hash, refuse a malformed or unknown version', async () => {
  const { call } = await setup();
  const list = await call('GET', '/api/evidence', U.auditor);
  assert.equal(list.body.value.length, 12);
  assert.ok(list.body.value.every((e: Record<string, unknown>) => !('objectKey' in e)), 'internal storage keys are not exposed');
  const v = list.body.value.find((e: { evidenceId: string; derivedFrom: unknown }) => e.evidenceId === 'BW-001' && e.derivedFrom === null);
  const read = await call('GET', `/api/evidence/read?evidenceId=BW-001&versionId=${v.versionId}`, U.auditor);
  assert.equal(read.status, 200);
  assert.equal(read.body.value.sha256, v.sha256);
  assert.match(read.body.value.text, /\S/);
  assert.equal((await call('GET', '/api/evidence/read?evidenceId=BW-001&versionId=latest', U.auditor)).status, 404);
  assert.equal((await call('GET', '/api/evidence/read?evidenceId=../x&versionId=v', U.auditor)).status, 400);
});

test('custody: an investigator records a transfer and a fresh checkpoint follows; an auditor is refused by role', async () => {
  const { call } = await setup();
  const list = await call('GET', '/api/evidence', U.investigator);
  const v = list.body.value.find((e: { evidenceId: string }) => e.evidenceId === 'BW-007');
  const before = (await call('GET', '/api/case', U.investigator)).body.value.head.sequence;
  const t = await call('POST', '/api/custody/transfer', U.investigator, { evidenceId: 'BW-007', versionId: v.versionId, from: 'evidence locker', to: 'audit review', reason: 'Scheduled audit review' });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  const after = (await call('GET', '/api/case', U.investigator)).body.value;
  assert.equal(after.head.sequence, before + 1);
  assert.equal(after.checkpoint.sequence, after.head.sequence);
  const refused = await call('POST', '/api/custody/transfer', U.auditor, { evidenceId: 'BW-007', versionId: v.versionId, from: 'a', to: 'b', reason: 'c' });
  assert.deepEqual([refused.status, refused.body.code], [403, 'DENIED_ROLE']);
  const extra = await call('POST', '/api/custody/transfer', U.investigator, { evidenceId: 'BW-007', versionId: v.versionId, from: 'a', to: 'b', reason: 'c', actor: 'elena.ward' });
  assert.deepEqual([extra.status, extra.body.code], [400, 'INVALID_REQUEST']);
});

test('corrections append; they never edit the original event', async () => {
  const { call } = await setup();
  const tl = (await call('GET', '/api/timeline', U.auditor)).body.value;
  const target = tl.events[2];
  const r = await call('POST', '/api/custody/correction', U.auditor, { targetSequence: target.sequence, targetHash: target.eventHash, reason: 'Room name was recorded wrongly' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = (await call('GET', '/api/timeline', U.auditor)).body.value;
  assert.equal(after.events.length, tl.events.length + 1);
  assert.deepEqual(after.events[2], target);
  assert.equal(after.chain.intact, true);
});

test('scripted agent pass produces findings and drafts; a human promotes a draft once', async () => {
  const { call } = await setup();
  const run = await call('POST', '/api/agent/run', U.auditor, {});
  assert.equal(run.body.value.scripted, true);
  assert.equal(run.body.value.calls.length, 7);
  assert.ok(run.body.value.calls.every((c: { outcome: string }) => c.outcome === 'executed'), JSON.stringify(run.body.value.calls));
  const drafts = (await call('GET', '/api/proposals', U.investigator)).body.value;
  assert.equal(drafts.length, 2);
  assert.equal((await call('GET', '/api/findings', U.auditor)).body.value.length, 1);
  const transfer = drafts.find((p: { kind: string }) => p.kind === 'custody_transfer');
  const auditorTry = await call('POST', '/api/proposals/promote', U.auditor, { proposalId: transfer.proposalId });
  assert.equal(auditorTry.status, 403, 'auditors cannot move evidence, even through a draft');
  const promoted = await call('POST', '/api/proposals/promote', U.investigator, { proposalId: transfer.proposalId });
  assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
  const again = await call('POST', '/api/proposals/promote', U.investigator, { proposalId: transfer.proposalId });
  assert.equal(again.status, 400);
});

test('findings: a human records one; conclusions of guilt are refused', async () => {
  const { call } = await setup();
  const ok = await call('POST', '/api/findings', U.auditor, { findingType: 'discrepancy', summary: 'BW-004 access log has no entry for the 21:40 door event in BW-001.', citedEvidenceIds: ['BW-001', 'BW-004'], uncertainty: 'medium' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const guilt = await call('POST', '/api/findings', U.auditor, { findingType: 'discrepancy', summary: 'The night supervisor is guilty of arson.', citedEvidenceIds: ['BW-001'], uncertainty: 'low' });
  assert.deepEqual([guilt.status, guilt.body.code], [422, 'CONTENT_RULE_VIOLATION']);
});

test('export: request, self-approval refused, independent approval, export verifies, approval cannot be reused', async () => {
  const { call } = await setup();
  const list = (await call('GET', '/api/evidence', U.investigator)).body.value;
  const payload = { evidence: list.filter((e: { evidenceId: string }) => ['BW-001', 'BW-010'].includes(e.evidenceId)).map((e: { evidenceId: string; versionId: string }) => ({ evidenceId: e.evidenceId, versionId: e.versionId })), destination: 'internal:case-export-store' };
  const req = await call('POST', '/api/approvals/request', U.investigator, payload);
  assert.equal(req.status, 200, JSON.stringify(req.body));
  const approvalId = req.body.value.approvalId;
  const self = await call('POST', '/api/approvals/approve', U.investigator, { approvalId });
  assert.equal(self.status, 403);
  const early = await call('POST', '/api/exports', U.investigator, { approvalId, payload });
  assert.equal(early.status, 403, 'a pending approval cannot export');
  assert.equal((await call('POST', '/api/approvals/approve', U.supervisor, { approvalId })).status, 200);
  const swapped = await call('POST', '/api/exports', U.investigator, { approvalId, payload: { ...payload, evidence: payload.evidence.slice(0, 1) } });
  assert.equal(swapped.status, 403, 'a changed payload does not match the approved digest');
  const exp = await call('POST', '/api/exports', U.investigator, { approvalId, payload });
  assert.equal(exp.status, 200, JSON.stringify(exp.body));
  assert.equal(exp.body.value.verification.status, 'VERIFIED', JSON.stringify(exp.body.value.verification.findings));
  assert.equal(exp.body.value.verification.freshness, 'FRESH');
  assert.equal(exp.body.value.package.evidence.length, 2);
  assert.equal((await call('POST', '/api/exports', U.investigator, { approvalId, payload })).status, 403, 'single use');
  const statuses = (await call('GET', '/api/approvals', U.auditor)).body.value.map((a: { status: string }) => a.status);
  assert.deepEqual(statuses, ['consumed']);
});

test('reset restores the seeded case; unknown endpoints are 404', async () => {
  const { call } = await setup();
  await call('POST', '/api/agent/run', U.auditor, {});
  assert.equal((await call('POST', '/api/reset', U.auditor, {})).status, 200);
  assert.equal((await call('GET', '/api/proposals', U.auditor)).body.value.length, 0);
  assert.equal((await call('GET', '/api/nope', U.auditor)).status, 404);
  assert.equal((await call('DELETE', '/api/evidence', U.supervisor)).status, 404);
});

test('drafts: a person dismisses one with a reason; it stays listed, cannot be promoted, and the ledger is unchanged', async () => {
  const { call } = await setup();
  await call('POST', '/api/agent/run', U.auditor, {});
  const drafts = (await call('GET', '/api/proposals', U.auditor)).body.value;
  const target = drafts.find((p: { kind: string }) => p.kind === 'historical_assertion');
  const head = (await call('GET', '/api/case', U.auditor)).body.value.head.sequence;
  const noReason = await call('POST', '/api/proposals/dismiss', U.auditor, { proposalId: target.proposalId });
  assert.deepEqual([noReason.status, noReason.body.code], [400, 'INVALID_REQUEST']);
  const outsider = await call('POST', '/api/proposals/dismiss', U.outsider, { proposalId: target.proposalId, reason: 'x' });
  assert.equal(outsider.status, 404);
  const ok = await call('POST', '/api/proposals/dismiss', U.auditor, { proposalId: target.proposalId, reason: 'The claimed time contradicts BW-004' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const after = (await call('GET', '/api/proposals', U.investigator)).body.value;
  assert.equal(after.length, 2, 'dismissed drafts stay listed');
  const d = after.find((p: { proposalId: string }) => p.proposalId === target.proposalId);
  assert.equal(d.status, 'dismissed');
  assert.deepEqual(d.dismissal, { by: U.auditor, at: '2026-11-18T20:00:00.000Z', reason: 'The claimed time contradicts BW-004' });
  assert.equal((await call('GET', '/api/case', U.auditor)).body.value.head.sequence, head);
  assert.equal((await call('POST', '/api/proposals/promote', U.investigator, { proposalId: target.proposalId })).status, 400);
});

test('historical claims: a person records one exactly as stated; bad sources and blank fields are refused', async () => {
  const { call } = await setup();
  const list = (await call('GET', '/api/evidence', U.auditor)).body.value;
  const src = list.find((e: { evidenceId: string; derivedFrom: unknown }) => e.evidenceId === 'BW-004' && e.derivedFrom === null);
  const claim = {
    evidenceId: 'BW-001', sources: [{ evidenceId: 'BW-004', versionId: src.versionId }],
    statement: 'The access log shows no badge entry for the lab B door between 21:30 and 22:00.',
    claimedTimeRaw: '10/13/2021 9:40 PM', sourceClock: 'badge controller clock', timezone: 'not stated', offsetUncertainty: 'unknown; controller drifts',
  };
  const head = (await call('GET', '/api/case', U.auditor)).body.value.head.sequence;
  const r = await call('POST', '/api/custody/assertion', U.auditor, claim);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.value.sequence, head + 1);
  assert.deepEqual(r.body.value.body, claim, 'stored exactly as entered: no time parsing or zone conversion');
  assert.deepEqual(r.body.value.actor, { type: 'human', userId: U.auditor, role: 'auditor' });
  assert.equal((await call('GET', '/api/case', U.auditor)).body.value.checkpoint.sequence, head + 1);

  const refused: Array<[unknown, number]> = [
    [{ ...claim, sources: [] }, 400],
    [{ ...claim, sources: [{ evidenceId: 'BW-004', versionId: 'v-not-registered' }] }, 404],
    [{ ...claim, evidenceId: 'BW-999' }, 404],
    [{ ...claim, timezone: '  ' }, 400],
    [{ ...claim, recordedAt: '2021-10-13T21:40:00Z' }, 400],
  ];
  for (const [body, status] of refused) assert.equal((await call('POST', '/api/custody/assertion', U.auditor, body)).status, status, JSON.stringify(body).slice(0, 80));
  assert.equal((await call('POST', '/api/custody/assertion', U.outsider, claim)).status, 403);
  assert.equal((await call('GET', '/api/case', U.auditor)).body.value.head.sequence, head + 1, 'refusals append nothing');
});
