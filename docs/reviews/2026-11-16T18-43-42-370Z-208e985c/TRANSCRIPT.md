# Blackwater Architecture Review

Run: 2026-11-16T18-43-42-370Z-208e985c

This is actual CLI output and Mozaik receipt metadata. Review proposals are not automatically accepted decisions.

## claude reply at 2026-11-16T18:44:17.716Z

# Chain of Custody Review

Nonce: **BW-7cd84704-6642-4107-8d47-40f1902721a2**

Scope: documents only, nothing executed. All AWS, Managed Agents and event claims are unverified.

## Concrete gaps

1. **The checkpoint trust root is undefined.** The docs require an "authenticated checkpoint" written by a "separate writer authority." They never say who holds the signing key, how the verifier gets the public key, or how a key is rotated or revoked. Locally, the same process could write both the ledger and the checkpoint. That defeats the stated admin-forgery defense (A10, V14).
2. **Chain topology is ambiguous.** "Per-case/evidence sequence" could mean one chain per case or one per artifact. With per-artifact chains, truncation detection needs a checkpoint that commits to *every* head, such as a Merkle root over the heads. Otherwise a whole artifact's chain can be dropped undetected.
3. **The agent principal model is missing.** The docs say actor identity comes from the verified session. They don't say whether the agent acts *as* the user or as its own principal *on behalf of* the user. Without effective rights = intersection(agent cap, user rights), this is a confused-deputy risk. Agent "propose only" also needs a defined proposal object and a human promotion step that re-checks policy.
4. **Backdating vs. late recording is undefined.** A04 says "proposal flagged," but legitimately recording a late-discovered 2021 event looks the same. A `claimedTime` field must never affect ordering. Only server sequence and server time order the ledger, and a claimed time earlier than registration should show as "asserted, unverified."
5. **The security audit log has no integrity.** Denials go outside the ledger, but nothing protects that log. Yet "inspect the denial" is a demo step and a success criterion. It needs at least a hash chain and inclusion in exports.
6. **The role matrix has gaps.** There is no row for creating DerivedEvidence, changing membership or roles, or revoking approvals. Membership changes are not audited events, so V05 (stale membership) can't be reconstructed afterward.
7. **The canonicalization spec is shared but unowned.** Approval digests and event hashes both depend on canonical serialization. A versioning mismatch between them breaks A08 silently. One spec with test vectors should serve both.
8. **Evaluator truth can leak.** `fixtures/manifest.json` holds expected findings beside agent-visible data. The read allowlist must exclude it by path, and a test should prove that.

## Smallest MVP

A headless TypeScript core plus a CLI verifier, with no UI and no model:

- One case and the six deep artifacts with real fixture bytes.
- Register exact versions.
- One per-case hash chain with CAS on the ledger head.
- An approval lifecycle.
- Export.
- An Ed25519 checkpoint signed by a separate local signer process whose public key is pinned in the verifier.
- A labeled scripted "hostile agent" client that calls the same gateway.

This covers A01–A10 and L01–L08 before any React or Bedrock work.

## Ticket 1: Anchored ledger and independent verifier

- Canonical serialization spec v1 with ≥10 golden test vectors, shared by events and approval digests.
- Single per-case chain where each event has `seq`, `serverTime`, an optional `claimedTime`, `prevHash` and `hash`.
- Checkpoint = signature over {caseId, seq, headHash, manifestDigest}, made by a key the ledger writer cannot read.
- **Acceptance criteria:**
  - The verifier, run with only the export and the pinned public key, detects edited bytes, reordered events, a removed middle event, a truncated tail past the checkpoint, and a replaced checkpoint (V11, V14, A10).
  - It reports any unanchored tail explicitly.
  - V10: of 50 concurrent appends at the same `seq`, exactly one succeeds.
  - An untouched export verifies clean (L08).

## Ticket 2: Policy gateway with delegated agent principal

- Principal = {verified user, optional agent id}. Effective rights are the matrix intersection.
- The agent can only create `Proposal` records. A human promotion step re-runs policy.
- Approvals are bound to digest, version, destination, requester, case and expiry, and are consumed once inside the same transaction as the event and head update.
- **Acceptance criteria:**
  - For A02, A03, A06, A07, A08, V04, V05, V08, V09 and V13, a pre/post snapshot shows unchanged bytes, ledger head and approval state.
  - Each of those produces a stable error code and a hash-chained security event with a correlation ID.
  - A07: 20 parallel consumptions yield exactly one execution.
  - The paired controls L04, L05 and L10 pass in the same run.
  - A test proves the agent cannot read the fixture manifest path.

## Question for the other reviewer

For the per-case chain in Ticket 1, should a correction (A05/L06) be a new event that references the corrected event's `seq` and `hash`, with the verifier computing an "effective view"? Or should corrections live in a separate overlay chain under the same checkpoint? Which one keeps BW-010's attempted / blocked / completed distinction unambiguous in the export?

## codex reply at 2026-11-16T18:44:24.004Z

BW-7cd84704-6642-4107-8d47-40f1902721a2

The plan has a sound foundation, but checkpoint trust, agent identity, and export execution need concrete contracts before the security claims are testable. This review uses only the supplied documents. AWS services and event details remain unverified proposals.

**Concrete gaps**

1. **The export does not establish its own checkpoint trust.** An “authenticated checkpoint” is insufficient if the verifier accepts a verification key supplied by that same export. Define an independently distributed trusted key or checkpoint, its case binding, and expected minimum sequence. An older valid checkpoint can otherwise make a truncated export look complete. Without a fresh external reference, verification must say “valid through checkpoint N,” not “complete history.”

2. **Agent authority is underspecified.** Verified sessions identify humans, but the gateway must also distinguish an agent acting for a human. Otherwise, forwarding an investigator’s session could give the agent investigator write permissions despite “propose only.” Effective authority should be the intersection of current human permissions, case scope, and the agent’s narrower permissions. Actor and execution channel must come from trusted server context.

3. **Approval consumption does not guarantee exactly one export.** The proposed transaction covers approval, event and ledger head, but export files live outside that transaction. A crash could consume approval without producing a package, or leave a downloadable package without a committed outcome. Define a durable export operation, private staging, recovery, and the exact point at which download becomes authorized. Also clarify whether all MVP exports require approval.

4. **Historical assertions need an explicit type boundary.** Separate server-recorded events from later claims about past custody. A server timestamp alone does not prevent an authorized user from submitting invented historical source/destination details. Historical assertions should require cited evidence and remain visibly unverified; corrections must reference exact earlier records.

5. **Audit failure handling is incomplete.** Persisting a decision before execution does not establish the outcome. Define transactional outcome recording for database mutations and recoverable states for filesystem operations. During an audit-store outage, denial remains mandatory, but persistence of that denial cannot be guaranteed. Tests must distinguish this from an ordinary audited denial.

**Smallest MVP**

Build a local TypeScript core, SQLite metadata and ledger, sealed fixture files, and an independently runnable verifier. Use the ten inventory entries with deeper content only for the six selected artifacts. Keep four thin screens over that core.

Use clearly labeled synthetic human identities and a simulated agent gateway. Support exact-version reads, registration, custody appends, linked corrections, and independently approved local exports. Treat every export as restricted for now. Exclude cloud integration and live model calls.

For the demonstration, provision the verifier’s trusted checkpoint reference separately from exported packages. State explicitly that this tests integrity verification, not protection against a hostile machine administrator.

**Ticket 1: Enforce identity and append contracts**

Implement trusted human/agent execution context, current membership checks, typed historical assertions, and linked corrections.

Acceptance criteria:

- Spoofed roles, actors and execution channels cannot expand permissions.
- Agent-originated registration or custody writes fail even under an investigator session.
- Revoked membership and cross-case requests expose no evidence.
- Historical assertions cannot masquerade as contemporaneously recorded transfers.
- Allowed human transfers and corrections succeed; denials preserve protected state and produce audit records when persistence is available.

**Ticket 2: Make approved exports recoverable and independently verifiable**

Implement immutable export requests, atomic approval consumption and operation creation, private package staging, recovery, and external checkpoint trust.

Acceptance criteria:

- Concurrent approval use creates one logical export; identical retries return that operation.
- Crash tests around consumption, file creation and publication cause no unauthorized download.
- The verifier rejects changed bytes, reordered events, missing anchored records and substituted trust keys.
- An older valid export is labeled as covering only its checkpoint unless a newer trusted reference proves truncation.
- A legitimate approved export verifies successfully.

**Question for the other reviewer:** What independently obtained trust reference should the MVP verifier require to distinguish a complete current export from a correctly signed but stale prefix?

Delivery: claude -> codex, independent-review, envelope ee341b87-3903-4939-bb32-e4a6dedd447e

Delivery: codex -> claude, independent-review, envelope 9e1c3d5c-04ec-40e7-957e-276365f33a3b

## claude reply at 2026-11-16T18:44:50.428Z

BW-7cd84704-6642-4107-8d47-40f1902721a2

## Answer to the peer question

No offline verifier can prove an export is *current*. It can only prove completeness relative to a reference obtained independently of the export. For the MVP, the verifier should require two inputs, neither of which is read from the package:

1. **A pinned trust key in verifier configuration.** This key belongs to a checkpoint signer that is separate from the ledger writer. The verifier rejects any key embedded in the export.
2. **A checkpoint record fetched at verification time from the separate checkpoint store.** The record contains `caseId`, `sequence`, `headHash`, `issuedAt` and `signerKeyId`, signed by that key.

The verifier also accepts an optional caller-supplied `--min-sequence`.

Output is always scoped: "valid and complete through sequence N, relative to checkpoint R retrieved at T." If the export's head is behind R, the result is **truncated**. If the export extends past R, the result is **unanchored tail**. If R is unavailable, the result is **unverifiable freshness**, never "complete."

Locally, the "separate signer" is a different key file and directory. It must be labeled as simulated authority separation, consistent with SECURITY-RULES' warning against implying hostile-host protection.

## Challenged claims

- **Ticket 1: "Agent-originated registration or custody writes fail."** This is underspecified against the role matrix, which says the agent may *propose*. Without a passing control, a gateway that blocks every agent call satisfies the criterion, and TEST-STRATEGY explicitly forbids that. Required addition: an agent proposal is persisted as a non-authoritative draft, does not advance the ledger head, and is visible for human action.
- **Gap 5: outage denials "cannot be guaranteed" persistence.** This is true but incomplete. It leaves the outage path untestable. The backend should return a distinct stable code (for example `DENIED_AUDIT_UNAVAILABLE`) and emit a best-effort operational log line. V13 then asserts that code, no state change, and no claim that an audit record exists.
- **Ticket 2 scope.** It bundles export state machine, crash recovery, file publication and verifier trust. That is too large to review or gate as one unit. Crash tests in particular need defined fault-injection points (after consume, after staging write, before publish), not real process kills.

## Remaining disagreements

- I would not treat *every* export as restricted in the MVP without saying so in SECURITY-RULES. Otherwise the docs and implementation diverge silently.
- Both tickets assume fixtures exist. Milestone 2 requires `fixtures/manifest.json` with bytes-derived hashes. That manifest, with evaluator truth kept separate, should precede or accompany Ticket 1.
- Typed historical assertions are agreed. "Requires cited evidence" still needs a defined validation rule, such as referencing an existing pinned `evidenceId@versionId`, or it becomes a free-text checkbox.

## Proposed handoff (bounded)

**Task: Verifier trust contract and checkpoint format (spec + local tests only)**

- Owner: one peer. Files: `docs/ARCHITECTURE.md` (checkpoint section), new `docs/VERIFIER-CONTRACT.md`, verifier tests under `tests/`.
- Out of scope: export state machine, crash recovery, UI, cloud, live model calls, new dependencies without approval.

**Acceptance criteria**

1. The spec defines the canonical checkpoint serialization, signature scheme placeholder, case binding, and the four result states: complete-through-N, truncated, unanchored tail, unverifiable freshness.
2. The verifier ignores any trust key inside the package. A test with a substituted embedded key fails verification.
3. Tests cover: changed bytes, reordered events, suffix truncation below the checkpoint, a stale-but-validly-signed prefix against a newer reference (reported truncated), a tail beyond the checkpoint (reported unanchored), a cross-case checkpoint (rejected), and a missing reference (reported unverifiable).
4. A legitimate synthetic export verifies as complete-through-N. This is the paired allowed control.
5. Every report states the verifier version, inputs, reference retrieval time, and the limitation: a hash is not proof of origin, and local key separation is not hostile-administrator protection.
6. No fabricated pass counts. The handoff reports the actual test command output, including failures.

## codex reply at 2026-11-16T18:44:57.255Z

BW-7cd84704-6642-4107-8d47-40f1902721a2

Use a **new correction event in the same per-case chain**, referencing the corrected event’s exact `seq` and `hash`, with case scope enforced. A separate overlay chain adds synchronization and checkpoint coverage problems without helping this MVP.

The verifier should validate the correction reference and preserve both records. An application can compute an “effective view,” but that view must remain a labeled interpretation with links to the original and correction. Corrections must not silently replace historical records.

For BW-010, separate **operation outcomes from corrections**. Record attempted, denied, failed and completed outcomes as structured security events linked by correlation ID. Custody events describe committed custody changes. A denied overwrite produces a security event and no custody mutation. A later correction can amend an assertion about that attempt; it cannot turn a denial into a completed operation.

I agree with the peer’s main gaps: checkpoint trust, chain topology, delegated identity, proposal promotion and canonicalization need explicit contracts. Several claims need narrowing:

- **A pinned public key does not establish checkpoint freshness.** It rejects an unauthorized replacement signature, but an older valid checkpoint and matching shortened export can still verify. Detecting that rollback requires a separately trusted minimum checkpoint or latest-checkpoint reference. Ticket 1’s “replaced checkpoint” criterion must distinguish forgery from replay.
- **A separate signer process is not automatically a separate authority.** If the ledger writer can read its key or ask it to sign arbitrary replacement history, separation fails. Define key access and signing rules. Local process separation alone cannot establish resistance to a privileged host administrator.
- **Ticket 2’s unchanged-state assertion conflicts with its race test.** A07’s winning authorized request must consume approval and commit the permitted result. Assert exactly one committed execution overall; losing requests cause no additional mutation. For V13, unavailable audit persistence cannot also yield a persisted security event in that unavailable store. Require failure without protected mutation and report the logging limitation honestly.
- **“Agent can only create Proposal records” is too restrictive.** The frozen matrix also permits scoped reads through the gateway and validated audit reporting. Proposal-only behavior should govern restricted mutations.
- A hash-chained security log helps detect modification only with a trusted anchor. Export inclusion alone does not provide that protection.

Remaining disagreements concern guarantees and scope. Keep ten initial artifacts, with six receiving deep treatment, as the frozen plan specifies. The proposed components do not themselves demonstrate coverage of A01–A10 or L01–L08; coverage needs executed assertions. Also, sequence should define ledger order. Server time provides context but can move backward. An earlier claimed time is a historical assertion, not automatically evidence of fabrication.

Proposed bounded handoff: **one owner prepares the local ledger/export contract and its verification fixtures**, limited to canonicalization, correction semantics, checkpoint validation and the standalone verifier. This review proposes the task; it grants no execution authority.

Acceptance criteria:

1. Specify one per-case chain, exact correction references, sequence ordering and immutable historical records.
2. Define versioned, purpose-separated canonical inputs for events, approvals and checkpoints, with golden vectors.
3. State the verifier’s external trust inputs and distinguish signature validity, checkpoint coverage and freshness.
4. Verify an untouched export; detect changed bytes, reordered or missing anchored events, invalid correction references and forged checkpoints.
5. Report unanchored tails; demonstrate older-checkpoint replay detection only when an external freshness reference is supplied.
6. Show BW-010’s denied overwrite with unchanged original bytes, a correlated security outcome and no custody mutation.
7. Record commands, actual results and limitations. No cloud claims, UI work or model integration enter this handoff.

No tools were used and no tests were executed for this review.

Delivery: claude -> codex, peer-response, envelope 15bb902b-ec30-44e7-b61f-b6abf8793931

Delivery: codex -> claude, peer-response, envelope 368d8dc9-f26a-47eb-af5b-209b496556f1

## Result

{
  "at": "2026-11-16T18:44:57.257Z",
  "kind": "complete",
  "verdict": "PASS",
  "cliTurns": 4,
  "peerDeliveries": 4,
  "nonce": "BW-7cd84704-6642-4107-8d47-40f1902721a2",
  "note": "Both independent reviews and both peer responses were received through the real local Mozaik network. Task execution is not enabled."
}
