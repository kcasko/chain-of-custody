# Chain of Custody: The Blackwater Evidence

Evidence can be questioned. Its history should never be rewritten.

A fictional forensic evidence audit project. An auditor investigates inconsistencies in records from a 2021 research-facility fire in northern Michigan, reopened during a 2026 archive migration. The agent audits support for claims; it never decides guilt or rewrites originals.

**Status (November 18, 2026):** the investigation application is complete as a local demonstration, and its security controls are tested and independently reviewed. The AWS adapters, the durable audit log and the deployable tool Lambda are tested locally against DynamoDB Local and an S3 fake. The CDK stacks are synthesized and tested, not deployed. **The agent ran on the AgentCore managed harness** on November 19, 2026: it did its audit job and held every protected-state rule in two stress runs of 9 prompts ([T21 report](docs/research/2026-11-19-t21-agent-run-report.md), [ADR 0010](docs/adr/0010-agentcore-managed-harness.md)). Everything was torn down afterward. **Not yet submitted:** publication needs Keith's decisions and approvals. What is done and what remains: [docs/SUBMISSION.md](docs/SUBMISSION.md).

## Setup

Needs Node.js 24 (it runs TypeScript directly) and npm. Optional: Java 17+ and DynamoDB Local for the DynamoDB tests. Without them those tests report as skipped, with the reason; see [adapters/aws/README.md](adapters/aws/README.md).

```bash
npm ci
```

```bash
npx playwright install chromium
```

## Run the demo

```bash
npm run demo
```

Open http://127.0.0.1:4317 and follow [docs/DEMO.md](docs/DEMO.md), about 10 minutes covering all nine workflow steps.
- **Identity:** the server listens on loopback only. There is no login: you choose which synthetic staff member you act as, and the core authorizes and audits each action as that person.
- **Agent pass:** a scripted replay of seven tool calls through the real tool handler. It is not a model and not evidence of Bedrock Managed Agents behavior.
- **Integrity Challenge** (http://127.0.0.1:4317/challenge): 28 attempts (21 attacks, 7 legitimate), showing which layer refused each attack and proving the evidence and history are unchanged.

To verify a downloaded export offline: `npm run verify:export -- <package.json> <trust.json>`.

## Test

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run test:e2e
```

## Teardown

- **Local:** stop `npm run demo` with Ctrl+C. All demo state is in memory and disappears.
- **Disk:** DynamoDB Local tests use a temporary in-memory instance. Playwright traces and CDK assets go to the git-ignored `.local/` folder, which is safe to delete.
- **AWS:** nothing is deployed. The deploy and teardown procedure, which needs approval, is in [docs/runbooks/infra.md](docs/runbooks/infra.md).

**Release blockers:** RB-4 (publication decisions and approvals) is primary; RB-3 is resolved; RB-1 (BMA refused for this account) no longer blocks. See [docs/RELEASE-BLOCKERS.md](docs/RELEASE-BLOCKERS.md).

## Documents

- [Submission readiness: complete, blocked, unverified](docs/SUBMISSION.md)
- [Demo walkthrough](docs/DEMO.md)
- [Security controls and limitations](docs/SECURITY-LIMITATIONS.md)
- [Project plan](docs/PROJECT-PLAN.md)
- [Case bible](docs/CASE-BIBLE.md)
- [Architecture, with diagram and trust boundaries](docs/ARCHITECTURE.md)
- [Security rules](docs/SECURITY-RULES.md)
- [Test strategy](docs/TEST-STRATEGY.md)
- [Collaboration setup and commands](docs/COLLABORATION.md)
- [Task board](docs/TASKS.md)
- [BMA feasibility research (Nov 18)](docs/research/2026-11-18-bma-feasibility.md)
- [ADR 0003: BMA integration and enforcement layers (adopted)](docs/adr/0003-bma-integration-and-enforcement-layers.md)
- [ADR 0004: Agent tools and Cedar policy](docs/adr/0004-agent-tools-and-cedar-policy.md) (`npm test` runs the policy suite)
- [T09 spike plan](docs/plans/2026-11-19-t09-bma-spike.md) and [report: BMA blocked by account access; Stage B enforcement stack verified](docs/research/2026-11-18-t09-spike-report.md)
- [ADR 0005: Domain core](docs/adr/0005-domain-core.md) and [verification spec v1](docs/specs/canonicalization-and-verification-v1.md)
- [ADR 0007: DynamoDB and S3 adapters](docs/adr/0007-aws-storage-adapters.md) and [adapter test setup](adapters/aws/README.md)
- [ADR 0008: Ledger overwrite risk (prevention, detection, recovery)](docs/adr/0008-ledger-overwrite-risk.md) and [T14b real AWS report](docs/research/2026-11-18-t14b-real-aws-report.md)
- [CDK infrastructure runbook: deploy and teardown (not deployed)](docs/runbooks/infra.md)
- [ADR 0009: Investigation workspace (T17)](docs/adr/0009-investigation-workspace.md)
- [Release blockers](docs/RELEASE-BLOCKERS.md) (primary: RB-1, Bedrock Managed Agents access)
- [Stage B harness](harness/README.md) and [BMA access request drafts](docs/plans/2026-11-18-bma-access-requests.md)
- [Original planning source](docs/source/ORIGINAL-BLUEPRINT.md)

Everything in the case is synthetic. Do not add actual evidence, personal information, or credentials. Do not deploy, publish, create paid resources, or enable pay-as-you-go model access.
