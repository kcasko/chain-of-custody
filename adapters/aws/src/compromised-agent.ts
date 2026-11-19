// Compromised-agent runner: sends the attacks in harness/compromised-agent.cjs
// through any ToolClient and records, per call, what the system did and
// whether protected state moved. No model is involved.
//
// Protected state, re-read around every call:
//   - the custody ledger head (sequence and hash);
//   - a digest of every registered evidence version's stored bytes, re-read
//     from the object store (not the registered hash);
//   - the number of findings and drafts, and the security audit log.
//
// The logic is a pure function of injected clients and observers, so it can
// run against the backend alone (tests) or through a live Gateway.

import type { AuditPage, SecurityEvent } from '../../../core/src/audit.ts';
import type { ToolClient, ToolResult } from './stage-b-core.ts';
import { TARGET } from './stage-b-core.ts';

export interface Attack {
  id: string; scenario: string; tool: string; args: Record<string, unknown>;
  expect: 'refused' | 'contained' | 'TBD'; code?: string; adds?: 'findings' | 'proposals' | null; attempt: string;
}

export interface CompromisedObserver {
  audit(): Promise<AuditPage>;
  ledgerHead(): Promise<{ sequence: number; hash: string }>;
  count(collection: 'findings' | 'proposals'): Promise<number>;
  evidenceFingerprint(): Promise<string>;
}

export interface AttackResult {
  id: string; scenario: string; tool: string; attempt: string;
  /** 'gateway' (refused before the backend), 'cedar:<ids>', 'core:<code>', or 'allowed'. */
  outcome: string;
  audit: Array<{ principal: string; operation: string; outcome: string; code: string | null }>;
  added: { findings: number; proposals: number };
  ledgerMoved: boolean;
  evidenceChanged: boolean;
  problems: string[];
  /** The tool's response payload (for follow-up checks such as promoting a draft). */
  response: unknown;
}

/** 'syn-v1' -> the registered original of that evidence ID; 'syn-v1:BW-001' -> BW-001's original. */
export function bindAttackVersions(args: Record<string, unknown>, versions: ReadonlyMap<string, string>): Record<string, unknown> {
  const out = { ...args };
  const v = out.version_id;
  if (typeof v === 'string' && v.startsWith('syn-v1')) {
    const id = v.includes(':') ? v.slice(v.indexOf(':') + 1) : String(out.evidence_id);
    const real = versions.get(`${id}/original`);
    if (!real) throw new Error(`no registered original for ${id}`);
    out.version_id = real;
  }
  return out;
}

async function state(o: CompromisedObserver) {
  const [audit, findings, proposals, head, evidence] = await Promise.all([o.audit(), o.count('findings'), o.count('proposals'), o.ledgerHead(), o.evidenceFingerprint()]);
  return { audit, findings, proposals, head, evidence };
}

const newRecords = (before: AuditPage, after: AuditPage): SecurityEvent[] => after.events.slice(0, Math.max(0, after.total - before.total));
const payloadOf = (r: ToolResult): { status: string | null; code: string | null } => ({
  status: r.payload && typeof r.payload.status === 'string' ? r.payload.status : null,
  code: r.payload && typeof r.payload.code === 'string' ? r.payload.code : null,
});

export async function runCompromisedAgent(o: {
  client: ToolClient; attacks: readonly Attack[]; versions: ReadonlyMap<string, string>; observe: CompromisedObserver; agentId: string;
  deniedBy?(rpcError: string | null): string[];
}): Promise<AttackResult[]> {
  const agent = `agent:${o.agentId}`;
  const results: AttackResult[] = [];
  for (const a of o.attacks) {
    const before = await state(o.observe);
    const r = await o.client.callTool(`${TARGET}___${a.tool}`, bindAttackVersions(a.args, o.versions));
    const after = await state(o.observe);
    const events = newRecords(before.audit, after.audit);
    const p = payloadOf(r);
    const outcome = r.rpcError
      ? (o.deniedBy && o.deniedBy(r.rpcError).length ? `cedar:${o.deniedBy(r.rpcError).join('+')}` : 'gateway')
      : p.status === 'rejected' ? `core:${p.code ?? 'none'}` : 'allowed';
    const added = { findings: after.findings - before.findings, proposals: after.proposals - before.proposals };
    const ledgerMoved = after.head.sequence !== before.head.sequence || after.head.hash !== before.head.hash;
    const evidenceChanged = after.evidence !== before.evidence;

    const problems: string[] = [];
    if (ledgerMoved) problems.push('the custody ledger moved');
    if (evidenceChanged) problems.push('stored evidence bytes changed');
    const foreign = events.filter((e) => e.principal !== agent);
    if (foreign.length) problems.push(`audit records not attributed to ${agent}: ${foreign.map((e) => e.principal).join(', ')}`);
    if (a.expect === 'refused') {
      if (outcome === 'allowed') problems.push('allowed, but must be refused');
      if (outcome.startsWith('core:')) {
        if (a.code && p.code !== a.code) problems.push(`refused with ${p.code}, expected ${a.code}`);
        if (!events.some((e) => (e.outcome === 'denied' || e.outcome === 'failed') && e.code === p.code)) problems.push(`no audit record of the refusal (${p.code})`);
      }
      if (added.findings || added.proposals) problems.push(`state added after a refusal: ${JSON.stringify(added)}`);
    } else if (a.expect === 'contained') {
      if (outcome !== 'allowed') problems.push(`expected to be allowed, got ${outcome}`);
      const want = { findings: a.adds === 'findings' ? 1 : 0, proposals: a.adds === 'proposals' ? 1 : 0 };
      if (added.findings !== want.findings || added.proposals !== want.proposals) problems.push(`added ${JSON.stringify(added)}, expected ${JSON.stringify(want)}`);
    } else {
      problems.push(`expectation not set (observed ${outcome}, added ${JSON.stringify(added)})`);
    }
    results.push({
      id: a.id, scenario: a.scenario, tool: a.tool, attempt: a.attempt, outcome,
      audit: events.map((e) => ({ principal: e.principal, operation: e.operation, outcome: e.outcome, code: e.code })),
      added, ledgerMoved, evidenceChanged, problems, response: r.payload,
    });
  }
  return results;
}
