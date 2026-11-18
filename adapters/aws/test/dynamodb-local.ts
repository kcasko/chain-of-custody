// Starts DynamoDB Local (in memory, random port) for the adapter tests.
//
// Uses DYNAMODB_ENDPOINT if set (an instance you started yourself). Otherwise
// looks for the jar at .local/dynamodb-local (see adapters/aws/README.md) and
// a Java 17+ runtime. If either is missing the tests are skipped with the
// reason, never silently passed.
//
// DynamoDB Local has no bind-address option, so it listens on every interface
// while the tests run. It holds only synthetic data in memory, CORS is
// limited to a non-existent origin, and telemetry is disabled.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreateTableCommand, DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { tableDefinition } from '../src/dynamo-store.ts';

const JAR_DIR = fileURLToPath(new URL('../../../.local/dynamodb-local/', import.meta.url));

function javaMajor(bin: string): number {
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8', timeout: 15000 });
  const m = /version "(\d+)(?:\.(\d+))?/.exec(`${r.stderr}${r.stdout}`);
  if (!m) return 0;
  return m[1] === '1' ? Number(m[2]) : Number(m[1]);
}

function findJava(): string | undefined {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [
    process.env.DYNAMODB_LOCAL_JAVA,
    process.env.JAVA_HOME && join(process.env.JAVA_HOME, 'bin', exe),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map((d) => join(d, exe)),
  ].filter((c): c is string => !!c && existsSync(c));
  return [...new Set(candidates)].find((c) => javaMajor(c) >= 17);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

export interface LocalDynamo {
  client: DynamoDBClient;
  createTable(name: string): Promise<void>;
  stop(): Promise<void>;
}

export type LocalDynamoResult = { ok: true; dynamo: LocalDynamo } | { ok: false; reason: string };

function clientFor(endpoint: string): DynamoDBClient {
  // Fixed fake credentials: DynamoDB Local accepts anything, and this keeps
  // the developer's real AWS profile out of the tests entirely.
  return new DynamoDBClient({ endpoint, region: 'us-east-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' }, maxAttempts: 1 });
}

export async function startLocalDynamo(): Promise<LocalDynamoResult> {
  let child: ChildProcess | undefined;
  let endpoint = process.env.DYNAMODB_ENDPOINT;
  if (!endpoint) {
    if (!existsSync(join(JAR_DIR, 'DynamoDBLocal.jar'))) return { ok: false, reason: 'DynamoDB Local not installed at .local/dynamodb-local (see adapters/aws/README.md)' };
    const java = findJava();
    if (!java) return { ok: false, reason: 'no Java 17+ runtime found (set DYNAMODB_LOCAL_JAVA)' };
    const port = await freePort();
    child = spawn(java, ['-Djava.library.path=./DynamoDBLocal_lib', '-jar', 'DynamoDBLocal.jar', '-inMemory', '-port', String(port), '-disableTelemetry', '-cors', 'http://dynamodb-local.invalid'], { cwd: JAR_DIR, stdio: 'ignore' });
    endpoint = `http://127.0.0.1:${port}`;
    // Never leave a Java process behind if the run crashes or is interrupted.
    const proc = child;
    const killChild = () => { if (proc.exitCode == null) proc.kill(); };
    process.once('exit', killChild);
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { killChild(); process.exit(130); });
  }
  const client = clientFor(endpoint);
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      await client.send(new ListTablesCommand({}));
      break;
    } catch (err) {
      if (Date.now() > deadline || child?.exitCode != null) {
        child?.kill();
        return { ok: false, reason: `DynamoDB Local did not start: ${(err as Error).message}` };
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return {
    ok: true,
    dynamo: {
      client,
      async createTable(name) {
        await client.send(new CreateTableCommand(tableDefinition(name)));
      },
      async stop() {
        client.destroy();
        if (child && child.exitCode == null) {
          const exited = new Promise((r) => child!.once('exit', r));
          child.kill();
          await exited;
        }
      },
    },
  };
}
