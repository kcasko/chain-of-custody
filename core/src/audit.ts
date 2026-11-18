// Security audit trail, separate from the custody ledger. Denials go here,
// never into the ledger. A protected operation runs only after its
// 'attempted' record is persisted (fail closed: DENIED_AUDIT_UNAVAILABLE).

import type { MembershipDirectory, Decision } from './policy.ts';
import { authorize } from './policy.ts';
import type { ErrorCode, Operation, RequestContext, Result } from './types.ts';
import { fail } from './types.ts';
import { OutcomeUnknownError } from './store.ts';

export type Outcome = 'attempted' | 'denied' | 'completed' | 'failed';

export interface SecurityEvent {
  readonly requestId: string;
  readonly caseId: string;
  readonly principal: string; // "human:<id>" | "agent:<id>" | "anonymous"
  readonly operation: Operation | 'tool_call'; // tool_call: refused at the agent tool layer, before any domain operation
  readonly outcome: Outcome;
  readonly code: string | null;
  readonly at: string;
}

export interface SecurityAuditLog {
  append(event: SecurityEvent): Promise<void>;
}

export class MemoryAuditLog implements SecurityAuditLog {
  readonly events: SecurityEvent[] = [];
  available = true;
  async append(event: SecurityEvent): Promise<void> {
    if (!this.available) throw new Error('audit store unavailable');
    this.events.push(Object.freeze({ ...event }));
  }
}

export function principalLabel(ctx: RequestContext): string {
  const p = ctx.principal;
  if (!p) return 'anonymous';
  return p.type === 'human' ? `human:${p.userId}` : `agent:${p.agentId}`;
}

export interface GuardDeps { directory: MembershipDirectory; audit: SecurityAuditLog }

// A lookup by an opaque ID found nothing, so there is no case to authorize
// against. Record the miss (best effort) so ID probing leaves a trace, then fail.
export async function auditLookupMiss<T>(deps: GuardDeps, ctx: RequestContext, operation: Operation, detail: string): Promise<Result<T>> {
  return auditUnknownCase(deps, ctx, operation, 'denied', 'NOT_FOUND', detail);
}

async function auditUnknownCase<T>(deps: GuardDeps, ctx: RequestContext, operation: Operation, outcome: Outcome, code: ErrorCode, detail: string): Promise<Result<T>> {
  let persisted = true;
  try {
    await deps.audit.append({ requestId: ctx.requestId, caseId: '(unknown)', principal: principalLabel(ctx), operation, outcome, code, at: ctx.now.toISOString() });
  } catch {
    persisted = false;
  }
  return fail(code, detail, persisted);
}

// For operations addressed by an opaque record ID (approval, proposal) whose
// case is only known after a lookup. Order matters:
//  1. No identity: deny before touching the store, so anonymous callers learn nothing.
//  2. Store failure during the lookup: audited, returned as a Result (never thrown).
//  3. Missing record: audited NOT_FOUND.
//  4. Otherwise run the normal guard. A caller who is not a member of the
//     record's case also gets NOT_FOUND, so IDs are not an existence oracle;
//     the audit record keeps the real code (DENIED_NOT_MEMBER).
export async function lookupGuarded<R, T>(
  deps: GuardDeps,
  ctx: RequestContext,
  operation: Operation,
  lookup: () => Promise<R | null | undefined>,
  caseOf: (record: R) => string,
  run: (decision: Decision, record: R) => Promise<Result<T>>,
): Promise<Result<T>> {
  if (!ctx.principal) return auditUnknownCase(deps, ctx, operation, 'denied', 'DENIED_NO_IDENTITY', 'no verified principal');
  let record: R | null | undefined;
  try {
    record = await lookup();
  } catch {
    return auditUnknownCase(deps, ctx, operation, 'failed', 'STORAGE_UNAVAILABLE', 'record store unavailable');
  }
  if (!record) return auditLookupMiss(deps, ctx, operation, 'no such record');
  const found = record;
  const r = await guarded(deps, ctx, operation, caseOf(found), (d) => run(d, found));
  if (!r.ok && r.code === 'DENIED_NOT_MEMBER') return fail('NOT_FOUND', 'no such record', r.auditPersisted);
  return r;
}

// Authorize, persist 'attempted', run, then record the outcome.
// Returns the operation's own failure unchanged when it fails.
export async function guarded<T>(
  deps: GuardDeps,
  ctx: RequestContext,
  operation: Operation,
  caseId: string,
  run: (decision: Decision) => Promise<Result<T>>,
): Promise<Result<T>> {
  const base = { requestId: ctx.requestId, caseId, principal: principalLabel(ctx), operation, at: ctx.now.toISOString() };
  const record = async (outcome: Outcome, code: string | null): Promise<boolean> => {
    try {
      await deps.audit.append({ ...base, outcome, code });
      return true;
    } catch {
      return false;
    }
  };

  const decision = await authorize(deps.directory, ctx, operation, caseId);
  if (!decision.ok) {
    const persisted = await record('denied', decision.code);
    return fail(decision.code, decision.detail, persisted);
  }
  if (!(await record('attempted', null))) {
    // The denial cannot be persisted in an unavailable store; say so honestly.
    return fail('DENIED_AUDIT_UNAVAILABLE', 'audit store unavailable; no protected action taken', false);
  }
  let result: Result<T>;
  try {
    result = await run(decision.value);
  } catch (err) {
    result = err instanceof OutcomeUnknownError
      ? fail('OUTCOME_UNKNOWN', 'the change may or may not have been applied; read the current state before retrying')
      : fail('STORAGE_UNAVAILABLE', 'operation failed unexpectedly');
  }
  await record(result.ok ? 'completed' : 'failed', result.ok ? null : result.code);
  return result;
}
