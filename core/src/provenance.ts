// Clock and timezone provenance for evidence versions, keyed by content hash.
// Version IDs are assigned at registration, but a version's SHA-256 is fixed,
// so provenance recorded when the material was collected can be matched to
// whatever version it was registered as. Values are reported raw; nothing here
// decides which clock or source is correct.

import type { FixtureManifest } from './fixtures.ts';

export interface VersionProvenance {
  readonly label: string;
  readonly sourceClock: string;
  readonly timezone: string;
  readonly rawTimes: readonly string[];
  readonly offsetUncertainty: string;
}

export interface ProvenanceSource {
  forContent(caseId: string, sha256: string): Promise<VersionProvenance | null>;
}

export class ManifestProvenance implements ProvenanceSource {
  readonly #caseId: string;
  readonly #bySha = new Map<string, VersionProvenance>();
  constructor(manifest: FixtureManifest) {
    this.#caseId = manifest.caseId;
    for (const item of manifest.items) {
      for (const v of item.versions) {
        if (!v.sha256) throw new Error(`manifest entry ${item.evidenceId}/${v.label} has no hash`);
        this.#bySha.set(v.sha256, Object.freeze({
          label: v.label, sourceClock: v.sourceClock, timezone: v.timezone,
          rawTimes: Object.freeze([...v.rawTimes]), offsetUncertainty: v.offsetUncertainty,
        }));
      }
    }
  }
  async forContent(caseId: string, sha256: string): Promise<VersionProvenance | null> {
    return caseId === this.#caseId ? this.#bySha.get(sha256) ?? null : null;
  }
}
