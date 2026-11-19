// The offline verifier CLI (core/tools/verify-export.ts): exit codes and
// output for a valid package, a tampered one, a wrong trust key and bad usage.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Trust } from '../src/verifier.ts';
import { signingKeyFromSeed } from '../src/crypto.ts';
import { CASE, USERS, human, makeWorld, registerFixtures } from './helpers.ts';

const CLI = fileURLToPath(new URL('../tools/verify-export.ts', import.meta.url));

async function exported() {
  const w = makeWorld();
  const versions = await registerFixtures(w);
  const t = await w.custody.recordTransfer(human(USERS.investigator), CASE, { evidenceId: 'BW-007', versionId: versions.get('BW-007/original')!, from: 'locker', to: 'audit', reason: 'review' });
  assert.ok(t.ok);
  assert.ok((await w.checkpoints.issue(CASE, new Date('2026-11-18T17:00:00.000Z'))).ok);
  const payload = { evidence: [{ evidenceId: 'BW-001', versionId: versions.get('BW-001/original')! }], destination: 'internal:case-export-store' };
  const req = await w.approvals.requestExport(human(USERS.investigator), CASE, payload);
  assert.ok(req.ok);
  assert.ok((await w.approvals.approve(human(USERS.supervisor), req.value.approvalId)).ok);
  const pkg = await w.exports.exportCase(human(USERS.investigator), CASE, req.value.approvalId, payload);
  assert.ok(pkg.ok, JSON.stringify(pkg));
  const head = await w.ledger.head(CASE);
  const trust: Trust = { expectedCaseId: CASE, keys: [w.trustedKey], reference: { caseId: CASE, minSequence: head.sequence, headHashAtMinSequence: head.hash, retrievedAt: '2026-11-18T17:05:00.000Z' } };
  return { pkg: JSON.parse(JSON.stringify(pkg.value)), trust };
}

function run(dir: string, pkg: unknown, trust: unknown, extra: string[] = []) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  writeFileSync(join(dir, 'trust.json'), JSON.stringify(trust));
  return spawnSync(process.execPath, [CLI, join(dir, 'package.json'), join(dir, 'trust.json'), ...extra], { encoding: 'utf8' });
}

test('verify-export CLI: 0 for a valid package, 1 for tampering or an untrusted key, 2 for bad usage', async () => {
  const { pkg, trust } = await exported();
  const dir = mkdtempSync(join(tmpdir(), 'coc-verify-'));
  try {
    const good = run(dir, pkg, trust);
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /Status:\s+VERIFIED\n/);
    assert.match(good.stdout, /Freshness:\s+FRESH/);
    assert.match(good.stdout, /does not prove the original material is authentic/);

    const json = run(dir, pkg, trust, ['--json']);
    assert.equal(JSON.parse(json.stdout).status, 'VERIFIED');

    const edited = JSON.parse(JSON.stringify(pkg));
    const transfer = edited.events.find((e: { kind: string }) => e.kind === 'custody_transfer');
    transfer.body.to = 'somewhere else';
    const bad = run(dir, edited, trust);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /Status:\s+FAILED/);
    assert.match(bad.stdout, /ERROR /);

    const otherKey = signingKeyFromSeed(Buffer.alloc(32, 7));
    const wrongTrust = { ...trust, keys: [{ keyId: otherKey.keyId, publicKeyHex: otherKey.publicKeyRaw.toString('hex') }] };
    const untrusted = run(dir, pkg, wrongTrust);
    assert.equal(untrusted.status, 1, 'a checkpoint signed by a key the recipient does not trust is not a pass');

    const usage = spawnSync(process.execPath, [CLI, join(dir, 'package.json')], { encoding: 'utf8' });
    assert.equal(usage.status, 2);
    assert.match(usage.stderr, /usage:/);
    writeFileSync(join(dir, 'broken.json'), '{ not json');
    const broken = spawnSync(process.execPath, [CLI, join(dir, 'broken.json'), join(dir, 'trust.json')], { encoding: 'utf8' });
    assert.equal(broken.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
