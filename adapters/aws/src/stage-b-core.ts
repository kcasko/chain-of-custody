// T19: Stage B checks for the core-backed tool Lambda.
//
// The original runner (harness/run-stage-b.cjs) matched the stub Lambda's log
// lines by an argument hash. The core-backed handler logs no arguments, so this
// runner observes effects instead, one call at a time in a quiet environment:
//   - the tool response (executed, or rejected with the expected code);
//   - the security audit records the call left (none when Cedar stopped it;
//     otherwise all attributed to the agent, under one Gateway request ID);
//   - the stored state (exactly one new finding or draft for the write tools,
//     nothing for everything else), and a ledger head that never moves.
//
// The logic is a pure function of injected clients and observers, so it runs
// unchanged against the live Gateway (harness/run-stage-b-core.mts) and locally
// against the real Cedar policies and the real handler (see the tests).
// Passing locally is not evidence about AWS, and neither is evidence about BMA.

import type { AuditPage, SecurityEvent } from '../../../core/src/audit.ts';

export const TARGET = 'EvidenceTools';
export const TOOL_NAMES = ['compare_timestamps', 'list_evidence', 'propose_custody_event', 'read_evidence_version', 'record_finding'].map((t) => `${TARGET}___${t}`);
const BOUNDARY_IDS = new Set(['boundary-session-role-only', 'boundary-this-gateway-only']);
// The scenario file names the stub Lambda's codes; the core uses its own.
export const CORE_CODE_FOR_STUB_CODE: Readonly<Record<string, string>> = { VERSION_NOT_REGISTERED: 'NOT_FOUND', INVALID_ARGUMENTS: 'INVALID_REQUEST' };
// Which stored collection each write tool adds to.
const WRITES: Readonly<Record<string, Counted>> = { record_finding: 'findings', propose_custody_event: 'proposals' };

export type Counted = 'findings' | 'proposals';
export interface Scenario { id: string; tool: string; args: Record<string, unknown>; expect: string; l3Code?: string }
export interface ToolResult { httpStatus: number; rpcError: string | null; isError: boolean; payload: any; text: string }
export interface ToolClient {
  readonly name: string;
  initialize(): Promise<{ ok: boolean; httpStatus: number }>;
  listTools(): Promise<{ ok: boolean; httpStatus: number; tools: string[] }>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}
export interface Observer {
  audit(): Promise<AuditPage>;
  ledgerHead(): Promise<{ sequence: number; hash: string }>;
  count(collection: Counted): Promise<number>;
}
export interface RunOptions {
  harness: ToolClient;
  /** A signed client for a principal the Cedar boundary must not admit. */
  other: ToolClient;
  /** An unsigned client: the Gateway must refuse it before anything else. */
  unsigned: ToolClient;
  scenarios: readonly Scenario[];
  /** "BW-001/original" -> registered version ID, from the seed script. */
  versions: ReadonlyMap<string, string>;
  observe: Observer;
  agentId: string;
  /** Which Cedar policy IDs denied a call, from the Gateway's error text. */
  deniedBy(rpcError: string | null): string[];
}

export interface CheckResult { name: string; pass: boolean; detail: unknown }
export interface ScenarioResult {
  id: string; tool: string; expect: string; pass: boolean; stoppedBy: string; problems: string[];
  response: { rpcError: string | null; status: string | null; code: string | null };
  audit: Array<{ operation: string; outcome: string; code: string | null; requestId: string }>;
  stateChange: Record<Counted, number>;
}
export interface RunReport { checks: CheckResult[]; scenarios: ScenarioResult[]; summary: { passed: number; failed: number; total: number } }

// Which policies denied a call, from the Gateway's error text. The live engine
// names a policy by its engine name plus a 10-character suffix, which can
// contain underscores (seen live in T21: "boundary_session_role_only-829_dau654");
// `names` maps engine names to our @id values. Locally the reasons are already @id values.
export function parseDeniedBy(rpcError: string | null, names: Readonly<Record<string, string>> = {}): string[] {
  if (!rpcError) return [];
  if (/denied by default/i.test(rpcError)) return ['default-deny'];
  const m = /denied due to ([^\]]+)\]/.exec(rpcError);
  if (!m) return [];
  return m[1]!.split(',').map((s) => s.trim()).map((n) => names[n] ?? names[n.replace(/-[A-Za-z0-9_]{10}$/, '')] ?? n);
}

// The CDK app stores each policy's @id in its description ("<kind> policy <id> from policy/cedar").
export function policyIdFromDescription(description: string): string | null {
  const m = /^\S+ policy (\S+) from policy\/cedar$/.exec(description);
  return m ? m[1]! : null;
}

// Replaces the stub's synthetic version IDs with the registered ones.
export function bindVersions(args: Record<string, unknown>, versions: ReadonlyMap<string, string>): Record<string, unknown> {
  const real = (id: string) => versions.get(`${id}/original`) ?? 'v-not-registered';
  const out = { ...args };
  if (out.version_id === 'syn-v1' && typeof out.evidence_id === 'string') out.version_id = real(out.evidence_id);
  if (Array.isArray(out.source_version_ids) && Array.isArray(out.source_evidence_ids)) out.source_version_ids = (out.source_evidence_ids as string[]).map(real);
  return out;
}

async function snapshot(o: Observer) {
  const [audit, findings, proposals] = await Promise.all([o.audit(), o.count('findings'), o.count('proposals')]);
  return { audit, counts: { findings, proposals } as Record<Counted, number> };
}

// Records written between two reads of the same case's log, newest first.
function auditDelta(before: AuditPage, after: AuditPage): { events: SecurityEvent[]; problem: string | null } {
  if (before.totalIsLowerBound || after.totalIsLowerBound) return { events: [], problem: 'audit log too large to measure per call; use a fresh environment' };
  const n = after.total - before.total;
  if (n < 0) return { events: [], problem: 'audit log shrank during the run' };
  if (n > after.events.length) return { events: [], problem: `${n} new audit records, more than one page; use a fresh environment` };
  return { events: after.events.slice(0, n), problem: null };
}

const rejectionOf = (r: ToolResult): { status: string | null; code: string | null } => ({
  status: r.payload && typeof r.payload.status === 'string' ? r.payload.status : null,
  code: r.payload && typeof r.payload.code === 'string' ? r.payload.code : null,
});

export async function runCoreStageB(o: RunOptions): Promise<RunReport> {
  const checks: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail: unknown) => checks.push({ name, pass, detail });
  const agent = `agent:${o.agentId}`;
  const ledgerAtStart = await o.observe.ledgerHead();

  // 1. No anonymous access.
  const anon = await o.unsigned.initialize();
  check('unsigned request is rejected', !anon.ok && [401, 403].includes(anon.httpStatus), { httpStatus: anon.httpStatus });

  // 2. Another signed principal: denied by the session-role boundary, and the Lambda never ran.
  {
    const before = await snapshot(o.observe);
    await o.other.initialize();
    const probe = await o.other.callTool(`${TARGET}___read_evidence_version`, bindVersions({ evidence_id: 'BW-001', version_id: 'syn-v1' }, o.versions));
    const after = await snapshot(o.observe);
    const delta = auditDelta(before.audit, after.audit);
    const by = o.deniedBy(probe.rpcError);
    check('other principal: denied by the session-role boundary, nothing reached the Lambda', !!probe.rpcError && by.includes('boundary-session-role-only') && !delta.problem && delta.events.length === 0,
      { deniedBy: by, auditRecords: delta.events.length, problem: delta.problem });
  }

  // 3. The admitted role sees exactly the five tools.
  const init = await o.harness.initialize();
  check('harness initialize succeeds', init.ok, { httpStatus: init.httpStatus });
  const listed = await o.harness.listTools();
  check('harness sees exactly the five tools', JSON.stringify([...listed.tools].sort()) === JSON.stringify(TOOL_NAMES), { tools: listed.tools });

  // 4. Every scenario, one at a time, observed before and after.
  const scenarios: ScenarioResult[] = [];
  for (const s of o.scenarios) {
    const before = await snapshot(o.observe);
    const r = await o.harness.callTool(`${TARGET}___${s.tool}`, bindVersions(s.args, o.versions));
    const after = await snapshot(o.observe);
    const delta = auditDelta(before.audit, after.audit);
    const change = { findings: after.counts.findings - before.counts.findings, proposals: after.counts.proposals - before.counts.proposals };
    const rej = rejectionOf(r);
    const problems: string[] = [];
    if (delta.problem) problems.push(delta.problem);
    const events = delta.events;
    const notAgent = events.filter((e) => e.principal !== agent);
    if (notAgent.length) problems.push(`audit records not attributed to ${agent}: ${notAgent.map((e) => e.principal).join(', ')}`);
    const requestIds = [...new Set(events.map((e) => e.requestId))];
    if (requestIds.length > 1) problems.push(`audit records span ${requestIds.length} request IDs`);
    if (requestIds.some((id) => id.startsWith('local-'))) problems.push('no Gateway request ID reached the Lambda (local- fallback)');
    const expectChange = (collection: Counted | null) => {
      for (const c of ['findings', 'proposals'] as const) {
        const want = c === collection ? 1 : 0;
        if (change[c] !== want) problems.push(`${c} changed by ${change[c]}, expected ${want}`);
      }
    };
    let stoppedBy: string;

    if (s.expect === 'executed') {
      stoppedBy = 'executed';
      if (r.rpcError || r.isError || rej.status === 'rejected') problems.push(`not executed: ${r.rpcError ?? `${rej.status} ${rej.code}`}`);
      if (!events.some((e) => e.outcome === 'completed')) problems.push('no completed audit record');
      if (events.some((e) => e.outcome === 'denied' || e.outcome === 'failed')) problems.push('a denied or failed audit record on a legitimate call');
      expectChange(WRITES[s.tool] ?? null);
    } else if (s.expect === 'cedar-deny') {
      const by = o.deniedBy(r.rpcError);
      stoppedBy = `cedar:${by.join('+') || 'unknown'}`;
      if (!r.rpcError) problems.push('not denied by the Gateway');
      if (!by.some((id) => !BOUNDARY_IDS.has(id))) problems.push('not denied by a specific rule (only the boundary or default deny)');
      if (events.length) problems.push(`${events.length} audit records: the call reached the Lambda`);
      expectChange(null);
    } else {
      // l3-reject and not-executed: refused by the Gateway or the core, and nothing changed.
      if (r.rpcError) {
        stoppedBy = 'gateway';
        if (events.length) problems.push(`${events.length} audit records after a Gateway refusal`);
      } else {
        stoppedBy = `core:${rej.code ?? 'none'}`;
        if (rej.status !== 'rejected') problems.push('executed, but must not be');
        if (!events.some((e) => (e.outcome === 'denied' || e.outcome === 'failed') && e.code === rej.code)) problems.push(`no denied or failed audit record with code ${rej.code}`);
      }
      if (s.expect === 'l3-reject') {
        const want = CORE_CODE_FOR_STUB_CODE[s.l3Code ?? ''] ?? s.l3Code;
        if (rej.code !== want) problems.push(`expected the core to reject with ${want}, got ${r.rpcError ? 'a Gateway refusal' : rej.code}`);
      }
      expectChange(null);
    }
    scenarios.push({
      id: s.id, tool: s.tool, expect: s.expect, pass: problems.length === 0, stoppedBy, problems,
      response: { rpcError: r.rpcError, ...rej },
      audit: events.map((e) => ({ operation: e.operation, outcome: e.outcome, code: e.code, requestId: e.requestId })),
      stateChange: change,
    });
  }

  // 5. The agent never moves the ledger: drafts are not events.
  const ledgerAtEnd = await o.observe.ledgerHead();
  check('ledger head unchanged by the whole agent run', ledgerAtEnd.sequence === ledgerAtStart.sequence && ledgerAtEnd.hash === ledgerAtStart.hash, { start: ledgerAtStart.sequence, end: ledgerAtEnd.sequence });

  const all = [...checks.map((c) => c.pass), ...scenarios.map((s) => s.pass)];
  return { checks, scenarios, summary: { passed: all.filter(Boolean).length, failed: all.filter((p) => !p).length, total: all.length } };
}
