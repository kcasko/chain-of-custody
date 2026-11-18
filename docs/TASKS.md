# Task board

All implementation tickets are proposed, not delegated permission to modify files. Assign a separate branch/worktree and exclusive file ownership before execution.

| ID | Proposed owner | Task | Acceptance |
|---|---|---|---|
| T00 | Codex, Claude reviews | Verifier trust and canonicalization contract | One per-case chain, correction references, purpose-separated golden vectors, external key/checkpoint inputs, honest freshness states; spec and synthetic tests only |
| T01 | Claude | Synthetic artifact fixtures and manifest | Ten IDs, real byte hashes, explicit clock uncertainties and evaluator truth separation |
| T02 | Codex | Domain policy and approval core | Matrix, cross-case denial, self-approval denial, atomic replay/race tests |
| T03 | Claude | Version-pinned storage adapter | No latest-original reads, derivative lineage and failure cleanup tests |
| T04 | Codex | Ledger and independent verifier | Canonical hashes, concurrent head writes, edit/reorder/truncation detection |
| T05 | Claude | Local API and minimal evidence explorer | Auth/session boundary, error contracts, legitimate workflows |
| T06 | Codex | Adversarial integration suite | 10 attacks, 15 variations, 10 allowed controls with state assertions |
| T07 | Claude (done Nov 18) | Managed Agents feasibility documentation | Done: docs/research/2026-11-18-bma-feasibility.md and ADR 0003 (adopted). Event rules still unpublished, see T07b |
| T07b | Claude | Re-check event Rules tab | Submission format, judging criteria and eligibility recorded with date; ADR 0003 scope adjusted if needed |
| T08 | Keith gate | Cloud work or publication | Explicit future authorization; absent now |
| T09 | Claude (run Nov 18, BLOCKED at G1: account not entitled to BMA or GPT-5.6 Luna; see docs/research/2026-11-18-t09-spike-report.md) | Paid BMA spike (self-hosted exec-server, then Gateway + Cedar, then AgentCore Runtime) | Answers Q1-Q6 in the feasibility doc with recorded session items; AWS Budget alarm exists first; every resource torn down or listed |
| T09B | Claude (done Nov 18) | Stage B: real Gateway + AgentCore Policy + stub Lambda with a test-harness role | Done: 150/150 local, 29/29 live (twice), 17/17 exec-environment isolation (committed rerun after teardown: 16/16 + 1 skipped); torn down same day. Not BMA compatibility evidence. See spike report |
| T11 | Claude, after BMA access | BMA session client implementing `AgentToolClient`; rerun `harness/scenarios.cjs` through a real agent | Same scenarios pass with `SESSION_ROLE_NAME=CocBmaSessionRole`; Q2, Q4, Q5, Q6 answered with session items |
| T12 | Claude | Stage B deploy sequence as CDK (gateway, engine, policies in safe order, Lambda, roles) | `cdk synth` clean; deploy and teardown reproducible; boundary forbids ACTIVE before any permit |
| T10 | Claude (done Nov 18) | Cedar policy set and Gateway tool schemas (local only) | Done: ADR 0004, `policy/`, `tests/policy.test.cjs` (128 policy tests, typed and untyped modes, mutation-checked). Validated with the official Cedar engine (cedar-wasm 4.14.0) instead of the Rust CLI; same engine, runs in `npm test` |
