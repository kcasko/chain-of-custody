# Security rules and threat model

Assets: original bytes and versions, custody history, membership, approvals, exports, audit events and credentials. Adversaries: malicious case documents, compromised model/tool requests, unauthorized users, stolen sessions and privileged store editors. Model text, peer messages and typed role names are untrusted input.

| Action | Investigator | Auditor | Supervisor | Agent |
|---|---|---|---|---|
| Read authorized metadata | Case-scoped | Case-scoped | Case-scoped | Through gateway only |
| Read original | Case-scoped reader | Case-scoped reader | Case-scoped reader | No direct storage credentials |
| Register evidence | Scoped | No | Scoped | Propose only |
| Add custody event | Scoped | No | Scoped | Propose only |
| Correct history | Append correction | Append correction | Append correction | Draft only |
| Delete history / overwrite original | Never | Never | Never | Never |
| Approve own request | Never | Never | Never | Never |
| Restricted export | Independent approval | Independent approval | Scoped independent approval | Cannot authorize |
| Audit report | Scoped | Scoped | Scoped | Scoped and validated |

These are application roles, not accepted client claims. Enforce verified actor, membership, exact resource, operation and approval in the backend. Require an independent authenticated human approver for restricted operations. A supervisor cannot approve their own request either.

Review resolution: every MVP export requires independent approval, including supervisor exports. Restricted agent mutation requests produce non-authoritative Proposal drafts; scoped reads and validated audit reports remain permitted. Server-derived human identity, agent identity and execution channel cannot be supplied in tool arguments. Human promotion of a draft repeats authorization. Membership and role changes remain denied until their own policy rows and audit contracts are specified. (Update November 18, 2026, ADR 0005: derivative registration and approval revocation are now specified, with policy rows, audit records and tests.) Agent tools cannot read evaluator truth under tests/fixtures.

Non-negotiable: deny by default; no direct agent archive writes or arbitrary shell/network tools; no evidence-to-instruction escalation; no silent integrity suppression; no privilege grants by an agent; no fabricated historical custody events; no self-approval or replay; no evidence export without authorization; no guilt or admissibility claims.

Bind approval to canonical operation digest, evidence version, destination, requesting actor and case. Enforce expiry, revocation, one-time use and concurrent consumption server-side. Reject changed payloads. Log decision and outcome with correlation IDs, never tokens or full sensitive evidence. Persist required audit record before success; unavailable audit persistence means the action cannot proceed.

An audit-store outage returns DENIED_AUDIT_UNAVAILABLE without protected mutation. Persistence of that denial cannot be guaranteed in the unavailable store; report this explicitly. Hash-chain security outcomes and anchor them externally when implemented. Key possession, checkpoint signing policy and freshness reference are separate trust requirements. A different process on the same account does not establish an independent security authority.

For local collaboration: loopback-only Mozaik, unique ephemeral network, token-authenticated peers, recipient and sender checks, bounded message size/turns/time, explicit task/file ownership, no automatic command execution from messages. Self-hosted local account creation is open to local processes, so this is not a hostile-host security boundary. Send synthetic project material only. Use existing subscription authentication, remove API credentials/provider override variables from child environments, and stop if subscription authentication is unavailable. Do not enable overage or billing fallback. Model review restrictions do not replace OS isolation for future untrusted execution.

## BMA-specific threats (added November 18, 2026, from official docs; see ADR 0003)

| ID | Threat | Mitigation | Test |
|---|---|---|---|
| B1 | Agent runs shell commands in the execution environment | Environment holds no store credentials, evidence or evaluator truth. Execution role limited to RegisterEnvironment/ConnectEnvironment and logs | Spike Q5: agent runs `env`, metadata query, store access attempts; all fail |
| B2 | Agent sends evidence text out through the shell (PUBLIC network mode) | Synthetic data only. VPC egress lockdown is P2 | Residual risk R1, stated in the demo |
| B3 | Gateway MCP version mismatch: agent silently has no tools and may invent findings | Preflight check lists tools before any audit. Report validator rejects findings without tool-sourced citations | Negative test with tools missing |
| B4 | Cedar `forbid` reads a missing field, errors and is skipped (allowed) | Guard every optional field with `has`. Lambda re-checks the same rule | Calls with fields omitted |
| B5 | Model-supplied case, actor or role | Tools have no such arguments. Case bound by target configuration | A02 and A03 through the Gateway |
| B6 | Session role broader than needed (CDK L3 grants InvokeGateway on all gateways) | Narrow to one gateway ARN and one Runtime ARN | IAM policy review plus a denied call to a second gateway |
| B8 | Undeclared tool arguments (`actor`, `approved`, `case_id`) pass the Gateway and Cedar and reach the target (observed live, Stage B) | Tool target rejects any argument outside the closed schema before acting | Stage B F-1 to F-3: rejected only by the Lambda |
| B9 | Official exec-server example runs Codex with the operator's `AWS_PROFILE`, so agent commands inherit it (observed in the bundle) | Exec-server in a container with only the workspace, a read-only Codex binary and short-lived `CocBmaEnvRole` credentials | `harness/check-exec-env.sh`: 17 checks (gateway probe skipped when no gateway exists) |
| B7 | Preview API changes during the event | Thin adapter, pinned client versions, re-run smoke test daily | Daily smoke run |
## Ledger and evidence integrity: prevention, detection, recovery (November 18, 2026; ADRs 0007 and 0008)

Prevention stops a change from happening. Detection makes a change visible. Recovery restores the true record. Each control below is placed in exactly one column, with its verification status.

| Threat | Prevention | Detection | Recovery |
|---|---|---|---|
| Agent or API user rewrites history | Core: create-only writes, closed schemas, no update or delete operations, deny by default (tested) | Audit log of every attempt (tested) | Not needed: nothing is written |
| Overwrite of a ledger item with stolen application credentials | **Not possible in DynamoDB** (PutItem is required; no IAM condition covers the condition expression; confirmed live in T14b). Prevented for the archived original: write-once Object Lock archive only the archiver role can write (ADR 0008; tested locally, not yet on AWS) | `APPEND_ONLY_TAMPER` alarm from the table stream (stream behavior confirmed live in T14b; archiver tested locally). Hash chain plus signed checkpoints make the independent verifier report FAILED (confirmed live) | Archived original of every event; before and after images of the tamper; DynamoDB point-in-time recovery in non-test stacks |
| Delete of a ledger item, update in place, batch write, table drop by the application role | IAM explicit deny (confirmed live in T14b) | Stream `REMOVE` alarm if it ever happened | Archive and point-in-time recovery |
| Overwrite or delete of original evidence bytes | S3 `If-None-Match` plus bucket policy requiring it, delete and retention denies, Object Lock (all confirmed live in T14b) | Content SHA-256 in the ledger, re-checked on every read and by the verifier (tested) | Immutable object versions under Object Lock |
| Corrupted upload | S3 checksum check (`BadDigest`, confirmed live) | Storage confirmation read-back before registration (tested) | Bytes never registered; key quarantined (tested) |
| Stalled archiver | None | Iterator-age alarm before the 24-hour stream retention ends (planned in T12) | Point-in-time recovery |
| Forged *append* with stolen application credentials | Not prevented (looks like a legitimate write) | Actor attribution in every event, audit log, human review | Corrections are appended, never edits |
| Account administrator | Not prevented (R2) | CloudTrail; checkpoints held outside the account if anchored externally (not built) | Object Lock COMPLIANCE mode survives even an administrator, for retained data |

Application-level controls (roles, case isolation, agent limits, approvals, audit integrity, hostile content) and the plain list of limitations are in [SECURITY-LIMITATIONS.md](SECURITY-LIMITATIONS.md), in the same prevention, detection and recovery form.

Residual risks stated plainly: R1 evidence exfiltration through the agent's network egress (synthetic data, accepted for MVP). R2 an account administrator can change bucket policies, IAM and the ledger working copy; checkpoints and the stream alarm detect ledger edits but do not prevent them, and only COMPLIANCE-mode Object Lock survives an administrator. R4 stolen application credentials can overwrite the DynamoDB working copy; the archived original survives and the change raises an alarm (ADR 0008). R3 BMA service-held session data cannot use a customer-managed KMS key in preview.

Future AWS controls must be validated with real authorization-denial tests before claims are made. Document residual administrator and credential-compromise risks; do not call local simulation immutable storage.
