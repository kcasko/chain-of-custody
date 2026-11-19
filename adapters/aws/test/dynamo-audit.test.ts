// T16: the durable security audit log. One contract for the in-memory log and
// DynamoAuditLog on DynamoDB Local, plus DynamoDB-specific behavior and the
// whole domain recording and reading its audit trail through DynamoDB.

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { AuditIntegrityError, MemoryAuditLog, type SecurityAuditLog, type SecurityEvent } from '../../../core/src/audit.ts';
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
    const none = await log.forCase('NO-SUCH-CASE', 10);
    assert.deepEqual([none.events, none.total, none.totalIsLowerBound ?? false], [[], 0, false]);
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
  async function fresh(now?: () => Date, maxCountPages?: number) {
    const tableName = `coc-audit-${randomUUID()}`;
    await dynamo.createTable(tableName);
    return { tableName, log: new DynamoAuditLog({ client: dynamo.client, tableName, ...(now ? { now } : {}), ...(maxCountPages ? { maxCountPages } : {}) }) };
  }
  const forge = (tableName: string, sk: string, body: string) =>
    dynamo.client.send(new PutItemCommand({ TableName: tableName, Item: { pk: { S: AUDIT_PK }, sk: { S: sk }, v: { S: body }, ver: { N: '1' } } }));

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

  test('a malformed record is reported as an integrity failure, never skipped', async () => {
    const { tableName, log } = await fresh();
    await log.append(event(CASE, 1));
    await forge(tableName, `${CASE}#9999-12-31T00:00:00.000Z#000000#x`, '{"requestId":"r","caseId":"BLACKWATER-2021","outcome":"erased"}');
    await assert.rejects(log.forCase(CASE, 5), (e: Error) => e instanceof AuditIntegrityError && /unexpected shape/.test(e.message));
  });

  test('a record filed under one case but naming another is an integrity failure, not shown', async () => {
    const { tableName, log } = await fresh();
    await log.append(event(CASE, 1));
    await forge(tableName, `${CASE}#9999-12-31T00:00:00.000Z#000000#y`, JSON.stringify(event(OTHER_CASE, 2)));
    await assert.rejects(log.forCase(CASE, 5), (e: Error) => e instanceof AuditIntegrityError && /names case GREYHOLLOW-2019/.test(e.message));
  });

  test('the total stops at the count bound and is reported as a lower bound, not a failure', async () => {
    const { tableName, log } = await fresh(undefined, 1);
    const pad = 'x'.repeat(200_000); // about 5 items per 1 MB COUNT page
    for (let n = 0; n < 12; n++) await forge(tableName, `${CASE}#2026-11-18T20:00:00.${String(n).padStart(3, '0')}Z#000000#p${n}`, JSON.stringify({ ...event(CASE, n), requestId: `r-${n}-${pad}` }));
    const r = await log.forCase(CASE, 2);
    assert.equal(r.events.length, 2);
    assert.equal(r.totalIsLowerBound, true);
    assert.ok(r.total >= 2 && r.total < 12, String(r.total));
    const full = await (await fresh()).log.forCase(CASE, 2);
    assert.equal(full.totalIsLowerBound, false, 'a small log is counted exactly');
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

  test('a tampered audit record makes the supervisor view report INTEGRITY_FAILURE, not a storage error', async () => {
    const { tableName, log } = await fresh();
    const w = makeWorld({ audit: log });
    await forge(tableName, `${CASE}#9999-12-31T00:00:00.000Z#000000#z`, '{"not":"an audit event"}');
    const r = await w.caseRead.auditLog(human(USERS.supervisor), CASE);
    assert.equal(!r.ok && r.code, 'INTEGRITY_FAILURE');
  });

  test('an unreachable audit table fails closed: no protected action runs', async () => {
    const tableName = `coc-audit-missing-${randomUUID()}`; // never created
    const w = makeWorld({ audit: new DynamoAuditLog({ client: dynamo.client, tableName }) });
    const r = await w.caseRead.timeline(human(USERS.auditor), CASE);
    assert.equal(!r.ok && r.code, 'DENIED_AUDIT_UNAVAILABLE');
  });
});
