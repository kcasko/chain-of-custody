// T21 A2 probes against the deployed Gateway when the admitted principal is the
// managed harness's execution role (which only the AgentCore service can
// assume, so the full T19 scenario run cannot be signed from here):
//   - an unsigned request must be refused;
//   - a call signed as another principal (the operator) must be denied by the
//     session-role boundary, and nothing may reach the tool Lambda.
//
// Usage: node harness/probe-gateway.mts
// Reads .local/stage-b-core.json: { region, gatewayUrl, policyEngineId, tableName, evidenceBucket }

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { createAwsDomain, DEPLOYED_AGENT_ID, stageBObserver } from '../adapters/aws/src/aws-domain.ts';
import { parseDeniedBy, policyIdFromDescription, type ToolClient } from '../adapters/aws/src/stage-b-core.ts';
import { loadManifest } from '../core/src/fixtures.ts';
import type { ToolDefinition } from '../core/src/tool-schema.ts';

const require = createRequire(import.meta.url);
const { GatewayHarnessClient, currentProfileCredentials } = require('./clients/gateway-harness-client.cjs') as {
  GatewayHarnessClient: new (o: { gatewayUrl: string; region: string; credentials: unknown; label: string }) => ToolClient;
  currentProfileCredentials(): unknown;
};
const ROOT = join(import.meta.dirname, '..');
const CONFIG = join(ROOT, '.local', 'stage-b-core.json');
if (!existsSync(CONFIG)) {
  console.error('missing .local/stage-b-core.json');
  process.exit(2);
}
const cfg = JSON.parse(readFileSync(CONFIG, 'utf8')) as Record<string, string>;
const repo = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const caseScope = JSON.parse(repo('policy/case-scope.json')) as { caseId: string; evidenceIds: string[] };
const d = createAwsDomain({
  dynamo: new DynamoDBClient({ region: cfg.region }), s3: new S3Client({ region: cfg.region }), tableName: cfg.tableName!, evidenceBucket: cfg.evidenceBucket!,
  caseId: caseScope.caseId, agentId: DEPLOYED_AGENT_ID, caseScope, manifest: loadManifest(), tools: JSON.parse(repo('policy/tools/evidence-tools.json')) as ToolDefinition[],
});
const observe = stageBObserver(d, caseScope.caseId);
const names: Record<string, string> = {};
const listed = JSON.parse(execFileSync('aws', ['bedrock-agentcore-control', 'list-policies', '--policy-engine-id', cfg.policyEngineId!, '--region', cfg.region!, '--output', 'json']).toString()) as { policies: Array<{ name: string; description?: string }> };
for (const p of listed.policies) { const id = policyIdFromDescription(p.description ?? ''); if (id) names[p.name] = id; }

const before = await observe.audit();
const unsigned = await new GatewayHarnessClient({ gatewayUrl: cfg.gatewayUrl!, region: cfg.region!, credentials: null, label: 'unsigned' }).initialize();
const other = new GatewayHarnessClient({ gatewayUrl: cfg.gatewayUrl!, region: cfg.region!, credentials: currentProfileCredentials(), label: 'operator' });
await other.initialize();
const listedByOther = await other.listTools();
const call = await other.callTool('EvidenceTools___list_evidence', {});
const after = await observe.audit();

const results = [
  { check: 'unsigned request is refused', pass: !unsigned.ok && [401, 403].includes(unsigned.httpStatus), detail: { httpStatus: unsigned.httpStatus } },
  { check: 'operator principal: denied by the session-role boundary', pass: !!call.rpcError && parseDeniedBy(call.rpcError, names).includes('boundary-session-role-only'), detail: { deniedBy: parseDeniedBy(call.rpcError, names), toolsListed: listedByOther.tools.length } },
  { check: 'nothing reached the tool Lambda (no new audit records)', pass: after.total === before.total, detail: { auditBefore: before.total, auditAfter: after.total } },
];
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.check}  ${JSON.stringify(r.detail)}`);
process.exitCode = results.every((r) => r.pass) ? 0 : 1;
