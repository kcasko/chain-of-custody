// Deterministic authorization (layer L3 in ADR 0003). Deny by default.
// Implements the matrix in docs/SECURITY-RULES.md, with decisions recorded in
// docs/adr/0005-domain-core.md.

import type { Operation, RequestContext, Role, Result, ActorRecord } from './types.ts';
import { ok, fail } from './types.ts';
import { CASE_ID } from './validate.ts';

const ALL: readonly Role[] = ['investigator', 'auditor', 'supervisor'];

// Human roles allowed per operation. Missing or empty means nobody.
export const HUMAN_MATRIX: Readonly<Record<Operation, readonly Role[]>> = {
  read_metadata: ALL,
  read_original: ALL,
  register_evidence: ['investigator', 'supervisor'],
  register_derivative: ['investigator', 'supervisor'],
  add_custody_event: ['investigator', 'supervisor'],
  record_historical_assertion: ALL,
  append_correction: ALL,
  request_export: ALL,
  approve_request: ['supervisor'],
  // The service also requires: the requester themself, or a supervisor (ADR 0005 decision 7).
  revoke_approval: ALL,
  record_finding: ALL,
  create_proposal: [], // proposals exist for the agent; humans act directly
  // Gate only: promotion then re-runs the proposed operation's own policy for this human.
  promote_proposal: ALL,
  overwrite_original: [],
  delete_history: [],
  grant_role: [], // denied until membership changes get their own policy and audit contract
};

// Never allowed for anyone, so they are denied before any other check.
export const FORBIDDEN: ReadonlySet<Operation> = new Set(['overwrite_original', 'delete_history', 'grant_role']);

// The agent's capability set: strictly smaller than every human role.
export const AGENT_CAPABILITIES: ReadonlySet<Operation> = new Set(['read_metadata', 'read_original', 'record_finding', 'create_proposal']);

// Port: who belongs to which case. Async so a real directory can back it.
export interface MembershipDirectory {
  roleOf(caseId: string, userId: string): Promise<Role | null>;
  caseOfAgent(agentId: string): Promise<string | null>;
}

export class MemoryDirectory implements MembershipDirectory {
  readonly #roles = new Map<string, Role>();
  readonly #agents = new Map<string, string>();
  constructor(members: Array<{ caseId: string; userId: string; role: Role }>, agents: Array<{ agentId: string; caseId: string }> = []) {
    for (const m of members) this.#roles.set(`${m.caseId}\u0000${m.userId}`, m.role);
    for (const a of agents) this.#agents.set(a.agentId, a.caseId);
  }
  async roleOf(caseId: string, userId: string): Promise<Role | null> {
    return this.#roles.get(`${caseId}\u0000${userId}`) ?? null;
  }
  async caseOfAgent(agentId: string): Promise<string | null> {
    return this.#agents.get(agentId) ?? null;
  }
}

export type Decision = { kind: 'human'; actor: ActorRecord } | { kind: 'agent'; agentId: string };

export async function authorize(directory: MembershipDirectory, ctx: RequestContext, operation: Operation, caseId: string): Promise<Result<Decision>> {
  const p = ctx.principal;
  if (!p) return fail('DENIED_NO_IDENTITY', 'no verified principal');
  // Case IDs are used as key prefixes in prefix scans; '#' or other separators
  // could make one case read another's records (re-review finding N5).
  if (typeof caseId !== 'string' || !CASE_ID.test(caseId)) return fail('INVALID_REQUEST', 'malformed case id');
  if (FORBIDDEN.has(operation)) return fail('DENIED_FORBIDDEN_OPERATION', `${operation} is never allowed`);
  try {
    if (p.type === 'agent') {
      if (ctx.channel !== 'gateway') return fail('DENIED_AGENT', 'agent calls must arrive through the gateway');
      if (!AGENT_CAPABILITIES.has(operation)) return fail('DENIED_AGENT', `agent may not ${operation}; it may propose instead`);
      const boundCase = await directory.caseOfAgent(p.agentId);
      if (!boundCase || boundCase !== caseId) return fail('DENIED_NOT_MEMBER', 'agent is not bound to this case');
      return ok({ kind: 'agent', agentId: p.agentId });
    }
    const role = await directory.roleOf(caseId, p.userId);
    if (!role) return fail('DENIED_NOT_MEMBER', 'not a member of this case');
    if (!HUMAN_MATRIX[operation].includes(role)) return fail('DENIED_ROLE', `${role} may not ${operation}`);
    return ok({ kind: 'human', actor: { type: 'human', userId: p.userId, role } });
  } catch {
    return fail('DENIED_POLICY_UNAVAILABLE', 'membership directory unavailable');
  }
}
