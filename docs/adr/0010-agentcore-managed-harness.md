# ADR 0010: Run the agent on the AgentCore managed harness

Status: adopted November 18, 2026, pending a live run. Supersedes the part of ADR 0003 that treated Bedrock Managed Agents (BMA) as the only qualifying runtime.

## Context

The official rules page, checked live on November 18, says entries may be built on "Amazon Bedrock Managed Agents or the Amazon Bedrock AgentCore managed harness". The submission deadline is December 2, 2026, 11:59 PM PT. ADR 0003 was written before the rules were published and allowed no substitute. BMA still refuses this account (HTTP 401, release blocker RB-1).

Read-only checks on November 18:

| Check | Result |
|---|---|
| `bedrock-agentcore-control ListHarnesses` (us-east-1, us-west-2) | Succeeds; zero harnesses. The API is reachable. **Creating a harness has not been tried**; only a create proves the account may run one |
| Models with no new agreement needed (`GetFoundationModelAvailability`) | Claude Sonnet 4.6, Claude Haiku 4.5, Amazon Nova (Pro, Lite, Micro, 2 Lite), gpt-oss. Newer Claude and OpenAI models need a Marketplace agreement (not accepted, not needed) |
| Inference profile | `us.anthropic.claude-sonnet-4-6` routes to us-east-1, us-east-2 and us-west-2 |
| AWS documentation | The harness is generally available; it is a managed agent loop on AgentCore Runtime, configured rather than coded. It is not ordinary AgentCore Runtime, which runs your own agent code and does not qualify by itself |
| CDK | The pinned `aws-cdk-lib` 2.275.0 has `CfnHarness` |

## Decision

Run the Blackwater audit agent as an AgentCore managed harness, with no change to the domain core, the tools, Cedar or the workspace:

- **Model:** `us.anthropic.claude-sonnet-4-6`, temperature 0, explicit limits on iterations, tokens and time.
- **Tools:** exactly one `agentcore_gateway` tool, named `evidence`, pointing at our Gateway with SigV4 outbound auth. `allowedTools: ["@evidence"]`. The built-in `shell`, file tools, `web_fetch`, `subagent` and code tools are not allowed. Memory is disabled.
- **Identity:** the harness signs Gateway calls with its execution role, `CocHarnessExecutionRole`. That role becomes the single principal the Cedar boundary admits (`sessionRoleName`), in place of the BMA session role. Everything behind the Gateway is unchanged: the Cedar permits, the core-backed tool Lambda, the core's authorization, and the durable audit attributed to `agent:coc-audit-agent`.
- **Execution role:** model invocation only on that inference profile and its three regional model ARNs. `InvokeGateway` only on our Gateway. The documented ECR Public, logs, metrics and workload-identity statements, scoped to this harness. Explicit deny on `sts:AssumeRole` (closes the `additionalParams` role-switch path the harness docs warn about) and on `InvokeAgentRuntimeCommand`. No browser, code interpreter or memory permissions.
- **Callers:** only the operator invokes the harness (SigV4). Nobody is granted `InvokeAgentRuntimeCommand`, which would bypass the model.

The CDK app gets a third stack, `CocTestAgent`, and a context key `agentRuntime` (`bma`, the default and unchanged, or `agentcore-harness`).

## Layers, as the judging guidance asks

Each rule is enforced by something other than the prompt. The system prompt states the rules so the agent behaves well; it is never the control.

| Layer | Enforces |
|---|---|
| Harness configuration | Only the five Gateway tools exist for the model: no shell, files, web or memory |
| IAM | The harness role can call one model and one Gateway, cannot assume roles; the tool Lambda can touch only three logical tables (finding 1) and never write evidence |
| Cedar at the Gateway | Only the harness role; only the five tools; argument constraints (case evidence IDs, cited evidence, provenance) |
| Tool schemas and the core | Closed schemas; deny-by-default policy; agent capability set of four operations; content rules (no conclusions of guilt) |
| Human confirmation | The agent can only draft; a person promotes or dismisses each draft, and both are kept |
| Detection | Every call in the durable audit log; ledger hash chain, signed checkpoints, Object Lock archive and tamper alarm |

## Not yet verified (each is a step in the T21 plan)

1. That `CreateHarness` succeeds for this account.
2. That the Gateway sees the harness execution role as `arn:aws:sts::<account>:assumed-role/CocHarnessExecutionRole`, so the Cedar boundary admits it. If it sees another principal, the boundary denies every call. That fails closed, but it would block the run until the boundary is adjusted.
3. That the Gateway still passes its request ID to the Lambda when the harness is the caller.
4. That the model does the job and stays inside the rules under the stress test. Backend refusals are deterministic; the model's own wording is not, and is recorded verbatim.
