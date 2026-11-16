'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanEnvironment, validMessage, parseClaude, parseCodex, parseLoopResult, validateConfig } = require('../scripts/collaborate.cjs');
test('child environment drops paid-provider and hosted-network overrides', () => {
  const env = cleanEnvironment({ PATH: 'safe', USERPROFILE: 'local', ANTHROPIC_API_KEY: 'secret', OPENAI_API_KEY: 'secret', AWS_PROFILE: 'paid', MOZAIK_CLOUD_URL: 'remote', NETWORK_SERVICE_TOKEN: 'secret', CLAUDE_CODE_USE_BEDROCK: '1' });
  assert.equal(env.PATH, 'safe');
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'AWS_PROFILE', 'MOZAIK_CLOUD_URL', 'NETWORK_SERVICE_TOKEN', 'CLAUDE_CODE_USE_BEDROCK']) assert.equal(env[key], undefined);
});
test('routing requires exact network, sender, recipient and nonce', () => {
  const frame = { type: 'message.sent', networkId: 'n', senderId: 'a', payload: { to: 'b', message: 'answer nonce' } };
  assert.equal(validMessage(frame, 'n', 'a', 'b', 'nonce'), true);
  for (const args of [['other','a','b','nonce'], ['n','evil','b','nonce'], ['n','a','wrong','nonce'], ['n','a','b','missing']]) assert.equal(validMessage(frame, ...args), false);
});
test('Claude parser refuses errors and empty replies', () => {
  assert.equal(parseClaude(JSON.stringify({ subtype: 'success', result: 'review' })).text, 'review');
  assert.throws(() => parseClaude('{"subtype":"error","result":"refusal"}'));
  assert.throws(() => parseClaude('{"subtype":"success","result":""}'));
});
test('Codex parser requires completed turn and real agent message', () => {
  const good = [{ type: 'item.completed', item: { type: 'agent_message', text: 'review' } }, { type: 'turn.completed' }].map(JSON.stringify).join('\n');
  assert.equal(parseCodex(good).text, 'review');
  assert.throws(() => parseCodex('{"type":"turn.failed"}'));
  assert.throws(() => parseCodex('{"type":"turn.completed"}'));
});
test('config rejects exposed host, task execution and unlimited loops', () => {
  const c = require('../collaboration/config.json'); validateConfig(c);
  for (const override of [{ host: '0.0.0.0' }, { maxTurns: 100 }, { mode: 'execute' }, { billing: 'api' }, { maxMessageBytes: 1000000 }]) assert.throws(() => validateConfig({ ...c, ...override }));
});
test('Mozaik Core serialized tool results are decoded', () => {
  assert.equal(parseLoopResult({ completedInstructions: [{ result: { type: 'tool_call_output', result: '{"text":"actual CLI reply"}' } }] }).text, 'actual CLI reply');
  assert.throws(() => parseLoopResult({ completedInstructions: [] }));
  assert.throws(() => parseLoopResult({ completedInstructions: [{ result: 'invalid' }] }));
});
test('installed Mozaik Core executes a tool and returns its recorded payload', async () => {
  const core = require('D:/Repos/mozaik-learning/node_modules/@mozaik-ai/core');
  core.initAgentModule();
  const m = core.resolveAgentModule();
  m.registerTool('contract_test', { invoke: () => ({ text: 'contract verified' }) });
  const a = await m.createAgent({ name: 'contract', instruction: 'Synthetic contract test', tools: [] });
  const loop = await m.createLoop({ agentId: a.id, goal: 'Verify actual installed result shape without inference' });
  await m.setBreakpoint({ loopId: loop.id, instruction: { type: 'tool_call', parameters: { toolName: 'contract_test', toolArguments: '{}' } } });
  await m.advanceLoop({ loopId: loop.id });
  assert.equal(parseLoopResult(await m.getLoop(loop.id)).text, 'contract verified');
});
