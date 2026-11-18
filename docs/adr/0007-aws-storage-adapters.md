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
- **Values stored as a JSON string, not a DynamoDB map.** Avoids number-precision and empty-value conversions. `encodeValue` refuses any value that would not round-trip exactly (undefined fields, Dates, typed arrays, NaN, -0) instead of silently changing it.
- **Strongly consistent reads everywhere.** Version checks against an eventually consistent read would be worthless. Not testable locally (DynamoDB Local is always consistent); it is set on every `GetItem` and `Query`.
- **`ClientRequestToken` on every transaction.** Without it, an SDK retry after a lost response could report a CONFLICT for a write that actually committed; the ledger would then tell the user nothing was written when it was.
- **`TransactionConflict` maps to CONFLICT**, like a failed condition: nothing was written and the caller may re-read and retry. Throttling, validation and network errors are thrown (fail closed).
- **No local S3 emulator.** None is official, and MinIO or similar would be a third-party download proving someone else's semantics. Instead the tests run the real `S3Client`, replace only its request handler, and check the serialized headers and query plus the adapter's mapping of S3's documented status codes.

## What storage can and cannot enforce

| Guarantee | DynamoDB | S3 |
|---|---|---|
| Create-only writes refused by the service | Yes (`attribute_not_exists`), tested | Yes (`If-None-Match`, 412), request tested, service not |
| Append-only tables | Adapter refuses before sending; service enforces create-only | Write-once keys; versions immutable |
| Protection from a principal with raw write access | **No.** IAM can deny `DeleteItem` and `UpdateItem`, but cannot stop `PutItem` overwriting an item. Test proves a raw rewrite succeeds | With Object Lock (compliance mode) and a bucket policy denying deletes and unconditional puts: yes |
| Detection after tampering | Hash chain and signed checkpoints. Test proves the verifier reports `FAILED` with `EVENT_HASH_MISMATCH` after a raw rewrite | Content hash in the ledger; verifier re-hashes |

So for the ledger the storage layer narrows the attack (only raw table access, never the application path) and the verifier is the guarantee. That matches ADR 0003 (L5 is defense in depth; L6 audit and the verifier are what prove integrity).

## Required infrastructure settings (for T12)

- DynamoDB: on-demand table per `tableDefinition()`, point-in-time recovery on, deletion protection on. Application role: `GetItem`, `Query`, `TransactWriteItems`/`PutItem` (with `dynamodb:LeadingKeys` limited if per-case keys are adopted); explicitly deny `DeleteItem`, `UpdateItem`, `DeleteTable`, `BatchWriteItem`.
- S3: versioning enabled, Object Lock in compliance mode with a retention period covering the event, block public access, SSE. Application role: `PutObject`, `GetObjectVersion`; bucket policy denies `DeleteObject*`, `PutBucketVersioning`, `PutObjectRetention` shortening, and `PutObject` without `If-None-Match` (`s3:if-none-match` condition key). Without `ListBucket`, a missing key returns 403, which the adapter treats as an error (fail closed). The domain only reads versions it has registered, so this only happens after tampering.

## Verification (November 18)

- `npm test`: 323/323, including the shared port contract run against `MemoryStore` and against DynamoDB Local 3.3.1 (in memory, random port, telemetry off), the whole domain (fixtures, custody, checkpoint, approved export, independent verify) on DynamoDB, six concurrent ledger appends producing one contiguous chain, and the domain on the S3 adapter.
- Manual mutation checks: removing the create condition, the version condition or the conflict mapping fails 4, 6 and 8 tests; removing `If-None-Match`, the `"null"` version check, the malformed-ID guard or the 412 mapping each fails at least one test. One mutation survives: removing the adapter's re-sort in `list`, because DynamoDB already returns ASCII keys in the same order. The sort stays as a guard for non-ASCII keys.
- DynamoDB Local has no bind-address option and listens on all interfaces while the tests run; it holds synthetic data only and CORS is limited to an unused origin. Windows may show a firewall prompt the first time.

## Not verified

- Real DynamoDB: consistent-read behavior under replication lag, throttling, and the `ClientRequestToken` retry path. Needs a test table (cents; approval required).
- Real S3: `If-None-Match` enforcement, checksum rejection, Object Lock, and 409 `ConditionalRequestConflict` under concurrent puts. Needs a test bucket (approval required).
- No independent review of this change yet; the self-review notes are above.
