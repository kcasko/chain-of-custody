// Ledger archive (ADR 0008): a DynamoDB Streams consumer that copies every
// new item of an append-only table, once, into an Object Lock bucket.
//
// Why: DynamoDB cannot stop a principal holding the application's PutItem
// permission from overwriting an item (ADR 0007, confirmed live in T14b).
// The archive bucket is written only by this function's role, only with
// If-None-Match, and never deleted (Object Lock), so the first committed
// image of every event survives even if the working copy is altered.
//
// - INSERT on an append-only table: write `ledger/<table>/<key>` once.
//   A 412 with identical bytes is a harmless retry; different bytes mean
//   someone wrote that key first, which is raised as an alarm.
// - MODIFY or REMOVE on an append-only table: tampering with the working
//   copy. Raised as an alarm, and both images are archived under
//   `tamper/<table>/<key>/<stream sequence>` for the investigation.
// - Anything else: ignored. Failures are returned as batch item failures so
//   Lambda retries only the records that did not land.
//
// Alarms are single JSON log lines with an `alarm` field; a CloudWatch
// metric filter turns them into an alarm (see infra/).

import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';

export type Attr = { S?: string; N?: string };
export interface StreamRecord {
  eventName?: 'INSERT' | 'MODIFY' | 'REMOVE' | string;
  dynamodb?: {
    Keys?: Record<string, Attr>;
    NewImage?: Record<string, Attr>;
    OldImage?: Record<string, Attr>;
    SequenceNumber?: string;
  };
}
export interface StreamEvent { Records?: StreamRecord[] }
export interface BatchResponse { batchItemFailures: Array<{ itemIdentifier: string }> }

export interface ArchiveOptions {
  readonly s3: Pick<S3Client, 'send'>;
  readonly bucket: string;
  readonly appendOnlyTables: Iterable<string>;
  readonly log?: (line: string) => void;
}

const status = (err: unknown) => (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
const sha256 = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
const seg = (s: string) => encodeURIComponent(s);

function image(img: Record<string, Attr> | undefined) {
  if (!img) return null;
  return { pk: img.pk?.S ?? null, sk: img.sk?.S ?? null, ver: img.ver?.N ?? null, v: img.v?.S ?? null };
}

export function createArchiveHandler(options: ArchiveOptions) {
  const appendOnly = new Set(options.appendOnlyTables);
  const log = options.log ?? ((line: string) => console.log(line));
  const alarm = (fields: Record<string, unknown>) => log(JSON.stringify(fields));

  async function putOnce(key: string, body: string): Promise<'written' | 'same' | 'different'> {
    try {
      await options.s3.send(new PutObjectCommand({
        Bucket: options.bucket, Key: key, Body: body, IfNoneMatch: '*', ContentType: 'application/json',
        ChecksumSHA256: createHash('sha256').update(body).digest('base64'),
      }));
      return 'written';
    } catch (err) {
      if (status(err) !== 412 && (err as { name?: string }).name !== 'PreconditionFailed') throw err;
      const existing = await options.s3.send(new GetObjectCommand({ Bucket: options.bucket, Key: key }));
      const bytes = await existing.Body!.transformToString();
      return bytes === body ? 'same' : 'different';
    }
  }

  return async function handler(event: StreamEvent): Promise<BatchResponse> {
    const failures: Array<{ itemIdentifier: string }> = [];
    for (const record of event.Records ?? []) {
      const seq = record.dynamodb?.SequenceNumber ?? '';
      try {
        const table = record.dynamodb?.Keys?.pk?.S;
        const key = record.dynamodb?.Keys?.sk?.S;
        if (!table || !key || !appendOnly.has(table)) continue;
        if (record.eventName === 'INSERT') {
          const img = image(record.dynamodb?.NewImage);
          const body = JSON.stringify(img);
          const outcome = await putOnce(`ledger/${seg(table)}/${seg(key)}`, body);
          if (outcome === 'different') alarm({ alarm: 'ARCHIVE_CONFLICT', table, key, sequence: seq, insertedSha256: sha256(body) });
        } else if (record.eventName === 'MODIFY' || record.eventName === 'REMOVE') {
          const before = image(record.dynamodb?.OldImage);
          const after = image(record.dynamodb?.NewImage);
          alarm({ alarm: 'APPEND_ONLY_TAMPER', event: record.eventName, table, key, sequence: seq, oldSha256: before?.v ? sha256(before.v) : null, newSha256: after?.v ? sha256(after.v) : null });
          await putOnce(`tamper/${seg(table)}/${seg(key)}/${seg(seq)}`, JSON.stringify({ event: record.eventName, before, after }));
        }
      } catch (err) {
        failures.push({ itemIdentifier: seq });
        log(JSON.stringify({ error: 'ARCHIVE_WRITE_FAILED', sequence: seq, name: (err as Error).name }));
      }
    }
    return { batchItemFailures: failures };
  };
}
