// T19 live run: the Stage B scenarios against a deployed Gateway and the
// core-backed tool Lambda, checked by effects (responses, durable audit records,
// stored state, ledger head) instead of stub log lines. Needs AWS and an
// approved deployment (docs/runbooks/infra.md). NOT YET RUN.
//
// Usage: npm run harness:stage-b-core
// Reads .local/stage-b-core.json (git-ignored):
//   { "region", "gatewayUrl", "harnessRoleArn", "policyEngineId", "tableName", "evidenceBucket", "versionsFile" }
// versionsFile is the JSON written by `infra/scripts/seed-evidence.ts --out`.
// The operator's current AWS profile is used to assume the harness role, as the
// "other principal" probe, to read policy names, and to read the table.
// Run in a quiet test environment: per-call checks assume no other traffic.

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { createAwsDomain, DEPLOYED_AGENT_ID, stageBObserver } from '../adapters/aws/src/aws-domain.ts';
import { parseDeniedBy, policyIdFromDescription, runCoreStageB, type Scenario, type ToolClient } from '../adapters/aws/src/stage-b-core.ts';
import { loadManifest } from '../core/src/fixtures.ts';
import type { ToolDefinition } from '../core/src/tool-schema.ts';

const require = createRequire(import.meta.url);
const { GatewayHarnessClient, assumeRole, currentProfileCredentials } = require('./clients/gateway-harness-client.cjs') as {
  GatewayHarnessClient: new (o: { gatewayUrl: string; region: string; credentials: unknown; label: string }) => ToolClient;
  assumeRole(arn: string, session: string): unknown;
  currentProfileCredentials(): unknown;
};
const { SCENARIOS } = require('./scenarios.cjs') as { SCENARIOS: Scenario[] };

const ROOT = join(import.meta.dirname, '..');
const CONFIG = join(ROOT, '.local', 'stage-b-core.json');
if (!existsSync(CONFIG)) {
  console.error('missing .local/stage-b-core.json; see the header of harness/run-stage-b-core.mts and docs/runbooks/infra.md');
  process.exit(2);
}
const cfg = JSON.parse(readFileSync(CONFIG, 'utf8')) as Record<string, string>;
for (const k of ['region', 'gatewayUrl', 'harnessRoleArn', 'policyEngineId', 'tableName', 'evidenceBucket', 'versionsFile']) if (!cfg[k]) throw new Error(`.local/stage-b-core.json is missing ${k}`);
const repo = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const caseScope = JSON.parse(repo('policy/case-scope.json')) as { caseId: string; evidenceIds: string[] };
const versions = new Map(Object.entries(JSON.parse(readFileSync(cfg.versionsFile!, 'utf8')) as Record<string, string>));
const redact = <T,>(v: T): T => JSON.parse(JSON.stringify(v).replace(/\b\d{12}\b/g, '<account>')) as T;

// Engine policy names -> our @id values (stored as descriptions, as in Stage B).
const out = execFileSync('aws', ['bedrock-agentcore-control', 'list-policies', '--policy-engine-id', cfg.policyEngineId!, '--region', cfg.region!, '--output', 'json']).toString();
const names: Record<string, string> = {};
for (const p of JSON.parse(out).policies as Array<{ name: string; description?: string }>) {
  const id = policyIdFromDescription(p.description ?? '');
  if (id) names[p.name] = id;
}
const deniedBy = (rpcError: string | null) => parseDeniedBy(rpcError, names);

const operator = createAwsDomain({
  dynamo: new DynamoDBClient({ region: cfg.region }), s3: new S3Client({ region: cfg.region }),
  tableName: cfg.tableName!, evidenceBucket: cfg.evidenceBucket!, caseId: caseScope.caseId, agentId: DEPLOYED_AGENT_ID,
  caseScope, manifest: loadManifest(), tools: JSON.parse(repo('policy/tools/evidence-tools.json')) as ToolDefinition[],
});
const client = (credentials: unknown, label: string) => new GatewayHarnessClient({ gatewayUrl: cfg.gatewayUrl!, region: cfg.region!, credentials, label });

const report = await runCoreStageB({
  harness: client(assumeRole(cfg.harnessRoleArn!, 'coc-t19-stage-b-core'), 'harness-role'),
  other: client(currentProfileCredentials(), 'operator'),
  unsigned: client(null, 'unsigned'),
  scenarios: SCENARIOS, versions, observe: stageBObserver(operator, caseScope.caseId), agentId: DEPLOYED_AGENT_ID, deniedBy,
});

const dir = join(ROOT, 'docs', 'research', 't19-evidence');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'stage-b-core-live.json'), `${JSON.stringify(redact({ ranAt: new Date().toISOString(), lambda: 'core-backed', ...report }), null, 2)}\n`);
for (const c of report.checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  check  ${c.name}`);
for (const s of report.scenarios) console.log(`${s.pass ? 'PASS' : 'FAIL'}  ${s.id.padEnd(5)} ${s.expect.padEnd(12)} ${s.tool.padEnd(22)} ${s.stoppedBy}${s.problems.length ? `  (${s.problems.join('; ')})` : ''}`);
console.log(`\n${report.summary.passed}/${report.summary.total} passed, ${report.summary.failed} failed`);
process.exitCode = report.summary.failed === 0 ? 0 : 1;
