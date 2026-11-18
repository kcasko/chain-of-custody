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

test('the page scripts never interpret data as HTML and load nothing external', () => {
  for (const file of ['challenge.js', 'workspace.js']) {
    const js = readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
    for (const sink of [/\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /\beval\(/, /new Function\(/, /setTimeout\(\s*['"`]/]) {
      assert.doesNotMatch(js, sink, `${file}: ${sink}`);
    }
  }
  for (const file of ['challenge.html', 'workspace.html']) {
    const html = readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /https?:\/\/|<script>|\son[a-z]+=/i, `${file}: no external resources, inline scripts or inline handlers`);
  }
  for (const file of ['styles.css', 'workspace.css']) {
    assert.doesNotMatch(readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'), /https?:\/\/|@import/, file);
  }
});

async function withWorkspace(fn: (base: string, port: number) => Promise<void>) {
  const server = createDemoServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`, port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('server: workspace and challenge pages are served; other hosts and other origins are refused', async () => {
  await withWorkspace(async (base, port) => {
    for (const path of ['/', '/workspace.js', '/workspace.css', '/challenge', '/challenge.js', '/styles.css']) {
      assert.equal((await fetch(`${base}${path}`)).status, 200, path);
    }
    const { request } = await import('node:http');
    const status = (headers: Record<string, string>) => new Promise<number>((resolve, reject) => {
      const r = request({ host: '127.0.0.1', port, path: '/api/session', headers }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      r.on('error', reject);
      r.end();
    });
    assert.equal(await status({ Host: `evil.example:${port}` }), 421, 'DNS rebinding: wrong Host');
    assert.equal(await status({ Host: `127.0.0.1:${port}`, Origin: 'https://evil.example' }), 403, 'another site');
    assert.equal(await status({ Host: `localhost:${port}` }), 200);
  });
});

test('server: API writes need JSON, a size limit, the session token and a persona', async () => {
  await withWorkspace(async (base) => {
    const session = (await (await fetch(`${base}/api/session`)).json() as { value: { csrf: string } }).value;
    const headers = { 'x-coc-csrf': session.csrf, 'x-coc-user': 'mara.voss', 'content-type': 'application/json' };
    const post = (body: string, h: Record<string, string> = headers) => fetch(`${base}/api/findings`, { method: 'POST', headers: h, body });
    assert.equal((await post('{}', { ...headers, 'content-type': 'text/plain' })).status, 415);
    assert.equal((await post('x'.repeat(70 * 1024))).status, 413);
    assert.equal((await post('{not json')).status, 400);
    assert.equal((await post('{}', { ...headers, 'x-coc-csrf': 'wrong' })).status, 403);
    const ok = await post(JSON.stringify({ findingType: 'unresolved_question', summary: 'Who signed the BW-007 seal log?', citedEvidenceIds: ['BW-007'], uncertainty: 'high' }));
    assert.equal(ok.status, 200);
    assert.equal((await fetch(`${base}/api/evidence`, { method: 'PUT', headers })).status, 405);
  });
});
