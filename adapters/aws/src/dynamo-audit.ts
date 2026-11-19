// Durable security audit log on DynamoDB (T16), implementing the core's
// SecurityAuditLog port.
//
// Storage: the ledger's physical table, logical table `audit` (pk = 'audit').
// sk = <caseId>#<write time, ISO ms>#<per-process counter>#<random>, so one
// Query returns a case's records newest first.
//
// Writes go through DynamoStore as create-only (attribute_not_exists), so:
//   - an existing record can never be overwritten through this adapter;
//   - the SDK's ClientRequestToken makes a retry after a lost response
//     succeed instead of failing;
//   - an ambiguous failure throws, and the core's guard then refuses the
//     protected action (fail closed). A record may still have landed; an
//     extra 'attempted' record is the safe direction.
// `audit` is in APPEND_ONLY_TABLES, so the stream archive (ADR 0008) copies
// every record to the Object Lock bucket and alarms on any modify or delete.
//
// Ordering: by write time on the writing process. Two Lambda instances
// writing in the same millisecond are ordered by their random suffix, not by
// real order. Throughput: all audit records share one partition key, which
// DynamoDB serves at up to about 1,000 writes per second; enough for this
// application, and the reason to shard by case if that ever changes.

import { randomUUID } from 'node:crypto';
import { QueryCommand, type AttributeValue, type DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { AuditIntegrityError, type AuditPage, type SecurityAuditLog, type SecurityEvent } from '../../../core/src/audit.ts';
import { TABLES } from '../../../core/src/tables.ts';
import { DynamoStore } from './dynamo-store.ts';

export const AUDIT_PK = TABLES.audit;
// Counting reads the case's whole key range; stop after this many 1 MB pages
// and report the total as a lower bound rather than fail (review finding 4).
const DEFAULT_MAX_COUNT_PAGES = 10;

export interface DynamoAuditLogOptions {
  readonly client: Pick<DynamoDBClient, 'send'>;
  readonly tableName: string;
  /** Write time source; tests inject a fixed clock. */
  readonly now?: () => Date;
  /** Bound on COUNT pages per read (default 10, about 10 MB of keys). */
  readonly maxCountPages?: number;
}

const OUTCOMES = new Set(['attempted', 'denied', 'completed', 'failed']);

function decodeEvent(raw: Record<string, AttributeValue>, caseId: string): SecurityEvent {
  const v = raw.v?.S;
  const sk = raw.sk?.S ?? '';
  if (v === undefined) throw new AuditIntegrityError(`malformed audit item ${sk.slice(0, 120)}: missing v`);
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(v) as Record<string, unknown>;
  } catch {
    throw new AuditIntegrityError(`malformed audit item ${sk.slice(0, 120)}: not JSON`);
  }
  // A record that does not have the expected shape is reported, never skipped:
  // silently dropping it would hide exactly the tampering this log exists for.
  const ok = typeof e.requestId === 'string' && typeof e.caseId === 'string' && typeof e.principal === 'string'
    && typeof e.operation === 'string' && typeof e.outcome === 'string' && OUTCOMES.has(e.outcome)
    && (e.code === null || typeof e.code === 'string') && typeof e.at === 'string';
  if (!ok) throw new AuditIntegrityError(`malformed audit item ${sk.slice(0, 120)}: unexpected shape`);
  // The body must belong to the case its key files it under; a record keyed
  // under one case but naming another would otherwise show up in that view.
  if (e.caseId !== caseId || !sk.startsWith(`${caseId}#`)) throw new AuditIntegrityError(`audit item ${sk.slice(0, 120)} names case ${String(e.caseId).slice(0, 64)}`);
  return e as unknown as SecurityEvent;
}

export class DynamoAuditLog implements SecurityAuditLog {
  readonly #client: Pick<DynamoDBClient, 'send'>;
  readonly #table: string;
  readonly #store: DynamoStore;
  readonly #now: () => Date;
  readonly #maxCountPages: number;
  #counter = 0;

  constructor(options: DynamoAuditLogOptions) {
    this.#client = options.client;
    this.#table = options.tableName;
    this.#now = options.now ?? (() => new Date());
    this.#maxCountPages = options.maxCountPages ?? DEFAULT_MAX_COUNT_PAGES;
    this.#store = new DynamoStore({ client: options.client, tableName: options.tableName, appendOnlyTables: [AUDIT_PK] });
  }

  async append(event: SecurityEvent): Promise<void> {
    if (event.caseId.includes('#')) throw new Error('audit case id must not contain #');
    this.#counter = (this.#counter + 1) % 1_000_000;
    const key = `${event.caseId}#${this.#now().toISOString()}#${String(this.#counter).padStart(6, '0')}#${randomUUID()}`;
    const r = await this.#store.transact([{ table: AUDIT_PK, key, value: { ...event }, expectVersion: null }]);
    // A fresh random key cannot collide; a conflict means something else wrote it.
    if (!r.ok) throw new Error('audit record key already exists');
  }

  async forCase(caseId: string, limit: number): Promise<AuditPage> {
    if (caseId.includes('#')) throw new Error('audit case id must not contain #');
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('limit must be a positive integer');
    const key = { KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': { S: AUDIT_PK }, ':prefix': { S: `${caseId}#` } } };
    const page = await this.#client.send(new QueryCommand({ TableName: this.#table, ...key, ScanIndexForward: false, Limit: limit, ConsistentRead: true }));
    const events = (page.Items ?? []).map((raw) => decodeEvent(raw, caseId));
    let total = 0;
    let start: Record<string, AttributeValue> | undefined;
    let pages = 0;
    do {
      const c = await this.#client.send(new QueryCommand({ TableName: this.#table, ...key, Select: 'COUNT', ConsistentRead: true, ExclusiveStartKey: start }));
      total += c.Count ?? 0;
      start = c.LastEvaluatedKey;
      pages += 1;
    } while (start && pages < this.#maxCountPages);
    return { events, total: Math.max(total, events.length), totalIsLowerBound: start !== undefined };
  }
}
