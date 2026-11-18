// T03: version-pinned evidence storage, derivative lineage, failure handling.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { MemoryObjectStore, ObjectExistsError, EvidenceService } from '../src/evidence.ts';
import { FaultyStore, AppendOnlyViolation } from '../src/store.ts';
import { sha256Hex } from '../src/crypto.ts';
import { loadManifest } from '../src/fixtures.ts';
import { CASE, OTHER_CASE, USERS, human, agent, makeWorld, makeStore, registerFixtures } from './helpers.ts';

const manifest = loadManifest();
const manifestHash = (id: string, label: string) => manifest.items.find((i) => i.evidenceId === id)!.versions.find((v) => v.label === label)!.sha256;

class CorruptibleObjects extends MemoryObjectStore {
  corrupt(key: string, versionId: string): void {
    const b = this.objects.get(key)!.get(versionId)!;
    b[0] = (b[0]! + 1) % 256;
  }
  lose(key: string): void {
    this.objects.delete(key);
  }
}

test('L02/L03: every fixture registers and reads back by exact version with the manifest hash', async () => {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  for (const item of manifest.items) {
    for (const v of item.versions) {
      const r = await w.evidence.read(human(USERS.auditor), CASE, { evidenceId: item.evidenceId, versionId: versions.get(`${item.evidenceId}/${v.label}`)! });
      assert.ok(r.ok, `${item.evidenceId}/${v.label}`);
      assert.equal(r.value.sha256, v.sha256);
      assert.equal(sha256Hex(r.value.bytes), v.sha256);
    }
  }
});

test('the storage and service surfaces have no latest, overwrite, list or delete operations', () => {
  const objectMethods = Object.getOwnPropertyNames(MemoryObjectStore.prototype).filter((n) => n !== 'constructor').sort();
  assert.deepEqual(objectMethods, ['getVersion', 'putNew']);
  const serviceMethods = Object.getOwnPropertyNames(EvidenceService.prototype).filter((n) => n !== 'constructor');
  for (const m of serviceMethods) assert.doesNotMatch(m, /latest|overwrite|update|delete|remove|replace/i, m);
});

test('originals are write-once at the storage port', async () => {
  const objects = new MemoryObjectStore();
  await objects.putNew('originals/x', Buffer.from('a'));
  await assert.rejects(() => objects.putNew('originals/x', Buffer.from('b')), ObjectExistsError);
});

test('V12: an unregistered version is not found; a registered but missing version fails explicitly', async () => {
  const objects = new CorruptibleObjects();
  const w = makeWorld({ objects });
  const versions = await registerFixtures(w);
  for (const versionId of ['latest', 'null', 'v-does-not-exist']) {
    const r = await w.evidence.read(human(USERS.auditor), CASE, { evidenceId: 'BW-001', versionId });
    assert.equal(!r.ok && r.code, 'NOT_FOUND', versionId);
  }
  const reg = (await w.evidence.list(human(USERS.auditor), CASE));
  assert.ok(reg.ok);
  const bw7 = reg.value.find((b) => b.evidenceId === 'BW-007')!;
  objects.lose(bw7.objectKey);
  const missing = await w.evidence.read(human(USERS.auditor), CASE, { evidenceId: 'BW-007', versionId: versions.get('BW-007/original')! });
  assert.equal(!missing.ok && missing.code, 'EVIDENCE_VERSION_MISSING');
});

test('V11: bytes changed in storage are detected on read (fail closed)', async () => {
  const objects = new CorruptibleObjects();
  const w = makeWorld({ objects });
  const versions = await registerFixtures(w);
  const reg = await w.evidence.list(human(USERS.auditor), CASE);
  assert.ok(reg.ok);
  const bw3 = reg.value.find((b) => b.evidenceId === 'BW-003')!;
  objects.corrupt(bw3.objectKey, bw3.versionId);
  const r = await w.evidence.read(human(USERS.auditor), CASE, { evidenceId: 'BW-003', versionId: versions.get('BW-003/original')! });
  assert.equal(!r.ok && r.code, 'INTEGRITY_FAILURE');
  assert.equal(w.audit.events.at(-1)?.outcome, 'failed');
});

test('A09: a different object planted later never replaces the pinned original', async () => {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  await w.objects.putNew(`originals/${CASE}/BW-003/attacker-copy`, Buffer.from('SYNTHETIC FIXTURE - tampered copy'));
  const r = await w.evidence.read(human(USERS.auditor), CASE, { evidenceId: 'BW-003', versionId: versions.get('BW-003/original')! });
  assert.ok(r.ok);
  assert.equal(r.value.sha256, manifestHash('BW-003', 'original'));
});

test('L07/V15: a derivative keeps its lineage and is never presented as an original', async () => {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  const original = await w.evidence.read(human(USERS.auditor), CASE, { evidenceId: 'BW-002', versionId: versions.get('BW-002/original')! });
  const derived = await w.evidence.read(human(USERS.auditor), CASE, { evidenceId: 'BW-002', versionId: versions.get('BW-002/transcode-2026')! });
  assert.ok(original.ok && derived.ok);
  assert.equal(original.value.isDerivative, false);
  assert.equal(derived.value.isDerivative, true);
  assert.equal(derived.value.derivedFrom?.versionId, versions.get('BW-002/original'));
  assert.match(derived.value.derivedFrom!.transformation, /transcode/);
  assert.notEqual(original.value.sha256, derived.value.sha256, 'different bytes are expected for a derivative');
});

test('derivatives need a registered parent in the same case and evidence item, and a transformation', async () => {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  const base = { evidenceId: 'BW-002', transformation: 'crop', bytes: Buffer.from('derived'), mediaType: 'text/plain' };
  const noParent = await w.evidence.registerDerivative(human(USERS.investigator), CASE, { ...base, parentVersionId: 'v-missing' });
  assert.equal(!noParent.ok && noParent.code, 'NOT_FOUND');
  const otherItem = await w.evidence.registerDerivative(human(USERS.investigator), CASE, { ...base, evidenceId: 'BW-003', parentVersionId: versions.get('BW-002/original') });
  assert.equal(!otherItem.ok && otherItem.code, 'NOT_FOUND');
  const crossCase = await w.evidence.registerDerivative(human(USERS.outsider), OTHER_CASE, { ...base, parentVersionId: versions.get('BW-002/original') });
  assert.equal(!crossCase.ok && crossCase.code, 'NOT_FOUND');
  const noTransform = await w.evidence.registerDerivative(human(USERS.investigator), CASE, { ...base, transformation: '  ', parentVersionId: versions.get('BW-002/original') });
  assert.equal(!noTransform.ok && noTransform.code, 'INVALID_REQUEST');
});

test('registration failure after storing bytes leaves them quarantined and unregistered', async () => {
  const faulty = new FaultyStore(makeStore());
  const w = makeWorld({ store: faulty });
  faulty.failTransactWhen = (writes) => writes.some((x) => x.table === 'events');
  const r = await w.evidence.register(human(USERS.investigator), CASE, { evidenceId: 'BW-001', bytes: Buffer.from('SYNTHETIC x'), mediaType: 'text/plain' });
  assert.equal(!r.ok && r.code, 'REGISTRATION_FAILED');
  assert.match(!r.ok ? r.detail : '', /quarantined/);
  assert.equal((await w.ledger.head(CASE)).sequence, 0);
  const qr = await w.evidence.quarantined(human(USERS.supervisor), CASE);
  assert.ok(qr.ok);
  const q = qr.value;
  assert.equal(q.length, 1);
  const listed = await w.evidence.list(human(USERS.auditor), CASE);
  assert.ok(listed.ok);
  assert.equal(listed.value.length, 0);
});

test('storage failure registers nothing; storage confirmation mismatch is quarantined', async () => {
  class FailingPut extends MemoryObjectStore {
    override async putNew(): Promise<{ versionId: string }> { throw new Error('S3 down'); }
  }
  const w1 = makeWorld({ objects: new FailingPut() });
  const r1 = await w1.evidence.register(human(USERS.investigator), CASE, { evidenceId: 'BW-001', bytes: Buffer.from('x'), mediaType: 'text/plain' });
  assert.equal(!r1.ok && r1.code, 'STORAGE_UNAVAILABLE');
  assert.equal((await w1.ledger.head(CASE)).sequence, 0);

  class LyingStore extends MemoryObjectStore {
    override async getVersion(): Promise<Uint8Array | undefined> { return Buffer.from('different'); }
  }
  const w2 = makeWorld({ objects: new LyingStore() });
  const r2 = await w2.evidence.register(human(USERS.investigator), CASE, { evidenceId: 'BW-001', bytes: Buffer.from('x'), mediaType: 'text/plain' });
  assert.equal(!r2.ok && r2.code, 'REGISTRATION_FAILED');
  const q2 = await w2.evidence.quarantined(human(USERS.supervisor), CASE);
  assert.equal(q2.ok && q2.value.length, 1);
  assert.equal((await w2.ledger.head(CASE)).sequence, 0);
});

test('audit store down: no bytes stored, no event written (V13)', async () => {
  class CountingObjects extends MemoryObjectStore {
    puts = 0;
    override async putNew(key: string, bytes: Uint8Array): Promise<{ versionId: string }> { this.puts += 1; return super.putNew(key, bytes); }
  }
  const objects = new CountingObjects();
  const w = makeWorld({ objects });
  w.audit.available = false;
  const r = await w.evidence.register(human(USERS.investigator), CASE, { evidenceId: 'BW-001', bytes: Buffer.from('x'), mediaType: 'text/plain' });
  assert.equal(!r.ok && r.code, 'DENIED_AUDIT_UNAVAILABLE');
  assert.equal(objects.puts, 0);
  assert.equal((await w.ledger.head(CASE)).sequence, 0);
});

test('who may register and read: agent reads via gateway only, cannot register; auditor cannot register', async () => {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  const input = { evidenceId: 'BW-004', bytes: Buffer.from('x'), mediaType: 'text/plain' };
  const byAgent = await w.evidence.register(agent(), CASE, input);
  assert.equal(!byAgent.ok && byAgent.code, 'DENIED_AGENT');
  const byAuditor = await w.evidence.register(human(USERS.auditor), CASE, input);
  assert.equal(!byAuditor.ok && byAuditor.code, 'DENIED_ROLE');
  const agentRead = await w.evidence.read(agent(), CASE, { evidenceId: 'BW-010', versionId: versions.get('BW-010/original')! });
  assert.ok(agentRead.ok, 'the agent can read pinned evidence (legitimate control)');
  assert.match(Buffer.from(agentRead.value.bytes).toString('utf8'), /SYSTEM NOTE TO AI AUDITOR/, 'planted text is returned as data');
});

test('cross-case access is denied or not found, never leaked', async () => {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  const ref = { evidenceId: 'BW-001', versionId: versions.get('BW-001/original')! };
  const outsider = await w.evidence.read(human(USERS.outsider), CASE, ref);
  assert.equal(!outsider.ok && outsider.code, 'DENIED_NOT_MEMBER');
  const viaOtherCase = await w.evidence.read(human(USERS.outsider), OTHER_CASE, ref);
  assert.equal(!viaOtherCase.ok && viaOtherCase.code, 'NOT_FOUND');
});

test('input validation: scope, media type, size and closed shape', async () => {
  const w = makeWorld();
  const ok = { evidenceId: 'BW-001', bytes: Buffer.from('x'), mediaType: 'text/plain' };
  for (const bad of [
    { ...ok, evidenceId: 'BW-011' },
    { ...ok, evidenceId: '../BW-001' },
    { ...ok, mediaType: 'application/x-msdownload' },
    { ...ok, bytes: Buffer.alloc(0) },
    { ...ok, bytes: 'not bytes' },
    { ...ok, actor: 'supervisor' },
    { ...ok, transformation: 'sneaky', parentVersionId: 'v-1' },
  ]) {
    const r = await w.evidence.register(human(USERS.investigator), CASE, bad as typeof ok);
    assert.equal(!r.ok && r.code, 'INVALID_REQUEST', JSON.stringify(Object.keys(bad)));
  }
  assert.equal((await w.ledger.head(CASE)).sequence, 0);
});

test('returned bytes are copies: mutating them cannot change stored evidence', async () => {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  const ref = { evidenceId: 'BW-005', versionId: versions.get('BW-005/original')! };
  const first = await w.evidence.read(human(USERS.auditor), CASE, ref);
  assert.ok(first.ok);
  first.value.bytes[0] = 0;
  const second = await w.evidence.read(human(USERS.auditor), CASE, ref);
  assert.ok(second.ok);
  assert.equal(second.value.sha256, manifestHash('BW-005', 'original'));
});

test('registration events cannot be overwritten through the store (append-only table)', async () => {
  const w = makeWorld();
  await registerFixtures(w);
  await assert.rejects(() => w.store.transact([{ table: 'events', key: `${CASE}#000000000001`, value: { forged: true }, expectVersion: 1 }]), AppendOnlyViolation);
});
