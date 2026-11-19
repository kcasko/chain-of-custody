// T16: the durable security audit log. One contract for the in-memory log and
// DynamoAuditLog on DynamoDB Local, plus DynamoDB-specific behavior and the
// whole domain recording and reading its audit trail through DynamoDB.

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { MemoryAuditLog, type SecurityAuditLog, type SecurityEvent } from '../../../core/src/audit.ts';
import { CASE, OTHER_CASE, USERS, human, makeWorld, registerFixtures } from '../../../core/test/helpers.ts';
import { AUDIT_PK, DynamoAuditLog } from '../src/dynamo-audit.ts';
import { DynamoStore } from '../src/dynamo-store.ts';
import { APPEND_ONLY_TABLES } from '../../../core/src/tables.ts';
import { startLocalDynamo } from './dynamodb-local.ts';

const event = (caseId: string, n: number, outcome: SecurityEvent['outcome'] = 'attempted'): SecurityEvent => ({
  requestId: `r-${n}`, caseId, principal: 'human:mara.voss', operation: 'read_metadata', outcome, code: outcome === 'denied' ? 'DENIED_ROLE' : null, at: '2026-11-18T20:00:00.000Z',
});

function auditContract(make: () => Promise<SecurityAuditLog>) {
  test('records come back for their case only, newest first, in append order even with the same request time', async () => {
    const log = await make();
    for (let n = 1; n <= 5; n++) await log.append(event(CASE, n, n % 2 ? 'attempted' : 'completed'));
    await log.append(event(OTHER_CASE, 99));
    await log.append(event('(unknown)', 98, 'denied'));
    const r = await log.forCase(CASE, 10);
    assert.equal(r.total, 5);
    assert.deepEqual(r.events.map((e) => e.requestId), ['r-5', 'r-4', 'r-3', 'r-2', 'r-1']);
    assert.deepEqual(r.events[0], event(CASE, 5, 'attempted'), 'stored exactly as appended');
    assert.equal((await log.forCase(OTHER_CASE, 10)).total, 1);
    assert.deepEqual((await log.forCase('NO-SUCH-CASE', 10)), { events: [], total: 0 });
  });

  test('the limit keeps the newest records and the total still counts all of them', async () => {
    const log = await make();
    for (let n = 1; n <= 7; n++) await log.append(event(CASE, n));
    const r = await log.forCase(CASE, 3);
    assert.deepEqual(r.events.map((e) => e.requestId), ['r-7', 'r-6', 'r-5']);
    assert.equal(r.total, 7);
  });
}

describe('MemoryAuditLog (reference for the contract)', () => {
  auditContract(async () => new MemoryAuditLog());
});

const local = await startLocalDynamo();
after(async () => { if (local.ok) await local.dynamo.stop(); });

describe('DynamoAuditLog on DynamoDB Local', { skip: local.ok ? false : local.reason }, () => {
  const dynamo = local.ok ? local.dynamo : undefined!;
  async function fresh(now?: () => Date) {
    const tableName = `coc-audit-${randomUUID()}`;
    await dynamo.createTable(tableName);
    return { tableName, log: new DynamoAuditLog({ client: dynamo.client, tableName, ...(now ? { now } : {}) }) };
  }

  describe('port contract', () => {
    // A frozen clock: ordering must still follow append order.
    auditContract(async () => (await fresh(() => new Date('2026-11-18T20:00:00.000Z'))).log);
  });

  test('records are create-only: the store refuses to replace one, and DynamoDB refuses a create over it', async () => {
    const { tableName, log } = await fresh();
    await log.append(event(CASE, 1));
    const items = await dynamo.client.send(new QueryCommand({ TableName: tableName, KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': { S: AUDIT_PK } }, ConsistentRead: true }));
    const sk = items.Items![0]!.sk!.S!;
    const store = new DynamoStore({ client: dynamo.client, tableName, appendOnlyTables: APPEND_ONLY_TABLES });
    await assert.rejects(store.transact([{ table: AUDIT_PK, key: sk, value: { ...event(CASE, 1), outcome: 'completed' }, expectVersion: 1 }]), /append-only/i);
    assert.deepEqual(await store.transact([{ table: AUDIT_PK, key: sk, value: 'forged', expectVersion: null }]), { ok: false, reason: 'CONFLICT', index: 0 });
    assert.deepEqual((await log.forCase(CASE, 5)).events, [event(CASE, 1)]);
  });

  test('a malformed record is reported, never skipped', async () => {
    const { tableName, log } = await fresh();
    await log.append(event(CASE, 1));
    await dynamo.client.send(new PutItemCommand({ TableName: tableName, Item: { pk: { S: AUDIT_PK }, sk: { S: `${CASE}#9999-12-31T00:00:00.000Z#000000#x` }, v: { S: '{"requestId":"r","caseId":"BLACKWATER-2021","outcome":"erased"}' }, ver: { N: '1' } } }));
    await assert.rejects(log.forCase(CASE, 5), /malformed audit item/);
  });

  test('case ids that could cross a key boundary are refused', async () => {
    const { log } = await fresh();
    await assert.rejects(log.append(event('A#B', 1)), /must not contain #/);
    await assert.rejects(log.forCase('A#B', 5), /must not contain #/);
    await assert.rejects(log.forCase(CASE, 0), /positive integer/);
  });

  test('the whole domain audits through DynamoDB; a supervisor reads it back through the core', async () => {
    const { log } = await fresh();
    const w = makeWorld({ audit: log });
    await registerFixtures(w);
    const refused = await w.caseRead.auditLog(human(USERS.auditor), CASE);
    assert.equal(!refused.ok && refused.code, 'DENIED_ROLE');
    const r = await w.caseRead.auditLog(human(USERS.supervisor), CASE);
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual([r.value.events[0]!.operation, r.value.events[0]!.outcome, r.value.events[0]!.principal], ['read_audit_log', 'attempted', `human:${USERS.supervisor}`]);
    assert.deepEqual([r.value.events[1]!.operation, r.value.events[1]!.code, r.value.events[1]!.principal], ['read_audit_log', 'DENIED_ROLE', `human:${USERS.auditor}`]);
    assert.ok(r.value.total >= 24, 'registration of 12 versions left attempted and completed records');
  });

  test('an unreachable audit table fails closed: no protected action runs', async () => {
    const tableName = `coc-audit-missing-${randomUUID()}`; // never created
    const w = makeWorld({ audit: new DynamoAuditLog({ client: dynamo.client, tableName }) });
    const r = await w.caseRead.timeline(human(USERS.auditor), CASE);
    assert.equal(!r.ok && r.code, 'DENIED_AUDIT_UNAVAILABLE');
  });
});
