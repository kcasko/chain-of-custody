# Runbook: CDK infrastructure (T12)

**Nothing here has been deployed.** Synth and the template tests run locally with no AWS access. Every command that creates, changes or deletes AWS resources needs Keith's approval for that run, with a cost estimate and a teardown plan, like T09 and T14b.

## What the app contains

| Stack | Resources | Verified live by |
|---|---|---|
| `CocTestStorage` / `CocStorage` | Ledger table (stream on), evidence bucket and ledger archive bucket (Object Lock, versioned, private, TLS only, create-only puts, destructive actions only for break-glass), archiver Lambda on the stream, tamper and stalled-archiver alarms with an SNS topic, the T14b writer policy | Table, evidence bucket, policies and IAM: T14b. Archive and alarms: local tests only (ADR 0008) |
| `CocTestGateway` / `CocGateway` | Stage B tool stub Lambda, AgentCore policy engine (ENFORCE), Gateway (AWS_IAM, MCP 2025-03-26), one Lambda target, 11 Cedar policies in the verified load order, caller permission | Stage B (T09), deployed by hand then; this CDK version has not been deployed |

The two stacks share nothing, so either can be deployed or destroyed alone.

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
3. `npx cdk deploy CocTestStorage CocTestGateway -c stage=test [-c harness=true] [-c alarmEmail=...]`.
4. Smoke checks: the Stage B scenarios (`npm run harness:stage-b`) with the harness role; one archive round trip (write an event, see `ledger/events/...` in the archive bucket).

## Teardown (test stage)

1. `npx cdk destroy CocTestGateway`.
2. `npx cdk destroy CocTestStorage`. The table and log groups are deleted; **both Object Lock buckets are retained** because CloudFormation cannot delete locked versions.
3. As the break-glass principal: delete every object version in each bucket with `BypassGovernanceRetention`, then delete the bucket (the same procedure as T14b).
4. Inventory: no `coc-test-*` table, bucket, Lambda, gateway, policy engine or role; no resources tagged `Stage=test`.

`prod` stacks are not meant to be torn down; COMPLIANCE-locked objects stay until their retention ends.

## Known limits

- The tool Lambda is the Stage B stub. The core-backed handler needs a durable audit adapter before it can replace it.
- `npm audit` reports a moderate `minimatch` advisory inside `aws-cdk-lib` (dev dependency, synth time only, our own glob patterns). The suggested fix downgrades `aws-cdk-lib` to 2.239.0. Accepted; revisit when `aws-cdk-lib` updates its bundled copy.
- Multipart uploads are blocked by the create-only bucket rule (UploadPart has no `If-None-Match`). Evidence is capped at 10 MiB and uploaded in one request, so this is intended.
