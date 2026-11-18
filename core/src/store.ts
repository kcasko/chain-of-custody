// Transactional key-value port, modeled on DynamoDB TransactWriteItems:
// every write is conditional on the item's current version, and a
// transaction applies all writes or none. There is deliberately no delete.
// Append-only tables refuse any write to an existing key, like an S3 bucket
// policy that requires If-None-Match.

export interface Item<T = unknown> { readonly value: T; readonly version: number }
export interface Write { table: string; key: string; value: unknown; expectVersion: number | null } // null: must not exist
export type TransactResult = { ok: true } | { ok: false; reason: 'CONFLICT'; index: number };

export interface TransactionalStore {
  get<T = unknown>(table: string, key: string): Promise<Item<T> | undefined>;
  list<T = unknown>(table: string, keyPrefix: string): Promise<Array<{ key: string; item: Item<T> }>>;
  transact(writes: Write[]): Promise<TransactResult>;
}

export class AppendOnlyViolation extends Error {
  constructor(table: string, key: string) {
    super(`table ${table} is append-only: refusing to overwrite ${key}`);
    this.name = 'AppendOnlyViolation';
  }
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

export class MemoryStore implements TransactionalStore {
  readonly #tables = new Map<string, Map<string, Item>>();
  readonly #appendOnly: ReadonlySet<string>;

  constructor(options: { appendOnlyTables: Iterable<string> }) {
    this.#appendOnly = new Set(options.appendOnlyTables);
  }

  #table(name: string): Map<string, Item> {
    let t = this.#tables.get(name);
    if (!t) {
      t = new Map();
      this.#tables.set(name, t);
    }
    return t;
  }

  async get<T>(table: string, key: string): Promise<Item<T> | undefined> {
    return this.#table(table).get(key) as Item<T> | undefined;
  }

  async list<T>(table: string, keyPrefix: string): Promise<Array<{ key: string; item: Item<T> }>> {
    return [...this.#table(table).entries()]
      .filter(([k]) => k.startsWith(keyPrefix))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => ({ key, item: item as Item<T> }));
  }

  // Validate every condition, then apply every write, with no await in between:
  // in a single-threaded runtime that makes the transaction atomic.
  async transact(writes: Write[]): Promise<TransactResult> {
    const seen = new Set<string>();
    for (let i = 0; i < writes.length; i += 1) {
      const w = writes[i]!;
      const id = `${w.table}\u0000${w.key}`;
      if (seen.has(id)) throw new Error(`transaction writes ${w.table}/${w.key} twice`);
      seen.add(id);
      if (this.#appendOnly.has(w.table) && w.expectVersion !== null) throw new AppendOnlyViolation(w.table, w.key);
      const current = this.#table(w.table).get(w.key);
      if (w.expectVersion === null ? current !== undefined : current?.version !== w.expectVersion) {
        return { ok: false, reason: 'CONFLICT', index: i };
      }
    }
    for (const w of writes) {
      const current = this.#table(w.table).get(w.key);
      this.#table(w.table).set(w.key, deepFreeze({ value: structuredClone(w.value), version: (current?.version ?? 0) + 1 }));
    }
    return { ok: true };
  }
}

// Test adapters ------------------------------------------------------------

// Yields to the event loop before every call so concurrent callers interleave
// between their read and their conditional write.
export class InterleavingStore implements TransactionalStore {
  readonly inner: TransactionalStore;
  constructor(inner: TransactionalStore) {
    this.inner = inner;
  }
  async get<T>(table: string, key: string): Promise<Item<T> | undefined> {
    await new Promise((r) => setImmediate(r));
    return this.inner.get<T>(table, key);
  }
  async list<T>(table: string, keyPrefix: string): Promise<Array<{ key: string; item: Item<T> }>> {
    await new Promise((r) => setImmediate(r));
    return this.inner.list<T>(table, keyPrefix);
  }
  async transact(writes: Write[]): Promise<TransactResult> {
    await new Promise((r) => setImmediate(r));
    return this.inner.transact(writes);
  }
}

export class FaultyStore implements TransactionalStore {
  failTransactWhen: (writes: Write[]) => boolean = () => false;
  failReads = false;
  readonly inner: TransactionalStore;
  constructor(inner: TransactionalStore) {
    this.inner = inner;
  }
  async get<T>(table: string, key: string): Promise<Item<T> | undefined> {
    if (this.failReads) throw new Error('injected store read failure');
    return this.inner.get<T>(table, key);
  }
  async list<T>(table: string, keyPrefix: string): Promise<Array<{ key: string; item: Item<T> }>> {
    if (this.failReads) throw new Error('injected store read failure');
    return this.inner.list<T>(table, keyPrefix);
  }
  async transact(writes: Write[]): Promise<TransactResult> {
    if (this.failTransactWhen(writes)) throw new Error('injected store write failure');
    return this.inner.transact(writes);
  }
}
