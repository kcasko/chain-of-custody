// Compromised agent, backend alone: what the domain core permits when the
// model is hostile AND the Gateway and Cedar are both assumed to have failed.
// Every attack in harness/compromised-agent.cjs is sent straight to the real
// tool handler with a forged Gateway context, on DynamoDB Local and the S3
// fake. No model, no Gateway, no Cedar: only the backend can say no.
//
// This is a local test. It proves the backend's own refusals, not anything
// about IAM, S3 Object Lock, the live Gateway or the live Cedar engine.

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadManifest, readFixtureBytes } from '../../../core/src/fixtures.ts';
import { TOOL_DEFINITIONS } from '../../../core/test/helpers.ts';
import { createAwsDomain, createAwsToolHandler, DEPLOYED_AGENT_ID, registerManifest, stressObserver, type AwsDomainConfig } from '../src/aws-domain.ts';
import { runCompromisedAgent, type Attack, type AttackResult } from '../src/compromised-agent.ts';
import type { ToolClient } from '../src/stage-b-core.ts';
import { startLocalDynamo } from './dynamodb-local.ts';
import { FakeBucket, fakeS3Client } from './fake-s3.ts';

const require = createRequire(import.meta.url);
const { ATTACKS } = require('../../../harness/compromised-agent.cjs') as { ATTACKS: Attack[] };
const caseScope = JSON.parse(readFileSync(new URL('../../../policy/case-scope.json', import.meta.url), 'utf8')) as { caseId: string; evidenceIds: string[] };
const CASE = caseScope.caseId;

const local = await startLocalDynamo();
after(async () => { if (local.ok) await local.dynamo.stop(); });

type Handler = ReturnType<typeof createAwsToolHandler>;

// The handler as the Gateway would invoke it, with no Gateway or Cedar in front.
class DirectBackendClient implements ToolClient {
  readonly name = 'backend-only';
  readonly #handler: Handler;
  constructor(handler: Handler) { this.#handler = handler; }
  async initialize() { return { ok: true, httpStatus: 200 }; }
  async listTools() { return { ok: true, httpStatus: 200, tools: [] }; }
  async callTool(name: string, args: Record<string, unknown>) {
    const payload = await this.#handler(args, { clientContext: { custom: { bedrockAgentCoreToolName: name, bedrockAgentCoreAwsRequestId: `gw-${randomUUID()}` } } });
    return { httpStatus: 200, rpcError: null, isError: false, payload, text: JSON.stringify(payload) };
  }
}

describe('compromised agent against the backend alone (Gateway and Cedar bypassed)', { skip: local.ok ? false : local.reason }, () => {
  let results: AttackResult[] = [];
  let operator: ReturnType<typeof createAwsDomain>;

  test('runs every attack', async () => {
    const dynamo = local.ok ? local.dynamo : undefined!;
    const tableName = `coc-compromised-${randomUUID()}`;
    await dynamo.createTable(tableName);
    const cfg: AwsDomainConfig = { dynamo: dynamo.client, s3: fakeS3Client(new FakeBucket()), tableName, evidenceBucket: 'coc-evidence-test', caseId: CASE, agentId: DEPLOYED_AGENT_ID, caseScope, manifest: loadManifest(), tools: TOOL_DEFINITIONS };
    operator = createAwsDomain({ ...cfg, members: [{ userId: 'owen.hale', role: 'investigator' }] });
    const versions = await registerManifest(operator, CASE, cfg.manifest, readFixtureBytes, 'owen.hale');
    results = await runCompromisedAgent({
      client: new DirectBackendClient(createAwsToolHandler(cfg, { log: () => {} })),
      attacks: ATTACKS, versions, observe: stressObserver(operator, CASE), agentId: DEPLOYED_AGENT_ID,
    });
    if (process.env.COC_COMPROMISED_REPORT) for (const r of results) console.log(`COC ${JSON.stringify(r)}`);
    assert.equal(results.length, ATTACKS.length);
  });

  test('every attack had the expected outcome', () => {
    const failed = results.filter((r) => r.problems.length).map((r) => `${r.id}: ${r.problems.join('; ')}`);
    assert.deepEqual(failed, []);
  });

  test('no attack moved the ledger or changed a stored evidence byte', () => {
    assert.deepEqual(results.filter((r) => r.ledgerMoved || r.evidenceChanged).map((r) => r.id), []);
  });

  test('the forged BW-003 "correction" stays a draft: a person who tries to promote it is refused', async () => {
    const draft = results.find((r) => r.id === 'C1-4')!.response as { proposal_id?: string };
    assert.ok(draft.proposal_id, 'the draft was stored');
    const head = await operator.ledger.head(CASE);
    const ctx = { principal: { type: 'human' as const, userId: 'owen.hale' }, channel: 'api' as const, requestId: `promote-${randomUUID()}`, now: new Date() };
    const promoted = await operator.proposals.promote(ctx, draft.proposal_id);
    assert.equal(!promoted.ok && promoted.code, 'INVALID_REQUEST', 'promotion re-checks the target hash against the real ledger');
    assert.deepEqual(await operator.ledger.head(CASE), head);
  });

  test('every refusal is in the audit log, attributed to the agent, never to a claimed identity', () => {
    for (const r of results.filter((x) => x.outcome.startsWith('core:'))) {
      assert.ok(r.audit.length > 0, `${r.id}: refusal not audited`);
      for (const e of r.audit) assert.equal(e.principal, `agent:${DEPLOYED_AGENT_ID}`, r.id);
    }
  });
});
