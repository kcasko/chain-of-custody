// DynamoDB adapter for the core's TransactionalStore port (T14).
//
// One physical table. Partition key `pk` is the logical table name, sort key
// `sk` is the item key, so list(table, prefix) is a single Query with
// begins_with. Each item stores its JSON value as a string (`v`) and its
// version number (`ver`). Every write goes through TransactWriteItems with a
// condition on `ver` (or on the item not existing), which gives the port's
// all-or-nothing, version-checked semantics.
//
// Append-only tables are enforced here exactly as MemoryStore does (any write
// that expects an existing version is refused before reaching DynamoDB) and
// again by DynamoDB itself (create-only writes carry attribute_not_exists).
// DynamoDB has no native write-once mode, so a principal with raw PutItem on
// the table could still overwrite; production must deny the application's
// role DeleteItem and UpdateItem and keep the hash chain and signed
// checkpoints as the detection layer. See ADR 0007.

import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import {
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  TransactionCanceledException,
  type AttributeValue,
  type CreateTableCommandInput,
  type DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import { AppendOnlyViolation, deepFreeze, type Item, type TransactResult, type TransactionalStore, type Write } from '../../../core/src/store.ts';

export const MAX_TRANSACTION_ITEMS = 100; // DynamoDB TransactWriteItems limit

export interface DynamoStoreOptions {
  readonly client: Pick<DynamoDBClient, 'send'>;
  readonly tableName: string;
  readonly appendOnlyTables: Iterable<string>;
}

// The table the adapter expects. Used by tests against DynamoDB Local and as
// the reference for infrastructure code.
export function tableDefinition(tableName: string): CreateTableCommandInput {
  return {
    TableName: tableName,
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  };
}

// Values must survive JSON exactly. Anything that would silently change
// (undefined fields, Dates, typed arrays, NaN) is refused instead of stored.
export function encodeValue(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined || !isDeepStrictEqual(JSON.parse(json), value)) {
    throw new TypeError('store value is not plain JSON; refusing to write a value that would not round-trip');
  }
  return json;
}

function decode<T>(raw: Record<string, AttributeValue>): Item<T> {
  const v = raw.v?.S;
  const ver = raw.ver?.N;
  if (v === undefined || ver === undefined) throw new Error('malformed store item: missing v or ver');
  const version = Number(ver);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('malformed store item: bad version');
  return deepFreeze({ value: JSON.parse(v) as T, version });
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class DynamoStore implements TransactionalStore {
  readonly #client: Pick<DynamoDBClient, 'send'>;
  readonly #table: string;
  readonly #appendOnly: ReadonlySet<string>;

  constructor(options: DynamoStoreOptions) {
    this.#client = options.client;
    this.#table = options.tableName;
    this.#appendOnly = new Set(options.appendOnlyTables);
  }

  async get<T = unknown>(table: string, key: string): Promise<Item<T> | undefined> {
    const r = await this.#client.send(new GetItemCommand({
      TableName: this.#table,
      Key: { pk: { S: table }, sk: { S: key } },
      ConsistentRead: true, // a version check against a stale read would be worthless
    }));
    return r.Item ? decode<T>(r.Item) : undefined;
  }

  async list<T = unknown>(table: string, keyPrefix: string): Promise<Array<{ key: string; item: Item<T> }>> {
    const out: Array<{ key: string; item: Item<T> }> = [];
    let start: Record<string, AttributeValue> | undefined;
    do {
      const r = await this.#client.send(new QueryCommand({
        TableName: this.#table,
        KeyConditionExpression: keyPrefix === '' ? 'pk = :pk' : 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: keyPrefix === '' ? { ':pk': { S: table } } : { ':pk': { S: table }, ':prefix': { S: keyPrefix } },
        ConsistentRead: true,
        ExclusiveStartKey: start,
      }));
      for (const raw of r.Items ?? []) {
        const key = raw.sk?.S;
        if (key === undefined) throw new Error('malformed store item: missing sk');
        out.push({ key, item: decode<T>(raw) });
      }
      start = r.LastEvaluatedKey;
    } while (start);
    // DynamoDB orders by UTF-8 bytes; sort the same way MemoryStore does so
    // both adapters return identical order for every key.
    return out.sort((a, b) => compare(a.key, b.key));
  }

  async transact(writes: Write[]): Promise<TransactResult> {
    if (writes.length === 0) return { ok: true };
    if (writes.length > MAX_TRANSACTION_ITEMS) throw new Error(`transaction has ${writes.length} writes; DynamoDB allows ${MAX_TRANSACTION_ITEMS}`);
    const seen = new Set<string>();
    const items = writes.map((w) => {
      const id = `${w.table}\u0000${w.key}`;
      if (seen.has(id)) throw new Error(`transaction writes ${w.table}/${w.key} twice`);
      seen.add(id);
      if (this.#appendOnly.has(w.table) && w.expectVersion !== null) throw new AppendOnlyViolation(w.table, w.key);
      const nextVersion = (w.expectVersion ?? 0) + 1;
      return {
        Put: {
          TableName: this.#table,
          Item: { pk: { S: w.table }, sk: { S: w.key }, v: { S: encodeValue(w.value) }, ver: { N: String(nextVersion) } },
          ...(w.expectVersion === null
            ? { ConditionExpression: 'attribute_not_exists(pk)' }
            : { ConditionExpression: 'ver = :expect', ExpressionAttributeValues: { ':expect': { N: String(w.expectVersion) } } }),
        },
      };
    });
    try {
      // The request token makes the SDK's automatic retries idempotent: if a
      // first attempt committed but its response was lost, the retry returns
      // success instead of a false CONFLICT for a write that did happen.
      await this.#client.send(new TransactWriteItemsCommand({ TransactItems: items, ClientRequestToken: randomUUID() }));
      return { ok: true };
    } catch (err) {
      if (err instanceof TransactionCanceledException || (err as { name?: string }).name === 'TransactionCanceledException') {
        const reasons = (err as TransactionCanceledException).CancellationReasons ?? [];
        // Version mismatch, or another transaction holding the item: either way
        // nothing was written and the caller may re-read and retry.
        const index = reasons.findIndex((r) => r.Code === 'ConditionalCheckFailed' || r.Code === 'TransactionConflict');
        if (index >= 0) return { ok: false, reason: 'CONFLICT', index };
      }
      throw err; // throttling, validation, network: fail closed, never report success
    }
  }
}
