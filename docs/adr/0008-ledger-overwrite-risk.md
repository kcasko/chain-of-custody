# ADR 0008: Ledger overwrite risk: prevention, detection, recovery

Status: adopted, November 18, 2026. Code is local and tested; nothing deployed. Implements the follow-up from ADR 0007 and the T14b run.

## The risk

The application role must hold `dynamodb:PutItem`, because a Put inside `TransactWriteItems` is authorized as PutItem. IAM has no condition key that can require a condition expression. So anyone holding the application's credentials can overwrite a ledger item directly. T14b confirmed this on real AWS: the overwrite succeeded, the verifier reported FAILED, and the table stream recorded exactly one `MODIFY` on an append-only table.

Who can do it: someone who has stolen the tool Lambda's credentials, or an operator with table write access. **Not** the agent (it has no AWS credentials; ADR 0003, Stage B), not a human user through the API (every write goes through the core), and not the application code itself (create-only conditions on every append-only write).

## Options considered

| Option | Stops an app-credential overwrite? | Complexity | Verdict |
|---|---|---|---|
| IAM conditions on PutItem | No: no condition key covers the condition expression | None | Not possible |
| Separate writer service with its own role | No: that role still needs PutItem | Medium (another hop) | Moves the risk, does not remove it |
| Sign every event with KMS | No: overwrite still possible, only detection improves, which the hash chain and signed checkpoints already give | Medium, per-event KMS cost and latency | Rejected |
| Managed ledger database (QLDB) | Yes for its own journal | High: new service. From memory, AWS is retiring QLDB; not re-verified today | Rejected |
| S3 as the only ledger store | Yes (Object Lock plus If-None-Match) | High: no transactions across head, events and idempotency; the core would need a new concurrency design | Rejected for now |
| **Stream-fed write-once archive in an Object Lock bucket** | **Yes, for the archived original of every event.** The working copy in DynamoDB can still be altered, but the first committed image cannot be changed or deleted, and any change raises an alarm within seconds | **Low: one Lambda (about 100 lines, 6 tests), one bucket, one stream mapping, one alarm** | **Adopted** |

## Decision

1. **Prevention.** `adapters/aws/src/ledger-archive.ts` consumes the table stream and writes the new image of every append-only item once, to `ledger/<table>/<key>` in an Object Lock bucket, always with `If-None-Match: *`. Only the archiver's role can write there. Its bucket policy denies unconditional puts, deletes, retention changes and versioning changes. The application role, the agent and human users have no access at all. Object Lock mode is a deployment choice: GOVERNANCE with short retention for test stacks (same-day teardown), COMPLIANCE for anything that holds a real record (nobody, including root, can delete before retention ends).
2. **Detection.** The archiver logs `APPEND_ONLY_TAMPER` for any MODIFY or REMOVE on an append-only table, and `ARCHIVE_CONFLICT` if a key was already archived with different bytes. A metric filter turns both into a CloudWatch alarm. An alarm on the stream's iterator age catches a stalled archiver before the 24-hour stream retention runs out. The existing layers stay: the hash chain and signed checkpoints make any rewrite visible to the independent verifier.
3. **Recovery.** The archived original is the source of truth for any event. Before and after images of each tamper are archived under `tamper/<table>/<key>/<sequence>` for the investigation. DynamoDB point-in-time recovery is on in every non-test stack, so the whole working table can be restored to a time before the tamper.

## What this still does not cover

- An attacker with app credentials can still **append** forged events through a legitimate-looking transaction. That is not an overwrite. It is limited by actor attribution in each event, the audit log and human review; it is unchanged by this ADR.
- If the archiver is stalled for more than 24 hours, unarchived stream records are lost. The iterator-age alarm exists for this.
- A tool that rebuilds a case or compares the working table against the archive is not built yet. Until it is, recovery is a documented procedure, not a command.
- The archiver has run only against tests with an in-memory S3, not on real AWS. Its infrastructure (stream mapping, bucket policies, alarms) is defined in `infra/lib/storage-stack.ts` and covered by template tests, but not deployed.

## Verification

`adapters/aws/test/ledger-archive.test.ts`: archive once; ignore mutable tables; a redelivered record is a no-op; an overwrite raises the alarm, keeps the original and records both images; a removal raises the alarm; a pre-written key with different bytes raises `ARCHIVE_CONFLICT` and is never overwritten; only failed records are retried.
