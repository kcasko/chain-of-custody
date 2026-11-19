// The domain core wired to AWS adapters (T16): DynamoDB for state and the
// durable audit log, S3 (versioned, Object Lock) for evidence bytes. Used by
// the deployable tool Lambda (infra/lambda/tools.ts) and by tests that run the
// same wiring against DynamoDB Local and an in-memory S3 fake.
//
// What this does not change: authorization stays in the core (policy.ts,
// deny by default), the agent's identity and case come from deployment
// configuration (gateway-handler.ts), and every tool argument is untrusted.

import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { S3Client } from '@aws-sdk/client-s3';
import { AgentToolService } from '../../../core/src/agent-tools.ts';
import { CustodyService, type Promoter } from '../../../core/src/custody.ts';
import { EvidenceService, StaticCaseScope } from '../../../core/src/evidence.ts';
import type { FixtureManifest } from '../../../core/src/fixtures.ts';
import { FindingService } from '../../../core/src/findings.ts';
import { createGatewayHandler } from '../../../core/src/gateway-handler.ts';
import { Ledger } from '../../../core/src/ledger.ts';
import { MemoryDirectory } from '../../../core/src/policy.ts';
import { ProposalService } from '../../../core/src/proposals.ts';
import { ManifestProvenance } from '../../../core/src/provenance.ts';
import { APPEND_ONLY_TABLES, TABLES } from '../../../core/src/tables.ts';
import type { ToolDefinition } from '../../../core/src/tool-schema.ts';
import type { Role } from '../../../core/src/types.ts';
import { CASE_ID } from '../../../core/src/validate.ts';
import { DynamoAuditLog } from './dynamo-audit.ts';
import { DynamoStore } from './dynamo-store.ts';
import { S3ObjectStore } from './s3-objects.ts';

// The logical tables (partition keys) the agent path touches, measured over
// every Stage B scenario (adapters/aws/test/aws-domain.test.ts fails if the code
// reaches outside them). The tool Lambda's IAM role is limited to exactly these
// with dynamodb:LeadingKeys, so a compromised tool Lambda cannot write
// approvals, heads or ledger events (review finding 1, November 18).
export const TOOL_LAMBDA_TABLES = Object.freeze({
  read: Object.freeze([TABLES.events]),
  append: Object.freeze([TABLES.audit, TABLES.findings, TABLES.proposals]),
});

// The deployed agent's identity: deployment configuration, never a tool argument.
export const DEPLOYED_AGENT_ID = 'coc-audit-agent';

export interface AwsDomainConfig {
  readonly dynamo: Pick<DynamoDBClient, 'send'>;
  readonly s3: S3Client;
  readonly tableName: string;
  readonly evidenceBucket: string;
  readonly evidenceKeyPrefix?: string;
  readonly caseId: string;
  readonly agentId: string;
  /** Humans on the case. The tool Lambda needs none: only the agent calls it. */
  readonly members?: ReadonlyArray<{ userId: string; role: Role }>;
  readonly caseScope: { caseId: string; evidenceIds: string[] };
  readonly manifest: FixtureManifest;
  readonly tools: readonly ToolDefinition[];
}

export function createAwsDomain(cfg: AwsDomainConfig) {
  if (!CASE_ID.test(cfg.caseId)) throw new Error('invalid case id in configuration');
  if (cfg.caseScope.caseId !== cfg.caseId) throw new Error('case scope is for another case');
  if (cfg.manifest.caseId !== cfg.caseId) throw new Error('provenance manifest is for another case');
  const store = new DynamoStore({ client: cfg.dynamo, tableName: cfg.tableName, appendOnlyTables: APPEND_ONLY_TABLES });
  const audit = new DynamoAuditLog({ client: cfg.dynamo, tableName: cfg.tableName });
  const objects = new S3ObjectStore({ client: cfg.s3, bucket: cfg.evidenceBucket, keyPrefix: cfg.evidenceKeyPrefix });
  const directory = new MemoryDirectory(
    (cfg.members ?? []).map((m) => ({ caseId: cfg.caseId, userId: m.userId, role: m.role })),
    [{ agentId: cfg.agentId, caseId: cfg.caseId }],
  );
  const base = { store, directory, audit };
  const ledger = new Ledger(store);
  let promoter: Promoter | undefined;
  const custody = new CustodyService({ ...base, ledger }, { onPromoter: (p) => { promoter = p; } });
  if (!promoter) throw new Error('promoter not provided');
  const proposals = new ProposalService(base, promoter);
  const scope = new StaticCaseScope([cfg.caseScope]);
  const evidence = new EvidenceService({ ...base, ledger, objects, scope });
  const findings = new FindingService({ ...base, ledger });
  const provenance = new ManifestProvenance(cfg.manifest);
  const agentTools = new AgentToolService({ tools: cfg.tools, evidence, findings, proposals, provenance, audit });
  return { store, audit, objects, directory, ledger, custody, proposals, evidence, findings, provenance, agentTools };
}

export function createAwsToolHandler(cfg: AwsDomainConfig, options: { log?: (line: Record<string, unknown>) => void } = {}) {
  const d = createAwsDomain({ ...cfg, members: [] }); // the Lambda serves the agent only
  return createGatewayHandler({ caseId: cfg.caseId, agentId: cfg.agentId, tools: d.agentTools, ...(options.log ? { log: options.log } : {}) });
}

// Registers every manifest version as `userId` (who must be a case member
// allowed to register evidence). Used to seed a fresh environment and by tests.
// Returns "BW-002/original" -> registered version ID.
export async function registerManifest(
  d: ReturnType<typeof createAwsDomain>,
  caseId: string,
  manifest: FixtureManifest,
  readBytes: (path: string) => Uint8Array,
  userId: string,
  now: () => Date = () => new Date(),
): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  let n = 0;
  for (const item of manifest.items) {
    for (const v of item.versions) {
      const ctx = { principal: { type: 'human' as const, userId }, channel: 'api' as const, requestId: `seed-${(n += 1)}-${item.evidenceId}`, now: now() };
      const bytes = readBytes(v.path);
      const r = v.derivedFrom
        ? await d.evidence.registerDerivative(ctx, caseId, { evidenceId: item.evidenceId, parentVersionId: versions.get(`${item.evidenceId}/${v.derivedFrom.label}`), transformation: v.derivedFrom.transformation, bytes, mediaType: v.mediaType })
        : await d.evidence.register(ctx, caseId, { evidenceId: item.evidenceId, bytes, mediaType: v.mediaType });
      if (!r.ok || r.value.kind !== 'evidence_registered') throw new Error(`registration failed for ${item.evidenceId}/${v.label}: ${r.ok ? 'wrong kind' : `${r.code} ${r.detail}`}`);
      versions.set(`${item.evidenceId}/${v.label}`, r.value.body.versionId);
    }
  }
  return versions;
}
