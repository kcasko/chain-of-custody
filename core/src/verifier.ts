// Independent export verifier (T04). Implements spec v1 section 5-6.
//
// Independence: this module imports only the shared spec primitives
// (crypto.ts -> canonical.ts) and Node built-ins. It never imports the
// ledger, store or services, so a bug there cannot hide here. A test enforces it.
//
// Trust comes only from inputs supplied OUTSIDE the package: pinned public
// keys and an optional reference (minimum sequence and head hash).

import { Buffer } from 'node:buffer';
import { PURPOSE, ZERO_HASH, recordHash, sha256Hex, isHex64, keyIdFor, verifyCheckpointSignature } from './crypto.ts';

export interface TrustedKey { readonly keyId: string; readonly publicKeyHex: string }
export interface TrustedReference { readonly caseId: string; readonly minSequence: number; readonly headHashAtMinSequence?: string; readonly retrievedAt: string }
export interface Trust { readonly expectedCaseId: string; readonly keys: readonly TrustedKey[]; readonly reference?: TrustedReference }

export type Severity = 'error' | 'warning';
export interface Finding { readonly code: string; readonly severity: Severity; readonly sequence?: number; readonly detail: string }
export interface VerificationReport {
  readonly status: 'VERIFIED' | 'VERIFIED_WITH_WARNINGS' | 'FAILED';
  readonly validThrough: number;
  readonly anchoredThrough: number;
  readonly eventCount: number;
  readonly freshness: 'FRESH' | 'STALE' | 'UNKNOWN';
  readonly findings: readonly Finding[];
  readonly evidence: ReadonlyArray<{ evidenceId: string; versionId: string; verified: boolean; isDerivative: boolean }>;
}

const KINDS = new Set(['evidence_registered', 'custody_transfer', 'historical_assertion', 'correction']);
const EVENT_KEYS = ['schema', 'caseId', 'sequence', 'prevHash', 'recordedAt', 'actor', 'kind', 'body', 'approvalId', 'eventHash'].sort().join(',');
const SAFE_PATH = /^evidence\/BW-[0-9]{3}\/[A-Za-z0-9._-]{1,128}$/;
const MAX_EVENTS = 100_000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function eventShapeOk(e: unknown): e is Obj {
  if (!isObj(e)) return false;
  if (Object.keys(e).sort().join(',') !== EVENT_KEYS) return false;
  return e.schema === 'coc/custody-event/v1' && typeof e.caseId === 'string' && Number.isSafeInteger(e.sequence) && isHex64(e.prevHash)
    && typeof e.recordedAt === 'string' && isObj(e.actor) && typeof e.kind === 'string' && KINDS.has(e.kind) && isObj(e.body)
    && (e.approvalId === null || typeof e.approvalId === 'string') && isHex64(e.eventHash);
}

export function verifyExport(pkg: unknown, trust: Trust): VerificationReport {
  const findings: Finding[] = [];
  const err = (code: string, detail: string, sequence?: number): void => { findings.push(sequence === undefined ? { code, severity: 'error', detail } : { code, severity: 'error', sequence, detail }); };
  const warn = (code: string, detail: string, sequence?: number): void => { findings.push(sequence === undefined ? { code, severity: 'warning', detail } : { code, severity: 'warning', sequence, detail }); };
  const report = (validThrough: number, anchoredThrough: number, eventCount: number, freshness: VerificationReport['freshness'], evidence: VerificationReport['evidence']): VerificationReport => {
    const hasError = findings.some((f) => f.severity === 'error');
    const clean = !hasError && findings.length === 0 && anchoredThrough === eventCount && eventCount > 0 && freshness === 'FRESH';
    return { status: hasError ? 'FAILED' : clean ? 'VERIFIED' : 'VERIFIED_WITH_WARNINGS', validThrough, anchoredThrough, eventCount, freshness, findings, evidence };
  };

  if (!isObj(pkg) || pkg.schema !== 'coc/export/v1' || typeof pkg.caseId !== 'string' || !Array.isArray(pkg.events) || !Array.isArray(pkg.evidence) || !isObj(pkg.files)) {
    err('SCHEMA_INVALID', 'not a coc/export/v1 package');
    return report(0, 0, 0, 'UNKNOWN', []);
  }
  if (pkg.events.length > MAX_EVENTS) {
    err('SCHEMA_INVALID', 'too many events');
    return report(0, 0, 0, 'UNKNOWN', []);
  }
  if (pkg.caseId !== trust.expectedCaseId) err('WRONG_CASE', `package is for ${pkg.caseId}, expected ${trust.expectedCaseId}`);

  // 1. Chain: recompute every hash; links use recomputed values, never claimed ones.
  const events = pkg.events as unknown[];
  const computed: string[] = []; // computed[i] = recomputed hash of events[i]
  let validThrough = 0;
  let chainIntact = true;
  let prev = ZERO_HASH;
  const registered = new Map<string, { sha256: string; size: number; derivative: boolean; sequence: number }>();
  for (let i = 0; i < events.length; i += 1) {
    const expectedSeq = i + 1;
    const e = events[i];
    if (!eventShapeOk(e)) {
      err('SCHEMA_INVALID', 'malformed event', expectedSeq);
      chainIntact = false;
      computed.push('');
      continue;
    }
    const { eventHash, ...rest } = e;
    let recomputed = '';
    try {
      recomputed = recordHash(PURPOSE.custodyEvent, rest);
    } catch {
      err('SCHEMA_INVALID', 'event is not canonical data', expectedSeq);
    }
    computed.push(recomputed);
    let ok = recomputed !== '';
    if (e.caseId !== trust.expectedCaseId) { err('WRONG_CASE', `event belongs to ${String(e.caseId)}`, expectedSeq); ok = false; }
    if (e.sequence !== expectedSeq) {
      err((e.sequence as number) > expectedSeq ? 'SEQUENCE_GAP' : 'SEQUENCE_OUT_OF_ORDER', `found sequence ${String(e.sequence)} at position ${expectedSeq}`, expectedSeq);
      ok = false;
    }
    if (e.prevHash !== prev) { err('PREV_HASH_MISMATCH', 'does not link to the previous event', expectedSeq); ok = false; }
    if (recomputed && eventHash !== recomputed) { err('EVENT_HASH_MISMATCH', 'content does not match its hash', expectedSeq); ok = false; }
    if (e.kind === 'correction') {
      const b = e.body as Obj; // eventShapeOk guarantees an object
      const t = b.targetSequence;
      if (!Number.isSafeInteger(t) || (t as number) < 1 || (t as number) >= expectedSeq || computed[(t as number) - 1] !== b.targetHash) {
        err('CORRECTION_TARGET_INVALID', 'correction does not reference an earlier event by its exact hash', expectedSeq);
        ok = false;
      }
    }
    if (e.kind === 'evidence_registered' && ok) {
      const b = e.body as Obj; // eventShapeOk guarantees an object
      if (typeof b.evidenceId === 'string' && typeof b.versionId === 'string' && isHex64(b.sha256) && Number.isSafeInteger(b.size)) {
        const k = `${b.evidenceId}@${b.versionId}`;
        if (registered.has(k)) { err('DUPLICATE_REGISTRATION', `${k} is registered twice`, expectedSeq); ok = false; }
        else registered.set(k, { sha256: b.sha256, size: b.size as number, derivative: b.derivedFrom !== null, sequence: expectedSeq });
      }
    }
    if (ok && chainIntact) validThrough = expectedSeq;
    else chainIntact = false;
    prev = recomputed || prev;
  }

  // 2. Checkpoint, trusted only through keys supplied outside the package.
  let anchoredThrough = 0;
  const cp = pkg.checkpoint;
  if (!isObj(cp) || !isObj(cp.body) || typeof cp.signatureHex !== 'string') {
    err('CHECKPOINT_MISSING', 'no signed checkpoint: the chain cannot be anchored');
  } else {
    const body = cp.body;
    const trusted = trust.keys.find((k) => k.keyId === body.keyId && keyIdFor(Buffer.from(k.publicKeyHex, 'hex')) === k.keyId);
    if (!trusted) {
      err('CHECKPOINT_UNTRUSTED_KEY', 'checkpoint was not signed by a pinned key');
    } else if (!verifyCheckpointSignature(Buffer.from(trusted.publicKeyHex, 'hex'), body, cp.signatureHex)) {
      err('CHECKPOINT_SIGNATURE_INVALID', 'signature does not verify');
    } else if (body.schema !== 'coc/checkpoint/v1' || !Number.isSafeInteger(body.sequence) || (body.sequence as number) < 1 || !isHex64(body.headHash)) {
      err('SCHEMA_INVALID', 'malformed checkpoint body');
    } else if (body.caseId !== trust.expectedCaseId) {
      err('CHECKPOINT_WRONG_CASE', `checkpoint is for ${String(body.caseId)}`);
    } else {
      const seq = body.sequence as number;
      if (seq > events.length) {
        err('MISSING_ANCHORED_HISTORY', `checkpoint covers ${seq} events but the package has ${events.length}: history was removed`);
      } else if (computed[seq - 1] !== body.headHash) {
        err('CHECKPOINT_HEAD_MISMATCH', 'events up to the checkpoint differ from what was signed', seq);
      } else if (validThrough >= seq) {
        anchoredThrough = seq;
        if (events.length > seq) warn('UNANCHORED_TAIL', `events ${seq + 1}-${events.length} are not covered by the checkpoint`);
      }
    }
  }

  // 3. Freshness against a reference obtained outside the package.
  let freshness: VerificationReport['freshness'] = 'UNKNOWN';
  const ref = trust.reference;
  if (!ref) {
    warn('FRESHNESS_UNKNOWN', 'no trusted reference supplied; an older valid checkpoint cannot be detected as stale');
  } else if (ref.caseId !== trust.expectedCaseId) {
    err('WRONG_CASE', 'trusted reference is for another case');
  } else if (!Number.isSafeInteger(ref.minSequence) || ref.minSequence < 1 || (ref.headHashAtMinSequence !== undefined && !isHex64(ref.headHashAtMinSequence))) {
    // Freshness stays UNKNOWN: a malformed reference proves nothing.
    err('SCHEMA_INVALID', 'trusted reference is malformed');
  } else {
    if (ref.minSequence > events.length) {
      err('MISSING_ANCHORED_HISTORY', `the trusted reference knows ${ref.minSequence} events; the package has ${events.length}`);
    } else if (ref.headHashAtMinSequence !== undefined && computed[ref.minSequence - 1] !== ref.headHashAtMinSequence) {
      err('REFERENCE_HEAD_MISMATCH', 'package history differs from the trusted reference (fork or rewrite)', ref.minSequence);
    }
    if (anchoredThrough >= ref.minSequence && anchoredThrough > 0) freshness = 'FRESH';
    else {
      freshness = 'STALE';
      warn('STALE_CHECKPOINT', `checkpoint anchors ${anchoredThrough}; the trusted reference requires at least ${ref.minSequence}`);
    }
  }

  // 4. Evidence: each file must match the hash registered in the verified chain.
  const files = pkg.files as Obj;
  const evidenceOut: Array<{ evidenceId: string; versionId: string; verified: boolean; isDerivative: boolean }> = [];
  const referenced = new Set<string>();
  for (const item of pkg.evidence as unknown[]) {
    if (!isObj(item) || typeof item.evidenceId !== 'string' || typeof item.versionId !== 'string' || typeof item.path !== 'string' || !SAFE_PATH.test(item.path)) {
      err('SCHEMA_INVALID', 'malformed evidence entry or unsafe path');
      continue;
    }
    // A file's location must name exactly the evidence it claims to be, so
    // anyone unpacking by path cannot be handed mislabeled bytes (re-review N1).
    if (item.path !== `evidence/${item.evidenceId}/${item.versionId}`) {
      err('EVIDENCE_PATH_MISMATCH', `${item.path} does not match ${item.evidenceId}@${item.versionId}`);
      continue;
    }
    if (referenced.has(item.path)) {
      err('EVIDENCE_DUPLICATE_ENTRY', `${item.path} is listed more than once`);
      continue;
    }
    referenced.add(item.path);
    const reg = registered.get(`${item.evidenceId}@${item.versionId}`);
    let verified = false;
    if (!reg) {
      err('EVIDENCE_NOT_REGISTERED', `${item.evidenceId}@${item.versionId} is not registered in the verified chain`);
    } else if (typeof files[item.path] !== 'string') {
      err('EVIDENCE_MISSING', `no bytes for ${item.path}`);
    } else {
      const bytes = Buffer.from(files[item.path] as string, 'base64');
      if (bytes.length !== reg.size) err('EVIDENCE_SIZE_MISMATCH', `${item.path} size differs from registration`);
      else if (sha256Hex(bytes) !== reg.sha256) err('EVIDENCE_HASH_MISMATCH', `${item.path} bytes differ from the registered hash`);
      else if (reg.sequence > anchoredThrough) warn('EVIDENCE_UNANCHORED', `${item.path} is registered after the checkpoint`);
      else verified = true;
    }
    evidenceOut.push({ evidenceId: item.evidenceId, versionId: item.versionId, verified, isDerivative: reg?.derivative ?? false });
  }
  // Every file in the package must be accounted for: nothing may ride along unverified.
  for (const path of Object.keys(files)) {
    if (!referenced.has(path)) err('EVIDENCE_UNLISTED_FILE', `${path.slice(0, 160)} is in the package but not in the evidence list`);
  }

  // Nothing is reported as verified inside a failed package.
  const failed = findings.some((f) => f.severity === 'error');
  return report(validThrough, anchoredThrough, events.length, freshness, failed ? evidenceOut.map((e) => ({ ...e, verified: false })) : evidenceOut);
}
