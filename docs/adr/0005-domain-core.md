# ADR 0005: Domain core (T00 to T04)

Status: adopted, November 18, 2026. Local only; no AWS resources. Builds on ADR 0002, 0003 and 0004.

## Shape

`core/` is a TypeScript ES-module package with no runtime dependencies beyond Node built-ins. Node 24 runs the `.ts` files directly (type stripping, `erasableSyntaxOnly`); `npm run typecheck` runs `tsc` 7.0.2 in strict mode. Dev dependencies: `typescript` 7.0.2 and `@types/node` 24.19.2, pinned exactly.

It is independent of Bedrock Managed Agents and AWS. Every external system is a small port with an in-memory adapter:

| Port | Production target (later) | Test adapter |
|---|---|---|
| `TransactionalStore` (conditional writes, all-or-nothing transactions, no delete, append-only tables) | DynamoDB `TransactWriteItems` | `MemoryStore`, `InterleavingStore` (forces races), `FaultyStore` |
| `ObjectStore` (`putNew` write-once, `getVersion` exact) | S3 with versioning, `If-None-Match` bucket policy, `GetObjectVersion` | `MemoryObjectStore` |
| `MembershipDirectory` | Cognito groups or a membership table | `MemoryDirectory` |
| `SecurityAuditLog` | Separate append-only audit table plus anchoring | `MemoryAuditLog` |

The agent reaches the core only through the Gateway tool Lambda (ADR 0003). The core sees it as `{ type: 'agent', agentId }` on channel `gateway`; it never sees prompts or model output.

## Modules

| Task | Module | Purpose |
|---|---|---|
| T00 | `canonical.ts`, `crypto.ts`, spec `docs/specs/canonicalization-and-verification-v1.md` | RFC 8785 subset, purpose-separated SHA-256, Ed25519 checkpoints. Golden vectors checked with `sha256sum` and OpenSSL |
| T01 | `fixtures/`, `core/src/fixtures.ts`, `tests/fixtures/expected-findings.json` | Ten synthetic artifacts (six deep), byte-derived manifest, evaluator truth kept apart |
| T02 | `policy.ts`, `audit.ts`, `approvals.ts`, `validate.ts` | Deny-by-default matrix, fail-closed audit guard, digest-bound single-use approvals |
| T03 | `evidence.ts` | Write-once originals, exact-version reads with hash check on every read, derivative lineage, quarantine on failure |
| T04 | `ledger.ts`, `custody.ts`, `proposals.ts`, `checkpoint.ts`, `export.ts`, `verifier.ts` | Per-case hash chain, corrections, idempotency, agent proposals, signed checkpoints, approval-gated export, independent verifier |

## Decisions

1. **The ledger is the registry.** Evidence counts as registered only when its `evidence_registered` event commits. Bytes stored without a committed event are quarantined (recorded, never deleted, never readable).
2. **One transaction per state change.** Event, head move, idempotency record, and any consumed approval or promoted proposal commit together or not at all. This keeps ADR 0002's atomicity rule and maps to one DynamoDB transaction.
3. **Append-only is enforced at the store adapter,** not just by convention: a write to an existing key in `events`, `idempotency`, `checkpoints`, `exports` or `quarantine` throws.
4. **Idempotency keys are bound to case and actor,** and the stored digest covers the request content. Same key and content returns the original event; same key and different content is refused.
5. **Corrections reference `targetSequence` and `targetHash` exactly.** The original event never changes.
6. **Historical assertions** cite registered pinned versions and keep raw claimed time, source clock, timezone and uncertainty separate from server time.
7. **Policy decisions recorded here** (the earlier matrix left them open):
   - Auditors may record historical assertions (they document what a source claims; they are not custody transfers). Auditors still cannot register evidence or add transfers.
   - Approvers are supervisors other than the requester. Two supervisors are needed when a supervisor requests.
   - Derivative registration uses the same roles as registration (investigator, supervisor) and requires an exact registered parent in the same case and evidence item. This resolves the "derivatives denied until specified" item.
   - Role and membership changes stay denied (`grant_role` is forbidden) until they have their own policy and audit contract.
   - `revoke_approval` (all case roles at the policy layer; the service further requires the requester themself or a supervisor). Added after review finding 6; replaces the earlier "revocation denied until specified" item.
   - `promote_proposal` (all case roles) is only a gate: promotion then re-runs the proposed operation's own policy for the promoting human.
   - `dismiss_proposal` (all case roles, humans only, added in T18): marks a draft dismissed with a required reason; final, audited, never a ledger event (ADR 0009).
8. **Agent proposals** are drafts in their own table. Promotion runs the real operation as the promoting human (full policy and validation), and the draft's state change commits in the same transaction as the event, so one draft yields at most one event. **No public method accepts extra transactional writes.** The ability to commit a proposal's state with an event is a capability (`Promoter`) handed only to `ProposalService` when the services are wired, and it can write only to the proposals table (review finding 1).
9. **Exports read and hash-check every requested version before consuming the approval,** so a failed export never burns an approval. Consumption and the export record share one transaction. No public key is placed in the package.
10. **The verifier imports only `crypto.ts` and `node:buffer`** (enforced by a test). Its status is `VERIFIED` only with no findings, every event anchored by a pinned-key checkpoint, and freshness confirmed by an outside reference.

## Independent security review (November 18, 2026)

A separate reviewer with no access to the author's reasoning reviewed the core read-only. It reported ten findings, five confirmed by running proof-of-concept scripts; the author reproduced all five before fixing.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | Public custody methods accepted `extraWrites`, so an investigator could forge their own export approval inside a ledger transaction | Public methods read only `idempotencyKey`; `Promoter` capability limited to the proposals table |
| 2 | High | Verifier reported swapped evidence bytes as `verified` via a re-registration in an unanchored tail | Duplicate registration is an error; tail registrations are `EVIDENCE_UNANCHORED`; nothing is verified in a FAILED package |
| 3 | Medium | Registration retries could never replay and stored bytes every time | Idempotency checked before storage, on a digest of the client request; racing retries quarantine their extra copies |
| 4 | Medium | Export could fail after consuming the approval | Events and checkpoint read before consumption |
| 5 | Low-medium | Blocked promotions and ID lookup misses were not audited | `promote_proposal` guard; `auditLookupMiss` |
| 6 | Low-medium | Revocation shipped without a policy row | `revoke_approval` operation |
| 7 | Low | Unchecked getters | Renamed `getUnchecked` (internal, never exposed); quarantine view guarded |
| 8 | Low | Verifier accepted malformed trusted references (could yield FRESH) | Rejected as `SCHEMA_INVALID`; freshness stays UNKNOWN |
| 9 | Low | Append-only table list existed only in tests | `core/src/tables.ts` exports it |
| 10 | Low | Idempotency keys unvalidated | 1-128 chars of `A-Za-z0-9._:-` |

`core/test/review-regressions.test.ts` reproduces each attack against the fixed code. Undoing any one of fixes 1, 2, 3, 4, 5 or 8 in isolation makes at least one regression test fail.

Lesson recorded: every pre-review test used the API as intended, so none could catch finding 1. Tests now include callers that pass undocumented fields to public methods.

### Follow-up review (same day, fresh reviewer)

Verified fixes 1, 2, 3, 6, 7, 8, 9 and 10 hold under bypass attempts; 4 and 5 were partial. Six new findings, all reproduced and fixed:

| # | Severity | Finding | Fix |
|---|---|---|---|
| N1 | Medium | Verifier never bound files to their entries and ignored unlisted files: relabeled or planted bytes still VERIFIED | Path must be `evidence/<evidenceId>/<versionId>`; duplicate entries and unlisted files are errors |
| N2 | Medium | Export read events before the checkpoint, so a concurrent checkpoint could consume the approval for an unverifiable package | Checkpoint read first; the append-only ledger guarantees events cover it |
| N3 | Low | Approve, revoke and promote were an ID existence oracle for anonymous callers and non-members | `lookupGuarded`: anonymous rejected before lookup; non-members get NOT_FOUND, audit keeps DENIED_NOT_MEMBER |
| N4 | Low | A store failure during an ID lookup threw with no audit record | Returned as STORAGE_UNAVAILABLE and audited |
| N5 | Low | Case IDs were never validated though used as scan prefixes | `CASE_ID` enforced in `authorize()` |
| N6 | Info | The promoter capability could write any value to any proposal key | Promoter takes only `(ctx, proposalId, expectVersion)` and builds the promoted state itself |

Regression tests for N1 to N6 are in the same file. Undoing any one of them makes its test fail. One test (N2) initially passed even with the fix undone because it simulated the race incorrectly; it was corrected and re-checked in both directions.

## Verification

- `npm test`: 262 tests, 262 pass (150 existing plus 112 core). `npm run typecheck`: clean. `npm run fixtures:check`: manifest matches bytes.
- Mutation checks (manual): eight deliberate breakages of core safeguards, six undone first-review fixes and six undone follow-up fixes. Every one failed at least one test; sources restored byte-identical each time.
- Concurrency tests use `InterleavingStore` so callers really interleave between read and conditional write, and assert that the race actually happened.

## Known limits

- In-memory adapters only. DynamoDB, S3 and Cognito adapters are later work; their IAM and bucket policies are designed in ADR 0003 but not built.
- Registration lookups scan the case's events. Fine for one case and dozens of events; add an index table before scale.
- The checkpoint signer runs in-process with a test key: a simulation of separate authority (spec section 4).
- The export state machine (private staging, recovery, download authorization) is P2.
- Security audit events are not yet anchored or hash-chained (SECURITY-RULES asks for this before production).
- `ApprovalService.getUnchecked`, `ProposalService.getUnchecked` and `CheckpointAuthority.issue` have no authorization: they are internal and must never be exposed through a transport. Checkpoint issuance is a system job.
- Export residual: if the process dies after the approval-consuming commit but before the package is returned, the approval is spent with no package delivered. The P2 staging state machine closes this.
