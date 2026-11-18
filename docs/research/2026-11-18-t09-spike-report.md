# T09 spike report: stopped at gate G1

Run: November 18, 2026, approximately 08:45 to 09:10 Eastern. Plan: docs/plans/2026-11-19-t09-bma-spike.md (approved by Keith the same day).

## Result

**G1 failed. This AWS account is not entitled to Bedrock Managed Agents or to GPT-5.6 Luna.** Per the plan, the spike stopped. Stages B and C were not run.

| Call (SSO admin identity, SigV4 service `bedrock-mantle`) | Region | HTTP | Response |
|---|---|---|---|
| `POST /openai/v1/agents/sessions` (bundle `0.create-session.sh`, session role `CocBmaSessionRole`) | us-east-1 | 401 | `access_denied`: "Bedrock Managed Agents is not available for this account." |
| `GET /openai/v1/agents/sessions?limit=1` | us-east-1, us-west-2, us-east-2 | 401 | Same message in all three regions |
| `GET /v1/models` | all three | 200 | Lists `openai.gpt-5.6-luna` (61, 49 and 50 models) |
| `POST /v1/chat/completions` model `openai.gpt-oss-20b`, max 16 tokens | us-east-1 | 200 | Works (74 prompt + 16 completion tokens) |
| `POST /v1/chat/completions` model `openai.gpt-5.6-luna`, max 16 tokens | us-east-1 | 401 | "openai.gpt-5.6-luna is not available for this account. ... For additional access options, contact AWS Sales at https://aws.amazon.com/contact-us/sales-support/" |

What this rules out:
- Request signing, region and endpoint: `/v1/models` and `gpt-oss-20b` succeed with the same credentials and signing.
- IAM: the caller is the account's AdministratorAccess SSO role, and the error is an account-level `access_denied`, not an IAM `AccessDenied` naming an action.
- Being listed in the model catalog does not mean access. The BMA docs say the same: "Catalog presence alone does not establish BMA compatibility."

Corroboration (community, unverified): on the hackathon Discussion tab, other participants report the identical 401 on November 13 and 17, with support cases open and no reply yet. One reports the same `gpt-oss-20b` works / GPT-5.x fails split we reproduced.

## Changes from the approved plan

1. **The bundle's IAM stack was not deployed.** Its session role grants web search with external web access, `InvokeGateway` on every gateway and `InvokeAgentRuntime` on every runtime. Its client role trusts the whole account. That contradicts ADR 0003 (threat B6). Replaced with two narrow roles (below). CDK bootstrap was therefore not needed.
2. **Security finding in the official example:** `1.attach-exec-server.sh` starts `codex exec-server` with the caller's `AWS_PROFILE`. Agent commands are child processes of the exec-server, so with the documented setup, **the agent's shell inherits the operator's AWS profile** (here, AdministratorAccess) and can read the SSO token cache. Planned mitigation (not reached): run the exec-server in a container that has only the Codex binary (read-only), a dedicated workspace and short-lived `CocBmaEnvRole` credentials. This is threat B1 in practice and belongs in the demo write-up.
3. The script's default workspace is `/tmp`. The session request used `/workspace` (a dedicated container mount) instead.
4. Added a second, account-wide guard budget, because a service-filtered budget silently misses a misspelled service name.

## What exists now in the account

| Resource | Purpose | Standing cost | Plan |
|---|---|---|---|
| Budget `coc-t09-spike`: $15 per month, 9 service filters, alerts ACTUAL 25/50/80% and FORECASTED 100% | Spike spend | Free | Keep until December 31 |
| Budget `coc-t09-account-guard`: $45 per month, whole account, ACTUAL and FORECASTED 100% | Catches anything the filter misses | Free | Keep until December 31 |
| IAM role `CocBmaSessionRole`: trusts `bedrock-mantle.amazonaws.com` (SourceAccount + SourceArn in us-east-1); inline policy allows only `bedrock-mantle:CreateInference` for model `openai.gpt-5.6-luna` | BMA session role | Free | Keep while access is pending. Delete if the project drops BMA |
| IAM role `CocBmaEnvRole`: assumable only by the SSO AdministratorAccess role; allows only `RegisterEnvironment` and `ConnectEnvironment` on `project/*` in us-east-1 | Exec-server credentials | Free | Same |

Both roles are tagged `Project=chain-of-custody`, `Task=T09`, `Owner=keith`, `DeleteBy=2026-11-20`. Extend the tag if access is still pending on November 20.

No BMA session, Gateway, policy engine, Lambda, Runtime, ECR repository, CodeBuild project or CDK stack was created.

Local (WSL, not in the repo): AWS CLI 2.41.0 at `~/.local/share/aws-cli` (installer signature verified against key fingerprint `FB5D B77F D5C1 18B8 0511 ADA8 A631 0ACC 4672 475C`), a throwaway GnuPG home, the BMA example bundle (SHA-256 `0cda88723f65079872824b2c64948c2e2379157814578255acefb7cbd6850013`) and an empty workspace under `~/coc-t09/`.

Spend: one `gpt-oss-20b` call of 90 tokens (well under one cent). Everything else was free. Confirm in Cost Explorer after November 20.

## Stage B: real Gateway + Cedar + tool execution, with a test-harness role (November 18, approved by Keith)

**This is not evidence of Bedrock Managed Agents compatibility.** BMA was replaced by `CocT09HarnessRole`, which signs MCP calls to the same kind of Gateway that BMA would call with its session role. What Stage B proves is the enforcement stack (Gateway, AgentCore Policy, Lambda validation, IAM) and the agent-environment credential boundary, on real AWS services.

### Result

| Suite | Result | Evidence |
|---|---|---|
| Local tests (`npm test`) | **150 / 150 pass**: 133 policy (128 before Stage B, plus the resource-rule test and two new principal-format cases in both modes), 10 harness, 7 collaboration | run after each change |
| Live Gateway suite (`npm run harness:stage-b`), run twice | **29 / 29 pass**, both runs | `docs/research/t09-evidence/stage-b-live.json` |
| Agent-environment isolation (`bash harness/check-exec-env.sh` in WSL) | **17 / 17 pass** at 14:21 UTC while the gateway existed (the gateway probe returned 403). Committed evidence is a post-teardown rerun at 14:25 UTC: **16 / 16 pass, 1 skipped** (gateway probe got 404 because the gateway was deleted) | `docs/research/t09-evidence/exec-env-check.json` (14:25 UTC run) |
| Zero-policy baseline (engine in ENFORCE, no policies) | harness role saw 0 tools; call returned "No policy applies to the request (denied by default)" | recorded during the run |

Live suite detail (each call checked against the Lambda's own log line, matched by a hash of the exact arguments):

- 7 legitimate calls executed (list, exact-version read, compare, finding, transfer draft, sourced historical assertion, reading the BW-010 planted instruction as data).
- 9 Cedar denials, each attributed to the intended rule (8 default deny, 1 `forbid-historical-assertion-without-provenance`), never only the boundary, and **no Lambda execution** for any of them.
- 2 nonexistent tools (`approve_proposal`, `delete_evidence`) rejected by the Gateway as unknown.
- 3 rules Cedar cannot express (`version_id: "latest"`, five IDs in a 2-to-4 comparison, empty summary) rejected by the Lambda.
- 3 undeclared-field injections (`actor`, `approved`/`approval_id`, `case_id`) **passed the Gateway and Cedar** and were rejected only by the Lambda.
- Unsigned request: rejected. The operator's AdministratorAccess role: shown 0 tools, its call denied by `boundary-session-role-only`, nothing executed.
- Total Lambda executions equal the number of legitimate scenarios (no leaks).

Isolation detail: the planned exec-server container (non-root, all capabilities dropped, read-only root, Codex binary read-only) holds only a 15-minute `CocBmaEnvRole` credential file. No admin profile, SSO cache, operator home, Windows drives, docker socket or metadata endpoint. Those credentials could identify themselves and nothing else: S3, IAM, Lambda invoke, logs, Bedrock, AgentCore, the tool Gateway and assuming either other role were all denied. The credential file is deleted after the check.

### Findings from the real engine (each changed code or docs)

1. **Gateway tool schemas support only `type`, `description`, `items`, `properties`, `required`.** No `pattern`, `enum`, length limits or `additionalProperties`. The Gateway target uses a stripped schema (`harness/build-spec.cjs`); the Lambda enforces the full one.
2. **Undeclared tool arguments reach the target.** The Gateway does not reject them and Cedar does not see them. Only the Lambda (L3) stopped F-1 to F-3. ADR 0004 assumed schema typing might reject them; it does not. L3 validation is mandatory.
3. **CreatePolicy rejects an unconstrained `resource`**, and a tool-specific policy must name the specific Gateway (not just the type). Four forbid heads were changed; a local test now enforces both rules.
4. **The policy analyzer judges each new policy against the policies already loaded** and flags forbids as "Overly Restrictive" when nothing they cover is permitted yet. Load order is now: boundary forbids, then permits, then tool forbids. The two boundary forbids load with `IGNORE_ALL_FINDINGS` (their only findings were "Overly Restrictive", which is their purpose); all other policies pass `FAIL_ON_ANY_FINDINGS`. The two tool forbids are scoped to `principal is AgentCore::IamEntity` to remove an OAuth-only finding.
5. **`principal.id` is the role ARN with the session name removed** (`arn:aws:sts::<acct>:assumed-role/<role>`), confirmed in the docs and live. The boundary now uses exact equality, which is stricter than the earlier `like` pattern. Consequence: Cedar can never see which session made a call (answers spike question Q3: BMA session attribution must come from the BMA Items API).
6. **`tools/list` is filtered by policy.** The harness role saw exactly 5 tools; the admin role saw 0; with no policies, the harness saw 0.
7. Confirmed live under strict validation: `IamEntity.id` exists, arrays type as `Set<String>` (`isEmpty`, `containsAll`), integers as `Long`, and `@id` annotations are accepted.
8. No headers reached the Lambda (`propagatedHeaderNames` empty); no header propagation was configured, and BMA was not the caller, so Q4 stays open.

### Resources, cost and teardown

Created under the approved Stage B list, all tagged `Task=T09-StageB`: Lambda `coc-t09-evidence-tools` (arm64, 128 MB, no environment variables) and its log group (1-day retention); policy engine `coc_t09_policy`; Gateway `coc-t09-gw` (AWS_IAM, MCP 2025-03-26, DEBUG errors); target `EvidenceTools`; roles `CocT09StubLambdaRole` (own logs only), `CocT09GatewayRole` (invoke that Lambda, authorize against that engine and gateway), `CocT09HarnessRole` (assumable only by the SSO admin role, `InvokeGateway` on that gateway only).

All of them were deleted the same day. A read-only inventory afterwards found no project gateway, policy engine, Lambda, log group, tagged resource or Stage B role. Kept as required: both budgets, `CocBmaSessionRole`, `CocBmaEnvRole`.

Cost: about 150 Gateway calls, about 120 policy authorizations, about 40 Lambda invocations and under an hour of tool indexing. Estimated well under $0.01 at published prices; confirm in Cost Explorer after November 20. No BMA or OpenAI inference was used.

### What remains blocked by account access

| Item | Why it needs BMA access |
|---|---|
| G1: create a BMA session, run a turn with GPT-5.6 Luna | The account gets 401 on both |
| Q2 (BMA half): BMA lists and calls Gateway tools with the session role | Only BMA can make that call; the harness proves the Gateway side only |
| BMA session-role principal format at the Gateway | Expected `assumed-role/CocBmaSessionRole` per docs; unverified |
| Q4: headers BMA sends to the Gateway | Needs a real BMA caller |
| Q5: what the agent's shell can reach in a real session | Needs an attached exec-server; the container and credentials are verified, the agent's behavior is not |
| Q6: real cost and latency per turn | Needs inference |
| B3 preflight from BMA's side (MCP version mismatch gives no tools silently) | Needs a BMA session |
| Stage C (AgentCore Runtime environment) | Pointless without BMA sessions |
| Model behavior under prompt injection (does the agent try the attacks?) | Needs the model; the deterministic layers are already shown to hold when it does |

To integrate when access arrives: implement the `AgentToolClient` contract (`listTools`, `callTool`) with a BMA session client that submits a turn and reads MCP-call items, render the policies with `SESSION_ROLE_NAME=CocBmaSessionRole`, and run the same `harness/scenarios.cjs`. See `harness/README.md`.

## Next steps (ranked)

1. **Request access today through every channel at once.** Updated drafts, using the Stage B results: docs/plans/2026-11-18-bma-access-requests.md (AWS Sales form, AWS Support case, hackathon thread). Keith sends them; Claude does not.
2. **Keep building what does not need BMA,** so late access costs days, not the project: domain core, ledger and verifier (T00 to T04), and the real tool Lambda built on the Stage B handler (its closed-schema validation is mandatory, finding 2). Convert the Stage B deploy sequence to CDK before P0.
3. **Decision date: end of day November 24.** If access has not arrived, decide with Keith. ADR 0003 says no substitute product qualifies for the brief; the organizers may say otherwise, and the thread asks them.
