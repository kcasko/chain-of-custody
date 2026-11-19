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
import type { SecurityAuditLog, SecurityEvent } from '../../../core/src/audit.ts';
import { TABLES } from '../../../core/src/tables.ts';
import { DynamoStore } from './dynamo-store.ts';

export const AUDIT_PK = TABLES.audit;
const MAX_COUNT_PAGES = 1000;

export interface DynamoAuditLogOptions {
  readonly client: Pick<DynamoDBClient, 'send'>;
  readonly tableName: string;
  /** Write time source; tests inject a fixed clock. */
  readonly now?: () => Date;
}

const OUTCOMES = new Set(['attempted', 'denied', 'completed', 'failed']);

function decodeEvent(raw: Record<string, AttributeValue>): SecurityEvent {
  const v = raw.v?.S;
  if (v === undefined) throw new Error('malformed audit item: missing v');
  const e = JSON.parse(v) as Record<string, unknown>;
  // A record that does not have the expected shape is reported, never skipped:
  // silently dropping it would hide exactly the tampering this log exists for.
  const ok = typeof e.requestId === 'string' && typeof e.caseId === 'string' && typeof e.principal === 'string'
    && typeof e.operation === 'string' && typeof e.outcome === 'string' && OUTCOMES.has(e.outcome)
    && (e.code === null || typeof e.code === 'string') && typeof e.at === 'string';
  if (!ok) throw new Error('malformed audit item: unexpected shape');
  return e as unknown as SecurityEvent;
}

export class DynamoAuditLog implements SecurityAuditLog {
  readonly #client: Pick<DynamoDBClient, 'send'>;
  readonly #table: string;
  readonly #store: DynamoStore;
  readonly #now: () => Date;
  #counter = 0;

  constructor(options: DynamoAuditLogOptions) {
    this.#client = options.client;
    this.#table = options.tableName;
    this.#now = options.now ?? (() => new Date());
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

  async forCase(caseId: string, limit: number): Promise<{ events: SecurityEvent[]; total: number }> {
    if (caseId.includes('#')) throw new Error('audit case id must not contain #');
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('limit must be a positive integer');
    const key = { KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': { S: AUDIT_PK }, ':prefix': { S: `${caseId}#` } } };
    const page = await this.#client.send(new QueryCommand({ TableName: this.#table, ...key, ScanIndexForward: false, Limit: limit, ConsistentRead: true }));
    const events = (page.Items ?? []).map(decodeEvent);
    let total = 0;
    let start: Record<string, AttributeValue> | undefined;
    let pages = 0;
    do {
      const c = await this.#client.send(new QueryCommand({ TableName: this.#table, ...key, Select: 'COUNT', ConsistentRead: true, ExclusiveStartKey: start }));
      total += c.Count ?? 0;
      start = c.LastEvaluatedKey;
      if ((pages += 1) > MAX_COUNT_PAGES) throw new Error('audit count did not finish');
    } while (start);
    return { events, total };
  }
}
