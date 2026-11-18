// T14b: the adapters against real DynamoDB and S3 (plan:
// docs/plans/2026-11-18-t14-real-aws-adapter-run.md). Skipped unless
// COC_REAL_AWS=1 and COC_TEST_TABLE, COC_TEST_BUCKET, AWS_REGION are set.
// Run it only with the least-privilege test role's credentials: several
// checks assert that this role is DENIED things an admin could do.
//
// Results (no account IDs, ARNs or credentials) are written to COC_REPORT.

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import {
  BatchWriteItemCommand, DeleteItemCommand, DeleteTableCommand, DynamoDBClient, PutItemCommand, UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { DeleteObjectCommand, PutBucketVersioningCommand, PutObjectCommand, PutObjectRetentionCommand, S3Client } from '@aws-sdk/client-s3';
import { ObjectExistsError } from '../../../core/src/evidence.ts';
import type { Item, TransactResult, TransactionalStore, Write } from '../../../core/src/store.ts';
import { APPEND_ONLY_TABLES } from '../../../core/src/tables.ts';
import { VERSION_ID } from '../../../core/src/validate.ts';
import { verifyExport } from '../../../core/src/verifier.ts';
import { CASE, USERS, human, makeWorld, registerFixtures } from '../../../core/test/helpers.ts';
import { DynamoStore } from '../src/dynamo-store.ts';
import { S3ObjectStore } from '../src/s3-objects.ts';
import { CONTRACT_APPEND_ONLY, storeContract } from './store-contract.ts';

const env = process.env;
const enabled = env.COC_REAL_AWS === '1' && !!env.COC_TEST_TABLE && !!env.COC_TEST_BUCKET && !!env.AWS_REGION;
const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
const report: Record<string, unknown> = { runId, startedAt: new Date().toISOString(), region: env.AWS_REGION };
const versionIds: string[] = [];

after(() => {
  if (!enabled || !env.COC_REPORT) return;
  report.finishedAt = new Date().toISOString();
  report.versionIds = { count: versionIds.length, allMatchPattern: versionIds.every((v) => VERSION_ID.test(v)), lengths: [...new Set(versionIds.map((v) => v.length))], characters: [...new Set(versionIds.join(''))].sort().join(''), nonMatching: versionIds.filter((v) => !VERSION_ID.test(v)) };
  writeFileSync(env.COC_REPORT, `${JSON.stringify(report, null, 2)}\n`);
});

const errName = (e: unknown) => (e as { name?: string }).name ?? String(e);

// Gives each test its own logical tables inside the one real table.
class Namespaced implements TransactionalStore {
  readonly inner: TransactionalStore;
  readonly ns: string;
  constructor(inner: TransactionalStore, ns: string) {
    this.inner = inner;
    this.ns = ns;
  }
  get<T>(table: string, key: string): Promise<Item<T> | undefined> {
    return this.inner.get<T>(`${this.ns}${table}`, key);
  }
  list<T>(table: string, prefix: string): Promise<Array<{ key: string; item: Item<T> }>> {
    return this.inner.list<T>(`${this.ns}${table}`, prefix);
  }
  transact(writes: Write[]): Promise<TransactResult> {
    return this.inner.transact(writes.map((w) => ({ ...w, table: `${this.ns}${w.table}` })));
  }
}

describe('T14b real AWS', { skip: enabled ? false : 'set COC_REAL_AWS=1, COC_TEST_TABLE, COC_TEST_BUCKET and AWS_REGION (approved runs only)' }, () => {
  const tableName = env.COC_TEST_TABLE!;
  const bucket = env.COC_TEST_BUCKET!;
  const ddb = new DynamoDBClient({});
  const s3 = new S3Client({});
  const nsFor = (label: string) => `${runId}/${label}/`;
  function store(label: string, appendOnly: readonly string[] = APPEND_ONLY_TABLES, client = ddb) {
    const ns = nsFor(label);
    return new Namespaced(new DynamoStore({ client, tableName, appendOnlyTables: appendOnly.map((t) => `${ns}${t}`) }), ns);
  }
  class RecordingS3 extends S3ObjectStore {
    override async putNew(key: string, bytes: Uint8Array) {
      const r = await super.putNew(key, bytes);
      versionIds.push(r.versionId);
      return r;
    }
  }
  const objects = (label: string) => new RecordingS3({ client: s3, bucket, keyPrefix: `t14b/${runId}/${label}/` });
  let contractN = 0;

  describe('R1 port contract on real DynamoDB (at most one winner)', () => {
    storeContract(async () => store(`contract-${(contractN += 1)}`, CONTRACT_APPEND_ONLY), { atMostOne: true });
  });

  async function exportWorld(label: string) {
    const st = store(label);
    const w = makeWorld({ store: st, objects: objects(label) });
    const versions = await registerFixtures(w);
    const t = await w.custody.recordTransfer(human(USERS.investigator), CASE, { evidenceId: 'BW-007', versionId: versions.get('BW-007/original')!, from: 'locker', to: 'audit', reason: 'review' });
    assert.ok(t.ok, JSON.stringify(t));
    assert.ok((await w.checkpoints.issue(CASE, new Date())).ok);
    const payload = { evidence: ['BW-001/original', 'BW-002/transcode-2026', 'BW-010/original'].map((k) => ({ evidenceId: k.split('/')[0]!, versionId: versions.get(k)! })), destination: 'internal:case-export-store' };
    const req = await w.approvals.requestExport(human(USERS.investigator), CASE, payload);
    assert.ok(req.ok);
    assert.ok((await w.approvals.approve(human(USERS.supervisor), req.value.approvalId)).ok);
    return { st, w, run: () => w.exports.exportCase(human(USERS.investigator), CASE, req.value.approvalId, payload) };
  }

  test('R2 whole domain on DynamoDB plus S3: approved export verifies VERIFIED and FRESH', async () => {
    const { w, run } = await exportWorld('r2');
    const pkg = await run();
    assert.ok(pkg.ok, JSON.stringify(pkg));
    const head = await w.ledger.head(CASE);
    const r = verifyExport(JSON.parse(JSON.stringify(pkg.value)), { expectedCaseId: CASE, keys: [w.trustedKey], reference: { caseId: CASE, minSequence: head.sequence, headHashAtMinSequence: head.hash, retrievedAt: new Date().toISOString() } });
    report.R2 = { status: r.status, freshness: r.freshness, validThrough: r.validThrough, evidenceVerified: r.evidence.filter((e) => e.verified).length, findings: r.findings.map((f) => f.code) };
    assert.equal(r.status, 'VERIFIED', JSON.stringify(r.findings));
    assert.equal(r.freshness, 'FRESH');
  });

  test('R3 ledger under real contention: contiguous chain, losers get LEDGER_CONFLICT', async () => {
    const st = store('r3');
    const w = makeWorld({ store: st, objects: objects('r3') });
    const versions = await registerFixtures(w);
    const ref = { evidenceId: 'BW-002', versionId: versions.get('BW-002/original')! };
    const rounds: Array<{ committed: number; codes: Record<string, number>; ms: number }> = [];
    for (let round = 0; round < 5; round += 1) {
      const started = Date.now();
      const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
        w.custody.recordTransfer(human(USERS.investigator), CASE, { ...ref, from: 'evidence-room', to: `lab-${round}-${i}`, reason: `contention round ${round}` })));
      const codes: Record<string, number> = {};
      for (const r of results) if (!r.ok) codes[r.code] = (codes[r.code] ?? 0) + 1;
      rounds.push({ committed: results.filter((r) => r.ok).length, codes, ms: Date.now() - started });
      for (const r of results) if (!r.ok) assert.equal(r.code, 'LEDGER_CONFLICT');
    }
    const events = await w.ledger.events(CASE);
    events.forEach((e, i) => {
      assert.equal(e.sequence, i + 1);
      if (i > 0) assert.equal(e.prevHash, events[i - 1]!.eventHash);
    });
    report.R3 = { rounds, totalEvents: events.length };
  });

  test('R4 SDK retry after a discarded successful response is idempotent (automatic ClientRequestToken)', async () => {
    const client = new DynamoDBClient({ maxAttempts: 3 });
    let attempts = 0;
    let dropped = false;
    client.middlewareStack.add((next, context) => async (args) => {
      const result = await next(args);
      if (context.commandName === 'TransactWriteItemsCommand') {
        attempts += 1;
        if (!dropped) {
          dropped = true;
          throw Object.assign(new Error('simulated lost response after commit'), { name: 'TimeoutError', $metadata: {} });
        }
      }
      return result;
    }, { step: 'deserialize', name: 'cocDropFirstTransactResponse', priority: 'high' });
    const st = store('r4', APPEND_ONLY_TABLES, client);
    const r = await st.transact([{ table: 'events', key: 'C1#0000000001', value: { n: 1 }, expectVersion: null }, { table: 'heads', key: 'C1', value: { n: 1 }, expectVersion: null }]);
    report.R4 = { result: r, attempts, dropped };
    assert.equal(dropped, true);
    assert.ok(attempts >= 2, `the SDK did not retry (attempts ${attempts})`);
    assert.deepEqual(r, { ok: true });
    assert.equal((await st.get('events', 'C1#0000000001'))?.version, 1);
    client.destroy();
  });

  test('R5 least-privilege role: transactions work; delete, update, batch write and drop table are denied', async () => {
    const st = store('r5');
    assert.deepEqual(await st.transact([{ table: 'heads', key: 'k', value: 1, expectVersion: null }]), { ok: true });
    const key = { pk: { S: `${nsFor('r5')}heads` }, sk: { S: 'k' } };
    const attempts: Record<string, string> = {};
    const tryCall = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        attempts[label] = 'ALLOWED';
      } catch (e) {
        attempts[label] = errName(e);
      }
    };
    await tryCall('DeleteItem', () => ddb.send(new DeleteItemCommand({ TableName: tableName, Key: key })));
    await tryCall('UpdateItem', () => ddb.send(new UpdateItemCommand({ TableName: tableName, Key: key, UpdateExpression: 'SET v = :v', ExpressionAttributeValues: { ':v': { S: '"x"' } } })));
    await tryCall('BatchWriteItem', () => ddb.send(new BatchWriteItemCommand({ RequestItems: { [tableName]: [{ DeleteRequest: { Key: key } }] } })));
    await tryCall('DeleteTable', () => ddb.send(new DeleteTableCommand({ TableName: tableName })));
    report.R5 = attempts;
    for (const [label, outcome] of Object.entries(attempts)) assert.equal(outcome, 'AccessDeniedException', label);
    assert.deepEqual((await st.get('heads', 'k'))?.value, 1);
  });

  test('R6 the app role CAN overwrite an event with raw PutItem (documented risk); the verifier catches it', async () => {
    const { st, w, run } = await exportWorld('r6');
    const target = (await st.list<Record<string, unknown>>('events', `${CASE}#`))[3]!;
    let overwrite = 'ALLOWED';
    try {
      await ddb.send(new PutItemCommand({ TableName: tableName, Item: { pk: { S: `${nsFor('r6')}events` }, sk: { S: target.key }, v: { S: JSON.stringify({ ...target.item.value, recordedAt: '2021-01-01T00:00:00.000Z' }) }, ver: { N: '1' } } }));
    } catch (e) {
      overwrite = errName(e);
    }
    const pkg = await run();
    assert.ok(pkg.ok, JSON.stringify(pkg));
    const r = verifyExport(JSON.parse(JSON.stringify(pkg.value)), { expectedCaseId: CASE, keys: [w.trustedKey] });
    report.R6 = { rawOverwrite: overwrite, streamKeyToCheck: { pk: `${nsFor('r6')}events`, sk: target.key }, verifierStatus: r.status, findings: [...new Set(r.findings.map((f) => f.code))] };
    assert.equal(overwrite, 'ALLOWED', 'expected the documented risk: PutItem is needed for transactions');
    assert.equal(r.status, 'FAILED');
    assert.ok(r.findings.some((f) => f.code === 'EVENT_HASH_MISMATCH'));
  });

  test('R7 S3 refuses an overwrite with If-None-Match: *', async () => {
    const o = objects('r7');
    const first = await o.putNew('k', Buffer.from('original'));
    let second = 'ALLOWED';
    try {
      await o.putNew('k', Buffer.from('replacement'));
    } catch (e) {
      second = e instanceof ObjectExistsError ? 'ObjectExistsError' : errName(e);
    }
    const back = Buffer.from((await o.getVersion('k', first.versionId))!).toString();
    report.R7 = { second, firstVersionStillReads: back };
    assert.equal(second, 'ObjectExistsError');
    assert.equal(back, 'original');
  });

  test('R8 bucket policy: unconditional put and every delete or retention change are denied to the app role', async () => {
    const o = objects('r8');
    const key = `t14b/${runId}/r8/k`;
    const { versionId } = await o.putNew('k', Buffer.from('protected'));
    const attempts: Record<string, string> = {};
    const tryCall = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        attempts[label] = 'ALLOWED';
      } catch (e) {
        attempts[label] = errName(e);
      }
    };
    await tryCall('PutObject without If-None-Match', () => s3.send(new PutObjectCommand({ Bucket: bucket, Key: `t14b/${runId}/r8/unconditional`, Body: 'x' })));
    await tryCall('DeleteObject (delete marker)', () => s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })));
    await tryCall('DeleteObject with VersionId', () => s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId })));
    await tryCall('PutObjectRetention', () => s3.send(new PutObjectRetentionCommand({ Bucket: bucket, Key: key, VersionId: versionId, Retention: { Mode: 'GOVERNANCE', RetainUntilDate: new Date(Date.now() + 60000) } })));
    await tryCall('PutBucketVersioning', () => s3.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: 'Suspended' } })));
    report.R8 = attempts;
    for (const [label, outcome] of Object.entries(attempts)) assert.equal(outcome, 'AccessDenied', label);
    assert.equal(Buffer.from((await o.getVersion('k', versionId))!).toString(), 'protected');
  });

  test('R9 S3 rejects bytes whose SHA-256 does not match', async () => {
    const key = `t14b/${runId}/r9/k`;
    let outcome = 'ALLOWED';
    try {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: Buffer.from('actual bytes'), IfNoneMatch: '*', ChecksumSHA256: createHash('sha256').update('different bytes').digest('base64') }));
    } catch (e) {
      outcome = errName(e);
    }
    // If the bad upload had been stored, this create-only put would get 412.
    const after = await objects('r9').putNew('k', Buffer.from('actual bytes'));
    report.R9 = { badChecksumPut: outcome, laterCreateSucceeded: !!after.versionId };
    assert.notEqual(outcome, 'ALLOWED');
  });

  test('R10 real S3 version IDs fit VERSION_ID', async () => {
    const o = objects('r10');
    for (let i = 0; i < 40; i += 1) await o.putNew(`k${i}`, Buffer.from(`v${i}`));
    const bad = versionIds.filter((v) => !VERSION_ID.test(v));
    assert.deepEqual(bad, [], 'STOP: real version IDs fall outside the pattern; bring the decision to Keith');
  });

  test('R11 concurrent conditional puts to one new key: exactly one wins', async () => {
    const o = objects('r11');
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => o.putNew('same', Buffer.from(`racer ${i}`))));
    const tally: Record<string, number> = {};
    for (const r of results) {
      const k = r.status === 'fulfilled' ? 'ok' : r.reason instanceof ObjectExistsError ? 'ObjectExistsError' : errName(r.reason);
      tally[k] = (tally[k] ?? 0) + 1;
    }
    report.R11 = tally;
    assert.equal(tally.ok, 1, JSON.stringify(tally));
  });

  test('R12 read-your-write with consistent reads (200 pairs)', async () => {
    const st = store('r12');
    let mismatches = 0;
    for (let i = 0; i < 200; i += 1) {
      const key = `k${i}-${randomUUID()}`;
      await st.transact([{ table: 'heads', key, value: i, expectVersion: null }]);
      if ((await st.get('heads', key))?.value !== i) mismatches += 1;
    }
    report.R12 = { pairs: 200, mismatches };
    assert.equal(mismatches, 0);
  });
});
