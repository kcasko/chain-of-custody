// T16: the deployable tool handler (createAwsToolHandler, the code inside
// infra/lambda/tools.ts) on DynamoDB Local and an in-memory S3 fake. Every
// Stage B scenario runs through it. There is no Gateway or Cedar here, so
// every attack must be refused by the domain core on its own (defense in
// depth); the live Gateway adds Cedar in front of this.
//
// What this proves: the real services, adapters and handler work together and
// refuse what they must. What it does not prove: anything about AWS itself,
// the Gateway, or Bedrock Managed Agents (RB-1).

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { bind } from '../../../app/src/challenge.ts';
import { loadManifest, readFixtureBytes } from '../../../core/src/fixtures.ts';
import { TOOL_DEFINITIONS } from '../../../core/test/helpers.ts';
import { createAwsDomain, createAwsToolHandler, registerManifest, TOOL_LAMBDA_TABLES, type AwsDomainConfig } from '../src/aws-domain.ts';
import { startLocalDynamo } from './dynamodb-local.ts';
import { FakeBucket, fakeS3Client } from './fake-s3.ts';

const require = createRequire(import.meta.url);
const { SCENARIOS } = require('../../../harness/scenarios.cjs') as { SCENARIOS: Array<{ id: string; tool: string; args: Record<string, unknown>; expect: string }> };
const caseScope = JSON.parse(readFileSync(new URL('../../../policy/case-scope.json', import.meta.url), 'utf8')) as { caseId: string; evidenceIds: string[] };
const CASE = 'BLACKWATER-2021';
const AGENT = 'coc-audit-agent';

const local = await startLocalDynamo();
after(async () => { if (local.ok) await local.dynamo.stop(); });

describe('deployable tool handler on DynamoDB Local + S3 fake', { skip: local.ok ? false : local.reason }, () => {
  const dynamo = local.ok ? local.dynamo : undefined!;

  async function environment() {
    const tableName = `coc-tools-${randomUUID()}`;
    await dynamo.createTable(tableName);
    const bucket = new FakeBucket();
    const cfg: AwsDomainConfig = { dynamo: dynamo.client, s3: fakeS3Client(bucket), tableName, evidenceBucket: 'coc-evidence-test', caseId: CASE, agentId: AGENT, caseScope, manifest: loadManifest(), tools: TOOL_DEFINITIONS };
    const seeder = createAwsDomain({ ...cfg, members: [{ userId: 'owen.hale', role: 'investigator' }, { userId: 'elena.ward', role: 'supervisor' }] });
    const versions = await registerManifest(seeder, CASE, cfg.manifest, readFixtureBytes, 'owen.hale');
    const logs: Array<Record<string, unknown>> = [];
    const handler = createAwsToolHandler(cfg, { log: (l) => logs.push(l) });
    const call = (tool: string, args: unknown, requestId = `gw-${randomUUID()}`) =>
      handler(args, { clientContext: { custom: { bedrockAgentCoreToolName: `EvidenceTools___${tool}`, bedrockAgentCoreAwsRequestId: requestId } } }) as Promise<{ status?: string; code?: string } & Record<string, unknown>>;
    return { cfg, seeder, versions, handler, call, logs, bucket };
  }

  test('every Stage B scenario: the 7 legitimate calls execute, all other 17 are refused by the core alone', async () => {
    const { call, versions } = await environment();
    const legit = SCENARIOS.filter((s) => s.expect === 'executed');
    const attacks = SCENARIOS.filter((s) => s.expect !== 'executed');
    assert.equal(legit.length, 7);
    assert.equal(attacks.length, 17);
    for (const s of legit) {
      const out = await call(s.tool, bind(s.args, versions), s.id);
      assert.notEqual(out.status, 'rejected', `${s.id} should execute: ${JSON.stringify(out)}`);
    }
    for (const s of attacks) {
      const out = await call(s.tool, bind(s.args, versions), s.id);
      assert.equal(out.status, 'rejected', `${s.id} (${s.expect}) must be refused even without Cedar: ${JSON.stringify(out).slice(0, 200)}`);
    }
  });

  test('the agent path stays inside the tables its IAM role allows (TOOL_LAMBDA_TABLES)', async () => {
    const { cfg, versions } = await environment();
    const reads = new Set<string>();
    const writes = new Set<string>();
    const other = new Set<string>();
    const real = cfg.dynamo.send.bind(cfg.dynamo);
    const spy = { send: async (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
      const i = cmd.input;
      const op = cmd.constructor.name;
      if (op === 'QueryCommand' || op === 'GetItemCommand') reads.add(i.ExpressionAttributeValues?.[':pk']?.S ?? i.Key?.pk?.S);
      else if (op === 'TransactWriteItemsCommand') for (const t of i.TransactItems) { if (t.Put) writes.add(t.Put.Item.pk.S); else other.add(Object.keys(t)[0]!); }
      else other.add(op);
      return real(cmd as never);
    } };
    const handler = createAwsToolHandler({ ...cfg, dynamo: spy as never }, { log: () => {} });
    for (const s of SCENARIOS) await handler(bind(s.args, versions), { clientContext: { custom: { bedrockAgentCoreToolName: `EvidenceTools___${s.tool}`, bedrockAgentCoreAwsRequestId: s.id } } });
    assert.deepEqual([...other], [], 'only Query, GetItem and transactional Put are used');
    assert.ok([...reads].every((t) => (TOOL_LAMBDA_TABLES.read as readonly string[]).includes(t)), `reads ${[...reads]}`);
    assert.ok([...writes].every((t) => (TOOL_LAMBDA_TABLES.append as readonly string[]).includes(t)), `writes ${[...writes]}`);
    assert.deepEqual([...writes].sort(), [...TOOL_LAMBDA_TABLES.append].sort(), 'and the list is not wider than needed');
  });

  test('agent writes are attributed to the configured agent and stay drafts; the ledger only grows by human action', async () => {
    const { call, versions, seeder } = await environment();
    const head = await seeder.ledger.head(CASE);
    const l5 = SCENARIOS.find((s) => s.id === 'L-5')!;
    const proposed = await call(l5.tool, bind(l5.args, versions));
    assert.notEqual(proposed.status, 'rejected', JSON.stringify(proposed));
    assert.deepEqual(await seeder.ledger.head(CASE), head, 'a proposal is not a ledger event');
    const drafts = await seeder.store.list<{ proposedBy: string; status: string }>('proposals', '');
    assert.equal(drafts.length, 1);
    assert.deepEqual([drafts[0]!.item.value.proposedBy, drafts[0]!.item.value.status], [AGENT, 'draft']);
  });

  test('every call is in the durable audit log under the Gateway request ID, attributed to the agent', async () => {
    const { call, versions, seeder } = await environment();
    const l2 = SCENARIOS.find((s) => s.id === 'L-2')!;
    await call(l2.tool, bind(l2.args, versions), 'gw-req-L2');
    await call('read_evidence_version', { evidence_id: 'BW-999', version_id: 'v' }, 'gw-req-D1');
    const { events } = await seeder.audit.forCase(CASE, 50);
    const mine = events.filter((e) => e.requestId === 'gw-req-L2' || e.requestId === 'gw-req-D1');
    assert.ok(mine.length >= 3, JSON.stringify(mine));
    assert.ok(mine.every((e) => e.principal === `agent:${AGENT}`));
    assert.ok(mine.some((e) => e.requestId === 'gw-req-L2' && e.outcome === 'completed'));
    assert.ok(mine.some((e) => e.requestId === 'gw-req-D1' && e.outcome !== 'completed'));
  });

  test('without the Gateway context the handler refuses before touching any service', async () => {
    const { handler, logs } = await environment();
    const out = await handler({}, undefined) as { status: string; code: string };
    assert.deepEqual([out.status, out.code], ['rejected', 'NO_GATEWAY_CONTEXT']);
    const spoof = await handler({}, { clientContext: { custom: { bedrockAgentCoreToolName: 'OtherTarget___list_evidence' } } }) as { code: string };
    assert.equal(spoof.code, 'NO_GATEWAY_CONTEXT');
    assert.equal(logs.filter((l) => l.code === 'NO_GATEWAY_CONTEXT').length, 2);
  });

  test('configuration for the wrong case is refused at startup', () => {
    const base = { dynamo: dynamo.client, s3: fakeS3Client(new FakeBucket()), tableName: 't', evidenceBucket: 'b', agentId: AGENT, caseScope, manifest: loadManifest(), tools: TOOL_DEFINITIONS };
    assert.throws(() => createAwsDomain({ ...base, caseId: 'GREYHOLLOW-2019' }), /case scope is for another case/);
    assert.throws(() => createAwsDomain({ ...base, caseId: 'bad case' }), /invalid case id/);
  });
});
