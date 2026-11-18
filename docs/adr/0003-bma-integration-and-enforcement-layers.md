# ADR 0003: BMA integration, enforcement layers and 14-day scope

Status: adopted, November 18, 2026. Approved by Keith. Adoption makes this the plan of record; it does not authorize implementation spending or AWS resources. Spike T09 still needs its own approval.

Evidence: docs/research/2026-11-18-bma-feasibility.md (official AWS docs and event page, read November 18, 2026).

## Context

T07 verified the event window (November 18 to December 2, 2026) and the documented behavior of Bedrock Managed Agents (BMA). Three findings change the existing plan:

1. **The agent gets a shell.** BMA runs the Codex harness. Commands execute in the environment we provide, and no documented setting turns that off. ARCHITECTURE.md assumed the agent would only see a "narrow tool gateway".
2. **The Gateway never sees the human.** BMA calls an AgentCore Gateway using the session role. The Cedar principal is that role. Lambda targets get no caller identity. ADR 0002's rule "agent permission = intersection of the human's rights and agent capabilities" cannot be computed at the tool boundary.
3. **The calendar is 14 days.** The current plan (35 scenarios, signed checkpoints, export state machine, four screens, Cognito) does not fit, and the event rules are still unpublished.

## Decision 1: Tool boundary = AgentCore Gateway + Policy (Cedar) + Lambda

| Option | Verdict | Reason |
|---|---|---|
| **Gateway (AWS_IAM authorizer) + Policy in ENFORCE + Lambda targets** | **Chosen** | Enforcement runs on the AWS side, outside the agent's shell. Cedar rules are short, auditable and match the event theme ("your rules"). Lambda re-checks with domain code. |
| STDIO MCP server inside the execution environment | Rejected | The MCP server, its code and any credentials it holds sit inside the environment where the agent has a shell. The agent could skip MCP and call the backend directly with those credentials. |
| No tools, evidence copied into the workspace as files | Rejected | Evidence in the agent's writable workspace defeats version pinning and gives no enforcement point. |

Known traps (from docs), each needs a test:
- Gateway must support MCP `2025-03-26` or the agent silently gets zero tools.
- Every Cedar `forbid` must guard optional fields with `has`. A forbid that errors is skipped, which means allowed.
- A failed policy creation makes the Gateway deny everything. Check all policies are `ACTIVE`.
- The AgentCore CDK L3 session role grants `InvokeGateway` on every gateway in the account and Region. Narrow it to our one gateway ARN.

## Decision 2: Agent identity. Amends ADR 0002.

The agent is **its own principal**: one session role per deployment, bound to one case (Blackwater) by configuration, never by tool arguments.

- The case ID is set on the Lambda targets (environment/config) and in Cedar. Tools have no `case_id`, `actor`, or `role` arguments. A model-supplied identity field cannot exist, so it cannot be spoofed.
- The agent's capability set is a strict subset of every human case role: scoped reads, version-pinned reads, record findings, create Proposal drafts. Nothing else.
- Human authority lives only in the application API (Cognito in P1). Only a human can promote a proposal, and promotion re-runs policy and requires an independent approver.
- A BMA session is started by the application only after it checks that the requesting human has case access. The human ID is recorded against the BMA session ID in our own store. Tool calls are attributed to the session through the BMA Items API, not through anything the model says.

Why this still meets ADR 0002's intent: with one case and an agent capability set smaller than every human role, "intersection" equals "agent capabilities". If multi-case or per-human delegation is ever needed, revisit after spike questions Q3/Q4 (whether BMA exposes the session in the assumed-role name or a header).

## Decision 3: Execution environment = AgentCore Runtime, treated as hostile

Spike on self-hosted `codex exec-server` (no infrastructure, fastest feedback). Demo on AgentCore Runtime (one microVM per session, AWS-native, matches the event).

The environment is **not a trust zone**. Rules:
- Execution role: only `bedrock-mantle:RegisterEnvironment` and `ConnectEnvironment` scoped to our project, plus logs/metrics. No S3, DynamoDB, Gateway or KMS permissions.
- No evidence, secrets or evaluator truth in the image or workspace. Skills contain audit-method instructions only.
- Network: default PUBLIC mode means the shell can reach the internet, so the agent could send out evidence text it read through tools. Accepted for the MVP **only because all data is synthetic**. Documented as residual risk R1. VPC mode with restricted egress needs a NAT gateway (hourly cost) and is deferred until spike Q5 shows what the shell can actually reach.

## Decision 4: Storage. Enforce immutability in AWS, not just in code.

- **Originals bucket:** versioning on. Bucket policy denies `s3:PutObject` without `If-None-Match` for `Principal: "*"`, so no one can overwrite an existing key. Explicit deny on `DeleteObject` and `DeleteObjectVersion`. Readers use `GetObjectVersion` with an exact version ID only.
- **Ledger and approvals:** DynamoDB. One `TransactWriteItems` does all three: consume the approval (conditional on unused and unexpired), put event N (`attribute_not_exists`), and move the head from N-1 to N (conditional on the current head hash). This keeps ADR 0002's atomicity rule. The writer role gets no `UpdateItem`/`DeleteItem` on event items.
- **Checkpoints:** a separate S3 bucket with the same append-only policy, written only by a separate checkpoint Lambda role that reads the ledger head. The verifier trusts these checkpoints, not the ledger's own claims.
- **Object Lock: not in MVP.** Compliance mode cannot be undone, even by root, until retention expires. Governance mode adds little over the bucket policy for a demo. Revisit only with an explicit retention decision.

Honest limit: an account administrator can edit bucket policies and IAM. This design detects ledger edits through checkpoints but does not stop a hostile admin. That is residual risk R2, already named in ARCHITECTURE.md.

## Decision 5: Stack

- TypeScript domain core (unchanged from ARCHITECTURE.md), shared by the tool Lambdas and the app API Lambda. Node.js 22 runtime.
- AWS CDK in TypeScript. The AgentCore CLI generates CDK TypeScript, so one IaC tool.
- BMA client: the documented Python `client.py` for the spike. Move to TypeScript only if `openai` for Node exposes `beta.agents` (check during spike, not assumed).
- React + Vite for the UI (P1).
- Region: us-east-1 (BMA, the models and AgentCore are all there). Everything in one region.

## Decision 6: Layered security model (what the demo proves)

Each attack must be stopped by a deterministic layer. A model refusal is a bonus, never the pass condition.

| Layer | Control | Stops |
|---|---|---|
| L0 Environment | No credentials or evidence in the microVM | Shell-based access to stores |
| L1 Tool surface | No overwrite, delete, approve or grant tools exist | Most destructive intents |
| L2 Cedar at Gateway | Tool allowlist; input rules (for example, forbid proposals citing evidence IDs outside the case manifest, forbid `historical_assertion` without a pinned source) | Out-of-policy calls, visible as denials in BMA items |
| L3 Lambda domain policy | Schema validation, exact-version pinning, citation validation, proposal-only writes, idempotency | Malformed or crafted arguments that pass Cedar |
| L4 IAM | Per-Lambda least-privilege roles; no delete/update on ledger or originals | Bugs in L3 |
| L5 Storage | Conditional-write bucket policies, versioning, DynamoDB conditions | Overwrite even with valid credentials |
| L6 Detection | BMA Items (every command and MCP call), security events table, CloudTrail, independent verifier | Anything that slips through, plus proof for judges |

Optional later: Bedrock Guardrails `ApplyGuardrail` on evidence text as a **detection signal** only. It is probabilistic, so it never counts as enforcement.

## Decision 7: 14-day scope

P0 must work end to end before anything in P1 starts.

- **P0 (by November 27):** 10-artifact synthetic fixtures (6 deep, 3 with planted injections). Domain core: ledger, pinned reads, proposals, verifier CLI. Gateway + Cedar + 5 tools (`list_evidence`, `read_evidence_version`, `compare_timestamps`, `record_finding`, `propose_custody_event`). One BMA session on AgentCore Runtime. Attack suite: the 10 core attacks run against Gateway/Lambda directly, plus the same attacks through the agent. One "Integrity Challenge" page that shows attempts, denials, layer, and unchanged hashes.
- **P1 (by December 1):** Cognito with three synthetic users, human proposal promotion with independent approval, Evidence Explorer and Custody Timeline screens, demo video, write-up.
- **P2 (only if time remains):** signed checkpoints with an external public key, restricted export with approval, the 15 variations, VPC egress lockdown, Guardrails detection.
- **Cut from the hackathon:** export state machine fault injection, artifacts 11 to 25, multi-case.

December 2 is reserved for submission and buffer.

## Consequences

- ARCHITECTURE.md's AWS mapping, SECURITY-RULES.md's threat list and TASKS.md change to match.
- The first paid step is spike T09. It needs Keith's explicit approval and a budget alarm first.
- If BMA preview access fails (Q1), there is no substitute that satisfies the event. Do not quietly swap in AgentCore Harness or another agent product. Stop and decide with Keith.
