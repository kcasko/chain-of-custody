# T14b: Real AWS run for the storage adapters (plan, not approved)

Status: **plan only, nothing created.** Prepared November 18, 2026 at Keith's request. Every AWS step below needs his approval first. Expected cost: about 2 cents; worst case about $1.25.

## Goal

Answer the "Not verified" list in ADR 0007 on real services, with the application's least-privilege role rather than an admin:

| ID | Question | Pass condition |
|---|---|---|
| R1 | Does the shared port contract hold on real DynamoDB? | Every contract test passes; the two concurrency tests assert **at most one** winner (real DynamoDB can cancel every racer) |
| R2 | Does the whole domain run on DynamoDB plus S3 together? | Fixtures registered, custody transfer, checkpoint, approved export; `verifyExport` returns VERIFIED and FRESH |
| R3 | How does the ledger behave under real contention? | 5 rounds of 20 concurrent appends: chain contiguous, every loser `LEDGER_CONFLICT`, no `OUTCOME_UNKNOWN`. Record the win rate and `TransactionConflict` count |
| R4 | Is the SDK's automatic `ClientRequestToken` really idempotent across retries? | A test middleware discards the first successful `TransactWriteItems` response and forces one retry: the call returns ok, exactly one event is written, no CONFLICT |
| R5 | Is the least-privilege DynamoDB policy enough, and does it block what ADR 0007 says it blocks? | App role transactions succeed with only `GetItem`, `Query`, `PutItem`, `ConditionCheckItem`. `DeleteItem`, `UpdateItem`, `BatchWriteItem`, `DeleteTable` return AccessDenied |
| R6 | Can the app role overwrite a ledger event directly, as ADR 0007 now states? | Raw `PutItem` over an event **succeeds** (confirms the documented risk), the stream shows a `MODIFY` record for `pk = events`, and `verifyExport` returns FAILED with `EVENT_HASH_MISMATCH` |
| R7 | Does S3 refuse an overwrite with `If-None-Match: *`? | Second `putNew` to the same key throws `ObjectExistsError` (HTTP 412); the first version is unchanged |
| R8 | Does the bucket policy force conditional writes and block deletes for the app role? | App role: PutObject without `If-None-Match` is AccessDenied; `DeleteObject` (with and without a version ID), `PutObjectRetention`, `PutBucketVersioning` are AccessDenied |
| R9 | Does S3 reject corrupted uploads? | PutObject with a wrong `x-amz-checksum-sha256` returns `BadDigest`; nothing stored |
| R10 | Do real S3 version IDs fit `VERSION_ID` (`[A-Za-z0-9._-]{1,128}`)? | All version IDs from about 60 puts match. **If any do not:** stop, record them, and bring a decision to Keith (widen the pattern and re-check export paths, or map IDs); do not change the pattern during the run |
| R11 | What happens with concurrent conditional puts to one new key? | 20 parallel `putNew` calls: exactly one success, the rest `ObjectExistsError` or a thrown 409 `ConditionalRequestConflict`. Record the mix |
| R12 | Read-your-write with consistent reads | 200 write-then-read pairs all read their own write. **Honest limit:** this cannot prove replication-lag behavior, only that nothing contradicts it |

Not tested: suspended versioning (impossible on an Object Lock bucket; covered by the local test), Object Lock compliance mode (see the decision below), real throttling.

## Stage 0: local preparation (free, no approval needed)

1. Add `adapters/aws/test/real-aws.test.ts`, skipped unless `COC_REAL_AWS=1` plus `COC_TEST_TABLE`, `COC_TEST_BUCKET` and `AWS_REGION` are set. It reuses the shared contract (with an "at most one" option) and adds R2 to R12. Results go to a JSON file with account IDs and ARNs redacted to the last 4 digits.
2. Add `scripts/t14b/` with the exact CLI inputs below (table definition, bucket policy, role trust and inline policy, budget), so the run is copy-and-check rather than improvised.
3. `npm test` must still pass with the real-AWS file skipped.

## Stage 1: safeguards (free)

| Item | Detail |
|---|---|
| Budget `coc-t14-storage` | COST, MONTHLY, **$3**. Filter: Service in {Amazon DynamoDB, Amazon Simple Storage Service}. Alerts: ACTUAL 50% and 100%, FORECASTED 100%, to the existing alert address (not written in the repo). Monitoring budgets are free. |
| Existing `coc-t09-account-guard` | $45 per month, whole account. Kept; catches a misspelled service filter. |
| Time box | Two hours from first create to teardown, same day. |
| Tags on everything | `Project=chain-of-custody`, `Task=T14b`, `Owner=keith`, `DeleteBy=<run date + 1>` |
| Region | us-east-1 only (same as T09) |

Honest limit (same as T09): budget data refreshes about once a day. The time box and same-day teardown are the real safeguards.

## Exact resources

| Resource | Configuration | Cost | Teardown |
|---|---|---|---|
| DynamoDB table `coc-t14-adapter-test` | Exactly `tableDefinition()` (on-demand, `pk`/`sk` strings). Streams on, NEW_AND_OLD_IMAGES (for R6). SSE with the AWS owned key. PITR off and deletion protection off (test table; both are production settings for T12). | Request-based; see estimate | `delete-table` |
| S3 bucket `coc-t14-evidence-<8 random hex>` | Object Lock enabled at creation (which turns on versioning). Default retention **GOVERNANCE, 1 day**. Block Public Access on. SSE-S3. Bucket policy below. | Pennies | Delete every version with governance bypass (admin only), then delete the bucket |
| IAM role `CocT14AdapterTestRole` | Trust: only the SSO AdministratorAccess role, `sts:AssumeRole`, max session 1 hour. Inline policy below. No managed policies. | Free | `delete-role-policy`, `delete-role` |

**IAM inline policy for `CocT14AdapterTestRole`:**

- Allow `dynamodb:GetItem`, `dynamodb:Query`, `dynamodb:PutItem`, `dynamodb:ConditionCheckItem` on the table ARN only.
- Explicit deny on the table: `DeleteItem`, `UpdateItem`, `BatchWriteItem`, `DeleteTable`, `UpdateTable`, `PartiQLUpdate`, `PartiQLDelete`.
- Allow `s3:PutObject`, `s3:GetObject`, `s3:GetObjectVersion` on `bucket/*` only.
- Nothing else: no stream read, no list, no IAM. Stream checks for R6 run as admin.

**Bucket policy** (deny statements scoped to `CocT14AdapterTestRole` only, so admin teardown is never locked out):

- Deny `s3:PutObject` when `"Null": {"s3:if-none-match": "true"}`. This is the pattern on AWS's "Enforce conditional writes on Amazon S3 buckets" page, checked November 18.
- Deny `s3:DeleteObject`, `s3:DeleteObjectVersion`, `s3:PutObjectRetention`, `s3:PutObjectLegalHold`, `s3:BypassGovernanceRetention`, `s3:PutBucketVersioning`, `s3:PutBucketPolicy`, `s3:PutBucketObjectLockConfiguration`.
- Deny any request with `aws:SecureTransport = false` (all principals).

## Decision for Keith: Object Lock mode for the test bucket

| Option | Effect | Recommendation |
|---|---|---|
| **GOVERNANCE, 1-day retention** | The app role cannot shorten retention or delete (it lacks `BypassGovernanceRetention`, and the bucket policy denies it anyway). The admin can bypass, so teardown is same-day. | **Recommended.** For the app role it tests the same protection as production. |
| COMPLIANCE, 1-day retention | Nobody can delete the objects for 24 hours, including root. Teardown waits a day. The cost of the extra day is negligible. | Only if you want compliance mode itself on record before T12. |

## Cost estimate

Computed by script from the Price List API (us-east-1, November 18, 2026): DynamoDB on-demand $0.625 per million write request units, $0.125 per million read request units, first 25 GB-months of storage free. S3 Standard $0.005 per 1,000 PUT, $0.004 per 10,000 GET, $0.023 per GB-month. Transactional writes count double.

| Case | Assumption | Cost |
|---|---|---|
| Typical | 3 full runs, about 7,300 write units and 9,900 read units per run, about 80 PUTs and 200 GETs | **about $0.02** |
| Worst case | 20 runs at 10 times that usage | **about $1.25** |
| Storage, streams, budget, IAM | A few MB for one day; stream reads only from the CLI; one monitoring budget | under $0.01 |

## Run sequence

1. Create budget `coc-t14-storage` (Stage 1).
2. Create the role, then the table (wait for ACTIVE), then the bucket with Object Lock, versioning check, Block Public Access and the bucket policy. Confirm each with a describe or get call before the next step.
3. Assume `CocT14AdapterTestRole` for 1 hour. Its credentials go only into environment variables of the test process; nothing is written to disk or the repo.
4. Run `COC_REAL_AWS=1 node --test adapters/aws/test/real-aws.test.ts`. Stop at the first failure of R5, R7 or R8 (a security property) and report before running anything else.
5. As admin, read the table stream for the R6 `MODIFY` record.
6. Record results in `docs/research/2026-11-xx-t14b-real-aws-report.md` with redacted evidence JSON.
7. Teardown, then the inventory below.

## Teardown (same day, in this order)

1. Delete every object version in the bucket with `--bypass-governance-retention` (admin), then `delete-bucket`.
2. `delete-table --table-name coc-t14-adapter-test`.
3. Delete the role's inline policy, then the role.
4. Keep budget `coc-t14-storage` until December 31 to catch late charges.
5. Read-only inventory:
   - `aws dynamodb list-tables --region us-east-1` (no `coc-t14-*`)
   - `aws s3api list-buckets --query "Buckets[?starts_with(Name, 'coc-t14')]"` (empty)
   - `aws iam get-role --role-name CocT14AdapterTestRole` (NoSuchEntity)
   - `aws resourcegroupstaggingapi get-resources --tag-filters Key=Task,Values=T14b --region us-east-1` (empty; the tagging index can lag a few minutes)

If teardown is interrupted, the `DeleteBy` tag and this list are the recovery path. Nothing here keeps billing beyond a few cents of storage.

## Approvals needed (one decision each)

1. Stage 0 code (free, local). I can do this before any approval if you want it ready.
2. Object Lock mode: GOVERNANCE (recommended) or COMPLIANCE.
3. Stage 1: create budget `coc-t14-storage` ($3).
4. Create the three resources above, run R1 to R12, and tear down the same day. Spending cap: the $3 budget.

Not requested and not included: any public access, any change to existing roles or budgets, any resource outside us-east-1, any BMA or Bedrock call.
