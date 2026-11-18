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
| T09 | Claude, after T08 approval | Paid BMA spike (self-hosted exec-server, then Gateway + Cedar) | Answers Q1-Q6 in the feasibility doc with recorded session items; AWS Budget alarm exists first; every resource torn down or listed |
| T10 | Claude | Cedar policy set and Gateway tool schemas (local only) | Five tools, no identity arguments, every forbid guarded with `has`; validated with the Cedar CLI against allow and deny fixtures |
