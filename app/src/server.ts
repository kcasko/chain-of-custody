// Local server for the investigation workspace (/) and the Integrity Challenge
// (/challenge). Loopback only, fixed file map (no path traversal), strict CSP,
// no external resources. Usage: npm run demo   (then open http://127.0.0.1:4317)
//
// Request checks before anything reaches the workflow:
// - Host must be 127.0.0.1 or localhost on our port (blocks DNS rebinding).
// - Origin, when the browser sends one, must be this server (blocks other sites).
// - API bodies: application/json only, at most 64 KiB.
// The workflow then requires the per-launch session token on every data call.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { runChallenge } from './challenge.ts';
import { Workflow } from './workflow.ts';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4317);
const PUBLIC = new URL('../public/', import.meta.url);
const MAX_BODY = 64 * 1024;

const FILES: Readonly<Record<string, { file: string; type: string }>> = {
  '/': { file: 'workspace.html', type: 'text/html; charset=utf-8' },
  '/workspace.js': { file: 'workspace.js', type: 'text/javascript; charset=utf-8' },
  '/workspace.css': { file: 'workspace.css', type: 'text/css; charset=utf-8' },
  '/challenge': { file: 'challenge.html', type: 'text/html; charset=utf-8' },
  '/challenge.js': { file: 'challenge.js', type: 'text/javascript; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS });
  res.end(body);
}
const json = (res: ServerResponse, status: number, body: unknown) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(body));

function readBody(req: IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false; status: number; detail: string }> {
  return new Promise((resolve) => {
    if (!/^application\/json(;|$)/.test(req.headers['content-type'] ?? '')) {
      req.resume();
      return resolve({ ok: false, status: 415, detail: 'send application/json' });
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > MAX_BODY) {
        done = true;
        resolve({ ok: false, status: 413, detail: 'request body too large' });
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve({ ok: true, value: text === '' ? {} : JSON.parse(text) });
      } catch {
        resolve({ ok: false, status: 400, detail: 'body is not valid JSON' });
      }
    });
    req.on('error', () => {
      if (!done) resolve({ ok: false, status: 400, detail: 'could not read the request' });
      done = true;
    });
  });
}

export function createDemoServer(workflow: Promise<Workflow> = Workflow.create()): Server {
  const server = createServer(async (req, res) => {
    try {
      const port = (server.address() as AddressInfo).port;
      const host = req.headers.host ?? '';
      if (host !== `${HOST}:${port}` && host !== `localhost:${port}`) return send(res, 421, 'text/plain; charset=utf-8', 'wrong host');
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== `http://${host}`) return json(res, 403, { ok: false, code: 'DENIED_ORIGIN', detail: 'cross-origin request refused' });

      const url = new URL(req.url ?? '/', `http://${host}`);
      const path = url.pathname;
      if (path === '/api/challenge') {
        if (req.method !== 'GET') return send(res, 405, 'text/plain; charset=utf-8', 'method not allowed');
        const report = await runChallenge();
        return json(res, 200, report);
      }
      if (path.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, 'text/plain; charset=utf-8', 'method not allowed');
        let body: unknown;
        if (req.method === 'POST') {
          const b = await readBody(req);
          if (!b.ok) return json(res, b.status, { ok: false, code: 'INVALID_REQUEST', detail: b.detail });
          body = b.value;
        }
        const headers = { 'x-coc-csrf': req.headers['x-coc-csrf'] as string | undefined, 'x-coc-user': req.headers['x-coc-user'] as string | undefined };
        const r = await (await workflow).handle({ method: req.method, path, query: url.searchParams, headers, body });
        return json(res, r.status, r.body);
      }
      if (req.method !== 'GET') return send(res, 405, 'text/plain; charset=utf-8', 'method not allowed');
      const entry = FILES[path];
      if (!entry) return send(res, 404, 'text/plain; charset=utf-8', 'not found');
      return send(res, 200, entry.type, readFileSync(new URL(entry.file, PUBLIC)));
    } catch (err) {
      // Never echo internals to the page.
      console.error('request failed:', (err as Error).name);
      if (!res.headersSent) json(res, 500, { ok: false, code: 'SERVER_ERROR', detail: 'the request failed; see the server log' });
    }
  });
  return server;
}

export function startDemoServer(port = PORT) {
  const server = createDemoServer();
  server.listen(port, HOST, () => console.log(`Investigation workspace: http://${HOST}:${port}   Integrity Challenge: http://${HOST}:${port}/challenge`));
  return server;
}
