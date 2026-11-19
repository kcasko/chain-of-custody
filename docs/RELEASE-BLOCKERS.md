# Release blockers

A release blocker stops submission to the event. Do not mark the project submission-ready while any item below is open.

**Primary release blocker: RB-4, publication needs Keith's decisions and approvals.** RB-3 is resolved: on November 19, 2026, the agent ran its investigation job on the Amazon Bedrock AgentCore managed harness, and two stress runs of 9 prompts held every protected-state rule ([T21 report](research/2026-11-19-t21-agent-run-report.md)).

| ID | Blocker | Status | Evidence | Owner | Unblocks |
|---|---|---|---|---|---|
| RB-4 | **Publication not done.** The rules require a public repository under an OSI license (or a public demo), a published Builder Center project, and the submission itself. Open decisions: license, commit author e-mail, repository name, the AI-assistance line in the write-up, eligibility confirmation | **OPEN** | docs/submission/PUBLISHING.md | Keith (each decision and each publish step) | The submission |
| RB-3 | No agent run on a qualifying runtime | **RESOLVED** November 19, 2026: the job ran on the managed harness (finding recorded citing BW-001 and BW-005); stress test 9 of 9 held, twice; screenshot captured; everything torn down | docs/research/2026-11-19-t21-agent-run-report.md | Claude | Done |
| RB-1 | **AWS account not entitled to Bedrock Managed Agents (preview).** `POST /openai/v1/agents/sessions` returns HTTP 401 "Bedrock Managed Agents is not available for this account." in us-east-1, us-west-2 and us-east-2 | **OPEN, no longer blocking**: the managed harness is an accepted alternative | docs/research/2026-11-18-t09-spike-report.md (G1) | Keith (access requests, optional now) | A BMA variant of the same agent (T11), not needed to qualify |
| RB-2 | Event rules unknown | **RESOLVED** November 18: rules published and checked live (platforms, requirements, December 2 deadline, OSI license for a public repository) | docs/SUBMISSION.md, "Rules" | Claude | Done |

## RB-4 actions

1. Keith decides the license, the author e-mail question, the repository name and the write-up's AI-assistance line, and confirms eligibility.
2. Then, each with Keith's explicit approval: add the license, create and push the public repository, publish the Builder Center project, submit before December 2, 2026, 11:59 PM PT.

## What is not blocked

All engineering for the entry is done: the domain core, policies, Stage B enforcement (live), storage adapters (live in T14b), the CDK app for storage, gateway and agent (deployed and verified in T21, then torn down), the durable audit log and core-backed tool Lambda (live in T21), the investigation workflow UI, and the stress test (live in T21).

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
