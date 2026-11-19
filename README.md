# Chain of Custody: The Blackwater Evidence

Evidence can be questioned. Its history should never be rewritten.

An AI evidence-audit agent that can investigate a case but cannot change its record. It runs on the **Amazon Bedrock AgentCore managed harness** (Claude Sonnet 4.6). It reaches the case only through five tools behind an AgentCore Gateway with Cedar policies, a domain core that checks every call again, and storage that won't let anything be overwritten. People promote or dismiss what the agent drafts.

The case is fictional: a 2021 fire at a research facility in northern Michigan, reopened when a 2026 archive migration turned up records that disagree. Everything in it is synthetic. No real people, places or events.

Built for the AWS Builder Center hackathon "Agents, your rules" (November 2026).

![How each rule is enforced](docs/submission/screenshots/architecture.png)

## Status

| What | State |
|---|---|
| The agent on the AgentCore managed harness | **Ran live on AWS, November 19, 2026.** It did its audit job, and two stress runs of 9 prompts (8 adversarial, including direct and indirect prompt injection) held every protected-state rule. Then everything was torn down. [Run report](docs/research/2026-11-19-t21-agent-run-report.md) |
| Investigation workspace (local) | Complete: case brief, evidence with provenance, side-by-side comparison, findings and drafts, custody and corrections, approval-gated export with offline verification, security log, Integrity Challenge |
| Storage on AWS (DynamoDB, S3 Object Lock) | Verified live (T14b, T21) |
| Tests | 422 automated tests, 14 browser tests, typecheck clean |
| Known limits | [Security controls and limitations](docs/SECURITY-LIMITATIONS.md) and [what is done, partial or unverified](docs/SUBMISSION.md) |

## How this was built: AI assistance

I built this with substantial help from Claude, Anthropic's AI, through Claude Code. It wrote much of the code, tests and documentation, and it ran the commands, with me directing the work, setting the scope, and approving every plan, AWS deployment and dollar spent.

Two different AIs show up in this project, and they shouldn't be confused:

- **Claude Code** helped build the project.
- **Claude Sonnet 4.6 on Amazon Bedrock** is the agent under test, running on the AgentCore managed harness.

The AWS runs, test results, failures and fixes reported here are real. They come from recorded runs, CloudTrail, and the logs and reports in [docs/research](docs/research). Where something wasn't verified, the docs say so.

## Screenshots

| | |
|---|---|
| ![The agent running on the AgentCore managed harness](docs/submission/screenshots/agent-running-managed-harness.png) | ![Investigation workspace](docs/submission/screenshots/workspace-overview.png) |
| The agent's real terminal output from the live run | The investigation workspace, with the case brief |
| ![Two versions side by side](docs/submission/screenshots/workspace-compare.png) | ![Security log showing a refusal](docs/submission/screenshots/workspace-security-log.png) |
| Comparing an original with its registered derivative | A supervisor's view of a refused operation |

## Setup

Needs Node.js 24 (it runs TypeScript directly) and npm. Optional: Java 17+ and DynamoDB Local for the DynamoDB tests. Without them those tests report as skipped, with the reason; see [adapters/aws/README.md](adapters/aws/README.md).

```bash
npm ci
```

```bash
npx playwright install chromium
```

## Run the demo (local, no AWS)

```bash
npm run demo
```

Open http://127.0.0.1:4317 and follow [docs/DEMO.md](docs/DEMO.md), about 10 minutes covering all nine workflow steps.

- **Identity:** the server listens on loopback only. There is no login: you choose which synthetic staff member you act as, and the core authorizes and audits each action as that person.
- **Agent pass in the local demo:** a scripted replay of seven tool calls through the real tool handler. It is not a model. The live model runs are in the [run report](docs/research/2026-11-19-t21-agent-run-report.md).
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

## Deploy the agent on AWS (optional, costs money)

The CDK app deploys storage, the Gateway with its Cedar policies, and the agent on the managed harness. The step-by-step plan with costs, run rules and teardown is in [docs/plans/2026-11-18-t21-agent-run.md](docs/plans/2026-11-18-t21-agent-run.md) and the [infrastructure runbook](docs/runbooks/infra.md). The verified run cost about $0.47 in model usage plus cents of infrastructure. Then:

```bash
npm run agent:ask -- "Compare the recorded times in BW-001 and BW-005, then record one finding citing both."
```

```bash
npm run agent:stress
```

## Teardown

- **Local:** stop `npm run demo` with Ctrl+C. All demo state is in memory and disappears.
- **Disk:** DynamoDB Local tests use a temporary in-memory instance. Playwright traces and CDK assets go to the git-ignored `.local/` folder, which is safe to delete.
- **AWS:** nothing is deployed now. The deploy and teardown procedure is in [docs/runbooks/infra.md](docs/runbooks/infra.md). Object Lock buckets are retained by CloudFormation and must be emptied by hand.

## Documents

**Start here**
- [Demo walkthrough](docs/DEMO.md)
- [Architecture: components, trust boundaries, verification levels](docs/ARCHITECTURE.md)
- [Live run report: the agent on the managed harness](docs/research/2026-11-19-t21-agent-run-report.md)
- [Stress-test reports, both runs](docs/research/stress-test/)
- [Security controls and limitations](docs/SECURITY-LIMITATIONS.md)
- [Submission readiness: done, partial, unverified](docs/SUBMISSION.md)

**Decisions (ADRs)**
- [0003: Enforcement layers](docs/adr/0003-bma-integration-and-enforcement-layers.md)
- [0004: Agent tools and Cedar policy](docs/adr/0004-agent-tools-and-cedar-policy.md)
- [0005: Domain core](docs/adr/0005-domain-core.md) and [verification spec](docs/specs/canonicalization-and-verification-v1.md)
- [0007: DynamoDB and S3 adapters](docs/adr/0007-aws-storage-adapters.md)
- [0008: Ledger overwrite risk (prevention, detection, recovery)](docs/adr/0008-ledger-overwrite-risk.md)
- [0009: Investigation workspace](docs/adr/0009-investigation-workspace.md)
- [0010: The agent on the AgentCore managed harness](docs/adr/0010-agentcore-managed-harness.md)

**History and research**
- [Release blockers](docs/RELEASE-BLOCKERS.md)
- [Task board](docs/TASKS.md)
- [Stage B: Gateway and Cedar verified live with a stub tool](docs/research/2026-11-18-t09-spike-report.md)
- [Storage adapters on real AWS](docs/research/2026-11-18-t14b-real-aws-report.md)
- [Case bible](docs/CASE-BIBLE.md), [project plan](docs/PROJECT-PLAN.md), [security rules](docs/SECURITY-RULES.md), [test strategy](docs/TEST-STRATEGY.md)
- [Changelog](CHANGELOG.md)

## License

Apache License 2.0. See [LICENSE](LICENSE).
