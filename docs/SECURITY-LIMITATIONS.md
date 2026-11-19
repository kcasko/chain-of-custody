# Security controls and limitations

What the system prevents, what it only detects, how it recovers, and what it does not protect against. Storage-level threats (overwrites, deletes, corrupted uploads, administrators) are in the table in [SECURITY-RULES.md](SECURITY-RULES.md); this page covers the application and states the limits plainly.

Verification labels: **tested** (unit, integration or Playwright tests in this repository), **DynamoDB Local** (real SDK against DynamoDB Local), **live** (verified on AWS, with the report named), **synthesized** (CDK template tests only), **not built**.

## Application controls

| Threat | Prevention | Detection | Recovery |
|---|---|---|---|
| A person acts outside their role (auditor moves evidence, investigator approves an export) | Deny-by-default role matrix in `core/src/policy.ts`, checked by every operation (tested, mutation-checked) | Every refusal is in the security audit log with the principal and code (tested) | Nothing changed, so nothing to recover |
| A person reads another case | Membership check on every read; lookups by opaque ID answer `NOT_FOUND` to non-members (tested) | Refusals audited under the record's case (tested) | Not needed |
| The agent acts as a human, writes the ledger, or reaches beyond its case | The agent's capability set is four operations; identity and case come from deployment configuration, never arguments; Cedar in front (Stage B live), the core behind it alone also refuses all 17 attack scenarios (DynamoDB Local) | Every tool call audited under the Gateway request ID (DynamoDB Local) | Agent output is a draft; a person promotes or dismisses it, and both are kept |
| Self-approval, approval reuse, swapped export contents | Approval bound to the payload digest, a different supervisor, single use, expiry (tested) | Refusals audited (tested) | Not needed |
| History rewritten through the application | No update or delete operation exists; corrections append and reference the exact target hash (tested) | Chain self-check on every timeline read; the offline verifier reports FAILED on any edit (tested) | The original entry is always kept |
| Write outcome unknown (storage timeout) | Reconciled by reading back; reported as `OUTCOME_UNKNOWN`, never as "nothing happened" (tested) | Quarantine record for evidence whose registration is unknown (tested) | Read the current state, then retry |
| Audit log unavailable | Protected operations refuse with `DENIED_AUDIT_UNAVAILABLE` before running (tested, also with an unreachable DynamoDB table) | Not applicable | Retry when the log is back |
| Audit record edited or hidden | Create-only writes; `audit` is an append-only table; the tool role cannot update or delete (DynamoDB Local, synthesized IAM) | Malformed records are reported, never skipped (DynamoDB Local); the stream archive alarms on any modify or delete (archiver tested locally) | Archived copy in the Object Lock bucket (synthesized, not deployed) |
| Hostile content in evidence, drafts or user text (script injection, prompt injection) | Rendered only with `textContent`; strict CSP, no inline script; evidence marked untrusted and never treated as instructions (Playwright, mutation-checked) | CSP violations fail the browser tests | Not needed |
| Cross-site requests to the local server | Host and Origin checks, per-launch session token, JSON only, 64 KiB limit (tested) | Not applicable | Not applicable |

## Limitations

1. **No real authentication in the workspace.** Choosing who you act as is a local demo control. A deployment needs real sign-in (Cognito or similar) before any of the role checks mean anything to a real user. Not built.
2. **The agent is not a model in this repository.** The agent pass and the Integrity Challenge replay fixed tool calls. Nothing here shows how a real BMA session behaves (RB-1).
3. **Integrity is not authenticity.** A passing export proves the history and files are complete and unaltered since registration, relative to a trusted key and reference. A forged document registered honestly verifies perfectly.
4. **The checkpoint key is a demo key.** The local server signs checkpoints with a fixed seed; the trust file is offered from the same page as the package. In real use the public key and reference must reach the recipient by a separate channel, and the signing key must be held by a separate authority. Not built.
5. **Stolen application credentials can overwrite the DynamoDB working copy.** DynamoDB has no write-once mode. The Object Lock archive and the tamper alarm detect it, and the archive holds the original (ADR 0008); prevention is not possible at the table.
6. **An account administrator is trusted.** They can change IAM, bucket policies and the table. Only COMPLIANCE-mode Object Lock survives them, and only for retained data.
7. **Audit ordering is per writer.** Records from two Lambda instances in the same millisecond are ordered by a random suffix, not real time. The security log view shows the newest 200 entries with no paging or search.
8. **Records without a case are not shown.** Attempts that never identified a case (anonymous calls, lookups of IDs that do not exist) are stored under `(unknown)` and are not in the per-case security log.
9. **The core-backed tool Lambda has not run on AWS.** It is tested locally against DynamoDB Local and an S3 fake, and its bundle loads; the deployed Stage B run used the stub Lambda.
10. **Evidence exfiltration through the agent's network egress** is accepted for the MVP because all data is synthetic (R1 in SECURITY-RULES).
