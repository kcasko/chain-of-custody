# T07: Bedrock Managed Agents feasibility and event requirements

Date: November 18, 2026. Researched by Claude (Opus 5.5) from official AWS pages. No AWS resources were created and no model calls were made. One read-only, free AWS check was run (see "Account check").

## 1. Event requirements (official, as of November 18, 2026)

Source: AWS Builder Center hackathon page, About and Rules tabs.
https://builder.aws.com/build/hackathons/61c39fba-1383-37e7-bd5c-3f9d889d89fc/agents-your-rules-bedrock-managed-agents-build

Verified:

- Name: "Agents, your rules: Bedrock Managed Agents build". Online, public. Live.
- Window: November 18, 2026 12:00 AM PST to December 2, 2026 11:59 PM PST. That is 14 days from today.
- Brief (paraphrased): build an agent on Amazon Bedrock Managed Agents that follows rules or guardrails you define, and show it staying inside those boundaries even when a prompt tries to push it out. Pick a job where mistakes matter. Define what it can touch, what it must refuse, and how it handles edge cases.
- Awards listed: $8,000 total, five awards of $1,000 AWS Promotional Credits plus a swag bundle (page shows $1,600 per award). Four AWS-employee judges listed.

Not yet published:

- The Rules tab says "coming soon". The About tab says "Full details coming soon."
- Unknown: submission format (video, repo, write-up), judging criteria and weights, eligibility, whether a deployed live endpoint is required, whether AgentCore Runtime vs self-hosted matters.

Consequence: plan against the brief, not guessed criteria. Re-check the Rules tab before locking scope (task T07b). Do not claim submission readiness until the rules exist.

## 2. What Bedrock Managed Agents (BMA) actually is

Sources:
- https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-managed-agents-openai.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-managed-agents-openai-api-reference.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-managed-agents-openai-skills-tools.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-managed-agents-openai-security.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-bma.html

Verified facts:

| Fact | Why it matters here |
|---|---|
| Public preview. APIs can change. | Build a thin adapter. Expect breakage. |
| Runs OpenAI models with the **Codex harness**. AWS runs the agent loop, sessions and context compaction. | We do not write the loop. Our control points are instructions, tools, environment and IAM. |
| **Tools and shell commands execute in an execution environment you provide**: self-hosted (`codex exec-server` on your host) or AgentCore Runtime (one microVM per session). | The agent has a shell in that environment. Nothing documented turns that off. The environment is part of the attack surface, not a trusted zone. |
| Regions: us-east-1, us-west-2, us-east-2. Endpoint `bedrock-mantle.<region>.api.aws`, SigV4 service `bedrock-mantle`. Sessions at `/openai/v1/agents/sessions`. | Pick one region and keep everything in it. |
| Session = model + instructions + tools + environment + `role_arn`. Status `idle`, `in_progress`, `failed`. | Session creation is the place to bind case scope. |
| Three identities: caller, session role (BMA assumes it), execution-environment identity. Docs say keep them separate. | Matches our least-privilege model. |
| Session role trust: `bedrock-mantle.amazonaws.com` with `aws:SourceAccount` and `aws:SourceArn`. Permission `bedrock-mantle:CreateInference` narrowed by `bedrock-mantle:Model`. | Confused-deputy protection is documented. Use it as given. |
| Tools: STDIO MCP servers inside the environment, with `allowed_tools`. Or an **AgentCore Gateway as an MCP tool** (`{"type":"mcp","connector_id":<gateway ARN>}`), which **BMA calls from the service side using the session role**. | The Gateway path keeps the tool boundary outside the agent's shell. This is the only documented path where enforcement cannot be reached from the environment. |
| Gateway must speak MCP `2025-03-26`, otherwise **the agent silently gets no tools and BMA shows no error**. | Must be an explicit test, not an assumption. |
| Items API records command executions (command, cwd, output, exit code) and MCP calls (server, tool, args, result, status). | Free, durable evidence of what the agent tried. Use it in the demo and the audit trail. |
| Not supported in preview: subagents, programmatic tool calling (code mode), built-in long-term memory, customer-managed KMS for service-held session data. | Single agent only. Our own datastore for anything persistent. Do not put sensitive data in session content. |
| Skills are `SKILL.md` directories under `capability_directories`. | Useful for audit-method instructions. Not an enforcement mechanism. |
| Docs: "Commands and MCP tools run with the access available to the execution environment... enforce authorization and any required human review in the application or tool implementation. Treat instructions from documents... as untrusted input." | AWS's own guidance matches AGENTS.md: enforcement belongs in deterministic code, not prompts. |

Not found in the docs (treat as unavailable until proven):

- A setting to disable shell command execution or set the Codex sandbox/approval mode through BMA.
- Bedrock Guardrails attached to a BMA session.
- Any header or field that tells a Gateway target which BMA session or which human started the call.

## 3. AgentCore Gateway and Policy (the enforcement layer)

Sources:
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-core-concepts.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-getting-started.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-add-target-lambda.html
- https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_GatewayPolicyEngineConfiguration.html

Verified:

- Policy in AgentCore evaluates Cedar policies on every Gateway tool call, before the target runs. Default deny. Modes: `LOG_ONLY` and `ENFORCE`.
- With an `AWS_IAM` Gateway authorizer the Cedar principal is `AgentCore::IamEntity` whose `id` is the caller's assumed-role ARN. Since BMA calls with the session role, **the principal is the agent's session role, not a human**.
- Cedar can check tool input: `context.input.<field>`. Actions are named `<Target>___<tool>`.
- A policy that reads a missing tag errors and is skipped. A skipped `permit` grants nothing (safe). A skipped `forbid` blocks nothing (unsafe). Every forbid must guard with `has`/`hasTag`.
- If a policy fails to create, the engine leaves the Gateway denying every call. Fail-closed, but it will look like "the agent has no tools".
- Lambda targets receive tool arguments plus gateway metadata (request ID, gateway ID, target ID, tool name). **No caller identity and no BMA session ID** unless header propagation is configured and BMA sends a header. Unverified.

## 4. Storage enforcement (verified)

- S3 bucket policies can require conditional writes with `s3:if-none-match` (Deny when `Null: true`). With a `Principal: "*"` deny, no writer can overwrite an existing key on that prefix. Source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html
- Residual: an account administrator can edit the bucket policy itself. That is the same "privileged store editor" risk ARCHITECTURE.md already names, so checkpoints still need separate protection.

## 5. Account check (read-only, free)

Ran `sts:GetCallerIdentity` and `bedrock:ListFoundationModels` (provider OpenAI) in us-east-1, us-west-2 and us-east-2 through the AWS MCP server.

- Credentials resolve to an assumed role.
- All three regions list `openai.gpt-5.6-luna` (the model the BMA examples use) plus other OpenAI models.

This proves the models are in the catalog. It does **not** prove BMA preview access, model entitlement, or that `CreateAgentSession` works for this account. Only the spike (T09) can prove that, and it costs money, so it needs Keith's explicit approval.

## 6. Open questions the spike must answer

| # | Question | How to answer it |
|---|---|---|
| Q1 | Does this account have BMA preview access? | `CreateAgentSession` returns 200, not 403/404. |
| Q2 | Does a Gateway with an `AWS_IAM` authorizer and Policy in `ENFORCE` mode work as a BMA tool? | Agent lists the tools; an allowed call succeeds; a Cedar-forbidden call shows a denial in the MCP-call item. |
| Q3 | What is the assumed-role session name BMA uses? Does it include the BMA session ID? | Log the Cedar principal / CloudTrail `AssumeRole` event. If it does, Cedar and our audit log can bind calls to a session. |
| Q4 | Does BMA send any header a Gateway target can receive via header propagation? | Allowlist headers on a test target and log `bedrockAgentCorePropagatedHeaders`. |
| Q5 | What can the agent's shell reach in AgentCore Runtime PUBLIC network mode? Can it read the execution role credentials? | Ask the agent to run `env`, `curl` an external host, and query the metadata service. Record the items. |
| Q6 | Real per-turn cost and latency with `gpt-5.6-luna`. | Read usage from the session items/billing after 5 to 10 turns. |
