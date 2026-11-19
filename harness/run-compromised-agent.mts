// Live compromised-agent run (proposed T22). NOT YET RUN.
//
// Sends every attack in harness/compromised-agent.cjs through the deployed
// AgentCore Gateway and Cedar engine, signed as the admitted test role, into
// the core-backed tool Lambda. No model is involved. For each call it records
// the first layer that refused (Gateway, a named Cedar policy, or the core)
// and re-reads the ledger head, the stored bytes of every evidence version,
// the findings and drafts, and the audit log.
//
// Needs an approved test deployment with -c harness=true (see
// docs/plans/2026-11-19-t22-compromised-agent-live.md) and the same
// .local/stage-b-core.json that harness/run-stage-b-core.mts reads.
//
// Usage: node harness/run-compromised-agent.mts

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { createAwsDomain, DEPLOYED_AGENT_ID, stressObserver } from '../adapters/aws/src/aws-domain.ts';
import { runCompromisedAgent, type Attack } from '../adapters/aws/src/compromised-agent.ts';
import { parseDeniedBy, policyIdFromDescription, type ToolClient } from '../adapters/aws/src/stage-b-core.ts';
import { loadManifest } from '../core/src/fixtures.ts';
import type { ToolDefinition } from '../core/src/tool-schema.ts';

const require = createRequire(import.meta.url);
const { GatewayHarnessClient, assumeRole } = require('./clients/gateway-harness-client.cjs') as {
  GatewayHarnessClient: new (o: { gatewayUrl: string; region: string; credentials: unknown; label: string }) => ToolClient;
  assumeRole(arn: string, session: string): unknown;
};
const { ATTACKS } = require('./compromised-agent.cjs') as { ATTACKS: Attack[] };

const ROOT = join(import.meta.dirname, '..');
const CONFIG = join(ROOT, '.local', 'stage-b-core.json');
if (!existsSync(CONFIG)) {
  console.error('missing .local/stage-b-core.json; see docs/plans/2026-11-19-t22-compromised-agent-live.md');
  process.exit(2);
}
const cfg = JSON.parse(readFileSync(CONFIG, 'utf8')) as Record<string, string>;
for (const k of ['region', 'gatewayUrl', 'harnessRoleArn', 'policyEngineId', 'tableName', 'evidenceBucket', 'versionsFile']) if (!cfg[k]) throw new Error(`.local/stage-b-core.json is missing ${k}`);
const repo = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const caseScope = JSON.parse(repo('policy/case-scope.json')) as { caseId: string; evidenceIds: string[] };
const versions = new Map(Object.entries(JSON.parse(readFileSync(cfg.versionsFile!, 'utf8')) as Record<string, string>));
const redact = <T,>(v: T): T => JSON.parse(JSON.stringify(v).replace(/\b\d{12}\b/g, '<account>')) as T;

const out = execFileSync('aws', ['bedrock-agentcore-control', 'list-policies', '--policy-engine-id', cfg.policyEngineId!, '--region', cfg.region!, '--output', 'json']).toString();
const names: Record<string, string> = {};
for (const p of JSON.parse(out).policies as Array<{ name: string; description?: string }>) {
  const id = policyIdFromDescription(p.description ?? '');
  if (id) names[p.name] = id;
}

const operator = createAwsDomain({
  dynamo: new DynamoDBClient({ region: cfg.region }), s3: new S3Client({ region: cfg.region }),
  tableName: cfg.tableName!, evidenceBucket: cfg.evidenceBucket!, caseId: caseScope.caseId, agentId: DEPLOYED_AGENT_ID,
  caseScope, manifest: loadManifest(), tools: JSON.parse(repo('policy/tools/evidence-tools.json')) as ToolDefinition[],
});

const results = await runCompromisedAgent({
  client: new GatewayHarnessClient({ gatewayUrl: cfg.gatewayUrl!, region: cfg.region!, credentials: assumeRole(cfg.harnessRoleArn!, 'coc-t22-compromised'), label: 'harness-role' }),
  attacks: ATTACKS, versions, observe: stressObserver(operator, caseScope.caseId), agentId: DEPLOYED_AGENT_ID,
  deniedBy: (rpcError) => parseDeniedBy(rpcError, names),
});

const dir = join(ROOT, 'docs', 'research', 't22-evidence');
mkdirSync(dir, { recursive: true });
const failed = results.filter((r) => r.problems.length).length;
writeFileSync(join(dir, 'compromised-agent-live.json'), `${JSON.stringify(redact({ ranAt: new Date().toISOString(), model: 'none', results: results.map(({ response: _r, ...rest }) => rest), failed }), null, 2)}\n`);
for (const r of results) console.log(`${r.problems.length ? 'FAIL' : 'PASS'}  ${r.id.padEnd(5)} ${r.outcome.padEnd(40)} ${r.attempt}${r.problems.length ? `  (${r.problems.join('; ')})` : ''}`);
console.log(`\n${results.length - failed}/${results.length} as expected`);
process.exitCode = failed === 0 ? 0 : 1;
