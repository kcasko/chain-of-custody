// DynamoStore against DynamoDB Local: the shared port contract, DynamoDB-
// specific limits, and the whole domain (ledger, evidence, verifier) running
// on DynamoDB instead of memory.

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { MemoryStore } from '../../../core/src/store.ts';
import { APPEND_ONLY_TABLES } from '../../../core/src/tables.ts';
import { verifyExport } from '../../../core/src/verifier.ts';
import { CASE, USERS, human, makeWorld, registerFixtures } from '../../../core/test/helpers.ts';
import { DynamoStore, encodeValue, MAX_TRANSACTION_ITEMS } from '../src/dynamo-store.ts';
import { startLocalDynamo } from './dynamodb-local.ts';
import { CONTRACT_APPEND_ONLY, storeContract } from './store-contract.ts';

describe('MemoryStore (reference for the contract)', () => {
  storeContract(async () => new MemoryStore({ appendOnlyTables: CONTRACT_APPEND_ONLY }));
});

test('encodeValue refuses values that would not survive JSON', () => {
  for (const bad of [{ a: undefined }, [undefined], new Date(0), new Uint8Array(2), Number.NaN, { n: Infinity }, { z: -0 }, () => 1, 10n]) {
    assert.throws(() => encodeValue(bad), TypeError, String(bad));
  }
  assert.equal(encodeValue({ a: [1, 'x', null] }), '{"a":[1,"x",null]}');
});

const local = await startLocalDynamo();
after(async () => { if (local.ok) await local.dynamo.stop(); });

describe('DynamoStore on DynamoDB Local', { skip: local.ok ? false : local.reason }, () => {
  const dynamo = local.ok ? local.dynamo : undefined!;
  async function fresh(appendOnlyTables: Iterable<string> = CONTRACT_APPEND_ONLY) {
    const tableName = `coc-test-${randomUUID()}`;
    await dynamo.createTable(tableName);
    return { tableName, store: new DynamoStore({ client: dynamo.client, tableName, appendOnlyTables }) };
  }

  describe('port contract', () => {
    storeContract(async () => (await fresh()).store);
  });

  test('DynamoDB itself refuses a create over an existing item (not only the adapter)', async () => {
    const { tableName, store } = await fresh([]);
    await store.transact([{ table: 'events', key: 'C1#1', value: 'orig', expectVersion: null }]);
    // An adapter configured without the append-only list still cannot replace
    // the item with a create-only write: the condition runs in DynamoDB.
    assert.deepEqual(await store.transact([{ table: 'events', key: 'C1#1', value: 'forged', expectVersion: null }]), { ok: false, reason: 'CONFLICT', index: 0 });
    const raw = await dynamo.client.send(new GetItemCommand({ TableName: tableName, Key: { pk: { S: 'events' }, sk: { S: 'C1#1' } }, ConsistentRead: true }));
    assert.equal(raw.Item?.v?.S, '"orig"');
  });

  test('list pages through more than 1 MB of results', async () => {
    const { store } = await fresh();
    const pad = 'x'.repeat(60_000);
    for (let batch = 0; batch < 3; batch += 1) {
      await store.transact(Array.from({ length: 10 }, (_, i) => ({ table: 'proposals', key: `C1#${String(batch * 10 + i).padStart(3, '0')}`, value: { pad }, expectVersion: null })));
    }
    const rows = await store.list('proposals', 'C1#');
    assert.equal(rows.length, 30, 'about 1.8 MB: needs at least two Query pages');
    assert.deepEqual(rows.map((r) => r.key), Array.from({ length: 30 }, (_, i) => `C1#${String(i).padStart(3, '0')}`));
  });

  test('transaction size is checked before calling DynamoDB', async () => {
    const { store } = await fresh();
    const writes = Array.from({ length: MAX_TRANSACTION_ITEMS + 1 }, (_, i) => ({ table: 'heads', key: `k${i}`, value: i, expectVersion: null }));
    await assert.rejects(store.transact(writes), /DynamoDB allows 100/);
  });

  test('items edited outside the adapter fail closed instead of decoding as valid', async () => {
    const { tableName, store } = await fresh();
    await dynamo.client.send(new PutItemCommand({ TableName: tableName, Item: { pk: { S: 'heads' }, sk: { S: 'bad' }, v: { S: '{}' }, ver: { N: '0' } } }));
    await assert.rejects(store.get('heads', 'bad'), /bad version/);
    await dynamo.client.send(new PutItemCommand({ TableName: tableName, Item: { pk: { S: 'heads' }, sk: { S: 'nov' }, ver: { N: '1' } } }));
    await assert.rejects(store.get('heads', 'nov'), /missing v/);
  });

  async function exportOn(store: DynamoStore) {
    const w = makeWorld({ store });
    const versions = await registerFixtures(w);
    const t = await w.custody.recordTransfer(human(USERS.investigator), CASE, { evidenceId: 'BW-007', versionId: versions.get('BW-007/original')!, from: 'locker', to: 'audit', reason: 'review' });
    assert.ok(t.ok);
    assert.ok((await w.checkpoints.issue(CASE, new Date('2026-11-18T17:00:00.000Z'))).ok);
    const payload = { evidence: ['BW-001/original', 'BW-002/transcode-2026'].map((k) => ({ evidenceId: k.split('/')[0]!, versionId: versions.get(k)! })), destination: 'internal:case-export-store' };
    const req = await w.approvals.requestExport(human(USERS.investigator), CASE, payload);
    assert.ok(req.ok);
    assert.ok((await w.approvals.approve(human(USERS.supervisor), req.value.approvalId)).ok);
    return { w, versions, run: () => w.exports.exportCase(human(USERS.investigator), CASE, req.value.approvalId, payload) };
  }

  test('the whole domain runs on DynamoDB: fixtures, custody, checkpoint, approved export, independent verify', async () => {
    const { store } = await fresh(APPEND_ONLY_TABLES);
    const { w, run } = await exportOn(store);
    const pkg = await run();
    assert.ok(pkg.ok, JSON.stringify(pkg));
    const head = await w.ledger.head(CASE);
    const reference = { caseId: CASE, minSequence: head.sequence, headHashAtMinSequence: head.hash, retrievedAt: '2026-11-18T17:05:00.000Z' };
    const r = verifyExport(JSON.parse(JSON.stringify(pkg.value)), { expectedCaseId: CASE, keys: [w.trustedKey], reference });
    assert.equal(r.status, 'VERIFIED', JSON.stringify(r.findings));
    assert.equal(r.freshness, 'FRESH');
    assert.equal(r.validThrough, (await w.ledger.head(CASE)).sequence);
    assert.ok(r.evidence.every((e) => e.verified));
    // The approval is single-use on DynamoDB too.
    const again = await run();
    assert.equal(again.ok, false);
  });

  test('concurrent ledger appends on DynamoDB leave one contiguous chain', async () => {
    const { store } = await fresh(APPEND_ONLY_TABLES);
    const w = makeWorld({ store });
    const versions = await registerFixtures(w);
    const ref = { evidenceId: 'BW-002', versionId: versions.get('BW-002/original')! };
    const before = (await w.ledger.head(CASE)).sequence;
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      w.custody.recordTransfer(human(USERS.investigator), CASE, { ...ref, from: 'evidence-room', to: `lab-${i}`, reason: `Concurrent transfer ${i}` })));
    const committed = results.filter((r) => r.ok).length;
    assert.ok(committed >= 1);
    for (const r of results) if (!r.ok) assert.equal(r.code, 'LEDGER_CONFLICT');
    const events = await w.ledger.events(CASE);
    assert.equal(events.length, before + committed);
    events.forEach((e, i) => {
      assert.equal(e.sequence, i + 1);
      if (i > 0) assert.equal(e.prevHash, events[i - 1]!.eventHash);
    });
  });

  test('a privileged raw rewrite of a ledger event is not prevented by storage, but the verifier catches it', async () => {
    const { tableName, store } = await fresh(APPEND_ONLY_TABLES);
    const { w, run } = await exportOn(store);
    const target = (await store.list<Record<string, unknown>>('events', `${CASE}#`))[3]!;
    // Someone with raw PutItem on the table, bypassing the adapter entirely.
    await dynamo.client.send(new PutItemCommand({ TableName: tableName, Item: { pk: { S: 'events' }, sk: { S: target.key }, v: { S: JSON.stringify({ ...target.item.value, recordedAt: '2021-01-01T00:00:00.000Z' }) }, ver: { N: '1' } } }));
    const pkg = await run();
    assert.ok(pkg.ok, 'export copies what storage holds; detection is the verifier job');
    const r = verifyExport(JSON.parse(JSON.stringify(pkg.value)), { expectedCaseId: CASE, keys: [w.trustedKey] });
    assert.equal(r.status, 'FAILED', JSON.stringify(r.findings));
    assert.ok(r.findings.some((f) => f.code === 'EVENT_HASH_MISMATCH'), JSON.stringify(r.findings.map((f) => f.code)));
  });
});
