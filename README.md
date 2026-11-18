# Chain of Custody: The Blackwater Evidence

Evidence can be questioned. Its history should never be rewritten.

A fictional forensic evidence audit project. An auditor investigates inconsistencies in records from a 2021 research-facility fire in northern Michigan, reopened during a 2026 archive migration. The agent audits support for claims; it never decides guilt or rewrites originals.

Status: domain core (TypeScript, `core/`), Cedar tool policies (`policy/`) and a Stage B enforcement harness (`harness/`) are built and tested locally (`npm test`, `npm run typecheck`). Nothing is deployed. No remote is configured.

**Local demo:** `npm run demo`, then open http://127.0.0.1:4317. The investigation workspace lets you act as each synthetic staff member: read pinned evidence versions, record custody, append corrections, review agent drafts and findings, and run an approval-gated export that is verified independently. The Integrity Challenge (http://127.0.0.1:4317/challenge) runs 28 attempts (21 attacks, 7 legitimate) and shows which layer refused each attack. Local only: no login (you choose who you act as), no AWS calls, no model; the agent pass is a scripted replay, not evidence of Bedrock Managed Agents behavior.

**Release blocker RB-1:** the AWS account is not entitled to Bedrock Managed Agents or GPT-5.6 Luna. See [docs/RELEASE-BLOCKERS.md](docs/RELEASE-BLOCKERS.md).

- [Project plan](docs/PROJECT-PLAN.md)
- [Case bible](docs/CASE-BIBLE.md)
- [Architecture](docs/ARCHITECTURE.md)
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
- [CDK infrastructure runbook (T12, not deployed)](docs/runbooks/infra.md)
- [ADR 0009: Investigation workspace (T17)](docs/adr/0009-investigation-workspace.md)
- [Release blockers](docs/RELEASE-BLOCKERS.md) (primary: RB-1, Bedrock Managed Agents access)
- [Stage B harness](harness/README.md) and [BMA access request drafts](docs/plans/2026-11-18-bma-access-requests.md)
- [Original planning source](docs/source/ORIGINAL-BLUEPRINT.md)

Everything in the case is synthetic. Do not add actual evidence, personal information, or credentials. Do not deploy, publish, create paid resources, or enable pay-as-you-go model access.
