// Registers the synthetic fixtures into a deployed environment, as one human
// investigator, through the same domain wiring the tool Lambda uses. Writes
// to DynamoDB and S3 (small, billable), so it refuses to run without --confirm.
// NOT YET RUN against AWS; part of the approved-deploy steps in
// docs/runbooks/infra.md.
//
// Usage (credentials from the standard AWS chain, with the writer policy):
//   TABLE_NAME=... EVIDENCE_BUCKET=... AWS_REGION=... \
//     node infra/scripts/seed-evidence.ts --as owen.hale --confirm
//
// Safe to re-run only on an empty case: registration is append-only, so a
// second run registers duplicate versions rather than overwriting anything.
//
// Attribution is asserted, not authenticated: whoever holds credentials with
// the writer policy can seed "as" any investigator ID. The registrations are
// recorded as stated by the operator; record who ran it in the deploy notes.

import { readFileSync } from 'node:fs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { createAwsDomain, DEPLOYED_AGENT_ID, registerManifest } from '../../adapters/aws/src/aws-domain.ts';
import { loadManifest, readFixtureBytes } from '../../core/src/fixtures.ts';
import type { ToolDefinition } from '../../core/src/tool-schema.ts';
import { USER_ID } from '../../core/src/validate.ts';

const args = process.argv.slice(2);
const asAt = args.indexOf('--as');
const as = asAt >= 0 ? args[asAt + 1] : undefined;
const env = (n: string) => process.env[n] ?? '';
if (!args.includes('--confirm') || !as || !USER_ID.test(as) || !env('TABLE_NAME') || !env('EVIDENCE_BUCKET')) {
  console.error('usage: TABLE_NAME=... EVIDENCE_BUCKET=... node infra/scripts/seed-evidence.ts --as <investigator-id> --confirm');
  process.exit(2);
}

const repo = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const caseScope = JSON.parse(repo('policy/case-scope.json')) as { caseId: string; evidenceIds: string[] };
const manifest = loadManifest();
const d = createAwsDomain({
  dynamo: new DynamoDBClient({}), s3: new S3Client({}),
  tableName: env('TABLE_NAME'), evidenceBucket: env('EVIDENCE_BUCKET'),
  caseId: caseScope.caseId, agentId: DEPLOYED_AGENT_ID, caseScope, manifest,
  tools: JSON.parse(repo('policy/tools/evidence-tools.json')) as ToolDefinition[],
  members: [{ userId: as, role: 'investigator' }],
});
const head = await d.ledger.head(caseScope.caseId);
if (head.sequence !== 0) {
  console.error(`case ${caseScope.caseId} already has ${head.sequence} ledger events; refusing to seed again`);
  process.exit(1);
}
const versions = await registerManifest(d, caseScope.caseId, manifest, readFixtureBytes, as);
console.log(`registered ${versions.size} versions; ledger head is now #${(await d.ledger.head(caseScope.caseId)).sequence}`);
