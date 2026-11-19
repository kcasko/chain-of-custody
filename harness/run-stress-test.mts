// Live stress test of the Blackwater audit agent on the AgentCore managed
// harness (ADR 0010). Needs the T21 deployment. NOT YET RUN.
//
// Usage: npm run agent:stress
// Reads .local/agent.json (git-ignored): { "region", "harnessArn", "tableName", "evidenceBucket" }
// Writes docs/research/stress-test/<date>-managed-harness.{json,md}, with account IDs redacted.
// Run in a quiet environment: per-prompt state deltas assume no other traffic.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { createAwsDomain, DEPLOYED_AGENT_ID, stressObserver } from '../adapters/aws/src/aws-domain.ts';
import { HarnessAgentClient } from '../adapters/aws/src/harness-client.ts';
import { renderStressReport, runStressTest, STRESS_PROMPTS } from '../adapters/aws/src/stress-test.ts';
import { loadManifest } from '../core/src/fixtures.ts';
import type { ToolDefinition } from '../core/src/tool-schema.ts';
import { AGENT_MODEL_PROFILE } from '../infra/lib/agent-stack.ts';

const ROOT = join(import.meta.dirname, '..');
const CONFIG = join(ROOT, '.local', 'agent.json');
if (!existsSync(CONFIG)) {
  console.error('missing .local/agent.json; see the header of harness/run-stress-test.mts and docs/plans/2026-11-18-t21-agent-run.md');
  process.exit(2);
}
const cfg = JSON.parse(readFileSync(CONFIG, 'utf8')) as Record<string, string>;
for (const k of ['region', 'harnessArn', 'tableName', 'evidenceBucket']) if (!cfg[k]) throw new Error(`.local/agent.json is missing ${k}`);
const repo = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const caseScope = JSON.parse(repo('policy/case-scope.json')) as { caseId: string; evidenceIds: string[] };
const redact = <T,>(v: T): T => JSON.parse(JSON.stringify(v).replace(/\b\d{12}\b/g, '<account>')) as T;

const operator = createAwsDomain({
  dynamo: new DynamoDBClient({ region: cfg.region }), s3: new S3Client({ region: cfg.region }),
  tableName: cfg.tableName!, evidenceBucket: cfg.evidenceBucket!, caseId: caseScope.caseId, agentId: DEPLOYED_AGENT_ID,
  caseScope, manifest: loadManifest(), tools: JSON.parse(repo('policy/tools/evidence-tools.json')) as ToolDefinition[],
});
const agent = new HarnessAgentClient({ harnessArn: cfg.harnessArn!, region: cfg.region });
const ranAt = new Date().toISOString();
const results = await runStressTest({ agent, prompts: STRESS_PROMPTS, observe: stressObserver(operator, caseScope.caseId), agentId: DEPLOYED_AGENT_ID });

const dir = join(ROOT, 'docs', 'research', 'stress-test');
mkdirSync(dir, { recursive: true });
const base = join(dir, `${ranAt.slice(0, 10)}-managed-harness`);
writeFileSync(`${base}.json`, `${JSON.stringify(redact({ ranAt, runtime: 'Amazon Bedrock AgentCore managed harness', model: AGENT_MODEL_PROFILE, results }), null, 2)}\n`);
writeFileSync(`${base}.md`, redact(renderStressReport(results, { runtime: 'Amazon Bedrock AgentCore managed harness', model: AGENT_MODEL_PROFILE, ranAt })));
for (const r of results) console.log(`${r.verdict === 'held' ? 'HELD  ' : 'BROKEN'} ${r.id} ${r.category.padEnd(18)} ${r.agentBehavior}${r.reasons.length ? `  (${r.reasons.join('; ')})` : ''}`);
const broken = results.filter((r) => r.verdict === 'broken').length;
console.log(`\n${results.length - broken}/${results.length} held. Report: ${base}.md`);
process.exitCode = broken === 0 ? 0 : 1;
