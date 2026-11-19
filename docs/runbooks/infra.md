# Runbook: CDK infrastructure (T12)

**Nothing here has been deployed.** Synth and the template tests run locally with no AWS access. Every command that creates, changes or deletes AWS resources needs Keith's approval for that run, with a cost estimate and a teardown plan, like T09 and T14b.

## What the app contains

| Stack | Resources | Verified live by |
|---|---|---|
| `CocTestStorage` / `CocStorage` | Ledger table (stream on), evidence bucket and ledger archive bucket (Object Lock, versioned, private, TLS only, create-only puts, destructive actions only for break-glass), archiver Lambda on the stream, tamper and stalled-archiver alarms with an SNS topic, the T14b writer policy | Table, evidence bucket, policies and IAM: T14b. Archive and alarms: local tests only (ADR 0008) |
| `CocTestGateway` / `CocGateway` | Core-backed tool Lambda (`infra/lambda/tools.ts`, T16: the domain core over the ledger table, the evidence bucket and the durable audit log, with its own narrow role), AgentCore policy engine (ENFORCE), Gateway (AWS_IAM, MCP 2025-03-26), one Lambda target, 11 Cedar policies in the verified load order, caller permission | Gateway, engine and Cedar: Stage B (T09B), deployed by hand with the stub Lambda. The core-backed Lambda: DynamoDB Local and S3 fake tests only. This CDK version has not been deployed |

The gateway stack imports the ledger table and evidence bucket from the storage stack, so deploy storage first and destroy it last.

## Configuration (CDK context)

| Key | Default | Notes |
|---|---|---|
| `stage` | `test` | `test`: GOVERNANCE Object Lock, 1-day logs, table destroyed on stack delete, DEBUG gateway errors. `prod`: COMPLIANCE Object Lock, PITR, deletion and termination protection, everything retained |
| `account` | `CDK_DEFAULT_ACCOUNT` | 12 digits; never committed |
| `region` | `us-east-1` | |
| `harness` | `false` | `true` creates `CocTestHarnessRole` and makes it the only role the Cedar boundary admits (Stage B style) |
| `sessionRoleName` | `CocBmaSessionRole` | When `harness=false`, deploy attaches one inline policy to this existing role: `InvokeGateway` on this gateway only |
| `breakGlassPrincipalArn` | the SSO AdministratorAccess role pattern | Only principal allowed destructive S3 actions on the locked buckets |
| `objectLockDays` | 1 (test), 365 (prod) | **COMPLIANCE retention cannot be shortened or removed by anyone, including root** |
| `alarmEmail` | none | Pass on the command line at deploy; never commit it |

## Synth and test (free, no AWS)

```bash
npm run typecheck
```

```bash
node --test infra/test/infra.test.ts
```

```bash
cd infra && npx cdk synth -c account=111111111111 --quiet -o ../.local/cdk.out
```

## Deploy (needs approval)

1. Bootstrap once per account and region (creates the CDK staging bucket and roles; small storage cost): `npx cdk bootstrap aws://<account>/us-east-1`. Not done yet: T09 found the account is not bootstrapped.
2. `cd infra && npx cdk diff -c stage=test` and review every IAM and bucket policy change.
3. `npx cdk deploy CocTestStorage CocTestGateway -c stage=test -c harness=true [-c alarmEmail=...]`. Use `harness=true` until BMA access exists (RB-1): the harness role stands in for the BMA session role.
4. Seed the synthetic evidence once, as an investigator, with credentials that carry the stack's writer policy: `TABLE_NAME=<LedgerTableName> EVIDENCE_BUCKET=<EvidenceBucketName> AWS_REGION=us-east-1 node infra/scripts/seed-evidence.ts --as owen.hale --confirm --out .local/versions.json`. It refuses to run on a case that already has ledger events. The investigator ID is asserted by the operator, not authenticated; note who ran it.
5. Smoke checks:
   - the Stage B scenarios through the **core-backed** Lambda, the first time on AWS: write `.local/stage-b-core.json` (region, gateway URL, harness role ARN, policy engine ID, table, evidence bucket, `versionsFile`: `.local/versions.json`), then `npm run harness:stage-b-core`. It runs the 24 scenarios one at a time and checks each by its effects: the tool response, the `audit` records the call left (none when Cedar stopped it; otherwise all `agent:coc-audit-agent` under one Gateway request ID), the findings and drafts it added (exactly one for the write tools, none otherwise), and a ledger head that never moves. Plus the unsigned and other-principal probes. Expected: 29 of 29, as in the local run (`adapters/aws/test/stage-b-core.test.ts`). The report goes to `docs/research/t19-evidence/stage-b-core-live.json` with account IDs redacted. Run it in a quiet environment: the per-call checks assume no other traffic. Most Cedar refusals show as default deny (no permit's argument constraints matched), as in the verified Stage B run; the local test proves those calls would otherwise reach the Lambda;
   - the tool Lambda's audit records: `audit` items for `BLACKWATER-2021` attributed to `agent:coc-audit-agent` under the Gateway request IDs;
   - one archive round trip: a new event appears as `ledger/events/...` and each audit record as `ledger/audit/...` in the archive bucket;
   - one denied write by the tool role (for example `UpdateItem` on the table), expected `AccessDenied`.

## Teardown (test stage)

1. `npx cdk destroy CocTestGateway`.
2. `npx cdk destroy CocTestStorage`. The table and log groups are deleted; **both Object Lock buckets are retained** because CloudFormation cannot delete locked versions.
3. As the break-glass principal: delete every object version in each bucket with `BypassGovernanceRetention`, then delete the bucket (the same procedure as T14b).
4. Inventory: no `coc-test-*` table, bucket, Lambda, gateway, policy engine or role; no resources tagged `Stage=test`.

`prod` stacks are not meant to be torn down; COMPLIANCE-locked objects stay until their retention ends.

## Known limits

- The core-backed tool Lambda (T16) replaced the Stage B stub in the template. It has been tested locally and its bundle loads, but it has not run on AWS.
- The seed script, the T19 runner (`harness/run-stage-b-core.mts`) and the archive round trip have not been run against AWS. The T19 runner passes 29 of 29 locally against the real Cedar policies and the real handler, and fails as it should when Cedar is bypassed, a handler leaks an attack, or attribution is wrong.
- `npm run harness:stage-b` (the original runner) still targets the stub Lambda; use `harness:stage-b-core` for this stack.
- `npm audit` reports a moderate `minimatch` advisory inside `aws-cdk-lib` (dev dependency, synth time only, our own glob patterns). The suggested fix downgrades `aws-cdk-lib` to 2.239.0. Accepted; revisit when `aws-cdk-lib` updates its bundled copy.
- Multipart uploads are blocked by the create-only bucket rule (UploadPart has no `If-None-Match`). Evidence is capped at 10 MiB and uploaded in one request, so this is intended.
