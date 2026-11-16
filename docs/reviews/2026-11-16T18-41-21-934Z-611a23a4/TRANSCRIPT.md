# Blackwater Architecture Review

Run: 2026-11-16T18-41-21-934Z-611a23a4

This is actual CLI output and Mozaik receipt metadata. Review proposals are not automatically accepted decisions.

## claude reply at 2026-11-16T18:41:54.464Z

# Chain of Custody: independent review

Nonce: **BW-be1ddaef-319d-4d42-8c49-1de45346fe2f**

Scope: these four documents only. AWS, Bedrock Managed Agents and event claims are treated as unverified proposals.

## Concrete gaps

1. **The checkpoint trust root is undefined.** ARCHITECTURE says the checkpoint has a "separate writer authority" and the export has an "authenticated checkpoint." Nothing says who holds the signing key locally or how the verifier gets the public key. If the API process signs, A10/V14 prove nothing against a privileged editor.
2. **The agent's authority is ambiguous (confused deputy).** The matrix says the agent can "Propose only," but the domain model has no Proposal entity and no endpoint. It is unclear whether gateway calls run as the investigator's session or as a distinct agent principal. If they inherit the investigator's session, the agent gets that user's write rights.
3. **The time model is incomplete.** CustodyEvent separates claimed historical time from server time but has no field for timezone, source clock, offset or uncertainty. BW-005 ("preserve raw time and documented clock correction separately") cannot be represented, and A04 detection has nothing structured to check.
4. **Corrections have no controls.** Auditors may append corrections but not custody events. Correction semantics (target event, superseded fields, approval need) are unspecified, so a correction could effectively rewrite meaning without independent approval.
5. **The security audit is not tamper-evident.** Denials live "outside the custody ledger," yet the tests assert that a security event persisted. Nothing chains or checkpoints that log, so a privileged editor can silently delete evidence of a blocked attack.
6. **Evaluator truth can leak.** The CASE-BIBLE puts "expected findings" in `fixtures/manifest.json` alongside agent-visible fixture data. If both come from one file, scenario L09 is contaminated.
7. **The canonical serialization is unspecified.** The independent verifier needs a versioned, written spec, not the app's code. Otherwise verification is not independent.
8. **The BW-010 narrative conflicts with the design.** The fixture's historical "blocked attempt" (a record) and the live demo denial (a security event) could be shown in the same place and confused.

## Smallest MVP

- TypeScript core with SQLite and file adapters, using the 6 deep artifacts only.
- Policy service, append-only ledger with CAS head, approvals, export, and a **standalone verifier CLI** in a separate package that consumes a spec document and a pinned public key.
- A clearly labeled **scripted hostile tool caller** stands in for the agent and hits the real gateway. No model integration and no UI beyond one read-only Evidence/Timeline page.
- Gate scenarios: A01, A02, A05, A06, A07, A08, A10, V14, paired with L02, L05, L06, L08.

## Ticket 1: Ledger, checkpoint and verifier

- Write `docs/CANONICAL-EVENT-V1.md` (field order, encodings, hash input).
- Run a checkpoint signer as a separate process or key file the API cannot read; the verifier takes the public key as an argument.

Acceptance:
- Editing one event byte, swapping two events, removing the tail after the last checkpoint, or substituting a re-signed checkpoint with an unknown key each yields a distinct verifier failure code.
- An untouched export passes.
- 100 concurrent appends produce strictly contiguous sequences with no duplicates.
- The security-audit log is also hash-chained and covered by checkpoints.

## Ticket 2: Agent principal and approval gateway

- Add a distinct `agent:` principal acting on behalf of a verified human session, plus a `Proposal` entity. Proposals never write custody events; a human accepts them with their own authenticated action.
- Approvals bind digest, version, destination, requester and case.

Acceptance:
- A02, A04 and A06 tool calls are denied, with stable error codes, a correlation ID, and an unchanged ledger head, bytes and approval state.
- A07 race: exactly one export and one consumed approval.
- A08: any field change produces a digest-mismatch denial.
- An L05 control (independent approver) succeeds.
- If audit persistence is unavailable, the operation fails closed and nothing is written.

## Question for the other reviewer

In the local MVP, which OS-level identity owns the checkpoint signing key, and what stops a process with write access to both the SQLite ledger and the checkpoint store from forging a consistent rewritten chain? If the answer is "nothing locally," should the demo say outright that A10 only covers non-key-holding editors?

## Result

{
  "at": "2026-11-16T18:41:54.465Z",
  "kind": "failed",
  "verdict": "FAIL",
  "message": "Mozaik loop did not complete CLI tool",
  "cliTurns": 2
}
