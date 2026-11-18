// Integrity Challenge: results, server behavior and page script safety.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { runChallenge } from '../src/challenge.ts';
import { createDemoServer } from '../src/server.ts';

test('every entry behaves as expected and nothing protected changes', async () => {
  const r = await runChallenge(new Date('2026-11-18T19:00:00.000Z'));
  assert.equal(r.rows.length, 28);
  assert.equal(r.totals.asExpected, 28, JSON.stringify(r.rows.filter((x) => !x.asExpected).map((x) => x.id)));
  assert.equal(r.unchanged, true);
  assert.deepEqual([r.totals.refused, r.totals.attacks, r.totals.executed, r.totals.legitimate], [21, 21, 7, 7]);
  assert.equal(r.before.evidence.length, 12);
  assert.ok(r.after.evidence.every((e) => /^[0-9a-f]{64}$/.test(e.sha256)), 'every version was re-read and hashed');
});

test('the core alone refuses every attack (defense in depth), and legitimate calls pass both layers', async () => {
  const r = await runChallenge();
  for (const row of r.rows) {
    if (row.kind === 'attack') assert.equal(row.core.verdict, 'refused', row.id);
    else assert.deepEqual([row.gateway.verdict, row.core.verdict], ['allowed', 'allowed'], row.id);
  }
});

test('injected-field attacks show the live Stage B behavior: Gateway allows, core refuses', async () => {
  const r = await runChallenge();
  for (const id of ['F-1', 'F-2', 'F-3']) {
    const row = r.rows.find((x) => x.id === id)!;
    assert.equal(row.gateway.verdict, 'allowed', id);
    assert.equal(row.core.verdict, 'refused', id);
    assert.equal(row.stoppedBy, 'core', id);
  }
});

test('the report says what the run is not', async () => {
  const r = await runChallenge();
  assert.ok(r.notes.some((n) => /Not evidence of Bedrock Managed Agents behavior/.test(n)));
  assert.ok(r.notes.some((n) => /no AWS calls, no model/.test(n)));
});

async function withServer(fn: (base: string) => Promise<void>) {
  const server = createDemoServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port, address } = server.address() as AddressInfo;
  assert.equal(address, '127.0.0.1');
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('server: strict headers, fixed file map, GET only, JSON challenge', async () => {
  await withServer(async (base) => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'none'; script-src 'self'/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    for (const path of ['/../package.json', '/%2e%2e/package.json', '/app/src/server.ts', '/index.html.bak']) {
      assert.equal((await fetch(`${base}${path}`)).status, 404, path);
    }
    assert.equal((await fetch(`${base}/api/challenge`, { method: 'POST' })).status, 405);
    const api = await fetch(`${base}/api/challenge`);
    assert.equal(api.status, 200);
    assert.equal((await api.json() as { rows: unknown[] }).rows.length, 28);
  });
});

test('the page script never interprets data as HTML and loads nothing external', () => {
  const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  for (const sink of [/\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /\beval\(/, /new Function\(/]) {
    assert.doesNotMatch(js, sink, String(sink));
  }
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /https?:\/\//, 'no external resources');
  assert.doesNotMatch(readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8'), /https?:\/\/|@import/);
});
