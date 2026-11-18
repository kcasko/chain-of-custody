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

## Options (ranked)

1. **Request access today through every official channel at once.** The error names AWS Sales. Also open an AWS Support case if your support plan allows one for service access, and ask the organizers on the hackathon thread (other participants are blocked the same way). Drafts below. Keith sends them; Claude does not.
2. **Keep building everything that does not need BMA,** so access arriving late costs days, not the project: domain core and verifier (T00 to T04), Lambda tools, fixtures. Optionally run Stage B now (Gateway + Policy + stub Lambda) with a test-harness role in place of the session role. That validates the ADR 0004 unknowns against the real Cedar engine within the approved $15, but it changes the stage order, so it needs Keith's go-ahead.
3. **Set a decision date: end of day November 24.** If access has not arrived, decide with Keith. ADR 0003 says no substitute product qualifies for the brief; the organizers could say otherwise, and the thread asks them.

## Drafts for Keith to send (not sent)

### A. AWS Sales contact form (https://aws.amazon.com/contact-us/sales-support/)

> Hi,
>
> I'm requesting access to Amazon Bedrock Managed Agents (preview) and the OpenAI GPT-5.6 models on my AWS account. I'm building an entry for the AWS Builder Center hackathon "Agents, your rules: Bedrock Managed Agents build", which runs until December 2, 2026.
>
> On November 18, 2026, from us-east-1, us-west-2 and us-east-2:
>
> 1. POST /openai/v1/agents/sessions on bedrock-mantle returns HTTP 401: "Bedrock Managed Agents is not available for this account."
> 2. openai.gpt-5.6-luna returns HTTP 401: "not available for this account", which points to AWS Sales.
> 3. openai.gpt-oss-20b works with the same credentials, so signing and IAM are not the problem.
>
> Please enable Bedrock Managed Agents and openai.gpt-5.6-luna for this account in us-east-1, or let me know what else is needed. I can provide the account ID and request IDs.
>
> Thank you,
> Keith

### B. Comment on the hackathon thread ("not available for this account")

> Same wall here as of Nov 18. bedrock-mantle /v1/models lists openai.gpt-5.6-luna, but /openai/v1/agents/sessions returns 401 in all three preview regions, and a plain chat completion to gpt-5.6-luna returns 401 pointing at AWS Sales. gpt-oss-20b works on the same credentials, so it's account entitlement, not setup.
>
> Organizers: is there an access path for participants, or is building on AgentCore with another model acceptable until access comes through? With the hackathon live, knowing which one decides how people spend the next two weeks.
