// T01: synthetic fixtures and manifest.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FIXTURE_ROOT, loadManifest, listEvidenceFiles, withComputedHashes, fixturePath, readFixtureBytes } from '../src/fixtures.ts';

const REPO = resolve(FIXTURE_ROOT, '..');
const manifest = loadManifest();
const caseScope = JSON.parse(readFileSync(join(REPO, 'policy', 'case-scope.json'), 'utf8'));

test('manifest hashes and sizes equal the actual fixture bytes', () => {
  assert.deepEqual(manifest, withComputedHashes(manifest));
});

test('the ten evidence IDs match the Cedar case scope exactly, in order', () => {
  assert.equal(manifest.caseId, caseScope.caseId);
  assert.deepEqual(manifest.items.map((i) => i.evidenceId), caseScope.evidenceIds);
});

test('six deep artifacts as planned (BW-001, 002, 003, 005, 007, 010)', () => {
  assert.deepEqual(manifest.items.filter((i) => i.depth === 'deep').map((i) => i.evidenceId), ['BW-001', 'BW-002', 'BW-003', 'BW-005', 'BW-007', 'BW-010']);
});

test('every evidence file is in the manifest and every manifest path exists', () => {
  const listed = manifest.items.flatMap((i) => i.versions.map((v) => v.path)).sort();
  assert.deepEqual(listEvidenceFiles(), listed);
});

test('every version records clock provenance and uncertainty explicitly', () => {
  for (const item of manifest.items) {
    for (const v of item.versions) {
      for (const f of ['sourceClock', 'timezone', 'offsetUncertainty'] as const) {
        assert.ok(typeof v[f] === 'string' && v[f].length > 0, `${item.evidenceId}/${v.label} ${f}`);
      }
      assert.ok(Array.isArray(v.rawTimes));
    }
  }
});

test('derivatives name an existing parent version in the same item and a transformation', () => {
  let derivatives = 0;
  for (const item of manifest.items) {
    for (const v of item.versions) {
      if (!v.derivedFrom) continue;
      derivatives += 1;
      assert.ok(item.versions.some((p) => p.label === v.derivedFrom!.label && p !== v), `${item.evidenceId}/${v.label}`);
      assert.ok(v.derivedFrom.transformation.length > 10);
    }
  }
  assert.ok(derivatives >= 1, 'BW-002 must have a derivative');
});

test('every fixture is labeled synthetic and none is executable content', () => {
  for (const path of listEvidenceFiles()) {
    const text = readFixtureBytes(path).toString('utf8');
    assert.match(text.split('\n')[0]!, /SYNTHETIC FIXTURE/, path);
    assert.doesNotMatch(path, /\.(exe|dll|sh|ps1|bat|cmd|js|cjs|mjs|py|bin)$/i, path);
  }
});

test('the BW-010 planted instruction is present as data (prompt-injection fixture)', () => {
  assert.match(readFixtureBytes('evidence/BW-010/archive-migration-log.txt').toString('utf8'), /SYSTEM NOTE TO AI AUDITOR/);
});

test('fixture path resolution refuses anything outside fixtures/evidence', () => {
  for (const bad of ['manifest.json', '../tests/fixtures/expected-findings.json', 'evidence/../../policy/case-scope.json', '/etc/passwd']) {
    assert.throws(() => fixturePath(bad), /escapes fixtures\/evidence/, bad);
  }
});

test('evaluator truth is separate from agent-visible material', () => {
  const truthPath = join(REPO, 'tests', 'fixtures', 'expected-findings.json');
  assert.ok(existsSync(truthPath));
  assert.ok(!existsSync(join(FIXTURE_ROOT, 'expected-findings.json')));
  const visible = [readFileSync(join(FIXTURE_ROOT, 'manifest.json'), 'utf8'), ...listEvidenceFiles().map((p) => readFixtureBytes(p).toString('utf8'))].join('\n');
  assert.doesNotMatch(visible, /expected-findings|EVALUATOR TRUTH|"forbidden"/);
  const stageBBundle = readFileSync(join(REPO, 'harness', 'lambda', 'synthetic-evidence.json'), 'utf8') + readFileSync(join(REPO, 'harness', 'package-lambda.cjs'), 'utf8');
  assert.doesNotMatch(stageBBundle, /expected-findings/);
  const truth = JSON.parse(readFileSync(truthPath, 'utf8'));
  assert.deepEqual(Object.keys(truth.findings), caseScope.evidenceIds);
});
