# Release blockers

A release blocker stops submission to the event. Do not mark the project submission-ready while any item below is open.

**Primary release blocker: RB-1 (Bedrock Managed Agents access).** Everything else in the project can be finished without it; the submission cannot.

| ID | Blocker | Status | Evidence | Owner | Unblocks |
|---|---|---|---|---|---|
| RB-1 | **AWS account not entitled to Bedrock Managed Agents (preview) or `openai.gpt-5.6-luna`.** `POST /openai/v1/agents/sessions` returns HTTP 401 "Bedrock Managed Agents is not available for this account." in us-east-1, us-west-2 and us-east-2; GPT-5.6 Luna returns 401 pointing to AWS Sales; `gpt-oss-20b` works with the same credentials. | **OPEN** since November 18, 2026 | docs/research/2026-11-18-t09-spike-report.md (G1) | Keith (access requests); Claude (integration once granted) | T11 (BMA client), spike questions Q2 BMA half, Q4, Q5, Q6, Stage C, the hackathon submission itself |
| RB-2 | Event Rules tab still "coming soon": submission format, judging criteria and eligibility unknown. | **OPEN** | docs/research/2026-11-18-bma-feasibility.md section 1 | Claude (T07b re-check) | Final scope and demo format |

## RB-1 actions

1. Keith sends the three requests in docs/plans/2026-11-18-bma-access-requests.md (AWS Sales form, AWS Support case, hackathon thread). Not yet confirmed as sent.
2. Decision date: **end of day November 24, 2026.** If access has not arrived, decide with Keith. ADR 0003: no substitute product qualifies for the brief unless the organizers say otherwise.
3. When access arrives: rerun T09 G1, then T11 (BMA `AgentToolClient`) against the Stage B scenarios, then Stage C.

## What is not blocked

Everything that does not need BMA keeps moving: the domain core (T00 to T04, done), the policies and Stage B enforcement stack (done), CDK for the Stage B stack (T12), the real tool Lambda on top of the core, and the UI.
