// The seed script refuses to run unless it is told exactly who it acts as and
// explicitly confirmed (review finding 5). The AWS endpoint points at a closed
// local port, so even a regression here could not reach AWS.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/seed-evidence.ts', import.meta.url));
const SAFE_ENV = {
  ...process.env,
  TABLE_NAME: 'coc-test-ledger', EVIDENCE_BUCKET: 'coc-test-evidence', AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', AWS_SESSION_TOKEN: '', AWS_PROFILE: '',
  AWS_ENDPOINT_URL: 'http://127.0.0.1:9', AWS_MAX_ATTEMPTS: '1',
};

const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: SAFE_ENV, timeout: 30_000 });

test('seed script: refuses without --as, with --as but no value, with a bad ID, or without --confirm', () => {
  for (const args of [['owen.hale', '--confirm'], ['--confirm', '--as'], ['--as', 'Owen Hale', '--confirm'], ['--as', 'owen.hale'], ['--as', 'owen.hale', '--confirm', '--out']]) {
    const r = run(...args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, /usage:|--out needs a file path/);
  }
});
