# T20: Test deploy of the CDK stacks with the core-backed tool Lambda (plan, not approved)

Status: **proposed November 18, 2026. Not approved, nothing created.** Expected cost about 3 cents; computed worst case about $1.56. Same-day teardown.

## Goal

Move the parts that are "tested locally only" to "verified on AWS", using the stand-in harness role in place of the BMA session role (RB-1 still blocks BMA). This does **not** make the project a qualifying BMA submission.

| ID | Question | Pass condition |
|---|---|---|
| D1 | Do the synthesized stacks deploy cleanly in the verified order? | `CocTestStorage`, then `CocTestGateway`, both `CREATE_COMPLETE`. The policy chain loads: boundary forbids first, then permits, then tool forbids. `cdk diff` before deploy shows only the 43 expected resources and no change to any existing role |
| D2 | Does the core-backed tool Lambda work behind the real Gateway and Cedar? | `npm run harness:stage-b-core`: **29 of 29**, as in the local run. Each call is checked by its response, its durable audit records (agent principal, one Gateway request ID), the findings and drafts it adds, and an unmoving ledger head |
| D3 | Does the Gateway pass its request ID to the Lambda? | Every audit record from D2 carries a Gateway request ID, never the `local-` fallback (part of D2) |
| D4 | Does the `LeadingKeys` restriction (review finding 1) hold on AWS? | IAM policy simulator on the tool role: `PutItem` with `dynamodb:LeadingKeys=approvals`, `heads` or `events` is denied, and with `audit`, `findings` or `proposals` it is allowed. `UpdateItem` and `DeleteItem` are denied. D2 passing proves the allowed set is enough at runtime |
| D5 | Does the archive capture records on AWS? | After the seed and D2: objects under `ledger/events/` (12 registrations) and `ledger/audit/` in the archive bucket |
| D6 (optional, Keith decides) | Does tamper detection fire on AWS? | As admin, overwrite one `audit` item with a raw `PutItem`. Within about 10 minutes: a `tamper/audit/...` object holding the before and after images, and the `APPEND_ONLY_TAMPER` alarm in `ALARM`. ADR 0008's detection layer is currently verified only locally |
| D7 | Does the seed script work on AWS, and refuse a second run? | 12 versions registered; ledger head #12; `--out` file written; a second run exits 1 without writing |

Not tested: anything involving BMA or a model; COMPLIANCE-mode Object Lock (the test stage uses GOVERNANCE, 1 day); the production stage; alarm e-mail delivery (no `alarmEmail` given).

## Stage 0: local preparation (free, done)

- T19 runner (`harness/run-stage-b-core.mts`) and its local test: 29 of 29 against the real Cedar policies and handler.
- `infra/scripts/seed-evidence.ts --out`.
- Budget template `scripts/t20/budget.json`.
- `npm test` 409/409, `npm run test:e2e` 14/14, typecheck clean.

## Stage 1: safeguards (free)

| Item | Detail |
|---|---|
| Budget `coc-t20-deploy` | COST, MONTHLY, **$3**. Filter: DynamoDB, S3, Lambda, CloudWatch, Bedrock AgentCore, SNS (`scripts/t20/budget.json`; exact service names confirmed in the console picker at creation). Alerts: ACTUAL 50% and 100%, FORECASTED 100%, to the existing alert address (not in the repository). |
| Existing `coc-t09-account-guard` | $45 per month, whole account. Kept. |
| Time box | Three hours from first create to finished teardown, same day. |
| Tags | The stacks already tag `Project=chain-of-custody`, `Stage=test`, `ManagedBy=cdk`. Add `Task=T20` and `DeleteBy=<run date + 1>` on the command line. |
| Region | us-east-1 only. |

Budget data refreshes about once a day, so the time box and same-day teardown are the real safeguards (as in T09 and T14b).

## Decision for Keith: how to bootstrap CDK

The account has never been bootstrapped (T09). `cdk bootstrap` creates the `CDKToolkit` stack: a staging bucket for the two Lambda bundles (about 3.2 MB), an ECR repository (unused here), an SSM parameter, and roles. By default, its CloudFormation execution role has **AdministratorAccess**, and its deploy roles can be assumed by principals in this account.

| Option | Effect | Recommendation |
|---|---|---|
| **A. Default bootstrap, deleted at teardown** | Standard and simple. The admin-level execution role exists only for the run, in a single-user account | **Recommended** for a same-day test |
| B. Bootstrap with `--cloudformation-execution-policies` scoped to the services in these stacks | Smaller blast radius if the deploy role were misused | Worth it if `CDKToolkit` will stay for later deploys (P0); adds setup and its own review |
| C. No CDK deploy: hand-deploy as in T09 | Avoids bootstrap | Not recommended: it would not verify the CDK app, which is the point of T20 |

## Exact resources

From the synthesized test stage with `harness=true` (43 resources, plus bootstrap):

| Stack | Resources | Standing cost | Teardown |
|---|---|---|---|
| `CDKToolkit` | Staging bucket (versioned, retained), ECR repository, SSM parameter, 5 IAM roles | Pennies of storage | `cdk`-independent: delete the stack, then empty and delete the retained staging bucket (and the ECR repository if it remains) |
| `CocTestStorage` | Ledger table `coc-test-ledger` (on demand, stream on, PITR off, destroyed on stack delete). Evidence bucket and archive bucket: Object Lock GOVERNANCE 1 day, versioned, private, TLS only, create-only puts, destructive actions only for break-glass. Both retained by CloudFormation. Archiver Lambda on the stream. Metric filter, 3 alarms, SNS topic. Writer managed policy | 3 alarms at $0.10 per alarm-month | `cdk destroy`, then empty both buckets with governance bypass as break-glass and delete them |
| `CocTestGateway` | Core-backed tool Lambda (512 MB, Arm) with its own narrow role. AgentCore policy engine `coc_test_policy` in ENFORCE. Gateway `coc-test-gw` (AWS_IAM, MCP 2025-03-26, DEBUG errors in test). Target `EvidenceTools`. 11 Cedar policies in chained order. `CocTestHarnessRole`, trusted only by the SSO AdministratorAccess role, 1-hour sessions, `InvokeGateway` on this gateway only | Tool indexing, $0.0002 per tool-month | `cdk destroy` |

With `harness=true` the stack does **not** touch `CocBmaSessionRole`. No public endpoints, no VPC, no NAT gateway.

## Cost estimate

Computed by script from the Price List API, us-east-1, November 18, 2026:

| Service | Price |
|---|---|
| Gateway | $0.000005 per call; tool indexing $0.0002 per tool-month |
| Policy | $0.000025 per authorization |
| Lambda on Arm | $0.20 per million requests; $0.0000133334 per GB-second |
| DynamoDB | $0.625 per million write units; $0.125 per million read units |
| S3 | $0.005 per 1,000 PUTs; $0.004 per 10,000 GETs |
| CloudWatch | $0.10 per alarm-month; $0.50 per GB of logs |

| Case | Assumption | Cost |
|---|---|---|
| One runner pass | 32 Gateway calls, 26 authorizations, 16 tool and 60 archiver invocations, 400 write and 4,000 read units, 300 archive PUTs (all rounded up) | about $0.006 |
| **Typical** | Seed, 3 passes, standing items for one day | **about $0.03** |
| Worst case | 3 seeds, 20 passes at 10 times the traffic, standing items left a full month | **about $1.56** |
| Teardown forgotten | Standing items only | about $0.30 per month (almost all alarms) |

## Run sequence (each step confirmed before the next)

1. Create budget `coc-t20-deploy` (Stage 1).
2. Pre-checks, all read-only:
   - confirm the account is not bootstrapped;
   - confirm no `coc-test-*` table, bucket, gateway or policy engine exists;
   - confirm the SSO role matches the break-glass pattern `AWSReservedSSO_AdministratorAccess_*`.
3. `npx cdk bootstrap aws://<account>/us-east-1` (option A or B above).
4. `cd infra && npx cdk diff -c account=<account> -c stage=test -c harness=true`.
   - Expect only the 43 resources above.
   - Review every IAM and bucket-policy statement against the template tests.
   - **Stop if anything else appears.**
5. `npx cdk deploy CocTestStorage CocTestGateway -c account=<account> -c stage=test -c harness=true --tags Task=T20 --tags DeleteBy=<date>`. The account ID goes on the command line only, never into a file.
6. D7: seed as `owen.hale` with `--out .local/versions.json`, then re-run once to confirm it refuses.
7. D5: list the archive bucket prefixes.
8. Write `.local/stage-b-core.json` from the stack outputs, then run D2 and D3 with `npm run harness:stage-b-core`. **Stop at the first failure** of the boundary probe, a Cedar scenario or attribution, and report before anything else.
9. D4: `aws iam simulate-principal-policy` on the tool role with the `dynamodb:LeadingKeys` context key, for each allowed and forbidden table.
10. D6, only if approved: one raw overwrite of an `audit` item as admin, then check the archive and the alarm.
11. Write `docs/research/2026-11-xx-t20-test-deploy-report.md`, with account IDs and bucket names redacted. The runner's JSON goes to `docs/research/t19-evidence/`.
12. Teardown, then the inventory.

## Teardown (same day, in this order)

1. `npx cdk destroy CocTestGateway -c account=<account> -c stage=test -c harness=true`.
2. `npx cdk destroy CocTestStorage ...`. The table, log groups, alarms and topic go; **both Object Lock buckets are retained**.
3. As break-glass: delete every object version in the evidence and archive buckets with `--bypass-governance-retention`, then delete both buckets (same procedure as T14b).
4. Delete `CDKToolkit`. Then empty and delete its retained staging bucket, and the ECR repository if it remains.
5. Delete `.local/stage-b-core.json` and `.local/versions.json`; they hold resource names.
6. Keep budget `coc-t20-deploy` until December 31 to catch late charges.
7. Read-only inventory:
   - `aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE` (no `CocTest*`, no `CDKToolkit`)
   - `aws dynamodb list-tables` (no `coc-test-*`)
   - `aws s3api list-buckets --query "Buckets[?starts_with(Name, 'coc-test') || starts_with(Name, 'cdk-')]"` (empty)
   - `aws bedrock-agentcore-control list-gateways` and `list-policy-engines` (no `coc-test*`)
   - `aws iam get-role --role-name CocTestHarnessRole` (NoSuchEntity)
   - `aws resourcegroupstaggingapi get-resources --tag-filters Key=Task,Values=T20` (empty; the index can lag)

If teardown is interrupted, the `DeleteBy` tag and this list are the recovery path. The standing cost of anything left behind is about $0.30 per month.

## Approvals needed (one decision each)

1. Stage 1: create budget `coc-t20-deploy` ($3).
2. CDK bootstrap: option A (recommended), B, or C.
3. Deploy the two stacks with `harness=true`, run D1 to D5 and D7, and tear everything down the same day. Spending cap: the $3 budget.
4. D6 tamper check: yes or no. It deliberately overwrites one test audit record, to prove the alarm fires on AWS.

Not requested and not included: the production stage, `alarmEmail`, any change to `CocBmaSessionRole` or existing budgets, any resource outside us-east-1, any BMA, Bedrock model or Marketplace call, any public endpoint.
