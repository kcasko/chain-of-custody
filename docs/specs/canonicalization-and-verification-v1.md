# Spec: canonicalization, hashing, signing and verification (v1)

Status: adopted with T00, November 18, 2026. Implemented in `core/src/canonical.ts`, `core/src/crypto.ts` and `core/src/verifier.ts`. Golden vectors: `core/test/vectors/v1.json`, checked against independent tools (`sha256sum`, OpenSSL), not only against this code.

## 1. Canonical form

Every hashed or signed record is serialized as **RFC 8785 (JCS) restricted to a smaller value domain**, so any JCS library can reproduce the bytes.

Allowed values: `null`, booleans, integers in the JavaScript safe range (no `-0`), strings, arrays, plain objects.
Rejected (an error, never silently converted): non-integer numbers, `NaN`, infinities, `-0`, `bigint`, `undefined`, functions, symbols, `Date`, buffers, class instances, strings or keys containing lone UTF-16 surrogates, and strings or keys that are not Unicode NFC.

Rejecting non-NFC text instead of normalizing it keeps the rule simple: what was hashed is exactly what was stored. Callers normalize before submitting.

Encoding: object keys sorted by UTF-16 code units, no whitespace, strings escaped as ECMAScript `JSON.stringify` does, integers in plain decimal. Bytes are the UTF-8 encoding of that text.

## 2. Hashes

| What | Hash |
|---|---|
| Evidence bytes (an original or a derivative) | `SHA-256(raw bytes)`, lowercase hex. The same value `sha256sum` prints, so anyone can check a file |
| Records | `SHA-256( UTF8(purpose) ‖ 0x00 ‖ canonicalBytes )`, lowercase hex |

Purposes (domain separation, so a value hashed for one meaning can never stand in for another):

| Purpose | Record |
|---|---|
| `coc/v1/custody-event` | A ledger event without its `eventHash` field |
| `coc/v1/approval-operation` | The exact operation an approval authorizes |
| `coc/v1/checkpoint` | A checkpoint body (used for its identifier) |
| `coc/v1/request` | An idempotent request (bound to actor and case) |

A hash is a fingerprint. It shows bytes did not change after hashing. It does not prove who created them or that their content was true when collected.

## 3. Ledger events

One chain per case. Each event:

```
schema: "coc/custody-event/v1"
caseId, sequence (1, 2, 3, ...), prevHash (64 zeros for sequence 1)
recordedAt   server time (ISO 8601). Context only: order comes from sequence, and server time may move backward.
actor        { type: "human", userId, role }   (resolved by the server, never taken from a request body)
kind + body  evidence_registered | custody_transfer | historical_assertion | correction
approvalId   present only when an approval was consumed in the same transaction
eventHash    hash of all other fields under purpose coc/v1/custody-event
```

Corrections reference an earlier event by exact `targetSequence` and `targetHash` in the same case. They append; nothing is edited. Historical assertions cite pinned evidence versions and keep the raw claimed time, the source clock and the stated uncertainty, separate from `recordedAt`.

## 4. Checkpoints and signing

Checkpoint body: `{ schema: "coc/checkpoint/v1", caseId, sequence, headHash, issuedAt, keyId }`.

Signature: Ed25519 over `UTF8("coc/v1/checkpoint-signature") ‖ 0x00 ‖ canonicalBytes(body)`. `keyId` = SHA-256 hex of the raw 32-byte public key.

Checkpoints are written by a separate signer with its own key into an append-only store. In this MVP the signer runs in the same process: that is a **simulation of separation**, not protection against a hostile administrator.

## 5. Verifier inputs and trust

The verifier needs three inputs, and only two of them come from the package:

1. The export package: events, a signed checkpoint, the evidence manifest and evidence bytes.
2. **Trusted public keys, pinned outside the package.** A key inside the package is never trusted.
3. **An optional trusted reference, obtained outside the package**: `{ caseId, minSequence, headHashAtMinSequence?, retrievedAt }`.

## 6. Verifier output (honest states)

```
status:          VERIFIED | VERIFIED_WITH_WARNINGS | FAILED
validThrough:    last sequence whose hashes and links check out from sequence 1
anchoredThrough: checkpoint sequence, if its signature, key, case and head hash all check out; else 0
freshness:       FRESH | STALE | UNKNOWN
findings:        [{ code, severity, sequence?, detail }]
```

`VERIFIED` requires: no errors, every event anchored by the checkpoint, and freshness `FRESH`. Anything less is `VERIFIED_WITH_WARNINGS` at best, so a report can never overstate what was proven.

Errors: `WRONG_CASE`, `SCHEMA_INVALID`, `SEQUENCE_GAP`, `SEQUENCE_OUT_OF_ORDER`, `PREV_HASH_MISMATCH`, `EVENT_HASH_MISMATCH`, `CORRECTION_TARGET_INVALID`, `CHECKPOINT_MISSING`, `CHECKPOINT_UNTRUSTED_KEY`, `CHECKPOINT_SIGNATURE_INVALID`, `CHECKPOINT_WRONG_CASE`, `CHECKPOINT_HEAD_MISMATCH`, `MISSING_ANCHORED_HISTORY` (the package ends before the checkpoint: truncation), `REFERENCE_HEAD_MISMATCH` (a fork against the trusted reference), `EVIDENCE_NOT_REGISTERED`, `EVIDENCE_MISSING`, `EVIDENCE_HASH_MISMATCH`, `EVIDENCE_SIZE_MISMATCH`.

Warnings: `UNANCHORED_TAIL` (events after the checkpoint), `STALE_CHECKPOINT` (older than the trusted reference), `FRESHNESS_UNKNOWN` (no trusted reference supplied).

Limits stated plainly:
- An attacker who can rewrite every event *and* recompute every hash produces a self-consistent chain. Only a checkpoint signed by a trusted key, or a trusted reference head hash, exposes it.
- An older valid checkpoint is only detectably stale against a newer trusted reference.
- Nothing here proves the facts recorded were true at collection.
