// Composition root for local runs (demo app, scripts): the full domain over
// in-memory adapters, seeded with the synthetic fixtures. Not for production:
// state lives in memory and the checkpoint key is a fixed demo seed.

import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { AgentToolService } from './agent-tools.ts';
import { ApprovalService } from './approvals.ts';
import { CaseReadService } from './case-read.ts';
import { MemoryAuditLog } from './audit.ts';
import { CheckpointAuthority } from './checkpoint.ts';
import { signingKeyFromSeed } from './crypto.ts';
import { CustodyService, type Promoter } from './custody.ts';
import { EvidenceService, MemoryObjectStore, StaticCaseScope } from './evidence.ts';
import { ExportService } from './export.ts';
import { FindingService } from './findings.ts';
import { loadManifest, readFixtureBytes } from './fixtures.ts';
import { Ledger } from './ledger.ts';
import { MemoryDirectory } from './policy.ts';
import { ProposalService } from './proposals.ts';
import { ManifestProvenance } from './provenance.ts';
import { MemoryStore } from './store.ts';
import { APPEND_ONLY_TABLES } from './tables.ts';
import type { ToolDefinition } from './tool-schema.ts';
import type { RequestContext } from './types.ts';

export const DEMO = {
  caseId: 'BLACKWATER-2021',
  agentId: 'coc-audit-agent',
  users: { investigator: 'owen.hale', auditor: 'mara.voss', supervisor: 'elena.ward', supervisor2: 'ruth.kim', outsider: 'adrian.cole' },
  otherCase: 'GREYHOLLOW-2019',
} as const;

const repoFile = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

export function createLocalDomain() {
  const store = new MemoryStore({ appendOnlyTables: APPEND_ONLY_TABLES });
  const u = DEMO.users;
  const directory = new MemoryDirectory(
    [
      { caseId: DEMO.caseId, userId: u.investigator, role: 'investigator' },
      { caseId: DEMO.caseId, userId: u.auditor, role: 'auditor' },
      { caseId: DEMO.caseId, userId: u.supervisor, role: 'supervisor' },
      { caseId: DEMO.caseId, userId: u.supervisor2, role: 'supervisor' },
      { caseId: DEMO.otherCase, userId: u.outsider, role: 'supervisor' },
    ],
    [{ agentId: DEMO.agentId, caseId: DEMO.caseId }],
  );
  const audit = new MemoryAuditLog();
  const ledger = new Ledger(store);
  const objects = new MemoryObjectStore();
  const scopeFile = JSON.parse(repoFile('policy/case-scope.json')) as { caseId: string; evidenceIds: string[] };
  const scope = new StaticCaseScope([scopeFile]);
  const base = { store, directory, audit };
  let promoter: Promoter | undefined;
  const custody = new CustodyService({ ...base, ledger }, { onPromoter: (p) => { promoter = p; } });
  if (!promoter) throw new Error('promoter not provided');
  const proposals = new ProposalService(base, promoter);
  const evidence = new EvidenceService({ ...base, ledger, objects, scope });
  const approvals = new ApprovalService(base, { ttlMs: 3600000 });
  const signingKey = signingKeyFromSeed(Buffer.alloc(32, 42)); // demo key only
  const checkpoints = new CheckpointAuthority(signingKey, store, ledger);
  const exports = new ExportService({ ...base, ledger, evidence, approvals, checkpoints });
  const findings = new FindingService({ ...base, ledger });
  const manifest = loadManifest();
  const provenance = new ManifestProvenance(manifest);
  const tools = JSON.parse(repoFile('policy/tools/evidence-tools.json')) as ToolDefinition[];
  const agentTools = new AgentToolService({ tools, evidence, findings, proposals, provenance, audit });
  const caseRead = new CaseReadService({ ...base, ledger, checkpoints });
  return { store, directory, audit, ledger, objects, custody, proposals, evidence, approvals, checkpoints, exports, findings, provenance, agentTools, caseRead, manifest, signingKey };
}
export type LocalDomain = ReturnType<typeof createLocalDomain>;

export function humanCtx(userId: string, requestId: string, now = new Date()): RequestContext {
  return { principal: { type: 'human', userId }, channel: 'api', requestId, now };
}

// Registers every fixture version as the investigator; returns "BW-002/original" -> versionId.
export async function seedFixtures(d: LocalDomain): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  let n = 0;
  for (const item of d.manifest.items) {
    for (const v of item.versions) {
      const ctx = humanCtx(DEMO.users.investigator, `seed-${(n += 1)}`);
      const bytes = readFixtureBytes(v.path);
      const r = v.derivedFrom
        ? await d.evidence.registerDerivative(ctx, DEMO.caseId, { evidenceId: item.evidenceId, parentVersionId: versions.get(`${item.evidenceId}/${v.derivedFrom.label}`), transformation: v.derivedFrom.transformation, bytes, mediaType: v.mediaType })
        : await d.evidence.register(ctx, DEMO.caseId, { evidenceId: item.evidenceId, bytes, mediaType: v.mediaType });
      if (!r.ok || r.value.kind !== 'evidence_registered') throw new Error(`seed failed for ${item.evidenceId}/${v.label}: ${r.ok ? 'wrong kind' : r.code}`);
      versions.set(`${item.evidenceId}/${v.label}`, r.value.body.versionId);
    }
  }
  return versions;
}
