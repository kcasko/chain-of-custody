// Loads and checks the synthetic fixture manifest (T01). Hashes and sizes
// always come from the actual fixture bytes.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { sha256Hex } from './crypto.ts';

export interface FixtureVersion {
  label: string;
  path: string;
  mediaType: string;
  derivedFrom: { label: string; transformation: string } | null;
  sourceClock: string;
  timezone: string;
  rawTimes: string[];
  offsetUncertainty: string;
  sha256: string | null;
  size: number | null;
}
export interface FixtureItem { evidenceId: string; title: string; depth: 'deep' | 'inventory'; versions: FixtureVersion[] }
export interface FixtureManifest { schema: string; caseId: string; synthetic: true; provenanceNote: string; items: FixtureItem[] }

export const FIXTURE_ROOT = resolve(import.meta.dirname, '..', '..', 'fixtures');

export function loadManifest(root = FIXTURE_ROOT): FixtureManifest {
  return JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as FixtureManifest;
}

// Resolves a manifest path and refuses anything outside fixtures/evidence.
export function fixturePath(rel: string, root = FIXTURE_ROOT): string {
  const evidenceRoot = resolve(root, 'evidence');
  const full = resolve(root, rel);
  if (!full.startsWith(evidenceRoot + sep)) throw new Error(`fixture path escapes fixtures/evidence: ${rel}`);
  return full;
}

export function readFixtureBytes(rel: string, root = FIXTURE_ROOT): Buffer {
  return readFileSync(fixturePath(rel, root));
}

export function listEvidenceFiles(root = FIXTURE_ROOT): string[] {
  const base = join(root, 'evidence');
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(root, p).split(sep).join('/'));
    }
  };
  walk(base);
  return out.sort();
}

// Returns a copy of the manifest with sha256 and size computed from the bytes.
export function withComputedHashes(manifest: FixtureManifest, root = FIXTURE_ROOT): FixtureManifest {
  const copy = structuredClone(manifest);
  for (const item of copy.items) {
    for (const v of item.versions) {
      const bytes = readFixtureBytes(v.path, root);
      v.sha256 = sha256Hex(bytes);
      v.size = bytes.length;
    }
  }
  return copy;
}
