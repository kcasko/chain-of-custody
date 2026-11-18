// Shared test world. Synthetic identities only.

import { MemoryStore, type TransactionalStore } from '../src/store.ts';
import { MemoryDirectory } from '../src/policy.ts';
import { MemoryAuditLog } from '../src/audit.ts';
import type { RequestContext, Principal } from '../src/types.ts';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { Ledger } from '../src/ledger.ts';
import { CustodyService, type Promoter } from '../src/custody.ts';
import { EvidenceService, MemoryObjectStore, StaticCaseScope, type ObjectStore } from '../src/evidence.ts';
import { ApprovalService } from '../src/approvals.ts';
import { CheckpointAuthority } from '../src/checkpoint.ts';
import { ExportService } from '../src/export.ts';
import { CaseReadService } from '../src/case-read.ts';
import { ProposalService } from '../src/proposals.ts';
import { signingKeyFromSeed } from '../src/crypto.ts';
import { loadManifest, readFixtureBytes } from '../src/fixtures.ts';
import { FindingService } from '../src/findings.ts';
import { ManifestProvenance } from '../src/provenance.ts';
import { AgentToolService } from '../src/agent-tools.ts';
import type { ToolDefinition } from '../src/tool-schema.ts';

export const TOOL_DEFINITIONS = JSON.parse(readFileSync(new URL('../../policy/tools/evidence-tools.json', import.meta.url), 'utf8')) as ToolDefinition[];

const caseScope = JSON.parse(readFileSync(new URL('../../policy/case-scope.json', import.meta.url), 'utf8')) as { caseId: string; evidenceIds: string[] };

export const CASE = 'BLACKWATER-2021';
export const OTHER_CASE = 'GREYHOLLOW-2019';
export { APPEND_ONLY_TABLES } from '../src/tables.ts';
import { APPEND_ONLY_TABLES } from '../src/tables.ts';

export const USERS = {
  investigator: 'owen.hale',
  auditor: 'mara.voss',
  supervisor: 'elena.ward',
  supervisor2: 'ruth.kim',
  outsider: 'adrian.cole', // member of another case only
} as const;
export const AGENT = 'coc-audit-agent';
export const OTHER_AGENT = 'other-case-agent';

export function makeDirectory(): MemoryDirectory {
  return new MemoryDirectory(
    [
      { caseId: CASE, userId: USERS.investigator, role: 'investigator' },
      { caseId: CASE, userId: USERS.auditor, role: 'auditor' },
      { caseId: CASE, userId: USERS.supervisor, role: 'supervisor' },
      { caseId: CASE, userId: USERS.supervisor2, role: 'supervisor' },
      { caseId: OTHER_CASE, userId: USERS.outsider, role: 'supervisor' },
    ],
    [{ agentId: AGENT, caseId: CASE }, { agentId: OTHER_AGENT, caseId: OTHER_CASE }],
  );
}

export function makeStore(): MemoryStore {
  return new MemoryStore({ appendOnlyTables: APPEND_ONLY_TABLES });
}

let counter = 0;
export function human(userId: string, now = new Date('2026-11-18T16:00:00.000Z')): RequestContext {
  counter += 1;
  return { principal: { type: 'human', userId }, channel: 'api', requestId: `req-${counter}`, now };
}
export function agent(agentId = AGENT, channel: 'api' | 'gateway' = 'gateway', now = new Date('2026-11-18T16:00:00.000Z')): RequestContext {
  counter += 1;
  return { principal: { type: 'agent', agentId }, channel, requestId: `req-${counter}`, now };
}
export function anonymous(): RequestContext {
  counter += 1;
  return { principal: null as Principal | null, channel: 'api', requestId: `req-${counter}`, now: new Date('2026-11-18T16:00:00.000Z') };
}

export function deps(store: TransactionalStore = makeStore()) {
  return { store, directory: makeDirectory(), audit: new MemoryAuditLog() };
}

// Wires custody and proposals the way production must: the promotion
// capability goes only to ProposalService.
export function wireCustody(base: { store: TransactionalStore; directory: MemoryDirectory; audit: MemoryAuditLog }, ledger: Ledger) {
  let promoter: Promoter | undefined;
  const custody = new CustodyService({ ...base, ledger }, { onPromoter: (p) => { promoter = p; } });
  if (!promoter) throw new Error("promoter not provided");
  const proposals = new ProposalService(base, promoter);
  return { custody, proposals };
}

// A fully wired domain over one store. Every service shares the same ledger.
export function makeWorld(options: { store?: TransactionalStore; objects?: ObjectStore } = {}) {
  const store = options.store ?? makeStore();
  const directory = makeDirectory();
  const audit = new MemoryAuditLog();
  const ledger = new Ledger(store);
  const objects = options.objects ?? new MemoryObjectStore();
  const scope = new StaticCaseScope([caseScope, { caseId: OTHER_CASE, evidenceIds: ['BW-001', 'BW-002'] }]);
  const base = { store, directory, audit };
  const { custody, proposals } = wireCustody(base, ledger);
  const evidence = new EvidenceService({ ...base, ledger, objects, scope });
  const approvals = new ApprovalService(base, { ttlMs: 3600000 });
  const signingKey = signingKeyFromSeed(Buffer.alloc(32, 42));
  const checkpoints = new CheckpointAuthority(signingKey, store, ledger);
  const exports = new ExportService({ ...base, ledger, evidence, approvals, checkpoints });
  const trustedKey = { keyId: signingKey.keyId, publicKeyHex: signingKey.publicKeyRaw.toString('hex') };
  const findings = new FindingService({ ...base, ledger });
  const provenance = new ManifestProvenance(loadManifest());
  const agentTools = new AgentToolService({ tools: TOOL_DEFINITIONS, evidence, findings, proposals, provenance, audit });
  const caseRead = new CaseReadService({ ...base, ledger, checkpoints });
  return { store, directory, audit, ledger, objects, scope, custody, evidence, approvals, checkpoints, exports, proposals, findings, provenance, agentTools, caseRead, signingKey, trustedKey };
}
export type World = ReturnType<typeof makeWorld>;

// Registers every T01 fixture version (and the BW-002 derivative) as the investigator.
export async function registerFixtures(world: World): Promise<Map<string, string>> {
  const versions = new Map<string, string>(); // "BW-002/original" -> versionId
  const manifest = loadManifest();
  for (const item of manifest.items) {
    for (const v of item.versions) {
      const bytes = readFixtureBytes(v.path);
      const r = v.derivedFrom
        ? await world.evidence.registerDerivative(human(USERS.investigator), CASE, {
          evidenceId: item.evidenceId, parentVersionId: versions.get(`${item.evidenceId}/${v.derivedFrom.label}`), transformation: v.derivedFrom.transformation, bytes, mediaType: v.mediaType,
        })
        : await world.evidence.register(human(USERS.investigator), CASE, { evidenceId: item.evidenceId, bytes, mediaType: v.mediaType });
      if (!r.ok) throw new Error(`fixture registration failed: ${item.evidenceId}/${v.label}: ${r.code} ${r.detail}`);
      if (r.value.kind !== 'evidence_registered') throw new Error('unexpected event kind');
      versions.set(`${item.evidenceId}/${v.label}`, r.value.body.versionId);
    }
  }
  return versions;
}
