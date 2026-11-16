# ADR 0002: Independent review and reconciled MVP contracts

Status: local planning decisions adopted, November 16, 2026. No application implementation or deployment authorized by this ADR.

Evidence: docs/reviews/2026-11-16T18-43-42-370Z-208e985c/TRANSCRIPT.md and transcript.jsonl. Both CLI reviewers saw the same frozen documents independently; then each received and answered the other's question through the local Mozaik network. Four CLI replies and four unique network receipts were checked by scripts/verify-conversation.cjs.

## Adopted

- One per-case sequence/hash chain. Corrections append in that chain with exact target sequence/hash; no overlay chain.
- Distinct trusted human/agent identities and execution channel. Effective agent authority is the intersection of human case rights and agent capabilities. Restricted mutations are proposals; useful reads and validated reports remain allowed.
- Historical assertions cite pinned evidence and remain separate from contemporaneous custody events. Preserve clock uncertainty.
- Verifier trusts an externally pinned key and independent case-bound checkpoint. It reports valid-through-N and freshness limits. A stale valid prefix needs a newer trusted reference to be detected.
- Local signer process separation is not a claim of protection against a hostile administrator. Key access and signing policy require separate design and future enforcement.
- Every MVP export is restricted. Approval consumption creates one logical durable export operation; private staging and recovery control readiness/downloads.
- Audit outage denies without protected mutation; no false promise that the unavailable store persisted the denial. Security outcomes need their own trusted anchoring.
- Separate agent-visible provenance from hidden evaluator findings and test that the gateway cannot read the latter.
- Headless contracts/core first. Keep ten inventory entries, deepen six, then add four thin screens. No cloud or current-service capability claims from this review.

## Remaining design work

Canonicalization and checkpoint formats, purpose separation, signing algorithm/key lifecycle, trusted checkpoint distribution and export fault-injection state machine need concrete specifications before implementation claims. Membership/role mutation, derivative creation and revocation permissions remain denied until specified. Human UX and AWS feasibility are later gates.

First bounded handoff is T00: write verifier trust/canonicalization contract with golden vectors and synthetic tests. It is a proposed task, not automatic execution. One owner works; the other reviews. No autonomous writer or merge behavior is enabled in the current bridge.

## Run history

Two earlier attempts are preserved as FAIL: the adapter initially misread Mozaik Core's nested serialized result envelope. The correction was checked against the actual installed library without inference before the successful rerun. Partial reviews are not counted as successful conversations. The successful run does not prove the evidence application exists; its reviews explicitly say no app tests were executed by the reviewers.
