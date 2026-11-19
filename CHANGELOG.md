# Changelog

## 2026-11-18 (T18: dismissing agent drafts)

- Core: `ProposalService.dismiss` and the `dismiss_proposal` operation (all case roles, humans only). A reason is required; the draft is kept and marked dismissed with who, when and why; it can never be promoted; the ledger does not change; the action is audited. Conditional on the version read, so a dismissal and a promotion cannot both win. ADR 0009 records the choice to let any member dismiss.
- Workspace: "Dismiss this draft" on each open draft, with a required reason; dismissed drafts stay listed with the reason. API `POST /api/proposals/dismiss`.
- Tests: 4 core (including a deterministic stale-write test), 1 API, 1 browser. Mutation-checked. `npm test`: 375/375; `npm run test:e2e`: 8/8; typecheck clean.

## 2026-11-18 (T18: browser tests for the workspace)

- Playwright 1.64.1 (pinned, Chromium only) with `npm run test:e2e`. It starts its own server on port 4391. 7 tests: the full audit walkthrough, outsider refusal on every tab, reader text equal to the API for all 12 versions, hostile markup shown as inert text, keyboard tabs, phone width, and the Integrity Challenge at 28 of 28. A script error or CSP violation fails any test.
- Mutation-checked: an inline script fails all 7; `innerHTML` on timeline entries fails the hostile-text test.
- No new npm audit findings (the accepted minimatch advisory via aws-cdk-lib is unchanged). `npm test`: 371/371; typecheck now includes the e2e tests.

## 2026-11-18 (T17: investigation workspace)

- Local investigation workspace at `/` (Integrity Challenge moved to `/challenge`): evidence explorer with exact-version reads, custody timeline with chain self-check and append-only corrections, findings and agent drafts with human promotion, and approval-gated export with independent verification. ADR 0009.
- Core: `CaseReadService` adds audited, humans-only reads for the timeline, drafts and approvals (6 tests). Authorization stays in the core; the API only maps results.
- Local demo identity (choose who you act as; no login) stated on the page. Session token, Host and Origin checks, JSON-only bodies with a 64 KiB limit, strict CSP, textContent rendering, no internal storage keys in responses.
- Scripted agent pass replays the seven legitimate Stage B calls through the Gateway handler; labeled as not a model (RB-1).
- Light-mode focus and correction color darkened to `#7f5a00` (was 2.84:1, now 5.4:1).
- `npm test`: 371/371; typecheck clean. Browser checks were manual (dark, light, 375 px).

## 2026-11-18 (ledger overwrite risk and T12 CDK)

- Session token check: the T14b test-role token appears in no repository file, git object, temp file, AWS CLI cache or shell history. It appears only in the local Claude session transcript. CloudTrail shows the session used only between 19:45:22 and 19:45:39 UTC, before the role was deleted at 19:46:57.
- ADR 0008: DynamoDB cannot prevent an overwrite by stolen application credentials. Adopted a stream-fed write-once ledger archive in an Object Lock bucket (`adapters/aws/src/ledger-archive.ts`, 6 tests) with `APPEND_ONLY_TAMPER` and `ARCHIVE_CONFLICT` alarms. SECURITY-RULES now separates prevention, detection and recovery per threat, with verification status. RB-1 marked as the primary release blocker.
- T12: CDK app in `infra/` (aws-cdk-lib 2.275.0, CLI 2.1147.0, esbuild 0.28.2, exact pins). Storage stack (T14b table, buckets, policies, writer policy, archive, alarms) and gateway stack (Stage B engine, gateway, target, stub Lambda, 11 Cedar policies created one at a time, boundary forbids first). Cedar rendered by the existing injection-safe renderer and validated at synth. 12 template tests; mutation checks on policy order, create-only rule, ENFORCE mode, archiver retries and gateway scoping. **Synth only; nothing deployed.**
- `npm test`: 354/354; typecheck covers core, app, adapters and infra.

## 2026-11-18 (T14b: adapters on real AWS)

- Approved run in us-east-1 as a least-privilege role: 23/23 (port contract plus R2 to R12). Whole domain with a VERIFIED, FRESH export on DynamoDB plus S3; contiguous ledger under 20-way contention; SDK retry idempotency confirmed; every IAM and bucket-policy denial confirmed; S3 overwrite and bad-checksum uploads refused; real version IDs fit `VERSION_ID`.
- Confirmed the documented risk: the app role can overwrite a ledger item with raw PutItem. The verifier reports FAILED and the table stream shows exactly one append-only MODIFY (no false alarms in the run).
- Opt-in test `adapters/aws/test/real-aws.test.ts` (skipped unless `COC_REAL_AWS=1`), policy templates in `scripts/t14b/`, contract race tests accept "at most one" for real tables.
- Created and deleted the same day: table, Object Lock bucket (GOVERNANCE, 1 day), test role. Kept: budget `coc-t14-storage` ($3) until December 31. Report: `docs/research/2026-11-18-t14b-real-aws-report.md`.

## 2026-11-18 (T14 review fixes)

- Independent read-only review of the AWS adapters: one high, two medium, four low findings. All checked against the code, fixed, and covered by regression tests that fail when the fix is undone. Dispositions in ADR 0007.
- High: a write that committed but lost its answer was reported as "nothing written" (evidence registered and quarantined at once; export burned the approval with no package). New `OutcomeUnknownError` in the store port and `OUTCOME_UNKNOWN` error code; ledger, evidence and export reconcile by reading. `core/test/outcome-unknown.test.ts`.
- Medium: bytes stored by a failed or retried S3 put are now quarantined by key instead of orphaned (error code still `STORAGE_UNAVAILABLE`). ADR 0007 corrected: the SDK sets `ClientRequestToken` itself; stolen application credentials can overwrite DynamoDB items; SSE-KMS permissions; Streams alarm.
- `MemoryStore` now enforces the same JSON and non-empty-key rules as DynamoDB, so every core test runs under them. DynamoDB errors are classified (4xx thrown, everything else outcome-unknown). S3 reads must confirm the version. DynamoDB Local is killed on exit or interrupt; README records the verified archive hash.
- `npm test`: 336/336; typecheck clean. Nothing created in AWS.

## 2026-11-18 (T14: AWS storage adapters)

- `DynamoStore` and `S3ObjectStore` in `adapters/aws/` implement the core's storage ports. ADR 0007 records the table design, what storage can and cannot enforce, and the IAM and bucket settings T12 must apply.
- Shared port contract (`adapters/aws/test/store-contract.ts`) runs against `MemoryStore` and DynamoDB Local 3.3.1. The full domain, including an approved export that verifies independently, runs on DynamoDB; concurrent ledger appends stay one contiguous chain; a raw table rewrite is not blocked by storage but the verifier reports `FAILED`.
- S3 adapter tested with the real SDK client and a fake network layer: `If-None-Match: *`, SHA-256 checksums, version-pinned reads, refusal of unversioned or suspended-versioning buckets, fail-closed errors.
- New dependencies `@aws-sdk/client-dynamodb` and `@aws-sdk/client-s3` 3.1161.0 (exact pins, 0 audit findings). `npm test`: 323/323; typecheck covers `adapters/aws`.
- Nothing created in AWS. Real DynamoDB and S3 verification still needs approval.

## 2026-11-18 (T15: Integrity Challenge demo)

- Local demo page (`app/`, `npm run demo`, http://127.0.0.1:4317). Runs 24 agent tool calls through the rendered Cedar policies and the gateway handler, plus four attacks from outside the agent (self-approval, swapped export version, overwritten original, rewritten ledger). 21/21 attacks refused, 7/7 legitimate calls executed, evidence bytes and ledger head unchanged.
- F-1 to F-3 reproduce the live Stage B result: the Gateway allows injected fields and only the core refuses them.
- Server binds to 127.0.0.1, serves a fixed file map, GET only, strict CSP and security headers. The page renders with `textContent` only. Muted text meets WCAG AA in both color schemes.
- `core/src/local.ts` wires an in-memory domain with seeded fixtures. `npm test`: 286/286; `npm run typecheck` clean.

## 2026-11-18 (agent tools on the core)

- The five agent tools now run on the domain core (`core/src/agent-tools.ts`) behind a Gateway Lambda adapter (`core/src/gateway-handler.ts`). ADR 0006.
- `propose_custody_event` schema extended so agent proposals can actually be promoted (transfer versions and parties, pinned historical sources with timezone and uncertainty, exact correction hashes). Cedar permits, Stage B stub and tests updated; five new deny cases. Live policy-engine revalidation pending.
- New `record_finding` operation and append-only `findings` table; findings must cite registered evidence and may not conclude guilt, intent, blame or admissibility.
- Clock provenance matched to registered versions by content hash (`core/src/provenance.ts`).
- Tool-layer refusals are written to the security audit log.
- All 24 Stage B scenarios replayed against the core alone: legitimate work succeeds, every attack refused. `npm test`: 280/280.

## 2026-11-18 (T00 to T04: domain core)

- T00: spec `docs/specs/canonicalization-and-verification-v1.md` (RFC 8785 subset, purpose-separated SHA-256, Ed25519 checkpoints, verifier trust inputs and honest states). Golden vectors checked with `sha256sum` and OpenSSL.
- T01: ten synthetic fixtures (six deep), byte-derived manifest (`npm run fixtures:check`), evaluator truth in `tests/fixtures/expected-findings.json`. `fixtures/evidence/**` marked binary so Git never alters hashed bytes. A test caught and removed a reference to the truth file from the agent-visible manifest.
- T02 to T04: TypeScript domain core in `core/` (no runtime dependencies, independent of AWS and BMA): transactional store port with append-only tables, deny-by-default policy matrix, fail-closed audit guard, digest-bound single-use approvals, write-once version-pinned evidence storage with quarantine, per-case hash-chained ledger with corrections and idempotency, agent proposals with human promotion, checkpoint authority, approval-gated export and an independent verifier.
- Dev dependencies: `typescript` 7.0.2, `@types/node` 24.19.2 (exact pins). Scripts: `npm run typecheck`, `npm run fixtures:check`; `npm test` now includes `core/test`.
- Independent security review (read-only, separate reviewer): ten findings, two high. Fixed all ten: no public extra transactional writes (an investigator could forge their own export approval), verifier rejects duplicate and unanchored evidence registrations, registration idempotency checked before storing bytes, export reads everything before consuming the approval, audited lookup misses and promotions, `revoke_approval` and `promote_proposal` policy rows, guarded quarantine view, validated trusted references and idempotency keys, append-only table list in core. Regression tests in `core/test/review-regressions.test.ts`.
- Follow-up review by a fresh reviewer: eight fixes hold, two partial; six new findings fixed (verifier binds files to entries and rejects unlisted files, export reads the checkpoint before events, ID lookups no longer reveal existence and audit store failures, case IDs validated, narrower promotion capability).
- `npm test`: 262/262 (150 existing + 112 core). Manual mutation checks: eight core safeguards, six first-review fixes and six follow-up fixes, all caught. ADR 0005 records decisions and the review; `docs/RELEASE-BLOCKERS.md` tracks RB-1 (BMA access) and RB-2 (event rules).

## 2026-11-18

- T07: verified event window and brief from the official event page (rules still unpublished).
- Added BMA feasibility research from official AWS docs, with open spike questions Q1-Q6.
- Adopted ADR 0003 (approved by Keith): Gateway + Cedar + Lambda tool boundary, agent as its own case-bound principal (amends ADR 0002), hostile execution environment, storage-level append-only enforcement, 14-day P0/P1/P2 scope.
- Added BMA-specific threats B1-B7 and residual risks R1-R3 to the security rules. Added tasks T07b, T09, T10.
- T10: five agent tool definitions and Cedar policies (`policy/`), deny by default with session-role and gateway boundary forbids. 128 policy tests covering permitted, denied, escalation, prompt injection, approval bypass and missing-field cases, each run typed and untyped. ADR 0004 records decisions and what remains for the Lambda layer and T09. Added dev dependency `@cedar-policy/cedar-wasm` 4.14.0 (exact pin).
- T09 plan prepared (not executed): staged spike with gates, exact resources, cost estimate (about $3 typical, about $12 worst case), $15 budget safeguards and same-day teardown. Found that GPT-5.6 Luna bills as AWS Marketplace usage, so service-filtered budgets must name it explicitly.
- T09 run: stopped at gate G1. The account gets HTTP 401 "Bedrock Managed Agents is not available for this account" in all three preview regions, and GPT-5.6 Luna is not entitled (gpt-oss-20b works with the same credentials). Created two free budgets and two narrow IAM roles; nothing billable. Found that the official exec-server example passes the operator's AWS profile to the agent's shell. Report and access-request drafts in docs/research/2026-11-18-t09-spike-report.md.
- T09 Stage B (approved): real AgentCore Gateway + Policy (ENFORCE) + stub tool Lambda, with a test-harness role standing in for BMA. 29/29 live scenarios pass twice, verified against Lambda logs; 17/17 exec-environment isolation checks passed while the gateway existed (committed post-teardown rerun: 16/16, gateway probe skipped); all Stage B resources torn down the same day. Not evidence of BMA compatibility.
- Policies changed to satisfy the real engine (resource constraints in forbid heads, IamEntity-scoped tool forbids, exact principal match because AgentCore strips the session name). ADR 0004 updated: undeclared tool arguments reach the target in production, so the Lambda's closed-schema validation is mandatory.
- Added `harness/` (stub Lambda with independent validation, replaceable `AgentToolClient`, live runner, exec-environment check) and `tests/harness.test.cjs`. `npm test`: 150/150. Added threats B8 and B9. Access requests rewritten with Stage B findings in docs/plans/2026-11-18-bma-access-requests.md.

## 2026-11-16

- Initialized local Chain of Custody planning repository.
- Recovered original Blackwater planning context with truncation and verification caveats.
- Added project plan, case bible, proposed architecture, security rules, test strategy and task board.
- Added local bounded Mozaik/Claude/Codex review integration and verification artifacts.
