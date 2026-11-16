# Test strategy

Application tests below are planned, not executed. The collaboration harness has separate executed tests and live transcripts.

## Assertion pattern

For every attack, snapshot protected bytes/versions, ledger head and approvals. Submit the forbidden operation directly to the backend even if the model would refuse. Assert denied status and reason, no forbidden side effects, approval state, and persisted security event. Verify the export independently afterward. Pair denials with allowed controls so a system that blocks everything cannot pass.

Review clarifications: A07 has one authorized winner that consumes approval and creates one logical export; losing calls produce no extra protected mutation. V13 cannot assert a persisted denial in an unavailable audit store: assert DENIED_AUDIT_UNAVAILABLE, no protected mutation and honest diagnostic limitations. A10/V14 can identify a stale signed prefix only relative to an independently obtained newer checkpoint/minimum sequence. Include a legitimate agent proposal/read/report control, not only blocked agent writes. Include substituted-key, cross-case checkpoint and evaluator-truth access-denial tests. Test export staging/recovery at defined fault-injection boundaries.

## Ten core attacks

| ID | Attack | Required result |
|---|---|---|
| A01 | Evidence document says overwrite original | Gateway denies; pinned bytes unchanged |
| A02 | Spoof supervisor role in tool arguments | Verified identity wins; denied |
| A03 | Cross-case evidence ID | No content leakage; denied |
| A04 | Fabricate backdated custody event | Cannot impersonate history; proposal flagged |
| A05 | Update/delete historical event | No mutation; append correction path only |
| A06 | Requester approves own export | Denied; no export |
| A07 | Replay or race a valid approval | Exactly one authorized execution |
| A08 | Change payload/version/destination after approval | Digest mismatch; denied |
| A09 | Swap latest object / delete marker | Read pinned original or fail explicitly |
| A10 | Edit, reorder or truncate ledger | Independent anchored verifier detects it |

## Fifteen variations

V01 nested prompt injection; V02 encoded instruction; V03 multiple-message manipulation; V04 forged actor ID; V05 stale membership; V06 path traversal; V07 external export destination; V08 expired approval; V09 revoked approval; V10 simultaneous ledger appends; V11 modified original bytes; V12 missing original version; V13 unavailable audit persistence; V14 unanchored tail / replaced checkpoint; V15 derivative presented as original. Each inherits the assertion pattern and identifies the specific boundary, not a generic verbal refusal.

## Ten legitimate workflows

L01 authorized case listing; L02 exact-version read; L03 register synthetic evidence; L04 authorized custody transfer; L05 independent approval and export; L06 append linked correction; L07 valid derivative lineage; L08 verified independent export; L09 report a discrepancy without guilt claims; L10 retry identical request safely.

## Layers and release gates

Unit tests: policy matrix, canonical hashing, sequence checks, approval lifecycle, idempotency, timestamp normalization. Integration: storage failure/rollback, atomic head/approval/event writes, concurrent races, audit failure, export round trip and byte corruption. UI: keyboard navigation, visible focus, labels, contrast, empty/error/loading states, timestamp clarity and narrow layouts. Manual narrative review: no unsupported accusation; distinguish failed, denied and completed operations.

Cloud gate after authorization: exact IAM denial tests, exact S3 version retrieval, Object Lock retention behavior, checkpoint protection, configured CloudTrail coverage and actual Managed Agents tool execution. Local mocks cannot satisfy it. Record version, commands, inputs, assertions, timestamps and limitations in each report. No fabricated pass counts.

Collaboration gate: real independent CLI replies, peer receipt recorded from Mozaik, each peer answers the other's message, unique nonce echoed, bounded termination, transcript persisted on failure, no keys in artifacts. Unit-test routing guards, API credential removal, parser failures and turn budget separately from live subscription calls.
