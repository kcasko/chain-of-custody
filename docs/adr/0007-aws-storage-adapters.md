# ADR 0007: DynamoDB and S3 adapters for the core ports

Status: adopted, November 18, 2026. Local only. Nothing was created in AWS; the DynamoDB adapter is verified against DynamoDB Local, the S3 adapter against the real AWS SDK with a fake network layer. Built while Bedrock Managed Agents access is blocked (RB-1).

## Decision

Two adapters in `adapters/aws/src/`, outside `core/` so the core keeps zero runtime dependencies:

| Port | Adapter | Mechanism |
|---|---|---|
| `TransactionalStore` | `DynamoStore` | One table, `pk` = logical table, `sk` = key, `v` = JSON string, `ver` = number. Every write is a `TransactWriteItems` Put with `attribute_not_exists(pk)` (create) or `ver = :expect` (update). |
| `ObjectStore` | `S3ObjectStore` | `PutObject` with `If-None-Match: *` and `x-amz-checksum-sha256`; `GetObject` always with `VersionId` and checksum mode enabled. Bucket versioning required. |

Dependencies: `@aws-sdk/client-dynamodb` and `@aws-sdk/client-s3` 3.1161.0, exact pins, the newest release at least 14 days old on November 18. `npm audit`: 0 vulnerabilities.

## Choices and the alternatives rejected

- **Single table, logical table as partition key.** `list(table, prefix)` becomes one `Query` with `begins_with`. Rejected one physical table per logical table: nine tables for no gain at this scale, and transactions span tables either way. Known cost: each logical table is one partition key, so a very busy case log would be a hot partition. Acceptable for the event; revisit with `pk = table#caseId` if load ever matters.
- **Values stored as a JSON string, not a DynamoDB map.** Avoids number-precision and empty-value conversions. `encodeJsonValue` (in `core/src/store.ts`) refuses any value that would not round-trip exactly (undefined fields, Dates, typed arrays, NaN, -0). `MemoryStore` enforces the same rule and refuses empty keys, so all core tests run under the DynamoDB rules; none of the 286 existing tests broke.
- **Strongly consistent reads everywhere.** Version checks against an eventually consistent read would be worthless. Not testable locally (DynamoDB Local is always consistent); it is set on every `GetItem` and `Query`.
- **Retries and ambiguous outcomes.** The SDK fills `ClientRequestToken` itself (it is an idempotency-token member) and reuses it across its own retries, so a retry after a lost response returns success instead of a false CONFLICT. (The first version of this ADR claimed the adapter had to set it; the review showed that was wrong, and the explicit token was removed.) When the SDK gives up, a 4xx is a definite rejection and is thrown as is; anything else (5xx, timeout, dropped connection) becomes `OutcomeUnknownError`, a new part of the port contract. The core never treats it as "nothing written": the ledger reads the event slot (our hash there: committed; another event: conflict; empty: `OUTCOME_UNKNOWN`), export reads its record (ours there: deliver the package), and every other operation reports `OUTCOME_UNKNOWN` instead of a plain failure.
- **`TransactionConflict` maps to CONFLICT**, like a failed condition: nothing was written and the caller may re-read and retry. Throttling, validation and network errors are thrown (fail closed).
- **No local S3 emulator.** None is official, and MinIO or similar would be a third-party download proving someone else's semantics. Instead the tests run the real `S3Client`, replace only its request handler, and check the serialized headers and query plus the adapter's mapping of S3's documented status codes.

## What storage can and cannot enforce

| Guarantee | DynamoDB | S3 |
|---|---|---|
| Create-only writes refused by the service | Yes (`attribute_not_exists`), tested | Yes (`If-None-Match`, 412), request tested, service not |
| Append-only tables | Adapter refuses before sending; service enforces create-only | Write-once keys; versions immutable |
| Protection from a principal with write access to the table, **including stolen application credentials** | **No.** A Put inside `TransactWriteItems` is authorized as `dynamodb:PutItem`, so the application role must hold PutItem, and IAM cannot require a condition expression. Anyone with those credentials can call PutItem directly and overwrite an event. Test proves a raw rewrite succeeds | With Object Lock (compliance mode) and a bucket policy denying deletes and puts without `If-None-Match`: yes |
| Detection after tampering | Hash chain and signed checkpoints. Test proves the verifier reports `FAILED` with `EVENT_HASH_MISMATCH` after a raw rewrite | Content hash in the ledger; verifier re-hashes |

So for the ledger, storage stops the application's own code paths from overwriting, but not someone holding the application's credentials; the hash chain and signed checkpoints are the guarantee, and a DynamoDB Streams alarm on `MODIFY` or `REMOVE` records for append-only tables should make tampering loud (T12). That matches ADR 0003 (L5 is defense in depth; L6 audit and the verifier are what prove integrity).

## Required infrastructure settings (for T12)

- DynamoDB: on-demand table per `tableDefinition()`, point-in-time recovery on, deletion protection on. Application role: `GetItem`, `Query`, `TransactWriteItems`/`PutItem` (with `dynamodb:LeadingKeys` limited if per-case keys are adopted); explicitly deny `DeleteItem`, `UpdateItem`, `DeleteTable`, `BatchWriteItem`.
- DynamoDB Streams (new and old images) feeding an alarm on any `MODIFY` or `REMOVE` record whose `pk` is an append-only table.
- If SSE-KMS with a customer managed key is used, the application role also needs `kms:GenerateDataKey` and `kms:Decrypt` on that key.
- `keyPrefix` is fixed deployment configuration: the ledger stores object keys without it, so changing it makes every registered version unreadable (`EVIDENCE_VERSION_MISSING`).
- S3: versioning enabled, Object Lock in compliance mode with a retention period covering the event, block public access, SSE. Application role: `PutObject`, `GetObjectVersion`; bucket policy denies `DeleteObject*`, `PutBucketVersioning`, `PutObjectRetention` shortening, and `PutObject` without `If-None-Match` (`s3:if-none-match` condition key). Without `ListBucket`, a missing key returns 403, which the adapter treats as an error (fail closed). The domain only reads versions it has registered, so this only happens after tampering.

## Verification (November 18)

- `npm test`: 323/323 at commit 27646df (after the review fixes: see CHANGELOG), including the shared port contract run against `MemoryStore` and against DynamoDB Local 3.3.1 (in memory, random port, telemetry off), the whole domain (fixtures, custody, checkpoint, approved export, independent verify) on DynamoDB, six concurrent ledger appends producing one contiguous chain, and the domain on the S3 adapter.
- Manual mutation checks: removing the create condition, the version condition or the conflict mapping fails 4, 6 and 8 tests; removing `If-None-Match`, the `"null"` version check, the malformed-ID guard or the 412 mapping each fails at least one test. One mutation survives: removing the adapter's re-sort in `list`, because DynamoDB already returns ASCII keys in the same order. The sort stays as a guard for non-ASCII keys.
- DynamoDB Local has no bind-address option and listens on all interfaces while the tests run; it holds synthetic data only and CORS is limited to an unused origin. Windows may show a firewall prompt the first time.

## Independent review (November 18)

A separate read-only reviewer examined commit 27646df. I checked each finding against the code before fixing it. Every fix has a regression test that fails when the fix is undone.

| Finding | Severity | Disposition |
|---|---|---|
| A committed transaction whose answer was lost is reported as "nothing written": evidence both registered and quarantined; export burns the approval with no package | High | Fixed: `OutcomeUnknownError` in the port, reconciliation in ledger, evidence, export and `guarded`. `core/test/outcome-unknown.test.ts` (7 tests; `AmbiguousStore` commits then throws, or throws without committing) |
| An S3 retry after a lost PutObject answer gets 412 on our own key; the stored bytes were orphaned with no quarantine record. Same for post-write checks | Medium | Fixed: any `putNew` failure quarantines the object key (version unknown) |
| ADR claims: `ClientRequestToken` wording, "never the application path", missing SSE-KMS permissions | Medium | Fixed above. SDK idempotency trait checked in the installed schema; PutItem authorization checked against the AWS API reference |
| Empty keys behave differently (`NOT_FOUND` in memory, `STORAGE_UNAVAILABLE` on DynamoDB) | Low | Fixed: both adapters return undefined for reads and refuse writes; contract tests added. Lone-surrogate keys not tested (domain keys are validated ASCII) |
| Concurrency tests cannot show real DynamoDB conflict behavior; all racers can lose | Low | Documented in the contract test; the real-table run must assert "at most one". No ledger retry added: callers already get `LEDGER_CONFLICT` and can retry |
| Real S3 version-ID format unverified; `getVersion` accepted a response without a version header | Low | Header now required (test added). Format stays strict on purpose (IDs appear in export paths); a mismatch now quarantines instead of orphaning. Check in the real-bucket run |
| DynamoDB Local launcher could leave Java running; setup trusted a same-CDN checksum of an unpinned "latest" archive | Low | Child killed on exit, SIGINT and SIGTERM. README records the hash verified on November 18 |
| Value fidelity untested on some write paths; read-checksum corruption untested | Info | `MemoryStore` now enforces the JSON rule, so every core write path is checked; read corruption is caught by the domain's own SHA-256 |

## Real AWS run (T14b, November 18)

Approved and run as a least-privilege role; 23/23 passed and everything was torn down the same day (`docs/research/2026-11-18-t14b-real-aws-report.md`). Confirmed on real services: the port contract, the whole domain with a VERIFIED export, contiguous chains under 20-way contention, SDK retry idempotency with the automatic token, the least-privilege DynamoDB set, every bucket-policy denial, `If-None-Match` and checksum refusal, the version ID format (32 characters, `A-Z a-z 0-9 . _`), and that an app-credential raw overwrite succeeds but is caught by the verifier and by the table stream with no false alarms.

## Not verified

- Behavior under replication lag or throttling; Object Lock COMPLIANCE mode; customer managed KMS keys; production-scale load.
- 409 `ConditionalRequestConflict` was not observed (20 concurrent puts gave 1 success and 19 x 412); the adapter still treats it as a thrown error.
- An `OUTCOME_UNKNOWN` append can still commit later if the request was in flight when the slot was read. A retry with the same idempotency key resolves it; without one, the client must list before re-uploading. The error message says so.
