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

Review resolution: every MVP export requires independent approval, including supervisor exports. Restricted agent mutation requests produce non-authoritative Proposal drafts; scoped reads and validated audit reports remain permitted. Server-derived human identity, agent identity and execution channel cannot be supplied in tool arguments. Human promotion of a draft repeats authorization. Derivative creation, membership changes, role changes and approval revocation remain denied until their own policy rows and audit contracts are specified. Agent tools cannot read evaluator truth under tests/fixtures.

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
| B7 | Preview API changes during the event | Thin adapter, pinned client versions, re-run smoke test daily | Daily smoke run |

Residual risks stated plainly: R1 evidence exfiltration through the agent's network egress (synthetic data, accepted for MVP). R2 an account administrator can change bucket policies, IAM and the ledger; checkpoints detect ledger edits but do not prevent them. R3 BMA service-held session data cannot use a customer-managed KMS key in preview.

Future AWS controls must be validated with real authorization-denial tests before claims are made. Document residual administrator and credential-compromise risks; do not call local simulation immutable storage.
