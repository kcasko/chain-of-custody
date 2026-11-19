// The Blackwater audit agent on the AgentCore managed harness (ADR 0010).
// Synthesized only until T21 is approved.
//
// The harness is the qualifying runtime: a managed agent loop configured here,
// not code we run. It reaches the case only through our Gateway, signing with
// its execution role, which is the one principal the Cedar boundary admits.

import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { systemPrompt } from './agent-rules.ts';
import { HARNESS_EXECUTION_ROLE, type CocConfig } from './config.ts';

export const AGENT_MODEL_PROFILE = 'us.anthropic.claude-sonnet-4-6';
export const AGENT_MODEL_ID = 'anthropic.claude-sonnet-4-6';
// Where the us. inference profile may route (checked November 18 with ListInferenceProfiles).
export const AGENT_MODEL_REGIONS = ['us-east-1', 'us-east-2', 'us-west-2'];
export const GATEWAY_TOOL_NAME = 'evidence';
// Execution limits are set explicitly, never left to service defaults.
export const AGENT_LIMITS = { maxIterations: 12, maxTokens: 4096, timeoutSeconds: 300 } as const;

export interface AgentProps {
  readonly gatewayArn: string;
}

export class CocAgentStack extends cdk.Stack {
  readonly harness: agentcore.CfnHarness;
  readonly role: iam.Role;

  constructor(scope: Construct, id: string, cfg: CocConfig, agent: AgentProps, props?: cdk.StackProps) {
    super(scope, id, props);
    if (cfg.agentRuntime !== 'agentcore-harness') throw new Error('CocAgentStack needs agentRuntime=agentcore-harness');
    const harnessName = `${cfg.prefix.replace(/-/g, '_')}_auditor`;
    const { account, region } = cfg;

    this.role = new iam.Role(this, 'ExecutionRole', {
      roleName: HARNESS_EXECUTION_ROLE[cfg.stage],
      description: 'AgentCore managed harness for the Blackwater audit agent: one model, one Gateway',
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com', {
        // Confused-deputy protection: only harnesses in this account.
        conditions: { StringEquals: { 'aws:SourceAccount': account }, ArnLike: { 'aws:SourceArn': `arn:aws:bedrock-agentcore:${region}:${account}:harness/*` } },
      }),
      maxSessionDuration: cdk.Duration.hours(1),
    });
    const allow = (sid: string, actions: string[], resources: string[], conditions?: Record<string, unknown>) =>
      this.role.addToPolicy(new iam.PolicyStatement({ sid, actions, resources, ...(conditions ? { conditions } : {}) }));

    allow('InvokeOneModel', ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'], [
      `arn:aws:bedrock:${region}:${account}:inference-profile/${AGENT_MODEL_PROFILE}`,
      ...AGENT_MODEL_REGIONS.map((r) => `arn:aws:bedrock:${r}::foundation-model/${AGENT_MODEL_ID}`),
    ]);
    allow('InvokeOneGateway', ['bedrock-agentcore:InvokeGateway'], [agent.gatewayArn]);
    // From the harness security guide's sample policy (public network), scoped where the API allows.
    allow('EcrPublicPull', ['ecr-public:GetAuthorizationToken', 'sts:GetServiceBearerToken'], ['*']);
    allow('Tracing', ['xray:PutTraceSegments', 'xray:PutTelemetryRecords', 'xray:GetSamplingRules', 'xray:GetSamplingTargets'], ['*']);
    allow('RuntimeLogGroups', ['logs:CreateLogGroup', 'logs:DescribeLogStreams'], [`arn:aws:logs:${region}:${account}:log-group:/aws/bedrock-agentcore/runtimes/*`]);
    allow('RuntimeLogStreams', ['logs:CreateLogStream', 'logs:PutLogEvents'], [`arn:aws:logs:${region}:${account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`]);
    allow('DescribeLogGroups', ['logs:DescribeLogGroups'], [`arn:aws:logs:${region}:${account}:log-group:*`]);
    allow('Metrics', ['cloudwatch:PutMetricData'], ['*'], { StringEquals: { 'cloudwatch:namespace': 'bedrock-agentcore' } });
    allow('WorkloadIdentity', ['bedrock-agentcore:GetWorkloadAccessToken', 'bedrock-agentcore:GetWorkloadAccessTokenForJWT'], [
      `arn:aws:bedrock-agentcore:${region}:${account}:workload-identity-directory/default`,
      `arn:aws:bedrock-agentcore:${region}:${account}:workload-identity-directory/default/workload-identity/harness_${harnessName}-*`,
    ]);
    // Close the paths the harness docs warn about: role switching through model
    // additionalParams, and direct commands that bypass the model.
    this.role.addToPolicy(new iam.PolicyStatement({ sid: 'NoRoleSwitching', effect: iam.Effect.DENY, actions: ['sts:AssumeRole'], resources: ['*'] }));
    this.role.addToPolicy(new iam.PolicyStatement({ sid: 'NoDirectCommands', effect: iam.Effect.DENY, actions: ['bedrock-agentcore:InvokeAgentRuntimeCommand', 'bedrock-agentcore:InvokeAgentRuntimeCommandShell'], resources: ['*'] }));

    this.harness = new agentcore.CfnHarness(this, 'Auditor', {
      harnessName,
      executionRoleArn: this.role.roleArn,
      model: { bedrockModelConfig: { modelId: AGENT_MODEL_PROFILE, temperature: 0, maxTokens: AGENT_LIMITS.maxTokens, apiFormat: 'converse_stream' } },
      systemPrompt: [{ text: systemPrompt() }],
      tools: [{ type: 'agentcore_gateway', name: GATEWAY_TOOL_NAME, config: { agentCoreGateway: { gatewayArn: agent.gatewayArn, outboundAuth: { awsIam: {} } } } }],
      // Only the Gateway's tools. No shell, file, web, subagent or code tools.
      allowedTools: [`@${GATEWAY_TOOL_NAME}`],
      memory: { disabled: {} },
      maxIterations: AGENT_LIMITS.maxIterations,
      maxTokens: AGENT_LIMITS.maxTokens,
      timeoutSeconds: AGENT_LIMITS.timeoutSeconds,
    });
    this.harness.node.addDependency(this.role);

    new cdk.CfnOutput(this, 'HarnessArn', { value: this.harness.attrArn });
    new cdk.CfnOutput(this, 'HarnessExecutionRoleArn', { value: this.role.roleArn });
  }
}
