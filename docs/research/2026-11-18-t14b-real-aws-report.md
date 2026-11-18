# T14b: storage adapters on real AWS (report)

Run on November 18, 2026, approved by Keith (plan: `docs/plans/2026-11-18-t14-real-aws-adapter-run.md`; Object Lock in GOVERNANCE mode). us-east-1. All tests ran as the least-privilege role `CocT14AdapterTestRole`, not as an admin. Everything was created, tested and deleted within about 15 minutes. Evidence: `docs/research/t14b-evidence/run-report.json` (no account IDs, ARNs or credentials).

**Result: 23/23 passed** (`adapters/aws/test/real-aws.test.ts`: the 12-test port contract plus R2 to R12). Nothing contradicted ADR 0007; one claim (R6) was confirmed as a real risk, exactly as the ADR now states.

## Results

| ID | Question | Result |
|---|---|---|
| R1 | Port contract on real DynamoDB | 12/12. Both race tests had exactly one winner (at most one was allowed) |
| R2 | Whole domain on DynamoDB plus S3 | 12 fixtures registered, custody transfer, signed checkpoint, approved export. `verifyExport`: VERIFIED, FRESH, valid through sequence 13, 3/3 evidence files verified, no findings |
| R3 | Ledger under real contention (5 rounds of 20 concurrent appends) | Winners per round: 2, 1, 1, 1, 1. All 94 losers got `LEDGER_CONFLICT`; none got `OUTCOME_UNKNOWN`. Chain of 18 events contiguous, every `prevHash` correct. About 240 ms per round |
| R4 | SDK retry after a discarded successful response | A test middleware threw away the first successful `TransactWriteItems` response. The SDK retried (2 attempts) and DynamoDB returned success for the retry: one item written at version 1, no false CONFLICT. **The SDK's automatic `ClientRequestToken` is idempotent across retries on the real service** |
| R5 | Least-privilege DynamoDB policy | Transactions work with only `GetItem`, `Query`, `PutItem`, `ConditionCheckItem`. `DeleteItem`, `UpdateItem`, `BatchWriteItem`, `DeleteTable`: all `AccessDeniedException` |
| R6 | Raw overwrite by the app role | **Allowed**, as ADR 0007 states (transactions need `PutItem`). The verifier reported FAILED with `EVENT_HASH_MISMATCH` and `PREV_HASH_MISMATCH`. The table stream recorded the overwrite as a `MODIFY` with old and new images showing the changed `recordedAt` |
| R7 | S3 overwrite with `If-None-Match: *` | Refused (`ObjectExistsError`, HTTP 412); the original version still reads back unchanged |
| R8 | Bucket policy against the app role | PutObject without `If-None-Match`, DeleteObject (delete marker), DeleteObject with VersionId, PutObjectRetention, PutBucketVersioning: all `AccessDenied` |
| R9 | Corrupted upload | `BadDigest`. Nothing stored: a later create-only put of the same key succeeded |
| R10 | Real S3 version ID format | 80 version IDs, all 32 characters from `A-Z a-z 0-9 . _`. All match `VERSION_ID`; no change needed |
| R11 | 20 concurrent conditional puts to one new key | 1 success, 19 `ObjectExistsError`, no 409 `ConditionalRequestConflict` seen |
| R12 | Read-your-write | 200/200 pairs read their own write. Not proof of behavior under replication lag; nothing contradicted it |

## Stream check for the recommended alarm (ADR 0007)

The table stream held 316 records: 212 inserts and 47 modifies on mutable tables (heads, approvals, proposals), 56 inserts and **exactly 1 modify** on append-only tables. That one was the R6 overwrite. An alarm on "MODIFY or REMOVE where `pk` is an append-only table" would have fired once, on the real tamper, with no false alarms in this run.

## Teardown and inventory

- 80 object versions deleted with governance bypass (admin), then the bucket. 80 equals the number of successful `putNew` calls recorded by the test, which independently confirms that the denied, corrupted and losing uploads stored nothing.
- Table deleted; both inline policies and the role deleted.
- Read-only inventory afterwards: no `coc-t14` table or bucket, `GetRole` returns NoSuchEntity, no resources tagged `Task=T14b`.
- Kept as planned: budget `coc-t14-storage` ($3, DynamoDB and S3) until December 31 to catch late charges.

Cost: not yet visible (billing data lags about a day). By the plan's estimate it is about 2 cents.

## Problems during the run

1. **Windows CLI output and Git Bash.** The first attempt never reached AWS: the AWS CLI on Windows ends text output with a carriage return, which corrupted the session token header. The second attempt reached AWS but failed signing, because Git Bash rewrites environment values that look like Unix paths before passing them to Windows programs, which altered a secret key. Fixed with `tr -d '\r'` and `MSYS2_ENV_CONV_EXCL='*'`. Lesson for T12 scripts: never pass credentials through Git Bash to Windows binaries without both.
2. **A session token was printed.** The first failure's CLI error message echoed the test role's session token into the operator's log. On its own it cannot sign a request (the secret key was never printed), it belonged to the least-privilege test role, it expired within the hour, and deleting the role about 10 minutes later invalidated it. No secret key or account ID was written to the repository; the committed evidence was checked for both.

## What this does and does not prove

Proven on real services: the adapters' conditional-write semantics, the least-privilege IAM set, the bucket policy, S3 overwrite and checksum refusal, the version ID format, SDK retry idempotency, and that storage alone does not stop an app-credential overwrite but the verifier and the stream both catch it.

Not proven: behavior under replication lag or throttling, Object Lock COMPLIANCE mode, KMS keys, cross-region anything, production-scale load. None of this is Bedrock Managed Agents evidence; RB-1 is unchanged.
