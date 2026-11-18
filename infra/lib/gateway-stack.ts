// The Stage B enforcement stack (verified live on November 18, T09 report),
// as CDK: tool Lambda, AgentCore Policy engine in ENFORCE, Gateway (AWS_IAM,
// MCP 2025-03-26), one Lambda target, and the Cedar policies in the verified
// load order. The engine is attached from creation, so with zero policies
// every call is denied; boundary forbids are ACTIVE before any permit exists.
//
// The tool Lambda is the Stage B stub (harness/lambda), the version verified
// live. The core-backed handler (core/src/gateway-handler.ts) replaces it once
// it has a durable audit adapter; see docs/TASKS.md.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { cfnPolicies } from './cedar.ts';
import type { CocConfig } from './config.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const require = createRequire(import.meta.url);
const spec = require('../../harness/build-spec.cjs') as {
  buildSpec(): unknown;
  toGatewayTool(tool: unknown): { name: string; description: string; inputSchema: unknown };
};

export const TARGET_NAME = 'EvidenceTools'; // Cedar actions are EvidenceTools___<tool>
export const MCP_VERSION = '2025-03-26';

// Writes the stub bundle (same three files as harness/package-lambda.cjs) to a
// content-addressed folder under .local/, which is git-ignored.
function stubBundle(): string {
  const files: Record<string, Buffer> = {
    'handler.cjs': fs.readFileSync(path.join(repoRoot, 'harness', 'lambda', 'handler.cjs')),
    'synthetic-evidence.json': fs.readFileSync(path.join(repoRoot, 'harness', 'lambda', 'synthetic-evidence.json')),
    'tool-spec.json': Buffer.from(`${JSON.stringify(spec.buildSpec(), null, 2)}\n`),
  };
  const hash = crypto.createHash('sha256');
  for (const [name, data] of Object.entries(files)) hash.update(name).update(data);
  const dir = path.join(repoRoot, '.local', 'cdk-assets', `stub-lambda-${hash.digest('hex').slice(0, 16)}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), data);
  return dir;
}

export class CocGatewayStack extends cdk.Stack {
  readonly gateway: agentcore.CfnGateway;
  readonly policies: agentcore.CfnPolicy[];

  constructor(scope: Construct, id: string, cfg: CocConfig, props?: cdk.StackProps) {
    super(scope, id, props);
    const test = cfg.stage === 'test';
    const gatewayName = `${cfg.prefix}-gw`;
    const gatewayArnPattern = `arn:aws:bedrock-agentcore:${cfg.region}:${cfg.account}:gateway/${gatewayName}-*`;

    const toolLogs = new logs.LogGroup(this, 'ToolLogs', { retention: test ? logs.RetentionDays.ONE_DAY : logs.RetentionDays.ONE_YEAR, removalPolicy: test ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN });
    const tool = new lambda.Function(this, 'EvidenceToolsFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(stubBundle()),
      logGroup: toolLogs,
      description: 'Stage B tool stub: closed-schema validation, synthetic evidence only',
    });

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
