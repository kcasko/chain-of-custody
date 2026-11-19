# Release blockers

A release blocker stops submission to the event. Do not mark the project submission-ready while any item below is open.

**Primary release blocker: RB-3, the agent has not yet run its investigation job on a qualifying runtime.** The official rules (verified live November 18, 2026) accept Bedrock Managed Agents **or the Amazon Bedrock AgentCore managed harness**. BMA is still refused (RB-1), so the path is the managed harness (ADR 0010). RB-3 closes only when the agent executes its job through the harness and the stress test is recorded (T21).

| ID | Blocker | Status | Evidence | Owner | Unblocks |
|---|---|---|---|---|---|
| RB-3 | **No agent run on a qualifying runtime yet.** The harness integration is built and synthesized: agent stack, execution role, the Cedar boundary admitting that role, the stress-test recorder and the live scripts. The account's harness API answers (`ListHarnesses`), but no harness has been created and no model has run the job | **OPEN** | ADR 0010; docs/plans/2026-11-18-t21-agent-run.md | Keith (approvals in T21); Claude (run, evidence) | The submission |
| RB-1 | **AWS account not entitled to Bedrock Managed Agents (preview).** `POST /openai/v1/agents/sessions` returns HTTP 401 "Bedrock Managed Agents is not available for this account." in us-east-1, us-west-2 and us-east-2 | **OPEN, no longer blocking**: the managed harness is an accepted alternative | docs/research/2026-11-18-t09-spike-report.md (G1) | Keith (access requests, optional now) | A BMA variant of the same agent (T11), not needed to qualify |
| RB-2 | Event rules unknown | **RESOLVED** November 18: rules published and checked live (platforms, requirements, December 2 deadline, OSI license for a public repository) | docs/SUBMISSION.md, "Rules" | Claude | Done |

## RB-3 actions

1. Keith decides the T21 approvals (budget, model, bootstrap, deploy and run, tamper check).
2. Run T21: deploy, T19 runner 29/29, agent job with a screenshot, stress test, then same-day teardown.
3. Fill the Builder Center draft from the generated report; publishing steps in docs/submission/PUBLISHING.md, each with Keith's approval.

## What is not blocked

Everything except the live agent run is done locally (November 18): the domain core, policies, Stage B enforcement (live), storage adapters (live in T14b), CDK for storage, gateway and agent (synthesized), the durable audit log and core-backed tool Lambda, the full investigation workflow UI, and the stress-test tooling.

## History

| ID | Blocker | Status | Evidence | Owner | Unblocks |
|---|---|---|---|---|---|
| RB-1 | **AWS account not entitled to Bedrock Managed Agents (preview) or `openai.gpt-5.6-luna`.** `POST /openai/v1/agents/sessions` returns HTTP 401 "Bedrock Managed Agents is not available for this account." in us-east-1, us-west-2 and us-east-2; GPT-5.6 Luna returns 401 pointing to AWS Sales; `gpt-oss-20b` works with the same credentials. | **OPEN** since November 18, 2026 | docs/research/2026-11-18-t09-spike-report.md (G1) | Keith (access requests); Claude (integration once granted) | T11 (BMA client), spike questions Q2 BMA half, Q4, Q5, Q6, Stage C, the hackathon submission itself |
| RB-2 | Event Rules tab still "coming soon": submission format, judging criteria and eligibility unknown. | **OPEN** | docs/research/2026-11-18-bma-feasibility.md section 1 | Claude (T07b re-check) | Final scope and demo format |

## RB-1 actions

1. Keith sends the three requests in docs/plans/2026-11-18-bma-access-requests.md (AWS Sales form, AWS Support case, hackathon thread). Not yet confirmed as sent.
2. Decision date: **end of day November 24, 2026.** If access has not arrived, decide with Keith. ADR 0003: no substitute product qualifies for the brief unless the organizers say otherwise.
3. When access arrives: rerun T09 G1, then T11 (BMA `AgentToolClient`) against the Stage B scenarios, then Stage C.

## What is not blocked

Everything that does not need BMA is done locally (November 18): the domain core, the policies and Stage B enforcement stack, CDK (synthesized), the durable audit log and the core-backed tool Lambda (T16, local), and the full investigation workflow UI. What remains to qualify, step by step, is in [SUBMISSION.md](SUBMISSION.md). Deploying the test stacks with the harness role (after T19) is the next step that does not need BMA; it needs Keith's approval.
