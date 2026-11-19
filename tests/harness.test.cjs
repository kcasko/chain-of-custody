'use strict';
// Local tests for the Stage B harness: the stub Lambda's independent
// validation (layer L3), the Gateway schema conversion, MCP response parsing
// and scenario integrity. No AWS calls.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../harness/lambda/handler.cjs');
const { buildSpec, toGatewayTool, GATEWAY_SCHEMA_KEYS } = require('../harness/build-spec.cjs');
const { parseMcpBody, toToolResult } = require('../harness/clients/gateway-harness-client.cjs');
const { SCENARIOS } = require('../harness/scenarios.cjs');
const evidence = require('../harness/lambda/synthetic-evidence.json');

const spec = buildSpec();
function harness() {
  const lines = [];
  const handler = createHandler(spec, evidence, (l) => lines.push(l));
  const call = (tool, args, target = 'EvidenceTools') => handler(args, { clientContext: { custom: { bedrockAgentCoreToolName: `${target}___${tool}`, bedrockAgentCoreAwsRequestId: 'req-1' } } });
  return { handler, call, lines };
}

test('L3 executes every legitimate live scenario', async () => {
  for (const s of SCENARIOS.filter((x) => x.expect === 'executed')) {
    const { call, lines } = harness();
    const out = await call(s.tool, s.args);
    assert.notEqual(out.status, 'rejected', `${s.id}: ${JSON.stringify(out)}`);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].outcome, 'executed');
  }
});

test('L3 independently rejects every scenario Cedar denies (defense in depth)', async () => {
  for (const s of SCENARIOS.filter((x) => x.expect !== 'executed')) {
    const { call, lines } = harness();
    const out = await call(s.tool, s.args);
    assert.equal(out.status, 'rejected', `${s.id} must be rejected by L3 too: ${JSON.stringify(out)}`);
    assert.equal(lines[0].outcome, 'rejected');
    if (s.l3Code) assert.equal(out.code, s.l3Code, s.id);
  }
});

test('L3 fails closed without trusted Gateway context', async () => {
  const { handler, lines } = harness();
  assert.equal((await handler({}, {})).code, 'NO_GATEWAY_CONTEXT');
  assert.equal((await handler({}, undefined)).code, 'NO_GATEWAY_CONTEXT');
  const { call } = harness();
  assert.equal((await call('list_evidence', {}, 'OtherTarget')).code, 'NO_GATEWAY_CONTEXT');
  assert.equal(lines[0].outcome, 'rejected');
});

test('L3 returns evidence content as labeled untrusted data and computes real hashes', async () => {
  const { call } = harness();
  const out = await call('read_evidence_version', { evidence_id: 'BW-010', version_id: 'syn-v1' });
  assert.equal(out.content_is_untrusted_data, true);
  assert.match(out.content, /SYNTHETIC/);
  assert.match(out.sha256, /^[0-9a-f]{64}$/);
  const list = await call('list_evidence', {});
  assert.equal(list.evidence.length, 10);
  assert.equal(list.synthetic, true);
});

test('L3 never claims persistence or ledger changes for drafts', async () => {
  const { call } = harness();
  const out = await call('propose_custody_event', { evidence_id: 'BW-007', event_kind: 'transfer', reason: 'r', version_id: 'syn-v1', from: 'a', to: 'b' });
  assert.equal(out.persisted, false);
  assert.equal(out.ledger_changed, false);
});

test('L3 log lines carry no argument values except evidence IDs', async () => {
  const { call, lines } = harness();
  await call('record_finding', { finding_type: 'discrepancy', summary: 'SECRET-LIKE-TEXT', cited_evidence_ids: ['BW-001'], uncertainty: 'low' });
  assert.doesNotMatch(JSON.stringify(lines), /SECRET-LIKE-TEXT/);
});

test('Gateway tool schemas use only keys the Gateway supports', () => {
  const walk = (schema) => {
    for (const k of Object.keys(schema)) assert.ok(GATEWAY_SCHEMA_KEYS.has(k), `unsupported key ${k}`);
    if (schema.properties) Object.values(schema.properties).forEach(walk);
    if (schema.items) walk(schema.items);
  };
  for (const tool of spec.tools) {
    const g = toGatewayTool(tool);
    walk(g.inputSchema);
    assert.deepEqual(Object.keys(g.inputSchema.properties).sort(), Object.keys(tool.inputSchema.properties).sort());
  }
});

test('every constraint the Gateway strips is restated in the description the model reads (T21 fix)', () => {
  const g = toGatewayTool(spec.tools.find((t) => t.name === 'record_finding'));
  const p = g.inputSchema.properties;
  assert.match(p.finding_type.description, /Must be exactly one of: discrepancy, provenance_gap, clock_uncertainty, unresolved_question, integrity_check_result\./);
  assert.match(p.uncertainty.description, /Must be exactly one of: low, medium, high\./);
  assert.match(p.summary.description, /Length 1 to 2000 characters/);
  assert.match(p.cited_evidence_ids.description, /1 to 10 items\. No duplicates\. Each item: Must match the pattern \^BW-\[0-9\]\{3\}\$/);
  assert.match(g.inputSchema.description, /No other fields are accepted/);
  // Nothing constrained in the source is left undescribed in the Gateway schema.
  const walk = (src, out, at) => {
    const keys = ['enum', 'pattern', 'minLength', 'maxLength', 'minItems', 'maxItems'].filter((k) => src[k] !== undefined);
    if (keys.length) assert.ok(out.description && out.description.length > 0, `${at} has ${keys.join(', ')} but no description`);
    for (const [k, v] of Object.entries(src.properties ?? {})) walk(v, out.properties[k], `${at}.${k}`);
  };
  for (const tool of spec.tools) walk(tool.inputSchema, toGatewayTool(tool).inputSchema, tool.name);
  const pk = toGatewayTool(spec.tools.find((t) => t.name === 'propose_custody_event')).inputSchema.properties.event_kind;
  assert.match(pk.description, /Must be exactly one of: transfer, historical_assertion, correction\./);
});

test('MCP responses parse from JSON and SSE bodies', () => {
  const msg = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"status":"ok"}' }] } };
  assert.deepEqual(parseMcpBody(JSON.stringify(msg)), msg);
  assert.deepEqual(parseMcpBody(`event: message\ndata: ${JSON.stringify(msg)}\n\n`), msg);
  assert.equal(toToolResult(200, msg).payload.status, 'ok');
  assert.equal(toToolResult(200, { error: { code: -32002, message: 'denied' } }).isError, true);
  assert.equal(toToolResult(200, null).isError, true);
});

test('args hash is order-independent, value-sensitive and logged without values', async () => {
  const { argsHash } = require('../harness/lambda/handler.cjs');
  assert.equal(argsHash({ a: 1, b: [2, 3] }), argsHash({ b: [2, 3], a: 1 }));
  assert.notEqual(argsHash({ a: 1 }), argsHash({ a: 2 }));
  assert.match(argsHash({}), /^[0-9a-f]{16}$/);
  const { call, lines } = harness();
  await call('read_evidence_version', { evidence_id: 'BW-001', version_id: 'syn-v1' });
  assert.equal(lines[0].argsHash, argsHash({ evidence_id: 'BW-001', version_id: 'syn-v1' }));
});

test('live scenarios have unique ids and argument signatures', () => {
  assert.equal(new Set(SCENARIOS.map((s) => s.id)).size, SCENARIOS.length);
  const sig = (s) => `${s.tool}|${JSON.stringify(s.args)}`;
  assert.equal(new Set(SCENARIOS.map(sig)).size, SCENARIOS.length);
});
