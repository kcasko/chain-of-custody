# Submission readiness

Last updated November 18, 2026. **Not submission-ready: release blocker RB-1 (Bedrock Managed Agents access) is open.** Nothing has been pushed, published, deployed or submitted.

## Status at a glance

| Area | State |
|---|---|
| Investigation application (all nine workflow steps) | **Complete, local.** Verified by tests and Playwright at desktop and phone widths, keyboard, light and dark contrast |
| Security controls in the domain core | **Complete, tested,** independently reviewed (see below) |
| Durable audit log and core-backed tool Lambda (T16) | **Complete locally** on DynamoDB Local and an S3 fake; **not run on AWS** |
| AWS infrastructure (CDK) | **Synthesized and tested only; not deployed** |
| Storage adapters on real AWS | **Verified live** in T14b (23/23, torn down the same day) |
| Gateway and Cedar enforcement on real AWS | **Verified live** in Stage B (T09B) with a stub Lambda, not with the core-backed one |
| Bedrock Managed Agents integration | **Blocked (RB-1).** Not connected, not demonstrated |
| Event rules (submission format, judging, eligibility) | **Unknown (RB-2).** The rules tab was still "coming soon" at last check |

## Checklist

### Complete

- [x] Workflow 1 to 9 in the workspace: brief, exact versions with provenance, compare, findings, draft promote and dismiss, custody and claims and corrections, export with independent approval and offline verification, security log, Integrity Challenge ([DEMO.md](DEMO.md)).
- [x] Authorization in the core only: deny by default, case isolation, version-pinned reads, single-use approvals bound to the payload, append-only history, honest `OUTCOME_UNKNOWN`, fail-closed audit.
- [x] Prevention, detection and recovery documented separately ([SECURITY-RULES.md](SECURITY-RULES.md), [SECURITY-LIMITATIONS.md](SECURITY-LIMITATIONS.md)).
- [x] Durable audit log (`DynamoAuditLog`) and the deployable tool handler; all 24 Stage B scenarios behave correctly through it locally.
- [x] Offline export verifier (`npm run verify:export`), stating integrity versus authenticity.
- [x] Architecture diagram ([ARCHITECTURE.md](ARCHITECTURE.md)), demo walkthrough, setup and teardown ([README](../README.md), [runbook](runbooks/infra.md)).
- [x] Independent security and correctness review, with confirmed findings fixed and re-verified (see "Review" below).

### Blocked

- [ ] **RB-1: BMA access.** The account gets HTTP 401 "Bedrock Managed Agents is not available for this account". Keith sends the access requests ([drafts](plans/2026-11-18-bma-access-requests.md)); decision date November 24, 2026.
- [ ] **RB-2: event rules.** Re-check before writing the final submission text (T07b).

### Needs approval (prepared, not done)

- [ ] **T19,** the Stage B runner for the core-backed Lambda. Needed before the first deploy; no AWS cost.
- [ ] **Deploy the test stacks** with the harness role. Use the [runbook](runbooks/infra.md) steps, a budget alarm like T14b, and same-day teardown. This needs a cost estimate and Keith's approval.
- [ ] **Seed evidence and run the smoke checks** on AWS: the core-backed tool Lambda, the audit records, one archive round trip and one denied write.

### Not built (stated limits)

- [ ] Real sign-in for the workspace (persona choice is a demo control).
- [ ] An independent checkpoint signing authority (the local server signs with a demo key).
- [ ] Paging and search in the security log beyond the newest 200 entries.

## What remains to qualify, in order

1. **BMA access granted** (RB-1).
2. **Rerun T09 G1:** create a BMA session with the session role `CocBmaSessionRole`.
3. **T11:** implement the BMA client behind the existing `AgentToolClient` boundary. The agent then calls the same Gateway and the same tool Lambda; no core change is expected.
4. **Verify against a real model,** with recorded evidence for each of:
   - **actual tool execution:** the seven legitimate calls run, as shown by tool responses and `audit` records under the Gateway request IDs;
   - **denied operations:** the Cedar denials and the core refusals for the attack scenarios, with the deciding layer recorded;
   - **session attribution:** every call arrives as the session role and is recorded as `agent:coc-audit-agent`;
   - **execution-environment isolation:** the 17 checks in `harness/check-exec-env.sh` pass inside the BMA execution environment, with no credentials, evidence or network path beyond the Gateway.
5. **Only then** claim a qualifying BMA submission, and record the run like the T09 and T14b reports.

## Verification run (November 18, 2026, final)

| Check | Result |
|---|---|
| `npm test` (core, app API, policy, adapters on DynamoDB Local, infra templates, CLI) | 403 of 403 pass, none skipped |
| `npm run typecheck` (core, app, e2e, adapters, infra) | Clean |
| `npm run test:e2e` (Playwright, Chromium) | 14 of 14 pass: full audit workflow with offline CLI verification of the downloaded files; brief, provenance and compare; dismissal; claims; outsider; security log; exact reader bytes; hostile text; keyboard (tabs and new controls, visible focus ring); phone width 375 px; WCAG AA 4.5:1 contrast in light and dark; Integrity Challenge 28 of 28 |
| Desktop and phone screenshots, light and dark | Checked by eye; no horizontal overflow, no script errors |
| CDK synth | Succeeds; the bundled tool Lambda loads and refuses calls without Gateway context |
| Architecture diagram | Written in Mermaid; **not render-checked** (a headless render with Mermaid from a CDN was blocked by this session's permission rules) |

## Independent review

A separate reviewer agent, with no access to this session's reasoning, reviewed every change since T17 (`494a978..HEAD`), ran the tests, and reported 8 findings, none critical. Each was fixed and verified, or documented:

| # | Severity | Finding | Outcome |
|---|---|---|---|
| 1 | Medium | The tool Lambda's IAM allowed `PutItem` on every logical table, so a compromised Lambda could forge an approved `approvals` row | **Fixed.** `dynamodb:LeadingKeys` pins reads to `events` and writes to `audit`, `findings` and `proposals`. A test records every DynamoDB call across all 24 scenarios and fails if the code leaves that list; the template test checks the conditions. `ConditionCheckItem` was dropped. The condition is synthesized, not yet tested on AWS |
| 2 | Medium | A 4xx after an SDK retry (or `TransactionInProgressException`) was reported as a definite failure although an earlier attempt may have committed | **Fixed.** Classified as `OUTCOME_UNKNOWN`; unit test for each case |
| 3 | Low-medium | The page called its export check "independent", but it uses this server's own key and head | **Fixed.** Reworded to a consistency check against the server's published key; independence comes from the offline verifier with a separately delivered trust file. The test that passed by construction now ties the trust file to the case's real head |
| 4 | Low | A malformed audit record broke the view as a generic storage error; no key and body case check; unbounded count | **Fixed.** `INTEGRITY_FAILURE` for malformed or mis-filed records; case ID checked against the key; count bounded and shown as "at least N". Tests on DynamoDB Local |
| 5 | Low | Seed script accepted a missing `--as`; attribution is asserted, not authenticated | **Fixed** (test, mutation-checked against the old parsing) and **documented** in the script and here |
| 6 | Low | Audit order is per writer, approximate across instances | **Documented** on the page and in [SECURITY-LIMITATIONS.md](SECURITY-LIMITATIONS.md) |
| 7 | Low | Compare could say "No line differences" for versions whose bytes differ outside the shown text | **Fixed** in the verdict text. No automated test: no seeded pair has identical text with different bytes |
| 8 | Low | Provenance is matched by content hash | **Documented** in ADR 0009 (harmless with current fixtures) |
