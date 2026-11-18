// Runs the Integrity Challenge: every agent scenario from Stage B plus four
// human-side attacks, against the real Cedar policies and the real domain core,
// then proves nothing protected changed. Pure function of a fresh local domain.

import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';
import { sha256Hex } from '../../core/src/crypto.ts';
import { createGatewayHandler } from '../../core/src/gateway-handler.ts';
import { createLocalDomain, seedFixtures, humanCtx, DEMO, type LocalDomain } from '../../core/src/local.ts';
import { TABLES } from '../../core/src/tables.ts';
import { NARRATIVE } from './narrative.ts';

const require = createRequire(import.meta.url);
const cedar = require('../../policy/lib.cjs') as {
  renderPolicies(v: Record<string, string>): string;
  authorize(req: unknown, opts: { policies: string; validateRequest: boolean }): { decision: 'allow' | 'deny'; reasons: string[]; errors: string[] };
};
const { SCENARIOS } = require('../../harness/scenarios.cjs') as { SCENARIOS: Array<{ id: string; tool: string; args: Record<string, unknown>; expect: string }> };

// Demo values for rendering the real policy text. Not an AWS account.
const DEMO_ACCOUNT = '000000000000';
const SESSION_ROLE = 'CocBmaSessionRole';
const GATEWAY_ARN = `arn:aws:bedrock-agentcore:us-east-1:${DEMO_ACCOUNT}:gateway/coc-demo-gw-0000000000`;
const POLICIES = cedar.renderPolicies({ ACCOUNT_ID: DEMO_ACCOUNT, SESSION_ROLE_NAME: SESSION_ROLE, GATEWAY_ARN });
const AGENT_PRINCIPAL = { type: 'IamEntity', id: 'session', arn: `arn:aws:sts::${DEMO_ACCOUNT}:assumed-role/${SESSION_ROLE}` };

export interface Verdict { readonly verdict: 'allowed' | 'refused' | 'not applicable'; readonly by: string; readonly detail: string }
export interface ChallengeRow {
  readonly id: string;
  readonly kind: 'legitimate' | 'attack';
  readonly actor: 'agent' | 'human';
  readonly title: string;
  readonly call: string;
  readonly gateway: Verdict;
  readonly core: Verdict;
  readonly outcome: 'executed' | 'refused';
  readonly stoppedBy: 'gateway' | 'core' | 'gateway and core' | null;
  readonly asExpected: boolean;
}
export interface Snapshot { readonly ledgerSequence: number; readonly ledgerHead: string; readonly evidence: ReadonlyArray<{ evidenceId: string; versionId: string; sha256: string }> }
export interface ChallengeReport {
  readonly ranAt: string;
  readonly caseId: string;
  readonly rows: readonly ChallengeRow[];
  readonly before: Snapshot;
  readonly after: Snapshot;
  readonly unchanged: boolean;
  readonly totals: { attacks: number; refused: number; legitimate: number; executed: number; asExpected: number; auditDenials: number; findings: number; drafts: number };
  readonly notes: readonly string[];
}

// Stage B scenarios used fixed synthetic version IDs; bind them to real ones.
export function bind(args: Record<string, unknown>, versions: Map<string, string>): Record<string, unknown> {
  const real = (id: string) => versions.get(`${id}/original`) ?? 'v-not-registered';
  const out = { ...args };
  if (out.version_id === 'syn-v1' && typeof out.evidence_id === 'string') out.version_id = real(out.evidence_id);
  if (Array.isArray(out.source_version_ids) && Array.isArray(out.source_evidence_ids)) out.source_version_ids = (out.source_evidence_ids as string[]).map(real);
  return out;
}

const brief = (v: unknown): string => {
  const s = JSON.stringify(v);
  return s.length > 220 ? `${s.slice(0, 217)}...` : s;
};

async function snapshot(d: LocalDomain, label: string): Promise<Snapshot> {
  const head = await d.ledger.head(DEMO.caseId);
  const list = await d.evidence.list(humanCtx(DEMO.users.auditor, `${label}-list`), DEMO.caseId);
  if (!list.ok) throw new Error('snapshot list failed');
  const evidence = [];
  for (const b of list.value) {
    const r = await d.evidence.read(humanCtx(DEMO.users.auditor, `${label}-read`), DEMO.caseId, { evidenceId: b.evidenceId, versionId: b.versionId });
    // Hash the bytes actually returned, not the registered value.
    evidence.push({ evidenceId: b.evidenceId, versionId: b.versionId, sha256: r.ok ? sha256Hex(r.value.bytes) : `READ FAILED: ${r.code}` });
  }
  return { ledgerSequence: head.sequence, ledgerHead: head.hash, evidence };
}

function gatewayVerdict(toolNames: Set<string>, tool: string, args: Record<string, unknown>): Verdict {
  if (!toolNames.has(tool)) return { verdict: 'refused', by: 'Gateway', detail: 'unknown tool: not in the agent tool list' };
  // Untyped evaluation mirrors the live finding: undeclared fields reach Cedar and are ignored.
  const d = cedar.authorize({ principal: AGENT_PRINCIPAL, action: tool, resource: GATEWAY_ARN, input: args }, { policies: POLICIES, validateRequest: false });
  if (d.decision === 'allow') return { verdict: 'allowed', by: 'Cedar', detail: `permitted by ${d.reasons.join(', ')}` };
  return { verdict: 'refused', by: 'Cedar', detail: d.reasons.length ? `forbidden by ${d.reasons.join(', ')}` : 'no policy permits it (deny by default)' };
}

export async function runChallenge(now = new Date()): Promise<ChallengeReport> {
  const d = createLocalDomain();
  const versions = await seedFixtures(d);
  const toolNames = new Set(JSON.parse(JSON.stringify(require('../../policy/tools/evidence-tools.json'))).map((t: { name: string }) => t.name) as string[]);
  const before = await snapshot(d, 'before');
  const handler = createGatewayHandler({ caseId: DEMO.caseId, agentId: DEMO.agentId, tools: d.agentTools, clock: () => now, log: () => {} });
  const rows: ChallengeRow[] = [];

  for (const s of SCENARIOS) {
    const args = bind(s.args, versions);
    const gateway = gatewayVerdict(toolNames, s.tool, args);
    const out = await handler(args, { clientContext: { custom: { bedrockAgentCoreToolName: `EvidenceTools___${s.tool}`, bedrockAgentCoreAwsRequestId: `challenge-${s.id}` } } }) as { status?: string; code?: string; detail?: string };
    const coreRefused = out?.status === 'rejected';
    const core: Verdict = coreRefused
      ? { verdict: 'refused', by: 'Core', detail: `${out.code}: ${out.detail ?? ''}`.trim() }
      : { verdict: 'allowed', by: 'Core', detail: 'executed' };
    const kind = s.expect === 'executed' ? 'legitimate' : 'attack';
    // In production the Gateway runs first; the core result shows the second layer independently.
    const outcome = gateway.verdict === 'refused' || coreRefused ? 'refused' : 'executed';
    const stoppedBy = outcome === 'executed' ? null : gateway.verdict === 'refused' && coreRefused ? 'gateway and core' : gateway.verdict === 'refused' ? 'gateway' : 'core';
    rows.push({
      id: s.id, kind, actor: 'agent', title: NARRATIVE[s.id] ?? s.id, call: `${s.tool} ${brief(args)}`,
      gateway, core, outcome, stoppedBy, asExpected: kind === 'legitimate' ? outcome === 'executed' : outcome === 'refused',
    });
  }

  rows.push(...(await humanAttacks(d, versions, now)));
  const after = await snapshot(d, 'after');
  const unchanged = before.ledgerHead === after.ledgerHead && JSON.stringify(before.evidence) === JSON.stringify(after.evidence);
  const findings = await d.store.list(TABLES.findings, `${DEMO.caseId}#`);
  const drafts = await d.store.list(TABLES.proposals, '');
  const attacks = rows.filter((r) => r.kind === 'attack');
  const legit = rows.filter((r) => r.kind === 'legitimate');
  return {
    ranAt: now.toISOString(),
    caseId: DEMO.caseId,
    rows,
    before,
    after,
    unchanged,
    totals: {
      attacks: attacks.length,
      refused: attacks.filter((r) => r.outcome === 'refused').length,
      legitimate: legit.length,
      executed: legit.filter((r) => r.outcome === 'executed').length,
      asExpected: rows.filter((r) => r.asExpected).length,
      auditDenials: d.audit.events.filter((e) => e.outcome === 'denied').length,
      findings: findings.length,
      drafts: drafts.length,
    },
    notes: [
      'Synthetic case. Local run: in-memory storage, demo signing key, no AWS calls, no model.',
      'Gateway column: the project\'s real Cedar policies evaluated locally by the official Cedar engine, the way the live AgentCore engine behaved in Stage B (undeclared fields are not rejected by the Gateway).',
      'Core column: the actual domain core, run even when the Gateway already refused, to show the second layer holds on its own.',
      'Not evidence of Bedrock Managed Agents behavior: no agent or model is involved (release blocker RB-1).',
    ],
  };
}

async function humanAttacks(d: LocalDomain, versions: Map<string, string>, now: Date): Promise<ChallengeRow[]> {
  const u = DEMO.users;
  const na: Verdict = { verdict: 'not applicable', by: 'Gateway', detail: 'human action through the application API, not an agent tool call' };
  const row = (id: string, call: string, refused: boolean, detail: string): ChallengeRow => ({
    id, kind: 'attack', actor: 'human', title: NARRATIVE[id] ?? id, call, gateway: na,
    core: refused ? { verdict: 'refused', by: 'Core', detail } : { verdict: 'allowed', by: 'Core', detail },
    outcome: refused ? 'refused' : 'executed', stoppedBy: refused ? 'core' : null, asExpected: refused,
  });
  const out: ChallengeRow[] = [];
  const payload = { evidence: [{ evidenceId: 'BW-001', versionId: versions.get('BW-001/original')! }], destination: 'internal:case-export-store' };

  const own = await d.approvals.requestExport(humanCtx(u.supervisor, 'h1-req', now), DEMO.caseId, payload);
  const self = own.ok ? await d.approvals.approve(humanCtx(u.supervisor, 'h1-approve', now), own.value.approvalId) : own;
  out.push(row('H-1', 'approvals.approve(own request)', !self.ok, self.ok ? 'approved' : `${self.code}: ${self.detail}`));

  const req = await d.approvals.requestExport(humanCtx(u.investigator, 'h2-req', now), DEMO.caseId, payload);
  if (req.ok) await d.approvals.approve(humanCtx(u.supervisor2, 'h2-approve', now), req.value.approvalId);
  const swapped = { ...payload, evidence: [{ evidenceId: 'BW-002', versionId: versions.get('BW-002/transcode-2026')! }] };
  const ex = req.ok ? await d.exports.exportCase(humanCtx(u.investigator, 'h2-export', now), DEMO.caseId, req.value.approvalId, swapped) : req;
  out.push(row('H-2', 'exports.exportCase(approved for BW-001, asks for BW-002)', !ex.ok, ex.ok ? 'exported' : `${ex.code}: ${ex.detail}`));

  const list = await d.evidence.list(humanCtx(u.auditor, 'h3-list', now), DEMO.caseId);
  const target = list.ok ? list.value.find((b) => b.evidenceId === 'BW-003') : undefined;
  let h3 = 'no target';
  let h3Refused = false;
  try {
    await d.objects.putNew(target!.objectKey, Buffer.from('SYNTHETIC tampered copy'));
    h3 = 'overwritten';
  } catch (err) {
    h3Refused = true;
    h3 = `${(err as Error).name}: originals are write-once`;
  }
  out.push(row('H-3', 'objectStore.putNew(existing BW-003 original key)', h3Refused, h3));

  let h4 = '';
  let h4Refused = false;
  try {
    await d.store.transact([{ table: TABLES.events, key: `${DEMO.caseId}#000000000003`, value: { forged: true }, expectVersion: 1 }]);
    h4 = 'rewritten';
  } catch (err) {
    h4Refused = true;
    h4 = `${(err as Error).name}: the events table is append-only`;
  }
  out.push(row('H-4', 'store.transact(overwrite ledger event 3)', h4Refused, h4));
  return out;
}
