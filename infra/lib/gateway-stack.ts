// The Stage B enforcement stack (verified live on November 18, T09 report),
// as CDK: tool Lambda, AgentCore Policy engine in ENFORCE, Gateway (AWS_IAM,
// MCP 2025-03-26), one Lambda target, and the Cedar policies in the verified
// load order. The engine is attached from creation, so with zero policies
// every call is denied; boundary forbids are ACTIVE before any permit exists.
//
// The tool Lambda is the core-backed handler (infra/lambda/tools.ts, T16):
// the domain core over DynamoDB and S3 with the durable audit log. The Stage B
// stub (harness/lambda) is the version that was verified live on November 18;
// this one is synthesized and tested locally only, not yet deployed.

import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { cfnPolicies } from './cedar.ts';
import type { CocConfig } from './config.ts';
import { WRITER_TABLE_DENY } from './storage-stack.ts';
import { TOOL_LAMBDA_TABLES } from '../../adapters/aws/src/aws-domain.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const require = createRequire(import.meta.url);
const spec = require('../../harness/build-spec.cjs') as {
  buildSpec(): unknown;
  toGatewayTool(tool: unknown): { name: string; description: string; inputSchema: unknown };
};

export const TARGET_NAME = 'EvidenceTools'; // Cedar actions are EvidenceTools___<tool>
export const MCP_VERSION = '2025-03-26';

// What the tool Lambda may do: query ledger events; append findings, proposals
// and audit records (and nothing else: dynamodb:LeadingKeys pins each action to
// the logical tables in TOOL_LAMBDA_TABLES); never delete or rewrite in place;
// read exact evidence versions. No s3:PutObject: the agent never registers
// evidence. IAM cannot force the create-only condition, so a compromised tool
// Lambda could still overwrite one of its own three tables; audit and findings
// are append-only and archived with tamper alarms, proposals are drafts.
export const TOOL_TABLE_READ = ['dynamodb:GetItem', 'dynamodb:Query'];
export const TOOL_TABLE_WRITE = ['dynamodb:PutItem'];
export const TOOL_EVIDENCE_ALLOW = ['s3:GetObject', 's3:GetObjectVersion'];

export interface GatewayStorage {
  readonly table: dynamodb.ITable;
  readonly evidenceBucket: s3.IBucket;
}

export class CocGatewayStack extends cdk.Stack {
  readonly gateway: agentcore.CfnGateway;
  readonly policies: agentcore.CfnPolicy[];

  constructor(scope: Construct, id: string, cfg: CocConfig, storage: GatewayStorage, props?: cdk.StackProps) {
    super(scope, id, props);
    const test = cfg.stage === 'test';
    const gatewayName = `${cfg.prefix}-gw`;
    const gatewayArnPattern = `arn:aws:bedrock-agentcore:${cfg.region}:${cfg.account}:gateway/${gatewayName}-*`;

    const toolLogs = new logs.LogGroup(this, 'ToolLogs', { retention: test ? logs.RetentionDays.ONE_DAY : logs.RetentionDays.ONE_YEAR, removalPolicy: test ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN });
    const tool = new nodejs.NodejsFunction(this, 'EvidenceToolsFn', {
      entry: path.join(repoRoot, 'infra', 'lambda', 'tools.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
      logGroup: toolLogs,
      description: 'Evidence tools on the domain core (DynamoDB, S3, durable audit)',
      environment: { TABLE_NAME: storage.table.tableName, EVIDENCE_BUCKET: storage.evidenceBucket.bucketName },
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      // Bundle the pinned SDK instead of whatever the runtime ships.
      bundling: { format: nodejs.OutputFormat.ESM, target: 'node22', externalModules: [], minify: false, sourceMap: false, banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
    });
    const onlyKeys = (keys: readonly string[]) => ({ 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': [...keys] }, Null: { 'dynamodb:LeadingKeys': 'false' } });
    tool.addToRolePolicy(new iam.PolicyStatement({ sid: 'ToolQueryLedgerEvents', actions: TOOL_TABLE_READ, resources: [storage.table.tableArn], conditions: onlyKeys(TOOL_LAMBDA_TABLES.read) }));
    tool.addToRolePolicy(new iam.PolicyStatement({ sid: 'ToolAppendFindingsDraftsAudit', actions: TOOL_TABLE_WRITE, resources: [storage.table.tableArn], conditions: onlyKeys(TOOL_LAMBDA_TABLES.append) }));
    tool.addToRolePolicy(new iam.PolicyStatement({ sid: 'ToolNeverDeleteOrRewriteInPlace', effect: iam.Effect.DENY, actions: WRITER_TABLE_DENY, resources: [storage.table.tableArn] }));
    tool.addToRolePolicy(new iam.PolicyStatement({ sid: 'ToolReadExactEvidenceVersions', actions: TOOL_EVIDENCE_ALLOW, resources: [storage.evidenceBucket.arnForObjects('*')] }));

    const engine = new agentcore.CfnPolicyEngine(this, 'PolicyEngine', {
      name: `${cfg.prefix.replace(/-/g, '_')}_policy`,
      description: 'Chain of Custody tool authorization (deny by default)',
    });

    const gatewayRole = new iam.Role(this, 'GatewayRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': cfg.account }, ArnLike: { 'aws:SourceArn': gatewayArnPattern } },
      }),
      description: 'Gateway execution role: invoke the one tool Lambda and consult the one policy engine',
      inlinePolicies: {
        gateway: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({ sid: 'InvokeToolOnly', actions: ['lambda:InvokeFunction'], resources: [tool.functionArn] }),
            new iam.PolicyStatement({
              sid: 'AuthorizeWithThisEngine',
              actions: ['bedrock-agentcore:AuthorizeAction', 'bedrock-agentcore:PartiallyAuthorizeActions', 'bedrock-agentcore:GetPolicyEngine'],
              resources: [engine.attrPolicyEngineArn, gatewayArnPattern],
            }),
          ],
        }),
      },
    });

    this.gateway = new agentcore.CfnGateway(this, 'Gateway', {
      name: gatewayName,
      description: 'Chain of Custody evidence tools',
      authorizerType: 'AWS_IAM',
      protocolType: 'MCP',
      protocolConfiguration: { mcp: { supportedVersions: [MCP_VERSION] } },
      roleArn: gatewayRole.roleArn,
      policyEngineConfiguration: { arn: engine.attrPolicyEngineArn, mode: 'ENFORCE' },
      ...(test ? { exceptionLevel: 'DEBUG' } : {}),
    });
    this.gateway.node.addDependency(gatewayRole);

    const tools = (spec.buildSpec() as { tools: unknown[] }).tools.map((t) => spec.toGatewayTool(t));
    const target = new agentcore.CfnGatewayTarget(this, 'Target', {
      gatewayIdentifier: this.gateway.attrGatewayIdentifier,
      name: TARGET_NAME,
      targetConfiguration: { mcp: { lambda: { lambdaArn: tool.functionArn, toolSchema: { inlinePayload: tools as never } } } },
      credentialProviderConfigurations: [{ credentialProviderType: 'GATEWAY_IAM_ROLE' }],
    });

    // Policies one at a time, in order: each waits for the previous one, so
    // the boundary forbids are ACTIVE before the first permit is created.
    this.policies = [];
    let previous: cdk.CfnResource = target;
    for (const p of cfnPolicies(cfg.account, cfg.region, cfg.sessionRoleName)) {
      const policy = new agentcore.CfnPolicy(this, `Policy-${p.id}`, {
        name: p.name,
        policyEngineId: engine.attrPolicyEngineId,
        definition: { cedar: { statement: p.statement(this.gateway.attrGatewayArn) } },
        enforcementMode: 'ACTIVE',
        validationMode: p.validationMode,
        description: `${p.kind} policy ${p.id} from policy/cedar`,
      });
      policy.addResourceDependency(previous);
      this.policies.push(policy);
      previous = policy;
    }

    // Who may call the Gateway: only the admitted session role, only this Gateway.
    const invoke = new iam.PolicyStatement({ sid: 'InvokeThisGatewayOnly', actions: ['bedrock-agentcore:InvokeGateway'], resources: [this.gateway.attrGatewayArn] });
    if (cfg.harness) {
      const harness = new iam.Role(this, 'HarnessRole', {
        roleName: cfg.sessionRoleName,
        assumedBy: new iam.AccountRootPrincipal().withConditions({ ArnLike: { 'aws:PrincipalArn': cfg.breakGlassPrincipalArn } }),
        maxSessionDuration: cdk.Duration.hours(1),
        description: 'Stage B test harness: signs MCP calls in place of the BMA session role',
      });
      harness.addToPolicy(invoke);
    } else {
      // The BMA session role is created outside CDK (T09) because BMA trusts it
      // by name. Deploying this stack attaches one policy to it: InvokeGateway on
      // this Gateway only.
      const session = iam.Role.fromRoleName(this, 'SessionRole', cfg.sessionRoleName, { mutable: true });
      session.addToPrincipalPolicy(invoke);
    }

    new cdk.CfnOutput(this, 'GatewayUrl', { value: this.gateway.attrGatewayUrl });
    new cdk.CfnOutput(this, 'GatewayArn', { value: this.gateway.attrGatewayArn });
    new cdk.CfnOutput(this, 'PolicyEngineId', { value: engine.attrPolicyEngineId });
  }
}
