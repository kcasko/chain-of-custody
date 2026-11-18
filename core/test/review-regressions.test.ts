// Regression tests for the independent security review of November 18, 2026.
// Each test reproduces a reported attack or defect against the fixed code.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { verifyExport, type Trust } from '../src/verifier.ts';
import { computeEventHash } from '../src/ledger.ts';
import { MemoryObjectStore } from '../src/evidence.ts';
import { TABLES, APPEND_ONLY_TABLES } from '../src/tables.ts';
import { InterleavingStore } from '../src/store.ts';
import { Ledger } from '../src/ledger.ts';
import { EvidenceService, StaticCaseScope } from '../src/evidence.ts';
import type { CustodyEvent } from '../src/types.ts';
import type { ExportPackage } from '../src/export.ts';
import { CASE, USERS, human, agent, makeWorld, makeStore, registerFixtures, deps, type World } from './helpers.ts';

const DEST = 'internal:case-export-store';
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

class CountingObjects extends MemoryObjectStore {
  puts = 0;
  override async putNew(key: string, bytes: Uint8Array): Promise<{ versionId: string }> {
    this.puts += 1;
    return super.putNew(key, bytes);
  }
}

async function approvedExport(w: World, versions: Map<string, string>, keys: string[]) {
  const payload = { evidence: keys.map((k) => ({ evidenceId: k.split('/')[0]!, versionId: versions.get(k)! })), destination: DEST };
  const req = await w.approvals.requestExport(human(USERS.investigator), CASE, payload);
  assert.ok(req.ok);
  assert.ok((await w.approvals.approve(human(USERS.supervisor), req.value.approvalId)).ok);
  return { payload, approvalId: req.value.approvalId };
}

// Finding 1 (high) ---------------------------------------------------------

test('F1: extraWrites passed to public custody calls are ignored, so an approval cannot be forged', async () => {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  const payload = { evidence: [{ evidenceId: 'BW-001', versionId: versions.get('BW-001/original')! }], destination: DEST };
  const req = await w.approvals.requestExport(human(USERS.investigator), CASE, payload);
  assert.ok(req.ok);
  const current = await w.approvals.getUnchecked(req.value.approvalId);
  const forged = { ...current!.approval, status: 'approved', approver: USERS.supervisor, decidedAt: '2026-11-18T16:00:00.000Z' };
  const options = { extraWrites: [{ table: TABLES.approvals, key: req.value.approvalId, value: forged, expectVersion: current!.version }] } as unknown as { idempotencyKey?: string };
  const t = await w.custody.recordTransfer(human(USERS.investigator), CASE, { evidenceId: 'BW-001', versionId: versions.get('BW-001/original')!, from: 'a', to: 'b', reason: 'cover' }, options);
  assert.ok(t.ok, 'the transfer itself is legitimate and still succeeds');
  assert.equal((await w.approvals.getUnchecked(req.value.approvalId))?.approval.status, 'pending', 'the smuggled write was not applied');
  const ex = await w.exports.exportCase(human(USERS.investigator), CASE, req.value.approvalId, payload);
  assert.equal(!ex.ok && ex.code, 'DENIED_APPROVAL_INVALID');
});

test('F1: the same holds for historical assertions and corrections', async () => {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  const smuggle = { extraWrites: [{ table: TABLES.events, key: `${CASE}#999999999999`, value: { forged: true }, expectVersion: null }] } as unknown as { idempotencyKey?: string };
  const [first] = await w.ledger.events(CASE);
  const c = await w.custody.appendCorrection(human(USERS.auditor), CASE, { targetSequence: 1, targetHash: first!.eventHash, reason: 'r' }, smuggle);
  assert.ok(c.ok);
  const h = await w.custody.recordHistoricalAssertion(human(USERS.auditor), CASE, {
    evidenceId: 'BW-007', sources: [{ evidenceId: 'BW-007', versionId: versions.get('BW-007/original')! }],
    statement: 's', claimedTimeRaw: 't', sourceClock: 'c', timezone: 'z', offsetUncertainty: 'u',
  }, smuggle);
  assert.ok(h.ok);
  assert.equal(await w.store.get(TABLES.events, `${CASE}#999999999999`), undefined);
});

// Finding 2 (high) ---------------------------------------------------------

async function anchoredExport() {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  assert.ok((await w.checkpoints.issue(CASE, new Date('2026-11-18T17:00:00.000Z'))).ok);
  const { payload, approvalId } = await approvedExport(w, versions, ['BW-001/original']);
  const pkg = await w.exports.exportCase(human(USERS.investigator), CASE, approvalId, payload);
  assert.ok(pkg.ok);
  const head = await w.ledger.head(CASE);
  const trust: Trust = { expectedCaseId: CASE, keys: [w.trustedKey], reference: { caseId: CASE, minSequence: head.sequence, headHashAtMinSequence: head.hash, retrievedAt: '2026-11-18T17:05:00.000Z' } };
  return { w, pkg: pkg.value, trust };
}

test('F2: re-registering an anchored version in an unanchored tail event with swapped bytes is rejected', async () => {
  const { pkg, trust } = await anchoredExport();
  const p = clone(pkg) as unknown as { events: CustodyEvent[]; files: Record<string, string>; evidence: ExportPackage['evidence'] };
  const entry = p.evidence[0]!;
  const original = p.events.find((e) => e.kind === 'evidence_registered' && e.body.evidenceId === entry.evidenceId && e.body.versionId === entry.versionId)!;
  const forgedBytes = Buffer.from('SYNTHETIC FIXTURE - forged replacement');
  const last = p.events.at(-1)!;
  const { eventHash: _oldHash, ...originalUnsigned } = original;
  const unsigned = {
    ...originalUnsigned, sequence: last.sequence + 1, prevHash: last.eventHash,
    body: { ...original.body, sha256: (await import('../src/crypto.ts')).sha256Hex(forgedBytes), size: forgedBytes.length },
  } as Omit<CustodyEvent, 'eventHash'>;
  p.events.push({ ...unsigned, eventHash: computeEventHash(unsigned) } as CustodyEvent);
  p.files[entry.path] = forgedBytes.toString('base64');
  const r = verifyExport(p, trust);
  assert.equal(r.status, 'FAILED');
  assert.ok(r.findings.some((f) => f.code === 'DUPLICATE_REGISTRATION'), JSON.stringify(r.findings));
  assert.ok(r.evidence.every((e) => !e.verified), 'nothing is reported verified in a failed package');
});

test('F2: evidence registered after the checkpoint is reported as unanchored, never verified', async () => {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  assert.ok((await w.checkpoints.issue(CASE, new Date('2026-11-18T17:00:00.000Z'))).ok);
  const late = await w.evidence.register(human(USERS.investigator), CASE, { evidenceId: 'BW-004', bytes: Buffer.from('SYNTHETIC late addition'), mediaType: 'text/plain' });
  assert.ok(late.ok && late.value.kind === 'evidence_registered');
  versions.set('BW-004/late', late.value.body.versionId);
  const { payload, approvalId } = await approvedExport(w, versions, ['BW-004/late']);
  const pkg = await w.exports.exportCase(human(USERS.investigator), CASE, approvalId, payload);
  assert.ok(pkg.ok);
  const r = verifyExport(clone(pkg.value), { expectedCaseId: CASE, keys: [w.trustedKey] });
  assert.ok(r.findings.some((f) => f.code === 'EVIDENCE_UNANCHORED'));
  assert.equal(r.evidence[0]!.verified, false);
  assert.notEqual(r.status, 'VERIFIED');
});

// Finding 8 ----------------------------------------------------------------

test('F8: a malformed trusted reference fails instead of producing FRESH', async () => {
  const { pkg, trust } = await anchoredExport();
  for (const minSequence of [0, -3, 1.5, Number.NaN]) {
    const r = verifyExport(clone(pkg), { ...trust, reference: { caseId: CASE, minSequence, retrievedAt: 'x' } });
    assert.equal(r.status, 'FAILED', String(minSequence));
    assert.notEqual(r.freshness, 'FRESH');
  }
  const badHash = verifyExport(clone(pkg), { ...trust, reference: { ...trust.reference!, headHashAtMinSequence: 'not-a-hash' } });
  assert.equal(badHash.status, 'FAILED');
});

// Findings 3 and 10 --------------------------------------------------------

test('F3: an idempotent registration retry returns the original event and stores nothing new', async () => {
  const objects = new CountingObjects();
  const w = makeWorld({ objects });
  const input = { evidenceId: 'BW-006', bytes: Buffer.from('SYNTHETIC retry test'), mediaType: 'text/plain' };
  const first = await w.evidence.register(human(USERS.investigator), CASE, input, { idempotencyKey: 'reg-1' });
  const retry = await w.evidence.register(human(USERS.investigator), CASE, input, { idempotencyKey: 'reg-1' });
  assert.ok(first.ok && retry.ok);
  assert.equal(retry.value.eventHash, first.value.eventHash);
  assert.equal(objects.puts, 1, 'the retry stored no second copy');
  const q = await w.evidence.quarantined(human(USERS.supervisor), CASE);
  assert.ok(q.ok);
  assert.equal(q.value.length, 0);
  const different = await w.evidence.register(human(USERS.investigator), CASE, { ...input, bytes: Buffer.from('SYNTHETIC other bytes') }, { idempotencyKey: 'reg-1' });
  assert.equal(!different.ok && different.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(objects.puts, 1, 'a refused retry stores nothing');
});

test('F3: concurrent identical registration retries register once; extra copies are quarantined, not exposed', async () => {
  const base = makeStore();
  const objects = new CountingObjects();
  const w = makeWorld({ store: base, objects });
  const il = new InterleavingStore(base);
  const d = deps(il);
  const racing = new EvidenceService({ ...d, ledger: new Ledger(il), objects, scope: new StaticCaseScope([{ caseId: CASE, evidenceIds: ['BW-006'] }]) });
  const input = { evidenceId: 'BW-006', bytes: Buffer.from('SYNTHETIC race'), mediaType: 'text/plain' };
  const results = await Promise.all(Array.from({ length: 5 }, () => racing.register(human(USERS.investigator), CASE, input, { idempotencyKey: 'race-1' })));
  assert.ok(results.every((r) => r.ok));
  assert.equal(new Set(results.map((r) => (r.ok ? r.value.eventHash : ''))).size, 1);
  assert.equal((await w.ledger.events(CASE)).length, 1);
  const q = await w.evidence.quarantined(human(USERS.supervisor), CASE);
  assert.ok(q.ok);
  assert.equal(q.value.length, objects.puts - 1, 'every extra stored copy is accounted for in quarantine');
});

test('F10: malformed idempotency keys are refused before anything is written', async () => {
  const objects = new CountingObjects();
  const w = makeWorld({ objects });
  const versions = await registerFixtures(w);
  const before = objects.puts;
  for (const key of ['', 'x'.repeat(129), 'has space', 'semi;colon', 42 as unknown as string]) {
    const t = await w.custody.recordTransfer(human(USERS.investigator), CASE, { evidenceId: 'BW-001', versionId: versions.get('BW-001/original')!, from: 'a', to: 'b', reason: 'r' }, { idempotencyKey: key });
    assert.equal(!t.ok && t.code, 'INVALID_REQUEST', String(key));
    const r = await w.evidence.register(human(USERS.investigator), CASE, { evidenceId: 'BW-006', bytes: Buffer.from('SYNTHETIC k'), mediaType: 'text/plain' }, { idempotencyKey: key });
    assert.equal(!r.ok && r.code, 'INVALID_REQUEST', String(key));
  }
  assert.equal(objects.puts, before);
  assert.equal((await w.ledger.head(CASE)).sequence, 12);
});

// Finding 4 ----------------------------------------------------------------

test('F4: a storage failure while assembling an export leaves the approval unused', async () => {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  const { payload, approvalId } = await approvedExport(w, versions, ['BW-001/original']);
  const original = w.checkpoints.latest.bind(w.checkpoints);
  w.checkpoints.latest = async () => { throw new Error('checkpoint store down'); };
  const r = await w.exports.exportCase(human(USERS.investigator), CASE, approvalId, payload);
  assert.equal(!r.ok && r.code, 'STORAGE_UNAVAILABLE');
  assert.equal((await w.approvals.getUnchecked(approvalId))?.approval.status, 'approved');
  assert.equal((await w.store.list(TABLES.exports, '')).length, 0);
  w.checkpoints.latest = original;
  assert.ok((await w.exports.exportCase(human(USERS.investigator), CASE, approvalId, payload)).ok, 'the same approval works once storage recovers');
});

// Findings 5, 6, 7 ---------------------------------------------------------

test('F5: blocked promotions and unknown IDs are written to the security audit log', async () => {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  const p = await w.proposals.create(agent(), CASE, { kind: 'custody_transfer', input: { evidenceId: 'BW-001', versionId: versions.get('BW-001/original')!, from: 'a', to: 'b', reason: 'r' } });
  assert.ok(p.ok);
  const before = w.audit.events.length;
  const byAgent = await w.proposals.promote(agent(), p.value.proposalId);
  assert.equal(!byAgent.ok && byAgent.code, 'DENIED_AGENT');
  assert.deepEqual(w.audit.events.slice(before).map((e) => [e.operation, e.outcome, e.code]), [['promote_proposal', 'denied', 'DENIED_AGENT']]);

  for (const [call, op] of [
    [() => w.proposals.promote(human(USERS.investigator), 'no-such-proposal'), 'promote_proposal'],
    [() => w.approvals.approve(human(USERS.supervisor), 'no-such-approval'), 'approve_request'],
    [() => w.approvals.revoke(human(USERS.investigator), 'no-such-approval'), 'revoke_approval'],
  ] as const) {
    const n = w.audit.events.length;
    const r = await call();
    assert.equal(!r.ok && r.code, 'NOT_FOUND');
    assert.deepEqual(w.audit.events.slice(n).map((e) => [e.operation, e.outcome, e.code, e.caseId]), [[op, 'denied', 'NOT_FOUND', '(unknown)']]);
  }
});

test('F6: revocation is its own audited operation', async () => {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  const { approvalId } = await approvedExport(w, versions, ['BW-001/original']);
  const n = w.audit.events.length;
  assert.ok((await w.approvals.revoke(human(USERS.investigator), approvalId)).ok);
  assert.ok(w.audit.events.slice(n).every((e) => e.operation === 'revoke_approval'));
  const byAgent = await w.approvals.revoke(agent(), approvalId);
  assert.equal(!byAgent.ok && byAgent.code, 'DENIED_AGENT');
});

test('F7: the quarantine view needs a case member and is closed to the agent', async () => {
  const w = makeWorld();
  for (const [ctx, code] of [[agent(), 'DENIED_AGENT'], [human(USERS.outsider), 'DENIED_NOT_MEMBER']] as const) {
    const r = await w.evidence.quarantined(ctx, CASE);
    assert.equal(!r.ok && r.code, code);
  }
});

// Re-review findings N1 to N6 ----------------------------------------------

test('N1: files must sit at the path of the evidence they claim; relabeled, duplicate and unlisted files fail', async () => {
  const { pkg, trust } = await anchoredExport();
  const entry = pkg.evidence[0]!;

  const relabeled = clone(pkg) as unknown as { evidence: Array<Record<string, unknown>>; files: Record<string, string> };
  relabeled.files['evidence/BW-009/v-forged-label'] = relabeled.files[entry.path]!;
  delete relabeled.files[entry.path];
  relabeled.evidence[0]!.path = 'evidence/BW-009/v-forged-label';
  const r1 = verifyExport(relabeled, trust);
  assert.equal(r1.status, 'FAILED');
  assert.ok(r1.findings.some((f) => f.code === 'EVIDENCE_PATH_MISMATCH'));

  const planted = clone(pkg) as unknown as { files: Record<string, string> };
  planted.files['evidence/BW-003/v-planted'] = Buffer.from('SYNTHETIC planted').toString('base64');
  const r2 = verifyExport(planted, trust);
  assert.equal(r2.status, 'FAILED');
  assert.ok(r2.findings.some((f) => f.code === 'EVIDENCE_UNLISTED_FILE'));
  assert.ok(r2.evidence.every((e) => !e.verified));

  const duplicated = clone(pkg) as unknown as { evidence: Array<Record<string, unknown>> };
  duplicated.evidence.push({ ...duplicated.evidence[0]! });
  assert.ok(verifyExport(duplicated, trust).findings.some((f) => f.code === 'EVIDENCE_DUPLICATE_ENTRY'));
});

test('N2: a checkpoint issued between reading events and checkpoint cannot produce an unverifiable export', async () => {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  assert.ok((await w.checkpoints.issue(CASE, new Date('2026-11-18T17:00:00.000Z'))).ok);
  const { payload, approvalId } = await approvedExport(w, versions, ['BW-001/original']);
  // Simulate a concurrent append plus a scheduled checkpoint landing in the middle of assembly.
  const realLatest = w.checkpoints.latest.bind(w.checkpoints);
  // The concurrent append and checkpoint land just before latest() returns, so
  // latest() returns the NEWER checkpoint (the real race in the review's PoC).
  w.checkpoints.latest = async (caseId: string) => {
    const t = await w.custody.recordTransfer(human(USERS.investigator), CASE, { evidenceId: 'BW-001', versionId: versions.get('BW-001/original')!, from: 'a', to: 'b', reason: 'concurrent' });
    assert.ok(t.ok);
    assert.ok((await w.checkpoints.issue(CASE, new Date('2026-11-18T17:30:00.000Z'))).ok);
    return realLatest(caseId);
  };
  const pkg = await w.exports.exportCase(human(USERS.investigator), CASE, approvalId, payload);
  assert.ok(pkg.ok);
  const r = verifyExport(clone(pkg.value), { expectedCaseId: CASE, keys: [w.trustedKey] });
  assert.notEqual(r.status, 'FAILED', JSON.stringify(r.findings));
  assert.ok(pkg.value.events.length >= (pkg.value.checkpoint?.body.sequence ?? 0));
});

test('N3: IDs are not an existence oracle for anonymous callers or non-members; the audit log keeps the truth', async () => {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  const { approvalId } = await approvedExport(w, versions, ['BW-001/original']);
  const anon = { principal: null, channel: 'api' as const, requestId: 'anon-1', now: new Date('2026-11-18T16:00:00.000Z') };
  for (const id of [approvalId, 'no-such-id']) {
    const a = await w.approvals.approve(anon, id);
    assert.equal(!a.ok && a.code, 'DENIED_NO_IDENTITY');
    const o = await w.approvals.revoke(human(USERS.outsider), id);
    assert.equal(!o.ok && o.code, 'NOT_FOUND');
  }
  assert.ok(w.audit.events.some((e) => e.principal === `human:${USERS.outsider}` && e.code === 'DENIED_NOT_MEMBER'), 'the real reason is audited');
});

test('N4: a store failure during an ID lookup is returned and audited, never thrown', async () => {
  const w = makeWorld();
  const realGet = w.store.get.bind(w.store);
  (w.store as { get: typeof w.store.get }).get = async () => { throw new Error('store down'); };
  try {
    for (const call of [
      () => w.proposals.promote(human(USERS.investigator), 'p-1'),
      () => w.approvals.approve(human(USERS.supervisor), 'a-1'),
      () => w.approvals.revoke(human(USERS.investigator), 'a-1'),
    ]) {
      const n = w.audit.events.length;
      const r = await call();
      assert.equal(!r.ok && r.code, 'STORAGE_UNAVAILABLE');
      assert.equal(w.audit.events.slice(n)[0]?.outcome, 'failed');
    }
  } finally {
    (w.store as { get: typeof w.store.get }).get = realGet;
  }
});

test('N5: malformed case IDs are refused before any lookup or scan', async () => {
  const w = makeWorld();
  for (const caseId of [`${CASE}#X`, 'blackwater-2021', '', 'A', '../x', 'X'.repeat(65)]) {
    const r = await w.evidence.list(human(USERS.auditor), caseId);
    assert.equal(!r.ok && r.code, 'INVALID_REQUEST', caseId);
  }
});

test('N6: the promotion capability cannot write arbitrary proposal state', async () => {
  let captured: import('../src/custody.ts').Promoter | undefined;
  const base = deps();
  const ledger = new Ledger(base.store);
  const { CustodyService } = await import('../src/custody.ts');
  new CustodyService({ ...base, ledger }, { onPromoter: (p) => { captured = p; } });
  assert.equal(captured!.length, 3, 'promoter takes (ctx, proposalId, expectVersion) only');
  const r = await captured!(human(USERS.investigator), 'does-not-exist', 1);
  assert.equal(!r.ok && r.code, 'LEDGER_CONFLICT');
  const byAgent = await captured!(agent(), 'does-not-exist', 1);
  assert.equal(!byAgent.ok && byAgent.code, 'DENIED_AGENT');
});

// Finding 9 ----------------------------------------------------------------

test('F9: the append-only table list lives in core and matches ADR 0005', () => {
  assert.deepEqual([...APPEND_ONLY_TABLES].sort(), ['checkpoints', 'events', 'exports', 'idempotency', 'quarantine']);
  for (const t of APPEND_ONLY_TABLES) assert.ok(Object.values(TABLES).includes(t as never), t);
  assert.ok(Object.isFrozen(APPEND_ONLY_TABLES));
});
