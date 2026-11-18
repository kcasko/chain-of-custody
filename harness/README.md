# Stage B harness

Tests the tool-enforcement stack on real AWS without Bedrock Managed Agents (BMA), and is built so a BMA client can replace the test-harness client later. Results: docs/research/2026-11-18-t09-spike-report.md.

**Not evidence of BMA compatibility.** A test-harness IAM role stands in for the BMA session role.

## Pieces

| File | Role |
|---|---|
| `lambda/handler.cjs` | Stub tool target (layer L3). Validates every call against the full tool spec, independently of Cedar; rejects by default; returns synthetic data only; logs one line per call with a hash of the arguments (never values) |
| `lambda/synthetic-evidence.json` | Fictional, agent-visible material. BW-010 contains a planted instruction |
| `build-spec.cjs` | Builds the Lambda spec from `policy/` and the Gateway-compatible tool schemas (Gateway supports only `type`, `description`, `items`, `properties`, `required`) |
| `clients/gateway-harness-client.cjs` | `AgentToolClient` that calls the Gateway's MCP endpoint, SigV4-signed. Credentials go to curl on stdin, never as arguments |
| `scenarios.cjs` | Client-agnostic live scenarios with expected outcomes |
| `run-stage-b.cjs` | Live runner (`npm run harness:stage-b`). Verifies each outcome against Lambda logs and which policy denied |
| `check-exec-env.sh` | Verifies the planned exec-server container and its credentials (run in WSL) |
| `package-lambda.cjs` | Writes the Lambda bundle inputs to `.local/stage-b/` with SHA-256 manifest |

`tests/harness.test.cjs` covers the handler, schema conversion, response parsing and scenario integrity locally (`npm test`).

## Replacing the harness with BMA

The contract every client implements:

```
name: string
listTools(): Promise<{ ok, httpStatus, tools: string[], error }>
callTool(name, args): Promise<{ httpStatus, rpcError, isError, payload, text }>
```

A BMA client would create a session with the Gateway as an `mcp` tool (`connector_id` = Gateway ARN) and the session role `CocBmaSessionRole`, ask the agent to make each scenario call, then read the session's MCP-call items to build the same result shape. Render policies with `SESSION_ROLE_NAME=CocBmaSessionRole`. Scenarios, Lambda and log matching stay unchanged. Model-driven runs cannot force a specific call, so keep the direct harness run as the deterministic baseline and use the BMA run to show the agent's behavior.

## Deploy sequence used on November 18 (all deleted the same day)

Order matters: never expose a tool without enforcement, and the policy analyzer evaluates each policy against those already loaded.

1. Roles: Lambda (own log group only), Gateway (invoke that Lambda; later authorize against that engine and gateway), harness (assumable only by the SSO admin role; `InvokeGateway` on that gateway only). Log group with 1-day retention.
2. Lambda: `node harness/package-lambda.cjs`, zip `.local/stage-b/lambda/`, `aws lambda create-function` (nodejs22.x, arm64, 128 MB, handler `handler.handler`). In Git Bash set `MSYS_NO_PATHCONV=1`.
3. Policy engine. 4. Gateway (`AWS_IAM`, MCP `2025-03-26`) with no engine and no target. 5. Scope role permissions to the new IDs.
6. Attach the engine in `ENFORCE` (zero policies = deny everything). 7. Add the target with Gateway-format schemas.
8. Policies, rendered by `policy/lib.cjs`: boundary forbids (`IGNORE_ALL_FINDINGS`, ACTIVE before anything else), then permits, then tool forbids (`FAIL_ON_ANY_FINDINGS`). Verify every policy is ACTIVE and its text matches the local render.
9. Write `.local/stage-b.json` (`region`, `gatewayUrl`, `gatewayArn`, `policyEngineId`, `harnessRoleArn`, `logGroup`), then `npm run harness:stage-b`.

Teardown order: policies, target, gateway, policy engine, Lambda, log group, Stage B roles. Then inventory gateways, policy engines, Lambdas, log groups, roles and tagged resources.

This was done with direct API calls. Before P0, turn it into CDK so it is reproducible from the repository.
