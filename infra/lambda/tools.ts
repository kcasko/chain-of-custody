// The Gateway's tool Lambda (T16): the five agent tools on the domain core,
// over DynamoDB (state and durable audit) and S3 (evidence, read only here).
// Replaces the Stage B stub in the synthesized template. Synthesized and
// tested locally (adapters/aws/test/aws-domain.test.ts); not yet deployed or
// verified on AWS.
//
// Configuration is fixed at deploy time. The case, its evidence IDs, the tool
// schemas and the agent identity are bundled from the reviewed policy files,
// never taken from the request.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import caseScope from '../../policy/case-scope.json' with { type: 'json' };
import tools from '../../policy/tools/evidence-tools.json' with { type: 'json' };
import manifest from '../../fixtures/manifest.json' with { type: 'json' };
import { createAwsToolHandler, DEPLOYED_AGENT_ID } from '../../adapters/aws/src/aws-domain.ts';
import type { FixtureManifest } from '../../core/src/fixtures.ts';
import type { ToolDefinition } from '../../core/src/tool-schema.ts';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export const handler = createAwsToolHandler({
  dynamo: new DynamoDBClient({}),
  s3: new S3Client({}),
  tableName: required('TABLE_NAME'),
  evidenceBucket: required('EVIDENCE_BUCKET'),
  caseId: caseScope.caseId,
  agentId: DEPLOYED_AGENT_ID,
  caseScope,
  manifest: manifest as FixtureManifest,
  tools: tools as unknown as ToolDefinition[], // shape checked by tool-schema tests on the same file
});
