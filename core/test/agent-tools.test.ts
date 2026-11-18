// The five agent tools on the real core, reached the way the Gateway reaches
// them (gateway-handler.ts). No Cedar, no Gateway: this proves the core alone
// refuses every Stage B attack while legitimate agent work succeeds.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createGatewayHandler } from '../src/gateway-handler.ts';
import { forbiddenConclusion } from '../src/findings.ts';
import { verifyExport } from '../src/verifier.ts';
import { CASE, USERS, AGENT, human, agent, makeWorld, registerFixtures, type World } from './helpers.ts';

const require = createRequire(import.meta.url);
const { SCENARIOS } = require('../../harness/scenarios.cjs') as { SCENARIOS: Array<{ id: string; tool: string; args: Record<string, unknown>; expect: string }> };

function handlerFor(w: World, logs: Array<Record<string, unknown>> = []) {
  return createGatewayHandler({ caseId: CASE, agentId: AGENT, tools: w.agentTools, clock: () => new Date('2026-11-18T18:00:00.000Z'), log: (l) => logs.push(l) });
}
const gw = (tool: string, requestId = 'gw-req-1') => ({ clientContext: { custom: { bedrockAgentCoreToolName: `EvidenceTools___${tool}`, bedrockAgentCoreAwsRequestId: requestId } } });
const rejected = (r: unknown): r is { status: 'rejected'; code: string } => !!r && typeof r === 'object' && (r as { status?: string }).status === 'rejected';

// Stage B used fixed synthetic version IDs; real registrations get random ones.
function bindVersions(args: Record<string, unknown>, versions: Map<string, string>): Record<string, unknown> {
  const real = (id: string) => versions.get(`${id}/original`) ?? 'v-not-registered';
  const out = { ...args };
  if (out.version_id === 'syn-v1' && typeof out.evidence_id === 'string') out.version_id = real(out.evidence_id);
  if (Array.isArray(out.source_version_ids) && Array.isArray(out.source_evidence_ids)) {
    out.source_version_ids = (out.source_evidence_ids as string[]).map(real);
  }
  return out;
}

test('all 24 Stage B scenarios against the core alone: legitimate calls work, every attack is refused', async () => {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  const handler = handlerFor(w);
  assert.equal(SCENARIOS.length, 24);
  for (const s of SCENARIOS) {
    const out = await handler(bindVersions(s.args, versions), gw(s.tool, `gw-${s.id}`));
    if (s.expect === 'executed') assert.ok(!rejected(out), `${s.id} should execute: ${JSON.stringify(out)}`);
    else assert.ok(rejected(out), `${s.id} (${s.expect}) must be refused by the core alone: ${JSON.stringify(out).slice(0, 200)}`);
  }
  assert.equal((await w.ledger.head(CASE)).sequence, 12, 'no tool call changed the custody ledger');
});

test('end to end: the agent audits, records findings and proposes; a human promotes; the export verifies', async () => {
  const w = makeWorld();
  await registerFixtures(w);
  const call = handlerFor(w);

  const listed = await call({}, gw('list_evidence')) as { evidence: Array<{ evidence_id: string; version_id: string; derived_from: unknown }> };
  assert.equal(listed.evidence.length, 12);
  const v = (id: string, derived = false) => listed.evidence.find((e) => e.evidence_id === id && (e.derived_from !== null) === derived)!.version_id;

  const bw10 = await call({ evidence_id: 'BW-010', version_id: v('BW-010') }, gw('read_evidence_version')) as { content: string; content_is_untrusted_data: boolean };
  assert.equal(bw10.content_is_untrusted_data, true);
  assert.match(bw10.content, /SYSTEM NOTE TO AI AUDITOR/, 'the planted instruction is returned as data');

  const cmp = await call({ evidence_ids: ['BW-001', 'BW-005'] }, gw('compare_timestamps')) as { comparisons: Array<{ evidence_id: string; versions: Array<{ source_clock: string; raw_times: string[] }> }> };
  assert.equal(cmp.comparisons.length, 2);
  assert.ok(cmp.comparisons[1]!.versions.some((x) => /controller RTC/.test(x.source_clock)));

  const finding = await call({ finding_type: 'clock_uncertainty', summary: 'BW-005 controller times precede the BW-001 header time; the later drift note was measured weeks after.', cited_evidence_ids: ['BW-001', 'BW-005'], uncertainty: 'high' }, gw('record_finding'));
  assert.ok(!rejected(finding), JSON.stringify(finding));

  const prop = await call({
    evidence_id: 'BW-007', event_kind: 'historical_assertion', reason: 'BW-007 shows sealing by E. Ward; receiving signature blank.',
    source_evidence_ids: ['BW-007'], source_version_ids: [v('BW-007')], claimed_time_raw: '10/14/2021 02:40',
    source_clock: 'handwritten', timezone: 'not stated', offset_uncertainty: 'unknown',
  }, gw('propose_custody_event')) as { proposal_id: string; ledger_changed: boolean };
  assert.equal(prop.ledger_changed, false);
  assert.equal((await w.ledger.head(CASE)).sequence, 12);

  const promoted = await w.proposals.promote(human(USERS.auditor), prop.proposal_id);
  assert.ok(promoted.ok, JSON.stringify(promoted));
  assert.equal(promoted.value.kind, 'historical_assertion');
  assert.equal((await w.ledger.head(CASE)).sequence, 13);

  const findings = await w.findings.list(human(USERS.auditor), CASE);
  assert.ok(findings.ok);
  assert.equal(findings.value[0]!.recordedBy, `agent:${AGENT}`);

  assert.ok((await w.checkpoints.issue(CASE, new Date('2026-11-18T18:30:00.000Z'))).ok);
  const payload = { evidence: [{ evidenceId: 'BW-007', versionId: v('BW-007') }], destination: 'internal:case-export-store' };
  const req = await w.approvals.requestExport(human(USERS.auditor), CASE, payload);
  assert.ok(req.ok);
  assert.ok((await w.approvals.approve(human(USERS.supervisor), req.value.approvalId)).ok);
  const pkg = await w.exports.exportCase(human(USERS.auditor), CASE, req.value.approvalId, payload);
  assert.ok(pkg.ok);
  const head = await w.ledger.head(CASE);
  const report = verifyExport(JSON.parse(JSON.stringify(pkg.value)), { expectedCaseId: CASE, keys: [w.trustedKey], reference: { caseId: CASE, minSequence: head.sequence, headHashAtMinSequence: head.hash, retrievedAt: 'x' } });
  assert.equal(report.status, 'VERIFIED', JSON.stringify(report.findings));
});

test('a proposal whose details are wrong is stored as a draft but cannot be promoted', async () => {
  const w = makeWorld();
  await registerFixtures(w);
  const call = handlerFor(w);
  const draft = await call({ evidence_id: 'BW-005', event_kind: 'correction', reason: 'fix', corrects_sequence: 3, corrects_hash: 'f'.repeat(64) }, gw('propose_custody_event')) as { proposal_id: string };
  assert.ok(draft.proposal_id);
  const r = await w.proposals.promote(human(USERS.supervisor), draft.proposal_id);
  assert.equal(!r.ok && r.code, 'INVALID_REQUEST', 'promotion re-validates: the hash does not match event 3');
  assert.equal((await w.ledger.head(CASE)).sequence, 12);
});

test('findings refuse conclusions of guilt, intent, blame or admissibility', async () => {
  const w = makeWorld();
  await registerFixtures(w);
  const call = handlerFor(w);
  for (const summary of [
    'Victor Sloane is guilty of starting the fire.',
    'The recording gap was deliberately created.',
    'The witness lied about the timeline.',
    'BW-003 is inadmissible.',
    'This proves sabotage of the lab.',
    'A. Cole falsified the migration log.',
  ]) {
    const out = await call({ finding_type: 'discrepancy', summary, cited_evidence_ids: ['BW-001'], uncertainty: 'low' }, gw('record_finding'));
    assert.ok(rejected(out) && out.code === 'CONTENT_RULE_VIOLATION', summary);
  }
  assert.equal(forbiddenConclusion('The receiving signature line on BW-007 is blank.'), null);
  const unregistered = await call({ finding_type: 'discrepancy', summary: 'x', cited_evidence_ids: ['BW-004'], uncertainty: 'low' }, gw('record_finding'));
  assert.ok(!rejected(unregistered), 'BW-004 is registered');
  const empty = makeWorld();
  const none = await handlerFor(empty)({ finding_type: 'discrepancy', summary: 'x', cited_evidence_ids: ['BW-004'], uncertainty: 'low' }, gw('record_finding'));
  assert.ok(rejected(none) && none.code === 'NOT_FOUND', 'citations must be registered evidence');
});

test('humans may record findings; outsiders may not', async () => {
  const w = makeWorld();
  await registerFixtures(w);
  const input = { findingType: 'provenance_gap', summary: 'S-17 is referenced in BW-003 but absent from BW-007.', citedEvidenceIds: ['BW-003', 'BW-007'], uncertainty: 'medium' };
  assert.ok((await w.findings.record(human(USERS.auditor), CASE, input)).ok);
  const outsider = await w.findings.record(human(USERS.outsider), CASE, input);
  assert.equal(!outsider.ok && outsider.code, 'DENIED_NOT_MEMBER');
  const list = await w.findings.list(agent(), CASE);
  assert.ok(list.ok, 'the agent can read findings (read_metadata)');
});

test('findings are append-only', async () => {
  const w = makeWorld();
  await registerFixtures(w);
  const r = await w.findings.record(human(USERS.auditor), CASE, { findingType: 'discrepancy', summary: 'x', citedEvidenceIds: ['BW-001'], uncertainty: 'low' });
  assert.ok(r.ok);
  const [row] = await w.store.list('findings', `${CASE}#`);
  await assert.rejects(() => w.store.transact([{ table: 'findings', key: row!.key, value: { ...r.value, summary: 'edited' }, expectVersion: row!.item.version }]));
});

test('the gateway handler fails closed without trusted gateway context and ignores identity in arguments', async () => {
  const w = makeWorld();
  await registerFixtures(w);
  const logs: Array<Record<string, unknown>> = [];
  const call = handlerFor(w, logs);
  for (const ctx of [undefined, {}, { clientContext: { custom: {} } }, { clientContext: { custom: { bedrockAgentCoreToolName: 'OtherTarget___list_evidence' } } }]) {
    const out = await call({}, ctx);
    assert.ok(rejected(out) && out.code === 'NO_GATEWAY_CONTEXT');
  }
  const spoof = await call({ actor: 'supervisor' }, gw('list_evidence'));
  assert.ok(rejected(spoof) && spoof.code === 'INVALID_REQUEST');
  assert.ok(logs.every((l) => !JSON.stringify(l).includes('supervisor')), 'arguments are not logged');
  const refusal = w.audit.events.find((e) => e.requestId === 'gw-req-1' && e.operation === 'tool_call');
  assert.ok(refusal, 'tool-layer refusals reach the security audit trail with the gateway request id');
  assert.equal(refusal.principal, `agent:${AGENT}`);
  assert.equal(refusal.code, 'INVALID_REQUEST');
  assert.ok(!JSON.stringify(w.audit.events).includes('supervisor'), 'arguments are not recorded in the audit log');
});

test('the gateway handler refuses bad deployment configuration', () => {
  const w = makeWorld();
  assert.throws(() => createGatewayHandler({ caseId: 'bad#case', agentId: AGENT, tools: w.agentTools }));
  assert.throws(() => createGatewayHandler({ caseId: CASE, agentId: 'bad agent', tools: w.agentTools }));
});
