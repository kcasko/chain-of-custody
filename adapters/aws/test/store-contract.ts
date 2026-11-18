// The TransactionalStore contract. Every adapter must pass the same cases;
// MemoryStore runs them too, so the contract is the core's actual behavior,
// not a description of DynamoDB.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppendOnlyViolation, type TransactionalStore } from '../../../core/src/store.ts';

export const CONTRACT_APPEND_ONLY = ['events', 'findings'];

export function storeContract(makeStore: () => Promise<TransactionalStore>): void {
  test('missing items read as undefined; empty prefixes list nothing', async () => {
    const s = await makeStore();
    assert.equal(await s.get('heads', 'nope'), undefined);
    assert.deepEqual(await s.list('heads', 'nope#'), []);
    assert.deepEqual(await s.transact([]), { ok: true });
  });

  test('create-only writes start at version 1 and refuse an existing key', async () => {
    const s = await makeStore();
    assert.deepEqual(await s.transact([{ table: 'heads', key: 'C1', value: { n: 1 }, expectVersion: null }]), { ok: true });
    assert.deepEqual(await s.get('heads', 'C1'), { value: { n: 1 }, version: 1 });
    assert.deepEqual(await s.transact([{ table: 'heads', key: 'C1', value: { n: 2 }, expectVersion: null }]), { ok: false, reason: 'CONFLICT', index: 0 });
    assert.deepEqual((await s.get('heads', 'C1'))?.value, { n: 1 });
  });

  test('versioned writes succeed only on the current version', async () => {
    const s = await makeStore();
    await s.transact([{ table: 'heads', key: 'C1', value: 'a', expectVersion: null }]);
    assert.deepEqual(await s.transact([{ table: 'heads', key: 'C1', value: 'b', expectVersion: 1 }]), { ok: true });
    assert.deepEqual(await s.get('heads', 'C1'), { value: 'b', version: 2 });
    assert.deepEqual(await s.transact([{ table: 'heads', key: 'C1', value: 'stale', expectVersion: 1 }]), { ok: false, reason: 'CONFLICT', index: 0 });
    assert.deepEqual(await s.transact([{ table: 'heads', key: 'absent', value: 'x', expectVersion: 1 }]), { ok: false, reason: 'CONFLICT', index: 0 });
    assert.equal(await s.get('heads', 'absent'), undefined);
  });

  test('a transaction applies all writes or none, and reports the failing index', async () => {
    const s = await makeStore();
    await s.transact([{ table: 'heads', key: 'C1', value: 0, expectVersion: null }]);
    const r = await s.transact([
      { table: 'events', key: 'C1#1', value: { e: 1 }, expectVersion: null },
      { table: 'idempotency', key: 'k1', value: { s: 1 }, expectVersion: null },
      { table: 'heads', key: 'C1', value: 1, expectVersion: 7 },
    ]);
    assert.deepEqual(r, { ok: false, reason: 'CONFLICT', index: 2 });
    assert.equal(await s.get('events', 'C1#1'), undefined);
    assert.equal(await s.get('idempotency', 'k1'), undefined);
    assert.deepEqual(await s.get('heads', 'C1'), { value: 0, version: 1 });
  });

  test('append-only tables refuse any overwrite before anything is written', async () => {
    const s = await makeStore();
    await s.transact([{ table: 'events', key: 'C1#1', value: 'orig', expectVersion: null }]);
    await assert.rejects(
      s.transact([
        { table: 'heads', key: 'side-effect', value: 1, expectVersion: null },
        { table: 'events', key: 'C1#1', value: 'rewritten', expectVersion: 1 },
      ]),
      AppendOnlyViolation,
    );
    assert.equal(await s.get('heads', 'side-effect'), undefined);
    assert.deepEqual(await s.get('events', 'C1#1'), { value: 'orig', version: 1 });
    assert.deepEqual(await s.transact([{ table: 'events', key: 'C1#1', value: 'again', expectVersion: null }]), { ok: false, reason: 'CONFLICT', index: 0 });
  });

  test('writing one key twice in a transaction is a programming error', async () => {
    const s = await makeStore();
    await assert.rejects(s.transact([
      { table: 'heads', key: 'C1', value: 1, expectVersion: null },
      { table: 'heads', key: 'C1', value: 2, expectVersion: null },
    ]), /twice/);
    assert.equal(await s.get('heads', 'C1'), undefined);
  });

  test('list returns only the table and prefix asked for, in key order', async () => {
    const s = await makeStore();
    await s.transact([
      { table: 'events', key: 'C1#0000000003', value: 3, expectVersion: null },
      { table: 'events', key: 'C1#0000000001', value: 1, expectVersion: null },
      { table: 'events', key: 'C10#0000000001', value: 'other case', expectVersion: null },
      { table: 'events', key: 'C1#0000000002', value: 2, expectVersion: null },
      { table: 'findings', key: 'C1#0000000001', value: 'other table', expectVersion: null },
    ]);
    const rows = await s.list<number>('events', 'C1#');
    assert.deepEqual(rows.map((r) => [r.key, r.item.value]), [['C1#0000000001', 1], ['C1#0000000002', 2], ['C1#0000000003', 3]]);
    assert.equal((await s.list('events', '')).length, 4);
  });

  test('values round-trip exactly and cannot be mutated through the store', async () => {
    const s = await makeStore();
    const value = { text: 'Ünïcödé "quotes" \\ \n tab\t', n: 1.5, neg: -0.25, big: 9007199254740991, list: [1, 'two', null, { deep: true }], empty: '', none: null };
    await s.transact([{ table: 'proposals', key: 'p1', value, expectVersion: null }]);
    value.text = 'changed by caller after write';
    const got = await s.get<typeof value>('proposals', 'p1');
    assert.equal(got?.value.text, 'Ünïcödé "quotes" \\ \n tab\t');
    assert.deepEqual(got?.value.list, [1, 'two', null, { deep: true }]);
    assert.ok(Object.isFrozen(got) && Object.isFrozen(got!.value) && Object.isFrozen(got!.value.list));
    assert.throws(() => { (got!.value as { text: string }).text = 'x'; }, TypeError);
  });

  test('concurrent creates of one key: exactly one wins', async () => {
    const s = await makeStore();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => s.transact([{ table: 'events', key: 'race#1', value: i, expectVersion: null }])));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal((await s.get('events', 'race#1'))?.version, 1);
  });

  test('concurrent updates from one version: exactly one wins', async () => {
    const s = await makeStore();
    await s.transact([{ table: 'heads', key: 'race', value: 0, expectVersion: null }]);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => s.transact([{ table: 'heads', key: 'race', value: i + 1, expectVersion: 1 }])));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal((await s.get('heads', 'race'))?.version, 2);
  });
}
