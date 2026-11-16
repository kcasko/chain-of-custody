# Blackwater Architecture Review

Run: 2026-11-16T18-42-29-417Z-3a43ea9a

This is actual CLI output and Mozaik receipt metadata. Review proposals are not automatically accepted decisions.

## claude reply at 2026-11-16T18:43:05.250Z

# Chain of Custody: Independent Review

Nonce: **BW-2802ace3-717d-4119-9e4a-7a09379dfe86**

This review is based only on the four documents provided. AWS, Bedrock Managed Agents and event claims are treated as unverified proposals.

## Concrete gaps

1. **The checkpoint trust anchor is undefined.** The docs require an "authenticated checkpoint" with "separate writer authority" but never say who signs it, with what key or algorithm, or how the verifier gets the public key. Locally, one process writes both the ledger and the checkpoints, so A10 and V14 prove nothing about a privileged editor.
2. **The agent's principal model is missing.** "Resolve identity from verified session" doesn't say whose session the agent uses. If the gateway forwards the investigator's session, the agent inherits *Register* and *Add custody event* rights, which violates "propose only." This is a confused-deputy risk.
3. **Proposals and drafts have no entity.** The matrix says the agent can "propose" and "draft," and A04 says "proposal flagged," but the domain model has no Proposal record, lifecycle or human-promotion step.
4. **There are no entities for clock corrections or annotations.** BW-005 needs raw time and correction stored separately, and BW-009 needs source separated from annotation. Finding and CustodyEvent cover neither, so fixtures will improvise.
5. **The sequence scope is ambiguous.** "Per-case/evidence sequence" could mean one chain or many. Multi-item transfers and cross-evidence ordering need a decision. I recommend one per-case chain for the MVP.
6. **Canonicalization is unnamed.** If the verifier imports the same serializer as the writer, a shared bug passes silently. Pick a named scheme (for example RFC 8785 JCS) and test the verifier against hand-computed vectors.
7. **Audit ordering conflicts with atomicity.** "Persist audit before success" combined with a later commit failure leaves an audit record claiming success. Use an intent record, then an outcome record, both carrying a correlation ID. The security audit log also has no tamper evidence of its own.
8. **The approval executor binding is unstated.** The digest includes the requester, but nothing says the executing session must be that requester. Revoke-versus-consume races are also not specified.

## Smallest MVP

A headless TypeScript domain core, without the UI or agent:
- SQLite adapter
- one synthetic case with BW-001, 005, 007 and 010
- a per-case hash-chained ledger with compare-and-set on the head
- an append-only correction path
- an approval lifecycle
- an Ed25519 checkpoint signer running as a separate process with its own key file, which signs only `(caseId, seq, headHash)` and refuses non-monotonic sequences
- an export bundle
- a standalone verifier CLI that shares no code with the writer

It should cover A05–A10, V08–V14 and L05, L06, L08 and L10. The agent, the UI and AWS come after this passes.

## Ticket 1: Anchored ledger, export and independent verifier

**Acceptance criteria**
- Events are serialized with the chosen canonical scheme, and the verifier passes ≥5 hand-computed test vectors.
- Two concurrent appends at the same sequence produce exactly one success (V10).
- The signer rejects regressing or duplicate sequences.
- The export contains the manifest, referenced bytes, the event list, the latest signed checkpoint and the head/count.
- The verifier separately reports byte edits, reordered events, a removed middle event, suffix truncation below the checkpoint, an unanchored tail, a replaced checkpoint signed with a wrong key, and a missing original version.
- Each corruption has its own distinct exit code.
- An unmodified export verifies cleanly (L08).

## Ticket 2: Policy gateway, agent principal and approvals

**Acceptance criteria**
- Identity comes only from the session. Actor or role fields supplied in a request are ignored and logged (A02, V04).
- The agent is a distinct principal whose effective rights are the intersection of its delegating user's rights and the agent's role. Its register, custody and correction calls create Proposal records only, never ledger events.
- Approvals bind the digest, version, destination, requester, case and expiry.
- Self-approval, replay, a concurrent second consumption, a changed payload, an expired approval and a revoked approval are each denied with a stable error code. In every case the ledger head and bytes are unchanged and a security event is persisted (A06–A08, V08, V09).
- When audit storage is unavailable, the action fails closed (V13).
- A valid independent approval exports exactly once (L05).
- An identical retry returns the original result (L10).

## Question for the other reviewer

For the local MVP, is a checkpoint signer in a separate process with its own key file acceptable, with A10 and V14 claims explicitly scoped to "detects tampering by a party without the signing key"? Or do you require the verifier's public key to be pinned out-of-band, for example committed in the repository and checked against the export, before any A10 result is reported as passing?

## Result

{
  "at": "2026-11-16T18:43:05.251Z",
  "kind": "failed",
  "verdict": "FAIL",
  "message": "Mozaik loop did not complete CLI tool",
  "cliTurns": 2
}
