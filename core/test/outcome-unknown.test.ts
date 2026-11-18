// Review of T14 (HIGH-1, MEDIUM-1): a network store can commit a write and
// lose the answer. The core must reconcile by reading, never report a
// committed write as "nothing written", and never orphan stored bytes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectExistsError, MemoryObjectStore } from '../src/evidence.ts';
import { AmbiguousStore, OutcomeUnknownError, type TransactionalStore, type Write } from '../src/store.ts';
import { TABLES } from '../src/tables.ts';
import { verifyExport } from '../src/verifier.ts';
import { CASE, USERS, human, makeStore, makeWorld, registerFixtures } from './helpers.ts';

const touches = (table: string) => (writes: Write[]) => writes.some((w) => w.table === table);
const bytes = Buffer.from('synthetic note for the outcome-unknown tests\n');

function ambiguousWorld() {
  const store = new AmbiguousStore(makeStore());
  return { store, w: makeWorld({ store }) };
}

test('registration whose ledger write committed but whose answer was lost: reported as registered, not quarantined', async () => {
  const { store, w } = ambiguousWorld();
  store.when = touches(TABLES.events);
  const r = await w.evidence.register(human(USERS.investigator), CASE, { evidenceId: 'BW-001', bytes, mediaType: 'text/plain' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal((await w.ledger.head(CASE)).sequence, 1);
  assert.deepEqual(await store.list(TABLES.quarantine, `${CASE}#`), []);
});

test('registration whose ledger write did not commit and whose answer was lost: OUTCOME_UNKNOWN, bytes recorded for review', async () => {
  const { store, w } = ambiguousWorld();
  store.when = touches(TABLES.events);
  store.commit = false;
  const r = await w.evidence.register(human(USERS.investigator), CASE, { evidenceId: 'BW-001', bytes, mediaType: 'text/plain' });
  assert.equal(r.ok ? 'ok' : r.code, 'OUTCOME_UNKNOWN');
  assert.equal((await w.ledger.head(CASE)).sequence, 0);
  const q = await store.list<{ reason: string }>(TABLES.quarantine, `${CASE}#`);
  assert.equal(q.length, 1);
  assert.match(q[0]!.item.value.reason, /outcome unknown/);
});

test('custody append: committed-but-lost is ok; not committed is OUTCOME_UNKNOWN; slot taken by another event is LEDGER_CONFLICT', async () => {
  const { store, w } = ambiguousWorld();
  const versions = await registerFixtures(w);
  const transfer = { evidenceId: 'BW-002', versionId: versions.get('BW-002/original')!, from: 'locker', to: 'lab', reason: 'analysis' };
  const start = (await w.ledger.head(CASE)).sequence;
  store.when = touches(TABLES.events);
  const a = await w.custody.recordTransfer(human(USERS.investigator), CASE, transfer);
  assert.ok(a.ok && a.value.sequence === start + 1, JSON.stringify(a));
  store.commit = false;
  const b = await w.custody.recordTransfer(human(USERS.investigator), CASE, transfer);
  assert.equal(b.ok ? 'ok' : b.code, 'OUTCOME_UNKNOWN');
  assert.equal((await w.ledger.head(CASE)).sequence, start + 1);

  // Another writer takes the slot while our answer is lost.
  class Racing implements TransactionalStore {
    readonly inner = store.inner;
    get = this.inner.get.bind(this.inner);
    list = this.inner.list.bind(this.inner);
    async transact(writes: Write[]) {
      if (!touches(TABLES.events)(writes)) return this.inner.transact(writes);
      const event = writes.find((x) => x.table === TABLES.events)!;
      await this.inner.transact([{ ...event, value: { ...(event.value as object), eventHash: 'f'.repeat(64) } }]);
      throw new OutcomeUnknownError();
    }
  }
  const w2 = makeWorld({ store: new Racing() });
  const c = await w2.custody.recordTransfer(human(USERS.investigator), CASE, transfer);
  assert.equal(c.ok ? 'ok' : c.code, 'LEDGER_CONFLICT');
});

async function approvedExport(w: ReturnType<typeof makeWorld>) {
  const versions = await registerFixtures(w);
  const payload = { evidence: [{ evidenceId: 'BW-001', versionId: versions.get('BW-001/original')! }], destination: 'internal:case-export-store' };
  const req = await w.approvals.requestExport(human(USERS.investigator), CASE, payload);
  assert.ok(req.ok);
  assert.ok((await w.approvals.approve(human(USERS.supervisor), req.value.approvalId)).ok);
  return { approvalId: req.value.approvalId, run: () => w.exports.exportCase(human(USERS.investigator), CASE, req.value.approvalId, payload) };
}

test('export whose consume+record committed but whose answer was lost still delivers the package', async () => {
  const { store, w } = ambiguousWorld();
  const { approvalId, run } = await approvedExport(w);
  store.when = touches(TABLES.exports);
  const pkg = await run();
  assert.ok(pkg.ok, JSON.stringify(pkg));
  assert.equal(verifyExport(JSON.parse(JSON.stringify(pkg.value)), { expectedCaseId: CASE, keys: [w.trustedKey] }).evidence.length, 1);
  assert.equal((await store.get<{ status: string }>(TABLES.approvals, approvalId))?.value.status, 'consumed');
});

test('export whose consume+record did not commit: OUTCOME_UNKNOWN, approval still usable, retry succeeds', async () => {
  const { store, w } = ambiguousWorld();
  const { approvalId, run } = await approvedExport(w);
  store.when = touches(TABLES.exports);
  store.commit = false;
  const first = await run();
  assert.equal(first.ok ? 'ok' : first.code, 'OUTCOME_UNKNOWN');
  assert.equal((await store.get<{ status: string }>(TABLES.approvals, approvalId))?.value.status, 'approved');
  store.when = () => false;
  assert.ok((await run()).ok);
});

test('any other operation with an ambiguous write reports OUTCOME_UNKNOWN, not a plain failure', async () => {
  const { store, w } = ambiguousWorld();
  const versions = await registerFixtures(w);
  const req = await w.approvals.requestExport(human(USERS.investigator), CASE, { evidence: [{ evidenceId: 'BW-001', versionId: versions.get('BW-001/original')! }], destination: 'internal:case-export-store' });
  assert.ok(req.ok);
  store.when = touches(TABLES.approvals);
  const r = await w.approvals.approve(human(USERS.supervisor), req.value.approvalId);
  assert.equal(r.ok ? 'ok' : r.code, 'OUTCOME_UNKNOWN');
});

class StoresThenFails extends MemoryObjectStore {
  error: Error = new Error('post-write check failed');
  override async putNew(key: string, data: Uint8Array): Promise<{ versionId: string }> {
    await super.putNew(key, data);
    throw this.error;
  }
  keys(): string[] {
    return [...this.objects.keys()];
  }
}

test('bytes stored by a put that then failed are quarantined by key, never orphaned or registered', async () => {
  for (const error of [new ObjectExistsError('x'), new Error('S3 returned a version ID outside the accepted format')]) {
    const objects = new StoresThenFails();
    objects.error = error;
    const store = makeStore();
    const w = makeWorld({ store, objects });
    const r = await w.evidence.register(human(USERS.investigator), CASE, { evidenceId: 'BW-001', bytes, mediaType: 'text/plain' });
    assert.equal(r.ok ? 'ok' : r.code, 'STORAGE_UNAVAILABLE');
    assert.equal((await w.ledger.head(CASE)).sequence, 0);
    const q = await store.list<{ objectKey: string; versionId: string | null }>(TABLES.quarantine, `${CASE}#`);
    assert.equal(q.length, 1);
    assert.deepEqual([q[0]!.item.value.objectKey, q[0]!.item.value.versionId], [objects.keys()[0], null]);
  }
});
