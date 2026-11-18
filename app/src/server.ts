// Local demo server for the Integrity Challenge. Loopback only, fixed file map
// (no path traversal), strict Content-Security-Policy, no external resources.
// Usage: npm run demo   (then open http://127.0.0.1:4317)

import { createServer, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { runChallenge } from './challenge.ts';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4317);
const PUBLIC = new URL('../public/', import.meta.url);

const FILES: Readonly<Record<string, { file: string; type: string }>> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS });
  res.end(body);
}

export function createDemoServer() {
  return createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    if (req.method !== 'GET') return send(res, 405, 'text/plain; charset=utf-8', 'method not allowed');
    if (path === '/api/challenge') {
      runChallenge()
        .then((report) => send(res, 200, 'application/json; charset=utf-8', JSON.stringify(report)))
        .catch((err: Error) => send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: 'challenge failed', detail: err.message.slice(0, 200) })));
      return;
    }
    const entry = FILES[path];
    if (!entry) return send(res, 404, 'text/plain; charset=utf-8', 'not found');
    return send(res, 200, entry.type, readFileSync(new URL(entry.file, PUBLIC)));
  });
}

export function startDemoServer(port = PORT) {
  const server = createDemoServer();
  server.listen(port, HOST, () => console.log(`Integrity Challenge: http://${HOST}:${port}`));
  return server;
}
