// T04: approval-gated export and the independent verifier.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { verifyExport, type Trust } from '../src/verifier.ts';
import { computeEventHash } from '../src/ledger.ts';
import { signingKeyFromSeed, signCheckpointBody, ZERO_HASH } from '../src/crypto.ts';
import type { ExportPackage } from '../src/export.ts';
import type { CustodyEvent, SignedCheckpoint } from '../src/types.ts';
import { CASE, OTHER_CASE, USERS, human, makeWorld, registerFixtures, type World } from './helpers.ts';

const DEST = 'internal:case-export-store';

async function exported(): Promise<{ w: World; pkg: ExportPackage; trust: Trust; versions: Map<string, string> }> {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  const t = await w.custody.recordTransfer(human(USERS.investigator), CASE, { evidenceId: 'BW-007', versionId: versions.get('BW-007/original')!, from: 'locker', to: 'audit', reason: 'review' });
  assert.ok(t.ok);
  const c = await w.custody.appendCorrection(human(USERS.auditor), CASE, { targetSequence: t.value.sequence, targetHash: t.value.eventHash, reason: 'room name corrected' });
  assert.ok(c.ok);
  assert.ok((await w.checkpoints.issue(CASE, new Date('2026-11-18T17:00:00.000Z'))).ok);
  const payload = { evidence: ['BW-001/original', 'BW-002/original', 'BW-002/transcode-2026', 'BW-010/original'].map((k) => ({ evidenceId: k.split('/')[0]!, versionId: versions.get(k)! })), destination: DEST };
  const req = await w.approvals.requestExport(human(USERS.investigator), CASE, payload);
  assert.ok(req.ok);
  assert.ok((await w.approvals.approve(human(USERS.supervisor), req.value.approvalId)).ok);
  const pkg = await w.exports.exportCase(human(USERS.investigator), CASE, req.value.approvalId, payload);
  assert.ok(pkg.ok, JSON.stringify(pkg));
  const head = await w.ledger.head(CASE);
  const trust: Trust = { expectedCaseId: CASE, keys: [w.trustedKey], reference: { caseId: CASE, minSequence: head.sequence, headHashAtMinSequence: head.hash, retrievedAt: '2026-11-18T17:05:00.000Z' } };
  return { w, pkg: pkg.value, trust, versions };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const codes = (r: ReturnType<typeof verifyExport>) => r.findings.map((f) => f.code);
function rehash(e: CustodyEvent): CustodyEvent {
  const { eventHash: _ignored, ...rest } = e;
  return { ...rest, eventHash: computeEventHash(rest) } as CustodyEvent;
}

test('L05/L08: an approved export verifies independently: VERIFIED, fully anchored, fresh', async () => {
  const { pkg, trust } = await exported();
  const r = verifyExport(clone(pkg), trust);
  assert.equal(r.status, 'VERIFIED', JSON.stringify(r.findings));
  assert.equal(r.validThrough, 14);
  assert.equal(r.anchoredThrough, 14);
  assert.equal(r.freshness, 'FRESH');
  assert.equal(r.evidence.length, 4);
  assert.ok(r.evidence.every((e) => e.verified));
  assert.deepEqual(r.evidence.filter((e) => e.isDerivative).map((e) => e.evidenceId), ['BW-002'], 'V15: the derivative is reported as one');
});

test('without an outside reference the result is honest: warnings, freshness unknown', async () => {
  const { pkg, trust } = await exported();
  const r = verifyExport(clone(pkg), { expectedCaseId: CASE, keys: trust.keys });
  assert.equal(r.status, 'VERIFIED_WITH_WARNINGS');
  assert.equal(r.freshness, 'UNKNOWN');
  assert.deepEqual(codes(r), ['FRESHNESS_UNKNOWN']);
});

test('A10: editing an event is detected at that sequence', async () => {
  const { pkg, trust } = await exported();
  const p = clone(pkg) as unknown as { events: CustodyEvent[] };
  (p.events[12]!.body as { to: string }).to = 'my desk';
  const r = verifyExport(p, trust);
  assert.equal(r.status, 'FAILED');
  assert.ok(r.findings.some((f) => f.code === 'EVENT_HASH_MISMATCH' && f.sequence === 13));
  assert.equal(r.validThrough, 12);
  assert.equal(r.anchoredThrough, 0);
});

test('editing an event and recomputing its own hash breaks the next link', async () => {
  const { pkg, trust } = await exported();
  const p = clone(pkg) as unknown as { events: CustodyEvent[] };
  (p.events[5]!.body as { mediaType: string }).mediaType = 'application/pdf';
  p.events[5] = rehash(p.events[5]!);
  const r = verifyExport(p, trust);
  assert.ok(r.findings.some((f) => f.code === 'PREV_HASH_MISMATCH' && f.sequence === 7));
  assert.equal(r.status, 'FAILED');
});

test('rewriting history and recomputing every hash is caught by the signed checkpoint and the reference', async () => {
  const { pkg, trust } = await exported();
  const p = clone(pkg) as unknown as { events: CustodyEvent[]; checkpoint: SignedCheckpoint | null };
  (p.events[2]!.body as { mediaType: string }).mediaType = 'application/pdf';
  // A competent forger also repoints corrections at the forged targets; otherwise
  // the correction link alone exposes the rewrite (CORRECTION_TARGET_INVALID).
  let prev = ZERO_HASH;
  const forgedHashes: string[] = [];
  p.events = p.events.map((e) => {
    let next = { ...e, prevHash: prev } as CustodyEvent;
    if (next.kind === 'correction') next = { ...next, body: { ...next.body, targetHash: forgedHashes[next.body.targetSequence - 1]! } } as CustodyEvent;
    const forged = rehash(next);
    forgedHashes.push(forged.eventHash);
    prev = forged.eventHash;
    return forged;
  });
  const withCheckpoint = verifyExport(p, { expectedCaseId: CASE, keys: trust.keys });
  assert.ok(codes(withCheckpoint).includes('CHECKPOINT_HEAD_MISMATCH'));
  assert.equal(withCheckpoint.status, 'FAILED');

  // The limit, stated honestly: with no checkpoint and no reference, a fully
  // recomputed chain is self-consistent. The verifier still refuses to call it verified.
  p.checkpoint = null;
  const bare = verifyExport(p, { expectedCaseId: CASE, keys: trust.keys });
  assert.equal(bare.validThrough, 14);
  assert.equal(bare.anchoredThrough, 0);
  assert.equal(bare.status, 'FAILED');
  assert.ok(codes(bare).includes('CHECKPOINT_MISSING'));
  const withRef = verifyExport(p, trust);
  assert.ok(codes(withRef).includes('REFERENCE_HEAD_MISMATCH'));
});

test('a rewrite that forgets to repoint corrections is exposed by the correction link alone', async () => {
  const { pkg, trust } = await exported();
  const p = clone(pkg) as unknown as { events: CustodyEvent[]; checkpoint: SignedCheckpoint | null };
  (p.events[12]!.body as { to: string }).to = 'my desk';
  let prev = ZERO_HASH;
  p.events = p.events.map((e) => { const f = rehash({ ...e, prevHash: prev } as CustodyEvent); prev = f.eventHash; return f; });
  p.checkpoint = null;
  const r = verifyExport(p, { expectedCaseId: CASE, keys: trust.keys });
  assert.ok(r.findings.some((f) => f.code === 'CORRECTION_TARGET_INVALID' && f.sequence === 14));
});

test('reordering events is detected', async () => {
  const { pkg, trust } = await exported();
  const p = clone(pkg) as unknown as { events: CustodyEvent[] };
  [p.events[3], p.events[4]] = [p.events[4]!, p.events[3]!];
  const r = verifyExport(p, trust);
  assert.ok(codes(r).includes('SEQUENCE_GAP') || codes(r).includes('SEQUENCE_OUT_OF_ORDER'));
  assert.ok(codes(r).includes('PREV_HASH_MISMATCH'));
  assert.equal(r.status, 'FAILED');
});

test('truncating anchored history is detected (suffix removed below the checkpoint)', async () => {
  const { pkg, trust } = await exported();
  const p = clone(pkg) as unknown as { events: CustodyEvent[] };
  p.events = p.events.slice(0, 10);
  const r = verifyExport(p, { expectedCaseId: CASE, keys: trust.keys });
  assert.ok(codes(r).includes('MISSING_ANCHORED_HISTORY'));
  assert.equal(r.status, 'FAILED');
});

test('V14: a checkpoint signed by a substituted key is rejected even if the package carries that key', async () => {
  const { pkg, trust } = await exported();
  const attacker = signingKeyFromSeed(Buffer.alloc(32, 99));
  const p = clone(pkg) as unknown as Record<string, unknown> & { checkpoint: SignedCheckpoint };
  const forgedBody = { ...p.checkpoint.body, keyId: attacker.keyId };
  p.checkpoint = { body: forgedBody, signatureHex: signCheckpointBody(attacker, forgedBody) };
  p.trustedKeys = [{ keyId: attacker.keyId, publicKeyHex: attacker.publicKeyRaw.toString('hex') }];
  p.publicKeyHex = attacker.publicKeyRaw.toString('hex');
  assert.ok(codes(verifyExport(p, trust)).includes('CHECKPOINT_UNTRUSTED_KEY'));

  const spoofedBody = { ...pkg.checkpoint!.body, sequence: 14 };
  p.checkpoint = { body: { ...spoofedBody, keyId: trust.keys[0]!.keyId }, signatureHex: signCheckpointBody(attacker, { ...spoofedBody, keyId: trust.keys[0]!.keyId }) };
  assert.ok(codes(verifyExport(p, trust)).includes('CHECKPOINT_SIGNATURE_INVALID'));
});

test('a pinned key whose ID does not match its public key is not trusted', async () => {
  const { pkg, trust } = await exported();
  const other = signingKeyFromSeed(Buffer.alloc(32, 5));
  const r = verifyExport(clone(pkg), { ...trust, keys: [{ keyId: trust.keys[0]!.keyId, publicKeyHex: other.publicKeyRaw.toString('hex') }] });
  assert.ok(codes(r).includes('CHECKPOINT_UNTRUSTED_KEY'));
});

test('a valid checkpoint from another case is rejected', async () => {
  const { w, pkg, trust } = await exported();
  const reg = await w.evidence.register(human(USERS.outsider), OTHER_CASE, { evidenceId: 'BW-001', bytes: Buffer.from('SYNTHETIC other case'), mediaType: 'text/plain' });
  assert.ok(reg.ok);
  const otherCp = await w.checkpoints.issue(OTHER_CASE, new Date('2026-11-18T17:10:00.000Z'));
  assert.ok(otherCp.ok);
  const p = clone(pkg) as unknown as { checkpoint: SignedCheckpoint };
  p.checkpoint = otherCp.value;
  assert.ok(codes(verifyExport(p, trust)).includes('CHECKPOINT_WRONG_CASE'));
});

test('a package for the wrong case, or events from another case, fail', async () => {
  const { pkg, trust } = await exported();
  assert.ok(codes(verifyExport(clone(pkg), { ...trust, expectedCaseId: OTHER_CASE })).includes('WRONG_CASE'));
});

test('stale: an older valid checkpoint is flagged only against a newer outside reference', async () => {
  const { w, pkg, trust, versions } = await exported();
  const more = await w.custody.recordTransfer(human(USERS.investigator), CASE, { evidenceId: 'BW-001', versionId: versions.get('BW-001/original')!, from: 'audit', to: 'locker', reason: 'returned' });
  assert.ok(more.ok);
  assert.ok((await w.checkpoints.issue(CASE, new Date('2026-11-18T18:00:00.000Z'))).ok);
  const newer = await w.ledger.head(CASE);
  const ref = { caseId: CASE, minSequence: newer.sequence, headHashAtMinSequence: newer.hash, retrievedAt: '2026-11-18T18:05:00.000Z' };

  // The old package is now behind the reference.
  const old = verifyExport(clone(pkg), { ...trust, reference: ref });
  assert.ok(codes(old).includes('MISSING_ANCHORED_HISTORY'));
  assert.equal(old.freshness, 'STALE');

  // A package with all events but the old checkpoint: valid but stale, with an unanchored tail.
  const stalePkg = { ...clone(pkg), events: clone(await w.ledger.events(CASE)) };
  const stale = verifyExport(stalePkg, { ...trust, reference: ref });
  assert.equal(stale.status, 'VERIFIED_WITH_WARNINGS');
  assert.deepEqual(codes(stale).sort(), ['STALE_CHECKPOINT', 'UNANCHORED_TAIL']);
  assert.equal(stale.anchoredThrough, 14);
  assert.equal(stale.validThrough, 15);
});

test('V11: changed, missing or unregistered evidence files are detected; unsafe paths refused', async () => {
  const { pkg, trust } = await exported();
  const path = pkg.evidence[0]!.path;
  const changed = clone(pkg) as unknown as { files: Record<string, string> };
  const bytes = Buffer.from(changed.files[path]!, 'base64');
  bytes[0] = (bytes[0]! + 1) % 256;
  changed.files[path] = bytes.toString('base64');
  assert.ok(codes(verifyExport(changed, trust)).includes('EVIDENCE_HASH_MISMATCH'));

  const missing = clone(pkg) as unknown as { files: Record<string, string> };
  delete missing.files[path];
  assert.ok(codes(verifyExport(missing, trust)).includes('EVIDENCE_MISSING'));

  const unregistered = clone(pkg) as unknown as { evidence: Array<Record<string, unknown>> };
  unregistered.evidence.push({ evidenceId: 'BW-004', versionId: 'v-ghost', sha256: '0'.repeat(64), size: 1, path: 'evidence/BW-004/v-ghost' });
  assert.ok(codes(verifyExport(unregistered, trust)).includes('EVIDENCE_NOT_REGISTERED'));

  const traversal = clone(pkg) as unknown as { evidence: Array<Record<string, unknown>> };
  traversal.evidence[0]!.path = '../../etc/passwd';
  assert.ok(codes(verifyExport(traversal, trust)).includes('SCHEMA_INVALID'));
});

test('a correction pointing at a forged target hash is reported', async () => {
  const { pkg, trust } = await exported();
  const p = clone(pkg) as unknown as { events: CustodyEvent[] };
  const last = p.events[13]!;
  (last.body as { targetHash: string }).targetHash = 'f'.repeat(64);
  p.events[13] = rehash(last);
  assert.ok(codes(verifyExport(p, trust)).includes('CORRECTION_TARGET_INVALID'));
});

test('garbage input never throws and always fails', () => {
  for (const g of [null, undefined, 42, 'x', [], {}, { schema: 'coc/export/v1' }, { schema: 'coc/export/v1', caseId: CASE, events: [null, 1, 'x'], evidence: [], files: {} }]) {
    const r = verifyExport(g, { expectedCaseId: CASE, keys: [] });
    assert.equal(r.status, 'FAILED', JSON.stringify(g));
  }
});

test('deterministic fuzz: 300 single-field mutations never throw and never verify', async () => {
  const { pkg, trust } = await exported();
  let seed = 1234567;
  const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const values: unknown[] = [null, 0, -1, 1.5, '', 'x', '0'.repeat(64), [], {}, true, 'é', 2 ** 60];
  const paths: Array<(p: Record<string, unknown>) => [Record<string, unknown>, string]> = [
    (p) => { const e = (p.events as Record<string, unknown>[])[rand(14)]!; const keys = Object.keys(e); return [e, keys[rand(keys.length)]!]; },
    (p) => { const e = (p.events as Record<string, unknown>[])[rand(14)]!.body as Record<string, unknown>; const keys = Object.keys(e); return [e, keys[rand(keys.length)]!]; },
    (p) => { const c = (p.checkpoint as Record<string, unknown>).body as Record<string, unknown>; const keys = Object.keys(c); return [c, keys[rand(keys.length)]!]; },
    (p) => { const e = (p.evidence as Record<string, unknown>[])[rand(4)]!; const keys = Object.keys(e); return [e, keys[rand(keys.length)]!]; },
  ];
  for (let i = 0; i < 300; i += 1) {
    const p = clone(pkg) as unknown as Record<string, unknown>;
    const [obj, key] = paths[rand(paths.length)]!(p);
    const v = values[rand(values.length)];
    if (JSON.stringify(obj[key]) === JSON.stringify(v)) continue;
    obj[key] = v;
    let r: ReturnType<typeof verifyExport> | undefined;
    assert.doesNotThrow(() => { r = verifyExport(p, trust); }, `mutation ${i}: ${key}`);
    assert.notEqual(r!.status, 'VERIFIED', `mutation ${i}: ${key}=${JSON.stringify(v)} verified`);
  }
});

test('the verifier is independent: it imports only the spec primitives and Node built-ins', () => {
  const src = readFileSync(new URL('../src/verifier.ts', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ['./crypto.ts', 'node:buffer']);
});

test('export needs a valid approval; a used approval cannot export twice; one export record per approval', async () => {
  const { w, versions } = await exported();
  const payload = { evidence: [{ evidenceId: 'BW-003', versionId: versions.get('BW-003/original')! }], destination: DEST };
  const unapproved = await w.approvals.requestExport(human(USERS.investigator), CASE, payload);
  assert.ok(unapproved.ok);
  const noApproval = await w.exports.exportCase(human(USERS.investigator), CASE, unapproved.value.approvalId, payload);
  assert.equal(!noApproval.ok && noApproval.code, 'DENIED_APPROVAL_INVALID');
  assert.ok((await w.approvals.approve(human(USERS.supervisor), unapproved.value.approvalId)).ok);
  const first = await w.exports.exportCase(human(USERS.investigator), CASE, unapproved.value.approvalId, payload);
  assert.ok(first.ok);
  const second = await w.exports.exportCase(human(USERS.investigator), CASE, unapproved.value.approvalId, payload);
  assert.equal(!second.ok && second.code, 'DENIED_APPROVAL_INVALID');
  assert.equal((await w.store.list('exports', '')).length, 2, 'one record per consumed approval (this and the setup export)');
});

test('an integrity failure during export does not consume the approval', async () => {
  const { w, versions } = await exported();
  const payload = { evidence: [{ evidenceId: 'BW-004', versionId: 'v-not-registered' }], destination: DEST };
  const req = await w.approvals.requestExport(human(USERS.investigator), CASE, payload);
  assert.ok(req.ok);
  assert.ok((await w.approvals.approve(human(USERS.supervisor), req.value.approvalId)).ok);
  const r = await w.exports.exportCase(human(USERS.investigator), CASE, req.value.approvalId, payload);
  assert.equal(!r.ok && r.code, 'NOT_FOUND');
  assert.equal((await w.approvals.getUnchecked(req.value.approvalId))?.approval.status, 'approved');
  void versions;
});
