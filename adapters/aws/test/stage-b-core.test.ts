// T19: the core-backed Stage B runner, end to end on this machine: real Cedar
// policies (official engine) in front of the real tool handler, on DynamoDB
// Local and the S3 fake, observed through the durable audit log. Then the same
// runner against broken setups, to prove it fails when it should.

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadManifest, readFixtureBytes } from '../../../core/src/fixtures.ts';
import { TOOL_DEFINITIONS } from '../../../core/test/helpers.ts';
import { createAwsDomain, createAwsToolHandler, DEPLOYED_AGENT_ID, registerManifest, stageBObserver, type AwsDomainConfig } from '../src/aws-domain.ts';
import { bindVersions, parseDeniedBy, policyIdFromDescription, runCoreStageB, type Scenario } from '../src/stage-b-core.ts';
import { startLocalDynamo } from './dynamodb-local.ts';
import { FakeBucket, fakeS3Client } from './fake-s3.ts';
import { LocalGatewayClient, localDeniedBy } from './local-gateway.ts';

const require = createRequire(import.meta.url);
const { SCENARIOS } = require('../../../harness/scenarios.cjs') as { SCENARIOS: Scenario[] };
const caseScope = JSON.parse(readFileSync(new URL('../../../policy/case-scope.json', import.meta.url), 'utf8')) as { caseId: string; evidenceIds: string[] };
const CASE = caseScope.caseId;

const local = await startLocalDynamo();
after(async () => { if (local.ok) await local.dynamo.stop(); });

describe('T19 runner on the local Gateway emulation', { skip: local.ok ? false : local.reason }, () => {
  const dynamo = local.ok ? local.dynamo : undefined!;

  async function environment(agentId = DEPLOYED_AGENT_ID) {
    const tableName = `coc-t19-${randomUUID()}`;
    await dynamo.createTable(tableName);
    const cfg: AwsDomainConfig = { dynamo: dynamo.client, s3: fakeS3Client(new FakeBucket()), tableName, evidenceBucket: 'coc-evidence-test', caseId: CASE, agentId, caseScope, manifest: loadManifest(), tools: TOOL_DEFINITIONS };
    const operator = createAwsDomain({ ...cfg, agentId: DEPLOYED_AGENT_ID, members: [{ userId: 'owen.hale', role: 'investigator' }] });
    const versions = await registerManifest(operator, CASE, cfg.manifest, readFixtureBytes, 'owen.hale');
    const handler = createAwsToolHandler(cfg, { log: () => {} });
    return { versions, handler, observe: stageBObserver(operator, CASE) };
  }

  const run = (env: Awaited<ReturnType<typeof environment>>, handler = env.handler, options: { enforceCedar?: boolean } = {}) => runCoreStageB({
    harness: new LocalGatewayClient(handler, 'session', options),
    other: new LocalGatewayClient(handler, 'other', options),
    unsigned: new LocalGatewayClient(handler, null),
    scenarios: SCENARIOS, versions: env.versions, observe: env.observe, agentId: DEPLOYED_AGENT_ID, deniedBy: localDeniedBy,
  });

  test('every check and all 24 scenarios pass, with the layer that stopped each attack recorded', async () => {
    const report = await run(await environment());
    const failed = [...report.checks.filter((c) => !c.pass).map((c) => c.name), ...report.scenarios.filter((s) => !s.pass).map((s) => `${s.id}: ${s.problems.join('; ')}`)];
    assert.deepEqual(failed, []);
    assert.deepEqual(report.summary, { passed: 29, failed: 0, total: 29 });
    const by = Object.fromEntries(report.scenarios.map((s) => [s.id, s.stoppedBy]));
    assert.equal(by['L-4'], 'executed');
    assert.match(by['D-1']!, /^cedar:/);
    assert.equal(by['V-1'], 'core:NOT_FOUND', 'the stub code VERSION_NOT_REGISTERED maps to the core code');
    assert.equal(by['A-1'], 'gateway', 'an unknown tool never reaches the Lambda');
    assert.deepEqual(report.scenarios.find((s) => s.id === 'L-4')!.stateChange, { findings: 1, proposals: 0 });
    assert.deepEqual(report.scenarios.find((s) => s.id === 'L-5')!.stateChange, { findings: 0, proposals: 1 });
  });

  test('with Cedar bypassed, the runner fails every cedar-deny scenario and the boundary check', async () => {
    const report = await run(await environment(), undefined, { enforceCedar: false });
    const failedIds = report.scenarios.filter((s) => !s.pass).map((s) => s.id).sort();
    const cedarIds = SCENARIOS.filter((s) => s.expect === 'cedar-deny').map((s) => s.id).sort();
    assert.deepEqual(failedIds, cedarIds);
    assert.equal(report.checks.find((c) => c.name.startsWith('other principal'))!.pass, false);
  });

  test('a handler that executes an attack it should refuse is caught by the state and audit checks', async () => {
    const env = await environment();
    // Leaky: answers "executed" to an invalid finding (V-3), as a broken Lambda might.
    const leaky = async (event: unknown, context: Parameters<typeof env.handler>[1]) => {
      const e = event as Record<string, unknown>;
      if (e.summary === '' && e.uncertainty === 'low') return { status: 'executed', finding_id: 'forged' };
      return env.handler(event, context);
    };
    const report = await run(env, leaky);
    const v3 = report.scenarios.find((s) => s.id === 'V-3')!;
    assert.equal(v3.pass, false);
    assert.ok(v3.problems.some((p) => /expected the core to reject with INVALID_REQUEST/.test(p)), v3.problems.join('; '));
    assert.ok(v3.problems.some((p) => /no denied or failed audit record/.test(p)), v3.problems.join('; '));
  });

  test('records attributed to a different agent identity fail attribution', async () => {
    const report = await run(await environment('some-other-agent'));
    const l1 = report.scenarios.find((s) => s.id === 'L-1')!;
    assert.equal(l1.pass, false);
    assert.ok(l1.problems.some((p) => /not attributed to agent:coc-audit-agent/.test(p)), l1.problems.join('; '));
  });
});

test('Gateway denial text is mapped to policy IDs, with the engine suffix removed', () => {
  const names = { coc_test_gw_03: 'permit-read-pinned-version', coc_test_gw_00: 'boundary-session-role-only' };
  const live = '-32002: Tool Execution Denied: Tool call not allowed due to policy enforcement [denied due to coc_test_gw_00-a1b2c3d4e5, coc_test_gw_03-zz99yy88xx]';
  assert.deepEqual(parseDeniedBy(live, names), ['boundary-session-role-only', 'permit-read-pinned-version']);
  assert.deepEqual(parseDeniedBy('... Tool call not allowed: denied by default', names), ['default-deny']);
  assert.deepEqual(parseDeniedBy(null), []);
  assert.deepEqual(parseDeniedBy('some other error'), []);
  assert.equal(policyIdFromDescription('boundary policy boundary-session-role-only from policy/cedar'), 'boundary-session-role-only');
  assert.equal(policyIdFromDescription('Chain of Custody tool authorization (deny by default)'), null);
});

test('stub version placeholders are replaced with registered IDs, nothing else is touched', () => {
  const versions = new Map([['BW-001/original', 'v-real-1'], ['BW-007/original', 'v-real-7']]);
  assert.deepEqual(bindVersions({ evidence_id: 'BW-001', version_id: 'syn-v1' }, versions), { evidence_id: 'BW-001', version_id: 'v-real-1' });
  assert.deepEqual(bindVersions({ evidence_id: 'BW-001', version_id: 'latest' }, versions), { evidence_id: 'BW-001', version_id: 'latest' });
  assert.deepEqual(bindVersions({ evidence_id: 'BW-999', version_id: 'syn-v1' }, versions).version_id, 'v-not-registered');
  assert.deepEqual(bindVersions({ source_evidence_ids: ['BW-007'], source_version_ids: ['syn-v1'] }, versions).source_version_ids, ['v-real-7']);
});
