// Ledger archive (ADR 0008). Uses a small in-memory S3 that models the two
// behaviors the archive relies on: If-None-Match refusal (412) and reads.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createArchiveHandler, type StreamRecord } from '../src/ledger-archive.ts';

class FakeS3 {
  objects = new Map<string, string>();
  failPutsFor: RegExp | undefined;
  async send(cmd: { constructor: { name: string }; input: { Key: string; Body?: string; IfNoneMatch?: string } }) {
    const { Key, Body, IfNoneMatch } = cmd.input;
    if (cmd.constructor.name === 'PutObjectCommand') {
      if (this.failPutsFor?.test(Key)) throw Object.assign(new Error('ServiceUnavailable'), { name: 'ServiceUnavailable', $metadata: { httpStatusCode: 503 } });
      assert.equal(IfNoneMatch, '*', 'the archive must never write without If-None-Match');
      if (this.objects.has(Key)) throw Object.assign(new Error('PreconditionFailed'), { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } });
      this.objects.set(Key, Body!);
      return {};
    }
    const body = this.objects.get(Key);
    if (body === undefined) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    return { Body: { transformToString: async () => body } };
  }
}

const img = (pk: string, sk: string, v: string, ver = '1') => ({ pk: { S: pk }, sk: { S: sk }, v: { S: v }, ver: { N: ver } });
const rec = (eventName: string, seq: string, pk: string, sk: string, NewImage?: ReturnType<typeof img>, OldImage?: ReturnType<typeof img>): StreamRecord =>
  ({ eventName, dynamodb: { Keys: { pk: { S: pk }, sk: { S: sk } }, NewImage, OldImage, SequenceNumber: seq } });

function setup() {
  const s3 = new FakeS3();
  const lines: string[] = [];
  const handler = createArchiveHandler({ s3: s3 as never, bucket: 'archive', appendOnlyTables: ['events', 'findings'], log: (l) => lines.push(l) });
  const alarms = () => lines.map((l) => JSON.parse(l)).filter((x) => x.alarm);
  return { s3, handler, alarms, lines };
}

test('every insert into an append-only table is archived once; mutable tables are ignored', async () => {
  const { s3, handler, alarms } = setup();
  const r = await handler({ Records: [
    rec('INSERT', '1', 'events', 'CASE#0000000001', img('events', 'CASE#0000000001', '{"e":1}')),
    rec('INSERT', '2', 'heads', 'CASE', img('heads', 'CASE', '{"sequence":1}')),
    rec('MODIFY', '3', 'heads', 'CASE', img('heads', 'CASE', '{"sequence":2}', '2'), img('heads', 'CASE', '{"sequence":1}')),
  ] });
  assert.deepEqual(r, { batchItemFailures: [] });
  assert.deepEqual([...s3.objects.keys()], ['ledger/events/CASE%230000000001']);
  assert.deepEqual(JSON.parse(s3.objects.get('ledger/events/CASE%230000000001')!), { pk: 'events', sk: 'CASE#0000000001', ver: '1', v: '{"e":1}' });
  assert.deepEqual(alarms(), []);
});

test('a redelivered insert (Lambda retry) is a harmless no-op', async () => {
  const { s3, handler, alarms } = setup();
  const r1 = rec('INSERT', '1', 'events', 'C#1', img('events', 'C#1', '{"e":1}'));
  await handler({ Records: [r1] });
  assert.deepEqual(await handler({ Records: [r1] }), { batchItemFailures: [] });
  assert.equal(s3.objects.size, 1);
  assert.deepEqual(alarms(), []);
});

test('an overwrite of the working copy raises APPEND_ONLY_TAMPER, keeps the archived original, and records both images', async () => {
  const { s3, handler, alarms } = setup();
  await handler({ Records: [rec('INSERT', '1', 'events', 'C#4', img('events', 'C#4', '{"recordedAt":"2026-11-18"}'))] });
  await handler({ Records: [rec('MODIFY', '2', 'events', 'C#4', img('events', 'C#4', '{"recordedAt":"2021-01-01"}'), img('events', 'C#4', '{"recordedAt":"2026-11-18"}'))] });
  assert.equal(JSON.parse(s3.objects.get('ledger/events/C%234')!).v, '{"recordedAt":"2026-11-18"}', 'the original survives');
  const a = alarms();
  assert.equal(a.length, 1);
  assert.equal(a[0].alarm, 'APPEND_ONLY_TAMPER');
  assert.notEqual(a[0].oldSha256, a[0].newSha256);
  const tamper = JSON.parse(s3.objects.get('tamper/events/C%234/2')!);
  assert.equal(tamper.before.v, '{"recordedAt":"2026-11-18"}');
  assert.equal(tamper.after.v, '{"recordedAt":"2021-01-01"}');
});

test('a removal from an append-only table raises APPEND_ONLY_TAMPER', async () => {
  const { handler, alarms } = setup();
  await handler({ Records: [rec('REMOVE', '9', 'findings', 'C#x', undefined, img('findings', 'C#x', '{"f":1}'))] });
  assert.equal(alarms()[0]?.event, 'REMOVE');
});

test('a key already archived with different bytes raises ARCHIVE_CONFLICT and is not overwritten', async () => {
  const { s3, handler, alarms } = setup();
  s3.objects.set('ledger/events/C%235', JSON.stringify({ pk: 'events', sk: 'C#5', ver: '1', v: '{"forged":true}' }));
  const r = await handler({ Records: [rec('INSERT', '1', 'events', 'C#5', img('events', 'C#5', '{"real":true}'))] });
  assert.deepEqual(r, { batchItemFailures: [] });
  assert.equal(alarms()[0]?.alarm, 'ARCHIVE_CONFLICT');
  assert.match(s3.objects.get('ledger/events/C%235')!, /forged/, 'the archive never overwrites; the alarm is the signal');
});

test('only records that failed to land are retried', async () => {
  const { s3, handler } = setup();
  s3.failPutsFor = /C%232/;
  const r = await handler({ Records: [
    rec('INSERT', '10', 'events', 'C#1', img('events', 'C#1', '{"e":1}')),
    rec('INSERT', '11', 'events', 'C#2', img('events', 'C#2', '{"e":2}')),
    rec('INSERT', '12', 'events', 'C#3', img('events', 'C#3', '{"e":3}')),
  ] });
  assert.deepEqual(r, { batchItemFailures: [{ itemIdentifier: '11' }] });
  assert.deepEqual([...s3.objects.keys()].sort(), ['ledger/events/C%231', 'ledger/events/C%233']);
});
