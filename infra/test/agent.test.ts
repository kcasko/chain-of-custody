// ADR 0010: the managed-harness agent stack. Synth only; no AWS.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { buildApp } from '../bin/app.ts';
import { AGENT_RULES, systemPrompt } from '../lib/agent-rules.ts';
import { AGENT_LIMITS, AGENT_MODEL_PROFILE } from '../lib/agent-stack.ts';

const ACCOUNT = '111111111111';
function synth(context: Record<string, string>) {
  const app = new cdk.App({ outdir: mkdtempSync(join(tmpdir(), 'coc-agent-')), context: { account: ACCOUNT, region: 'us-east-1', ...context } });
  return buildApp(app);
}
const built = synth({ agentRuntime: 'agentcore-harness' });
const agent = Template.fromStack(built.agent!);
const gateway = Template.fromStack(built.gateway);

type Stmt = { Sid?: string; Effect: string; Action: string | string[]; Resource: unknown; Condition?: unknown };
const asList = (a: unknown) => (Array.isArray(a) ? a : [a]);
const roleStatements = (): Stmt[] => Object.values(agent.findResources('AWS::IAM::Policy')).flatMap((r) => (r.Properties.PolicyDocument as { Statement: Stmt[] }).Statement);

test('without agentRuntime=agentcore-harness there is no agent stack, and the BMA path is unchanged', () => {
  const plain = synth({});
  assert.equal(plain.agent, undefined);
  assert.equal(plain.cfg.sessionRoleName, 'CocBmaSessionRole');
});

test('the harness: Claude Sonnet 4.6, temperature 0, explicit limits, memory off, only the Gateway tools', () => {
  const h = Object.values(agent.findResources('AWS::BedrockAgentCore::Harness'));
  assert.equal(h.length, 1);
  const p = h[0]!.Properties;
  assert.equal(p.HarnessName, 'coc_test_auditor');
  assert.deepEqual(p.Model, { BedrockModelConfig: { ModelId: AGENT_MODEL_PROFILE, Temperature: 0, MaxTokens: AGENT_LIMITS.maxTokens, ApiFormat: 'converse_stream' } });
  assert.deepEqual([p.MaxIterations, p.MaxTokens, p.TimeoutSeconds], [AGENT_LIMITS.maxIterations, AGENT_LIMITS.maxTokens, AGENT_LIMITS.timeoutSeconds]);
  assert.deepEqual(p.Memory, { Disabled: {} });
  assert.deepEqual(p.AllowedTools, ['@evidence'], 'no wildcard, no shell, file, web, subagent or code tools');
  assert.equal(p.Tools.length, 1);
  assert.equal(p.Tools[0].Type, 'agentcore_gateway');
  assert.deepEqual(p.Tools[0].Config.AgentCoreGateway.OutboundAuth, { AwsIam: {} });
  assert.match(JSON.stringify(p.Tools[0].Config.AgentCoreGateway.GatewayArn), /Fn::ImportValue.*Gateway/, 'our Gateway, from the gateway stack');
  assert.equal(p.AuthorizerConfiguration, undefined, 'SigV4 callers only');
  assert.equal(p.Skills, undefined, 'no skills: they would be injected as trusted context');
  assert.equal(p.SystemPrompt[0].Text, systemPrompt());
});

test('the system prompt states every rule, and every rule names an enforcement layer other than the prompt', () => {
  const prompt = systemPrompt();
  for (const r of AGENT_RULES) {
    assert.ok(prompt.includes(r.rule), r.id);
    assert.ok(r.enforcedBy.length > 20 && !/prompt/i.test(r.enforcedBy), `${r.id}: enforced by something other than the prompt`);
  }
  assert.ok(AGENT_RULES.length >= 8);
});

test('the execution role: one model, one Gateway, no role switching, no direct commands, trusted only by this account\'s harnesses', () => {
  const roles = Object.values(agent.findResources('AWS::IAM::Role'));
  assert.equal(roles.length, 1);
  const role = roles[0]!.Properties;
  assert.equal(role.RoleName, 'CocTestHarnessExecutionRole');
  const trust = (role.AssumeRolePolicyDocument as { Statement: Stmt[] }).Statement;
  assert.equal(trust.length, 1);
  assert.deepEqual((trust[0] as unknown as { Principal: unknown }).Principal, { Service: 'bedrock-agentcore.amazonaws.com' });
  // Only this account's harnesses and the runtimes they create (T21: harness/* alone failed CreateAgentRuntime validation).
  assert.deepEqual(trust[0]!.Condition, { StringEquals: { 'aws:SourceAccount': '111111111111' }, ArnLike: { 'aws:SourceArn': ['arn:aws:bedrock-agentcore:us-east-1:111111111111:harness/*', 'arn:aws:bedrock-agentcore:us-east-1:111111111111:runtime/*'] } });

  const s = Object.fromEntries(roleStatements().map((x) => [x.Sid, x]));
  assert.deepEqual(asList(s.InvokeOneModel!.Resource).map(String).sort(), [
    'arn:aws:bedrock:us-east-1:111111111111:inference-profile/us.anthropic.claude-sonnet-4-6',
    'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-6',
    'arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-sonnet-4-6',
    'arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-sonnet-4-6',
  ]);
  assert.match(JSON.stringify(s.InvokeOneGateway!.Resource), /Fn::ImportValue/);
  assert.equal(s.NoRoleSwitching!.Effect, 'Deny');
  assert.equal(s.NoDirectCommands!.Effect, 'Deny');
  const allowed = roleStatements().filter((x) => x.Effect === 'Allow').flatMap((x) => asList(x.Action).map(String));
  for (const forbidden of ['bedrock:*', 'bedrock-agentcore:*', 'bedrock-agentcore:InvokeAgentRuntimeCommand', 'bedrock-agentcore:StartBrowserSession', 'bedrock-agentcore:InvokeCodeInterpreter', 'bedrock-agentcore:CreateEvent', 's3:GetObject', 'dynamodb:GetItem', 'sts:AssumeRole', 'iam:PassRole']) {
    assert.ok(!allowed.includes(forbidden), forbidden);
  }
  // Wildcard resources only where the API has no resource ARN.
  for (const x of roleStatements().filter((y) => y.Effect === 'Allow' && asList(y.Resource).includes('*'))) {
    assert.ok(['EcrPublicPull', 'Tracing', 'Metrics'].includes(x.Sid!), `${x.Sid} uses a wildcard resource`);
  }
});

test('the Gateway admits exactly the harness execution role, and the stack attaches nothing to any other role', () => {
  const boundary = Object.values(gateway.findResources('AWS::BedrockAgentCore::Policy')).find((r) => r.Properties.Name === 'boundary_session_role_only')!;
  assert.match(JSON.stringify(boundary.Properties.Definition), /assumed-role\/CocTestHarnessExecutionRole\\"/);
  assert.equal(Object.values(gateway.findResources('AWS::IAM::Role')).filter((r) => r.Properties.RoleName === 'CocTestHarnessRole').length, 0, 'no Stage B test role');
  const sessionAttach = Object.values(gateway.findResources('AWS::IAM::Policy')).filter((r) => JSON.stringify(r.Properties.Roles ?? '').includes('Coc'));
  assert.deepEqual(sessionAttach, [], 'nothing attached to an existing role by name');
});

test('config refuses ambiguous admitted principals and unknown runtimes', () => {
  assert.throws(() => synth({ agentRuntime: 'agentcore-harness', harness: 'true' }), /choose one/);
  assert.throws(() => synth({ agentRuntime: 'agentcore-harness', sessionRoleName: 'SomethingElse' }), /fixed to the harness execution role/);
  assert.throws(() => synth({ agentRuntime: 'agentcore-runtime' }), /agentRuntime must be bma or agentcore-harness/);
});
