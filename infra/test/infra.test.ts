// T12: security properties of the synthesized templates. Synth only; no AWS.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { buildApp } from '../bin/app.ts';
import { readConfig } from '../lib/config.ts';
import { WRITER_TABLE_ALLOW, WRITER_TABLE_DENY } from '../lib/storage-stack.ts';
import { TOOL_EVIDENCE_ALLOW, TOOL_TABLE_READ, TOOL_TABLE_WRITE } from '../lib/gateway-stack.ts';

const ACCOUNT = '111111111111';
function synth(context: Record<string, string> = {}) {
  const app = new cdk.App({ outdir: mkdtempSync(join(tmpdir(), 'coc-cdk-')), context: { account: ACCOUNT, region: 'us-east-1', ...context } });
  const built = buildApp(app);
  return { ...built, storage: Template.fromStack(built.storage), gateway: Template.fromStack(built.gateway) };
}
const test1 = synth();
const prod = synth({ stage: 'prod', objectLockDays: '30' });
const harness = synth({ harness: 'true' });

type Stmt = { Effect: string; Action: string | string[]; Resource?: unknown; Sid?: string; Condition?: Record<string, unknown> };
const asList = (a: unknown) => (Array.isArray(a) ? a : [a]);
function statements(t: Template, type: string, prop: (p: Record<string, unknown>) => unknown): Stmt[] {
  return Object.values(t.findResources(type)).flatMap((r) => {
    const doc = prop(r.Properties as Record<string, unknown>);
    return asList(doc).filter(Boolean).flatMap((d) => ((d as { Statement?: Stmt[] }).Statement ?? []));
  });
}
function allIamStatements(t: Template): Stmt[] {
  return [
    ...statements(t, 'AWS::IAM::Policy', (p) => p.PolicyDocument),
    ...statements(t, 'AWS::IAM::ManagedPolicy', (p) => p.PolicyDocument),
    ...statements(t, 'AWS::IAM::Role', (p) => ((p.Policies as Array<{ PolicyDocument: unknown }> | undefined) ?? []).map((x) => x.PolicyDocument)),
  ];
}

test('no IAM statement in any stack grants every action', () => {
  for (const t of [test1.storage, test1.gateway, prod.storage, prod.gateway, harness.gateway]) {
    for (const s of allIamStatements(t)) {
      if (s.Effect !== 'Allow') continue;
      assert.ok(!asList(s.Action).some((a) => a === '*' || /^[a-z0-9-]+:\*$/.test(String(a))), JSON.stringify(s));
    }
  }
});

test('ledger table: exactly the adapter schema, with the stream the archive needs', () => {
  test1.storage.hasResourceProperties('AWS::DynamoDB::Table', {
    KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
    BillingMode: 'PAY_PER_REQUEST',
    StreamSpecification: { StreamViewType: 'NEW_AND_OLD_IMAGES' },
  });
  prod.storage.hasResourceProperties('AWS::DynamoDB::Table', { PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true }, DeletionProtectionEnabled: true });
  prod.storage.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain' });
});

test('both buckets: Object Lock (GOVERNANCE in test, COMPLIANCE in prod), versioned, private, retained', () => {
  const lock = (t: Template, mode: string, days: number) => {
    const buckets = t.findResources('AWS::S3::Bucket');
    assert.equal(Object.keys(buckets).length, 2);
    for (const b of Object.values(buckets)) {
      const p = b.Properties;
      assert.equal(p.ObjectLockEnabled, true);
      assert.deepEqual(p.ObjectLockConfiguration.Rule.DefaultRetention, { Mode: mode, Days: days });
      assert.equal(p.VersioningConfiguration.Status, 'Enabled');
      assert.deepEqual(p.PublicAccessBlockConfiguration, { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true });
      assert.equal(b.DeletionPolicy, 'Retain');
    }
  };
  lock(test1.storage, 'GOVERNANCE', 1);
  lock(prod.storage, 'COMPLIANCE', 30);
});

test('bucket policies: create-only puts for everyone, destructive actions only for break-glass, TLS only', () => {
  const policies = Object.values(test1.storage.findResources('AWS::S3::BucketPolicy'));
  assert.equal(policies.length, 2);
  for (const p of policies) {
    const s: Stmt[] = p.Properties.PolicyDocument.Statement;
    const createOnly = s.find((x) => x.Sid === 'CreateOnlyWithIfNoneMatch')!;
    assert.equal(createOnly.Effect, 'Deny');
    assert.deepEqual(createOnly.Condition, { Null: { 's3:if-none-match': 'true' } });
    const destructive = s.find((x) => x.Sid === 'NoDeleteOrLoosenExceptBreakGlass')!;
    assert.equal(destructive.Effect, 'Deny');
    for (const a of ['s3:DeleteObject', 's3:DeleteObjectVersion', 's3:PutObjectRetention', 's3:BypassGovernanceRetention', 's3:PutBucketVersioning']) assert.ok(asList(destructive.Action).includes(a), a);
    assert.match(JSON.stringify(destructive.Condition), /ArnNotLike.*AWSReservedSSO_AdministratorAccess_\*/);
    assert.ok(s.some((x) => x.Effect === 'Deny' && JSON.stringify(x.Condition).includes('aws:SecureTransport')));
  }
  const archive = policies.find((p) => p.Properties.PolicyDocument.Statement.some((x: Stmt) => x.Sid === 'OnlyTheArchiverWrites'));
  assert.ok(archive, 'the archive bucket admits writes only from the archiver role');
});

test('writer policy is exactly the T14b-verified set', () => {
  const [mp] = Object.values(test1.storage.findResources('AWS::IAM::ManagedPolicy'));
  const s: Stmt[] = mp!.Properties.PolicyDocument.Statement;
  assert.deepEqual(asList(s.find((x) => x.Sid === 'TableReadAndConditionalWrites')!.Action).sort(), [...WRITER_TABLE_ALLOW].sort());
  const deny = s.find((x) => x.Sid === 'NeverDeleteOrRewriteInPlace')!;
  assert.equal(deny.Effect, 'Deny');
  assert.deepEqual(asList(deny.Action).sort(), [...WRITER_TABLE_DENY].sort());
  assert.deepEqual(asList(s.find((x) => x.Sid === 'EvidenceWriteOnceReadVersion')!.Action).sort(), ['s3:GetObject', 's3:GetObjectVersion', 's3:PutObject']);
});

test('archiver: stream with partial-batch retry that never drops records; S3 access only to the archive', () => {
  test1.storage.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
    FunctionResponseTypes: ['ReportBatchItemFailures'], BisectBatchOnFunctionError: true, MaximumRetryAttempts: -1, StartingPosition: 'TRIM_HORIZON',
  });
  const s3Stmts = statements(test1.storage, 'AWS::IAM::Policy', (p) => p.PolicyDocument).filter((x) => asList(x.Action).some((a) => String(a).startsWith('s3:')));
  assert.equal(s3Stmts.length, 1);
  assert.deepEqual(asList(s3Stmts[0]!.Action).sort(), ['s3:GetObject', 's3:PutObject']);
  assert.match(JSON.stringify(s3Stmts[0]!.Resource), /Archive/);
  assert.doesNotMatch(JSON.stringify(s3Stmts[0]!.Resource), /Evidence/);
});

test('integrity alarms: tamper metric filter, stalled archiver, archiver errors; no e-mail unless given', () => {
  test1.storage.hasResourceProperties('AWS::Logs::MetricFilter', { FilterPattern: Match.stringLikeRegexp('APPEND_ONLY_TAMPER.*ARCHIVE_CONFLICT') });
  test1.storage.resourceCountIs('AWS::CloudWatch::Alarm', 3);
  test1.storage.resourceCountIs('AWS::SNS::Subscription', 0);
  const withMail = synth({ alarmEmail: 'alerts@example.com' });
  withMail.storage.resourceCountIs('AWS::SNS::Subscription', 1);
});

test('gateway: AWS_IAM, MCP 2025-03-26, policy engine attached in ENFORCE from creation', () => {
  test1.gateway.hasResourceProperties('AWS::BedrockAgentCore::Gateway', {
    AuthorizerType: 'AWS_IAM',
    ProtocolConfiguration: { Mcp: { SupportedVersions: ['2025-03-26'] } },
    PolicyEngineConfiguration: { Mode: 'ENFORCE' },
  });
  prod.gateway.hasResourceProperties('AWS::BedrockAgentCore::Gateway', { ExceptionLevel: Match.absent() });
});

test('policies load one at a time: boundary forbids ACTIVE before any permit, tool forbids last', () => {
  const R = test1.gateway.toJSON().Resources as Record<string, { Type: string; Properties: Record<string, unknown>; DependsOn?: string[] }>;
  const byLogical = Object.entries(R).filter(([, r]) => r.Type === 'AWS::BedrockAgentCore::Policy');
  const first = byLogical.find(([, r]) => (r.DependsOn ?? []).some((d) => R[d]!.Type === 'AWS::BedrockAgentCore::GatewayTarget'))!;
  const order: string[] = [];
  let cur: string | undefined = first[0];
  while (cur) {
    order.push(R[cur]!.Properties.Name as string);
    const next = byLogical.find(([, r]) => (r.DependsOn ?? []).includes(cur!));
    cur = next?.[0];
  }
  assert.equal(order.length, byLogical.length, 'one chain covers every policy');
  const kinds = order.map((n) => (n.startsWith('boundary_') ? 0 : n.startsWith('permit_') ? 1 : 2));
  assert.deepEqual(kinds, [...kinds].sort(), order.join(' > '));
  assert.equal(kinds[0], 0);
  for (const [, r] of byLogical) {
    assert.equal(r.Properties.EnforcementMode, 'ACTIVE');
    assert.equal(r.Properties.ValidationMode, String(r.Properties.Name).startsWith('boundary_') ? 'IGNORE_ALL_FINDINGS' : 'FAIL_ON_ANY_FINDINGS');
  }
  assert.ok(!JSON.stringify(R).includes('cdk-gateway-arn-sentinel'), 'every sentinel replaced by the real Gateway ARN');
});

test('gateway role: assumed only by AgentCore for this gateway name; invokes one Lambda; one policy engine', () => {
  const roles = test1.gateway.findResources('AWS::IAM::Role', { Properties: { AssumeRolePolicyDocument: { Statement: [{ Principal: { Service: 'bedrock-agentcore.amazonaws.com' } }] } } });
  const role = Object.values(roles)[0]!;
  const trust = role.Properties.AssumeRolePolicyDocument.Statement[0];
  assert.deepEqual(trust.Condition, { StringEquals: { 'aws:SourceAccount': ACCOUNT }, ArnLike: { 'aws:SourceArn': `arn:aws:bedrock-agentcore:us-east-1:${ACCOUNT}:gateway/coc-test-gw-*` } });
  const s: Stmt[] = role.Properties.Policies[0].PolicyDocument.Statement;
  assert.deepEqual(s.map((x) => x.Sid).sort(), ['AuthorizeWithThisEngine', 'InvokeToolOnly']);
  assert.ok(!JSON.stringify(s).includes('"*"'));
});

test('callers: only the admitted session role may invoke, and only this gateway', () => {
  const sessionPolicies = Object.values(test1.gateway.findResources('AWS::IAM::Policy')).filter((r) => JSON.stringify(r.Properties.Roles) === '["CocBmaSessionRole"]');
  assert.equal(sessionPolicies.length, 1);
  const bma = (sessionPolicies[0]!.Properties.PolicyDocument as { Statement: Stmt[] }).Statement;
  assert.equal(bma.length, 1);
  assert.equal(bma[0]!.Sid, 'InvokeThisGatewayOnly');
  assert.deepEqual(bma[0]!.Action, 'bedrock-agentcore:InvokeGateway');
  assert.match(JSON.stringify(bma[0]!.Resource), /^\{"Fn::GetAtt":\["Gateway[A-Za-z0-9]*","GatewayArn"\]\}$/, 'exactly this gateway, never a wildcard');
  test1.gateway.hasResourceProperties('AWS::IAM::Policy', { Roles: ['CocBmaSessionRole'] });
  const roles = Object.values(harness.gateway.findResources('AWS::IAM::Role', { Properties: { RoleName: 'CocTestHarnessRole' } }));
  assert.equal(roles.length, 1);
  assert.match(JSON.stringify(roles[0]!.Properties.AssumeRolePolicyDocument), /ArnLike.*AWSReservedSSO_AdministratorAccess_\*/);
  const boundary = Object.values(harness.gateway.findResources('AWS::BedrockAgentCore::Policy')).find((r) => r.Properties.Name === 'boundary_session_role_only')!;
  assert.match(JSON.stringify(boundary.Properties.Definition), /assumed-role\/CocTestHarnessRole/);
});

test('tool Lambda: the core-backed handler, wired to the ledger table and evidence bucket, with the narrowest permissions', () => {
  const fns = Object.values(test1.gateway.findResources('AWS::Lambda::Function')).filter((r) => String(r.Properties.Description ?? '').startsWith('Evidence tools on the domain core'));
  assert.equal(fns.length, 1, 'the Stage B stub is no longer the tool Lambda');
  const fn = fns[0]!.Properties as { Handler: string; Environment: { Variables: Record<string, unknown> }; Role: unknown };
  assert.equal(fn.Handler, 'index.handler');
  assert.deepEqual(Object.keys(fn.Environment.Variables).sort(), ['TABLE_NAME', 'EVIDENCE_BUCKET'].sort());
  assert.match(JSON.stringify(fn.Environment.Variables.TABLE_NAME), /Fn::ImportValue.*Ledger/, 'the table from the storage stack');
  const roleId = (fn.Role as { 'Fn::GetAtt': string[] })['Fn::GetAtt'][0]!;
  const policies = Object.values(test1.gateway.findResources('AWS::IAM::Policy')).filter((r) => JSON.stringify(r.Properties.Roles).includes(roleId));
  assert.equal(policies.length, 1);
  const stmts = (policies[0]!.Properties.PolicyDocument as { Statement: Stmt[] }).Statement;
  const bySid = Object.fromEntries(stmts.map((s) => [s.Sid, s]));
  // Each table action is pinned to named logical tables; no unconditioned table grant exists.
  assert.deepEqual(asList(bySid.ToolQueryLedgerEvents!.Action).sort(), [...TOOL_TABLE_READ].sort());
  assert.deepEqual(bySid.ToolQueryLedgerEvents!.Condition, { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['events'] }, Null: { 'dynamodb:LeadingKeys': 'false' } });
  assert.deepEqual(asList(bySid.ToolAppendFindingsDraftsAudit!.Action), [...TOOL_TABLE_WRITE]);
  assert.deepEqual(bySid.ToolAppendFindingsDraftsAudit!.Condition, { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['audit', 'findings', 'proposals'] }, Null: { 'dynamodb:LeadingKeys': 'false' } });
  for (const s of stmts.filter((x) => x.Effect === 'Allow' && asList(x.Action).some((a) => String(a).startsWith('dynamodb:')))) {
    assert.ok(s.Condition, `${s.Sid}: every table grant carries a LeadingKeys condition`);
    assert.ok(!JSON.stringify(s.Condition).match(/approvals|heads|idempotency|checkpoints|exports/), `${s.Sid} must not reach approvals, heads or other core tables`);
  }
  assert.equal(bySid.ToolNeverDeleteOrRewriteInPlace!.Effect, 'Deny');
  assert.deepEqual(asList(bySid.ToolNeverDeleteOrRewriteInPlace!.Action).sort(), [...WRITER_TABLE_DENY].sort());
  assert.deepEqual(asList(bySid.ToolReadExactEvidenceVersions!.Action).sort(), [...TOOL_EVIDENCE_ALLOW].sort());
  const actions = stmts.filter((s) => s.Effect === 'Allow').flatMap((s) => asList(s.Action).map(String));
  for (const forbidden of ['s3:PutObject', 's3:DeleteObject', 'dynamodb:DeleteItem', 'dynamodb:UpdateItem', 'dynamodb:Scan', 'dynamodb:ConditionCheckItem']) assert.ok(!actions.includes(forbidden), forbidden);
});

test('config refuses values that could inject into Cedar or IAM', () => {
  const bad: Array<Record<string, string>> = [
    { account: '12345' }, { stage: 'staging' }, { sessionRoleName: 'Role"||true' }, { region: 'us-east-1"' },
    { breakGlassPrincipalArn: '*' }, { objectLockDays: '0' }, { alarmEmail: 'not-an-email' },
  ];
  for (const ctx of bad) {
    const app = new cdk.App({ context: { account: ACCOUNT, ...ctx } });
    assert.throws(() => readConfig(app, {}), /config:/, JSON.stringify(ctx));
  }
});
