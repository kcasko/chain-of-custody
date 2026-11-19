// T04: append-only ledger, custody operations, corrections, idempotency,
// concurrency and agent proposals.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Ledger, computeEventHash } from '../src/ledger.ts';
import { CustodyService } from '../src/custody.ts';
import { InterleavingStore, AppendOnlyViolation, type TransactionalStore, type Write, type Item, type TransactResult } from '../src/store.ts';
import { ZERO_HASH } from '../src/crypto.ts';
import type { CustodyEvent } from '../src/types.ts';
import { CASE, OTHER_CASE, USERS, human, agent, makeWorld, makeStore, registerFixtures, deps, wireCustody } from './helpers.ts';

async function seeded() {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  const transfer = { evidenceId: 'BW-007', versionId: versions.get('BW-007/original')!, from: 'evidence locker A', to: 'audit review', reason: 'T04 test transfer' };
  return { w, versions, transfer };
}

function assertChain(events: readonly CustodyEvent[]) {
  let prev = ZERO_HASH;
  events.forEach((e, i) => {
    assert.equal(e.sequence, i + 1);
    assert.equal(e.prevHash, prev);
    const { eventHash, ...rest } = e;
    assert.equal(computeEventHash(rest), eventHash);
    prev = eventHash;
  });
}

test('events form one per-case hash chain from sequence 1', async () => {
  const { w, transfer } = await seeded();
  assert.ok((await w.custody.recordTransfer(human(USERS.investigator), CASE, transfer)).ok);
  const events = await w.ledger.events(CASE);
  assert.equal(events.length, 13);
  assertChain(events);
  assert.equal((await w.ledger.head(CASE)).hash, events.at(-1)!.eventHash);
  assert.deepEqual(await w.ledger.events(OTHER_CASE), []);
});

test('the ledger exposes no update or delete; events are frozen; the table is append-only', async () => {
  const { w } = await seeded();
  const methods = Object.getOwnPropertyNames(Ledger.prototype).filter((n) => n !== 'constructor');
  for (const m of methods) assert.doesNotMatch(m, /update|delete|remove|edit|rewrite|set/i, m);
  const [first] = await w.ledger.events(CASE);
  assert.throws(() => { (first as { sequence: number }).sequence = 99; }, TypeError);
  assert.throws(() => { (first!.body as { sha256: string }).sha256 = 'x'; }, TypeError);
  await assert.rejects(() => w.store.transact([{ table: 'events', key: `${CASE}#000000000001`, value: {}, expectVersion: 1 }]), AppendOnlyViolation);
});

test('recordedAt is context only: order comes from sequence even if server time moves backward', async () => {
  const { w, transfer } = await seeded();
  const r = await w.custody.recordTransfer(human(USERS.investigator, new Date('2020-01-01T00:00:00.000Z')), CASE, transfer);
  assert.ok(r.ok);
  assert.equal(r.value.sequence, 13);
  assertChain(await w.ledger.events(CASE));
});

test('V10: 20 concurrent appends with interleaving never share a sequence or break the chain', async () => {
  const base = makeStore();
  const w = makeWorld({ store: base });
  const versions = await registerFixtures(w);
  const racing = new CustodyService({ ...deps(new InterleavingStore(base)), ledger: new Ledger(new InterleavingStore(base)) });
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => racing.recordTransfer(human(USERS.investigator), CASE, {
    evidenceId: 'BW-005', versionId: versions.get('BW-005/original')!, from: 'shelf', to: 'desk', reason: `concurrent ${i}`,
  })));
  const winners = results.filter((r) => r.ok);
  const conflicts = results.filter((r) => !r.ok && r.code === 'LEDGER_CONFLICT');
  assert.equal(winners.length + conflicts.length, 20, 'every call either appended or reported a conflict');
  assert.ok(conflicts.length > 0, 'the race was actually exercised');
  const seqs = winners.map((r) => (r.ok ? r.value.sequence : 0));
  assert.equal(new Set(seqs).size, seqs.length);
  const events = await w.ledger.events(CASE);
  assert.equal(events.length, 12 + winners.length);
  assertChain(events);
});

test('L10: the same idempotent request returns the original event; a reused key with new content is refused', async () => {
  const { w, transfer } = await seeded();
  const a = await w.custody.recordTransfer(human(USERS.investigator), CASE, transfer, { idempotencyKey: 'k-1' });
  const b = await w.custody.recordTransfer(human(USERS.investigator), CASE, transfer, { idempotencyKey: 'k-1' });
  assert.ok(a.ok && b.ok);
  assert.equal(a.value.eventHash, b.value.eventHash);
  assert.equal((await w.ledger.head(CASE)).sequence, 13);
  const c = await w.custody.recordTransfer(human(USERS.investigator), CASE, { ...transfer, to: 'elsewhere' }, { idempotencyKey: 'k-1' });
  assert.equal(!c.ok && c.code, 'IDEMPOTENCY_KEY_REUSED');
  const otherUser = await w.custody.recordTransfer(human(USERS.supervisor), CASE, transfer, { idempotencyKey: 'k-1' });
  assert.ok(otherUser.ok, 'keys are bound to the actor');
  assert.equal(otherUser.value.sequence, 14);
});

test('L10: ten concurrent retries of one idempotent request append exactly once', async () => {
  const base = makeStore();
  const w = makeWorld({ store: base });
  const versions = await registerFixtures(w);
  const racing = new CustodyService({ ...deps(new InterleavingStore(base)), ledger: new Ledger(new InterleavingStore(base)) });
  const req = { evidenceId: 'BW-001', versionId: versions.get('BW-001/original')!, from: 'a', to: 'b', reason: 'retry storm' };
  const results = await Promise.all(Array.from({ length: 10 }, () => racing.recordTransfer(human(USERS.investigator), CASE, req, { idempotencyKey: 'storm' })));
  const hashes = new Set(results.filter((r) => r.ok).map((r) => (r.ok ? r.value.eventHash : '')));
  assert.equal(hashes.size, 1);
  assert.equal((await w.ledger.events(CASE)).filter((e) => e.kind === 'custody_transfer').length, 1);
});

test('L06/A05: corrections append and reference the exact target; they never edit it', async () => {
  const { w, transfer } = await seeded();
  const t = await w.custody.recordTransfer(human(USERS.investigator), CASE, transfer);
  assert.ok(t.ok);
  const c = await w.custody.appendCorrection(human(USERS.auditor), CASE, { targetSequence: t.value.sequence, targetHash: t.value.eventHash, reason: 'destination was mis-typed' });
  assert.ok(c.ok);
  assert.equal(c.value.sequence, t.value.sequence + 1);
  assert.deepEqual(await w.ledger.eventAt(CASE, t.value.sequence), t.value, 'the original is unchanged');
  for (const [input, code] of [
    [{ targetSequence: t.value.sequence, targetHash: '0'.repeat(64), reason: 'r' }, 'INVALID_REQUEST'],
    [{ targetSequence: 999, targetHash: t.value.eventHash, reason: 'r' }, 'NOT_FOUND'],
    [{ targetSequence: 0, targetHash: t.value.eventHash, reason: 'r' }, 'INVALID_REQUEST'],
    [{ targetSequence: 1.5, targetHash: t.value.eventHash, reason: 'r' }, 'INVALID_REQUEST'],
    [{ targetSequence: t.value.sequence, targetHash: t.value.eventHash, reason: 'r', replacement: { to: 'x' } }, 'INVALID_REQUEST'],
  ] as const) {
    const r = await w.custody.appendCorrection(human(USERS.auditor), CASE, input);
    assert.equal(!r.ok && r.code, code, JSON.stringify(input));
  }
});

test('corrections cannot target another case', async () => {
  const { w } = await seeded();
  const [first] = await w.ledger.events(CASE);
  const r = await w.custody.appendCorrection(human(USERS.outsider), OTHER_CASE, { targetSequence: 1, targetHash: first!.eventHash, reason: 'cross-case' });
  assert.equal(!r.ok && r.code, 'NOT_FOUND');
});

test('A04: a historical assertion must cite registered pinned sources and keep raw time and clock', async () => {
  const { w, versions } = await seeded();
  const good = {
    evidenceId: 'BW-007', sources: [{ evidenceId: 'BW-007', versionId: versions.get('BW-007/original')! }],
    statement: 'Manifest shows sealing by E. Ward; receiving signature is blank.',
    claimedTimeRaw: '10/14/2021 02:40', sourceClock: 'handwritten', timezone: 'not stated', offsetUncertainty: 'unknown',
  };
  const r = await w.custody.recordHistoricalAssertion(human(USERS.auditor), CASE, good);
  assert.ok(r.ok, 'auditors may record what a source claims');
  assert.equal(r.value.kind === 'historical_assertion' && r.value.body.claimedTimeRaw, '10/14/2021 02:40');
  assert.notEqual(r.value.recordedAt, '10/14/2021 02:40');
  for (const [mut, code] of [
    [{ sources: [{ evidenceId: 'BW-007', versionId: 'v-fabricated' }] }, 'NOT_FOUND'],
    [{ sources: [] }, 'INVALID_REQUEST'],
    [{ sourceClock: '' }, 'INVALID_REQUEST'],
    [{ claimedTimeRaw: undefined }, 'INVALID_REQUEST'],
    [{ statement: 'é' }, 'INVALID_REQUEST'],
    [{ receivedBy: 'V. Sloane' }, 'INVALID_REQUEST'],
  ] as const) {
    const res = await w.custody.recordHistoricalAssertion(human(USERS.auditor), CASE, { ...good, ...mut });
    assert.equal(!res.ok && res.code, code, JSON.stringify(mut));
  }
});

test('transfers need a registered version and a closed shape; auditors cannot transfer', async () => {
  const { w, transfer } = await seeded();
  const unregistered = await w.custody.recordTransfer(human(USERS.investigator), CASE, { ...transfer, versionId: 'v-ghost' });
  assert.equal(!unregistered.ok && unregistered.code, 'NOT_FOUND');
  for (const extra of [{ actor: 'supervisor' }, { approvalId: 'ap-1' }, { caseId: OTHER_CASE }]) {
    const r = await w.custody.recordTransfer(human(USERS.investigator), CASE, { ...transfer, ...extra });
    assert.equal(!r.ok && r.code, 'INVALID_REQUEST', JSON.stringify(extra));
  }
  const auditor = await w.custody.recordTransfer(human(USERS.auditor), CASE, transfer);
  assert.equal(!auditor.ok && auditor.code, 'DENIED_ROLE');
});

test('the agent cannot append anything to the ledger directly', async () => {
  const { w, transfer, versions } = await seeded();
  const t = await w.custody.recordTransfer(agent(), CASE, transfer);
  const [first] = await w.ledger.events(CASE);
  const c = await w.custody.appendCorrection(agent(), CASE, { targetSequence: 1, targetHash: first!.eventHash, reason: 'r' });
  const h = await w.custody.recordHistoricalAssertion(agent(), CASE, { evidenceId: 'BW-007', sources: [{ evidenceId: 'BW-007', versionId: versions.get('BW-007/original')! }], statement: 's', claimedTimeRaw: 't', sourceClock: 'c', timezone: 'z', offsetUncertainty: 'u' });
  for (const r of [t, c, h]) assert.equal(!r.ok && r.code, 'DENIED_AGENT');
  assert.equal((await w.ledger.head(CASE)).sequence, 12);
});

test('agent proposals are drafts; a human promotion re-runs policy and commits atomically once', async () => {
  const { w, transfer } = await seeded();
  const p = await w.proposals.create(agent(), CASE, { kind: 'custody_transfer', input: transfer });
  assert.ok(p.ok, 'the agent can propose (legitimate control)');
  assert.equal((await w.ledger.head(CASE)).sequence, 12, 'a draft does not touch the ledger');

  const byAgent = await w.proposals.promote(agent(), p.value.proposalId);
  assert.equal(!byAgent.ok && byAgent.code, 'DENIED_AGENT');
  const byAuditor = await w.proposals.promote(human(USERS.auditor), p.value.proposalId);
  assert.equal(!byAuditor.ok && byAuditor.code, 'DENIED_ROLE', 'auditors cannot add transfers, so they cannot promote one');
  assert.equal((await w.proposals.getUnchecked(p.value.proposalId))?.status, 'draft');

  const promoted = await w.proposals.promote(human(USERS.investigator), p.value.proposalId);
  assert.ok(promoted.ok);
  assert.deepEqual(promoted.value.actor, { type: 'human', userId: USERS.investigator, role: 'investigator' });
  assert.equal((await w.proposals.getUnchecked(p.value.proposalId))?.status, 'promoted');
  const again = await w.proposals.promote(human(USERS.supervisor), p.value.proposalId);
  assert.equal(again.ok, false);
});

test('concurrent promotions of one proposal produce exactly one event', async () => {
  const base = makeStore();
  const w = makeWorld({ store: base });
  const versions = await registerFixtures(w);
  const p = await w.proposals.create(agent(), CASE, { kind: 'custody_transfer', input: { evidenceId: 'BW-001', versionId: versions.get('BW-001/original')!, from: 'a', to: 'b', reason: 'r' } });
  assert.ok(p.ok);
  const il = new InterleavingStore(base);
  const d = deps(il);
  const racing = wireCustody(d, new Ledger(il)).proposals;
  const results = await Promise.all(Array.from({ length: 6 }, () => racing.promote(human(USERS.investigator), p.value.proposalId)));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal((await w.ledger.events(CASE)).filter((e) => e.kind === 'custody_transfer').length, 1);
});

test('humans cannot create proposals; bad proposal kinds and oversized input are refused', async () => {
  const { w, transfer } = await seeded();
  const byHuman = await w.proposals.create(human(USERS.investigator), CASE, { kind: 'custody_transfer', input: transfer });
  assert.equal(!byHuman.ok && byHuman.code, 'DENIED_ROLE');
  for (const req of [
    { kind: 'overwrite_original', input: {} },
    { kind: 'approval', input: {} },
    { kind: 'custody_transfer', input: { reason: 'x'.repeat(9000) } },
    { kind: 'custody_transfer', input: { n: 1.5 } },
    { kind: 'custody_transfer', input: {}, approved: true },
  ]) {
    const r = await w.proposals.create(agent(), CASE, req);
    assert.equal(!r.ok && r.code, 'INVALID_REQUEST', JSON.stringify(req).slice(0, 60));
  }
});

test('a human dismisses a draft with a reason: kept as dismissed, never on the ledger, never promotable', async () => {
  const { w, transfer } = await seeded();
  const p = await w.proposals.create(agent(), CASE, { kind: 'custody_transfer', input: transfer });
  assert.ok(p.ok);
  const id = p.value.proposalId;

  const byAgent = await w.proposals.dismiss(agent(), { proposalId: id, reason: 'not needed' });
  assert.equal(!byAgent.ok && byAgent.code, 'DENIED_AGENT', 'the agent cannot withdraw or bury drafts');
  const byOutsider = await w.proposals.dismiss(human(USERS.outsider), { proposalId: id, reason: 'x' });
  assert.equal(!byOutsider.ok && byOutsider.code, 'NOT_FOUND', 'a non-member learns nothing about the draft');
  for (const bad of [{ proposalId: id }, { proposalId: id, reason: '   ' }, { proposalId: id, reason: 'r'.repeat(2001) }, { proposalId: id, reason: 'ok', status: 'draft' }]) {
    const r = await w.proposals.dismiss(human(USERS.auditor), bad);
    assert.equal(!r.ok && r.code, 'INVALID_REQUEST', JSON.stringify(bad).slice(0, 60));
  }
  assert.equal((await w.proposals.getUnchecked(id))?.status, 'draft');

  const head = (await w.ledger.head(CASE)).sequence;
  const auditBefore = w.audit.events.length;
  const d = await w.proposals.dismiss(human(USERS.auditor), { proposalId: id, reason: 'BW-007 never left the locker; the draft misreads BW-004' });
  assert.ok(d.ok, JSON.stringify(d));
  assert.equal(d.value.status, 'dismissed');
  assert.deepEqual(d.value.dismissal, { by: USERS.auditor, at: '2026-11-18T16:00:00.000Z', reason: 'BW-007 never left the locker; the draft misreads BW-004' });
  assert.deepEqual(d.value.input, transfer, 'the draft content is kept as proposed');
  assert.equal((await w.ledger.head(CASE)).sequence, head, 'dismissal does not touch the ledger');
  assert.deepEqual(w.audit.events.slice(auditBefore).map((e) => [e.operation, e.outcome, e.principal]),
    [['dismiss_proposal', 'attempted', `human:${USERS.auditor}`], ['dismiss_proposal', 'completed', `human:${USERS.auditor}`]]);

  const promote = await w.proposals.promote(human(USERS.investigator), id);
  assert.equal(!promote.ok && promote.code, 'INVALID_REQUEST');
  const again = await w.proposals.dismiss(human(USERS.supervisor), { proposalId: id, reason: 'again' });
  assert.equal(!again.ok && again.code, 'INVALID_REQUEST');
  assert.equal((await w.proposals.getUnchecked(id))?.dismissal?.by, USERS.auditor, 'the first dismissal stands');
});

test('a dismissal racing promotions: exactly one wins, and the ledger agrees with the draft', async () => {
  for (let round = 0; round < 5; round++) {
    const base = makeStore();
    const w = makeWorld({ store: base });
    const versions = await registerFixtures(w);
    const p = await w.proposals.create(agent(), CASE, { kind: 'custody_transfer', input: { evidenceId: 'BW-001', versionId: versions.get('BW-001/original')!, from: 'a', to: 'b', reason: 'r' } });
    assert.ok(p.ok);
    const il = new InterleavingStore(base);
    const racing = wireCustody(deps(il), new Ledger(il)).proposals;
    const results = await Promise.all([
      racing.dismiss(human(USERS.auditor), { proposalId: p.value.proposalId, reason: 'set aside' }),
      ...Array.from({ length: 3 }, () => racing.promote(human(USERS.investigator), p.value.proposalId)),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1, `round ${round}`);
    const status = (await w.proposals.getUnchecked(p.value.proposalId))?.status;
    const transfers = (await w.ledger.events(CASE)).filter((e) => e.kind === 'custody_transfer').length;
    assert.equal(transfers, status === 'promoted' ? 1 : 0, `round ${round}: ${status}`);
    assert.equal(results[0]!.ok, status === 'dismissed');
  }
});

// Runs \`hook\` once, just before the first transaction that writes a dismissed
// proposal: the exact window a stale dismissal would need.
class BeforeDismissWrite implements TransactionalStore {
  hook: (() => Promise<unknown>) | undefined;
  readonly inner: TransactionalStore;
  constructor(inner: TransactionalStore) {
    this.inner = inner;
  }
  get<T>(table: string, key: string): Promise<Item<T> | undefined> {
    return this.inner.get<T>(table, key);
  }
  list<T>(table: string, keyPrefix: string): Promise<Array<{ key: string; item: Item<T> }>> {
    return this.inner.list<T>(table, keyPrefix);
  }
  async transact(writes: Write[]): Promise<TransactResult> {
    const hook = this.hook;
    if (hook && writes.some((w) => (w.value as { status?: string } | undefined)?.status === 'dismissed')) {
      this.hook = undefined;
      await hook();
    }
    return this.inner.transact(writes);
  }
}

test('a promotion that lands between a dismissal\'s read and write wins; the stale dismissal is refused', async () => {
  const base = makeStore();
  const w = makeWorld({ store: base });
  const versions = await registerFixtures(w);
  const p = await w.proposals.create(agent(), CASE, { kind: 'custody_transfer', input: { evidenceId: 'BW-001', versionId: versions.get('BW-001/original')!, from: 'a', to: 'b', reason: 'r' } });
  assert.ok(p.ok);
  const store = new BeforeDismissWrite(base);
  const dismisser = wireCustody(deps(store), new Ledger(store)).proposals;
  let promoted: unknown;
  store.hook = async () => { promoted = await w.proposals.promote(human(USERS.investigator), p.value.proposalId); };
  const d = await dismisser.dismiss(human(USERS.auditor), { proposalId: p.value.proposalId, reason: 'set aside' });
  assert.ok((promoted as { ok: boolean }).ok, 'the promotion went through inside the window');
  assert.equal(!d.ok && d.code, 'LEDGER_CONFLICT');
  assert.equal((await w.proposals.getUnchecked(p.value.proposalId))?.status, 'promoted', 'the draft is not overwritten as dismissed');
  assert.equal((await w.ledger.events(CASE)).filter((e) => e.kind === 'custody_transfer').length, 1);
});
