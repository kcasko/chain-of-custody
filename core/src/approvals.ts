// Independent human approval for restricted operations (T02).
// An approval authorizes one exact operation (bound by digest), once, before
// it expires, and only for the requester. Consumption is a conditional write
// the caller includes in the same transaction as the action itself.

import { TABLES } from './tables.ts';
import { randomUUID } from 'node:crypto';
import { guarded, lookupGuarded, type GuardDeps } from './audit.ts';
import { PURPOSE, recordHash } from './crypto.ts';
import type { TransactionalStore, Write } from './store.ts';
import type { EvidenceRef, RequestContext, Result } from './types.ts';
import { ok, fail } from './types.ts';
import { checkEvidenceRefs } from './validate.ts';

export const APPROVALS_TABLE = TABLES.approvals;

// The only destination an MVP export may target. External destinations are denied.
export const EXPORT_DESTINATIONS: ReadonlySet<string> = new Set(['internal:case-export-store']);

export interface ExportPayload { readonly evidence: readonly EvidenceRef[]; readonly destination: string }

export interface Approval {
  readonly approvalId: string;
  readonly caseId: string;
  readonly operation: 'export_evidence';
  readonly operationDigest: string;
  readonly requester: string;
  readonly status: 'pending' | 'approved' | 'consumed' | 'revoked';
  readonly approver: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly decidedAt: string | null;
  readonly consumedAt: string | null;
}

export function operationDigest(caseId: string, requester: string, payload: ExportPayload): string {
  return recordHash(PURPOSE.approvalOperation, {
    caseId,
    operation: 'export_evidence',
    requester,
    payload: { evidence: payload.evidence.map((r) => ({ evidenceId: r.evidenceId, versionId: r.versionId })), destination: payload.destination },
  });
}

export function validateExportPayload(payload: unknown): Result<ExportPayload> {
  if (!payload || typeof payload !== 'object') return fail('INVALID_REQUEST', 'payload must be an object');
  const p = payload as Record<string, unknown>;
  const allowed = new Set(['evidence', 'destination']);
  const extra = Object.keys(p).filter((k) => !allowed.has(k));
  if (extra.length) return fail('INVALID_REQUEST', `unknown field ${extra[0]}`);
  const refs = checkEvidenceRefs(p.evidence, 1, 20);
  if (!refs.ok) return refs;
  if (typeof p.destination !== 'string' || !EXPORT_DESTINATIONS.has(p.destination)) return fail('INVALID_REQUEST', 'destination is not an allowed export destination');
  return ok({ evidence: refs.value, destination: p.destination });
}

export class ApprovalService {
  readonly #deps: GuardDeps & { store: TransactionalStore };
  readonly #ttlMs: number;

  constructor(deps: GuardDeps & { store: TransactionalStore }, options: { ttlMs: number }) {
    this.#deps = deps;
    this.#ttlMs = options.ttlMs;
  }

  // Internal: no authorization or case check. Never expose through a transport.
  async getUnchecked(approvalId: unknown): Promise<{ approval: Approval; version: number } | null> {
    if (typeof approvalId !== 'string' || approvalId.length === 0 || approvalId.length > 64) return null;
    const item = await this.#deps.store.get<Approval>(APPROVALS_TABLE, approvalId);
    return item ? { approval: item.value, version: item.version } : null;
  }

  async requestExport(ctx: RequestContext, caseId: string, payload: unknown): Promise<Result<Approval>> {
    return guarded(this.#deps, ctx, 'request_export', caseId, async (d) => {
      if (d.kind !== 'human') return fail('DENIED_AGENT', 'only humans request exports');
      const v = validateExportPayload(payload);
      if (!v.ok) return v;
      const now = ctx.now.toISOString();
      const approval: Approval = {
        approvalId: randomUUID(), caseId, operation: 'export_evidence',
        operationDigest: operationDigest(caseId, d.actor.userId, v.value),
        requester: d.actor.userId, status: 'pending', approver: null,
        createdAt: now, expiresAt: new Date(ctx.now.getTime() + this.#ttlMs).toISOString(), decidedAt: null, consumedAt: null,
      };
      const r = await this.#deps.store.transact([{ table: APPROVALS_TABLE, key: approval.approvalId, value: approval, expectVersion: null }]);
      return r.ok ? ok(approval) : fail('LEDGER_CONFLICT', 'approval id collision');
    });
  }

  async approve(ctx: RequestContext, approvalId: string): Promise<Result<Approval>> {
    return lookupGuarded(this.#deps, ctx, 'approve_request', () => this.getUnchecked(approvalId), (f) => f.approval.caseId, async (d, { approval, version }) => {
      if (d.kind !== 'human') return fail('DENIED_AGENT', 'only humans approve');
      if (d.actor.userId === approval.requester) return fail('DENIED_SELF_APPROVAL', 'requester cannot approve their own request');
      if (approval.status !== 'pending') return fail('DENIED_APPROVAL_INVALID', `approval is ${approval.status}`);
      if (ctx.now.getTime() >= Date.parse(approval.expiresAt)) return fail('DENIED_APPROVAL_INVALID', 'approval request expired');
      const next: Approval = { ...approval, status: 'approved', approver: d.actor.userId, decidedAt: ctx.now.toISOString() };
      const r = await this.#deps.store.transact([{ table: APPROVALS_TABLE, key: approvalId, value: next, expectVersion: version }]);
      return r.ok ? ok(next) : fail('DENIED_APPROVAL_INVALID', 'approval changed concurrently');
    });
  }

  // The requester may withdraw; a supervisor may revoke anyone's approval.
  async revoke(ctx: RequestContext, approvalId: string): Promise<Result<Approval>> {
    return lookupGuarded(this.#deps, ctx, 'revoke_approval', () => this.getUnchecked(approvalId), (f) => f.approval.caseId, async (d, { approval, version }) => {
      if (d.kind !== 'human') return fail('DENIED_AGENT', 'only humans revoke');
      if (d.actor.userId !== approval.requester && d.actor.role !== 'supervisor') return fail('DENIED_ROLE', 'only the requester or a supervisor may revoke');
      if (approval.status !== 'pending' && approval.status !== 'approved') return fail('DENIED_APPROVAL_INVALID', `approval is ${approval.status}`);
      const next: Approval = { ...approval, status: 'revoked', decidedAt: ctx.now.toISOString() };
      const r = await this.#deps.store.transact([{ table: APPROVALS_TABLE, key: approvalId, value: next, expectVersion: version }]);
      return r.ok ? ok(next) : fail('DENIED_APPROVAL_INVALID', 'approval changed concurrently');
    });
  }

  // Checks an approval for one exact use and returns the conditional write that
  // consumes it. The caller commits that write in the same transaction as the
  // action. If two callers race, the store lets exactly one transaction through.
  async consumptionWrite(userId: string, now: Date, approvalId: string, caseId: string, payload: ExportPayload): Promise<Result<Write>> {
    const found = await this.getUnchecked(approvalId);
    if (!found) return fail('DENIED_APPROVAL_INVALID', 'no such approval');
    const { approval, version } = found;
    if (approval.caseId !== caseId) return fail('DENIED_APPROVAL_INVALID', 'approval belongs to another case');
    if (approval.status !== 'approved') return fail('DENIED_APPROVAL_INVALID', `approval is ${approval.status}`);
    if (now.getTime() >= Date.parse(approval.expiresAt)) return fail('DENIED_APPROVAL_INVALID', 'approval expired');
    if (approval.requester !== userId) return fail('DENIED_APPROVAL_INVALID', 'only the requester may use this approval');
    if (approval.operationDigest !== operationDigest(caseId, userId, payload)) return fail('DENIED_APPROVAL_INVALID', 'operation differs from what was approved');
    const next: Approval = { ...approval, status: 'consumed', consumedAt: now.toISOString() };
    return ok({ table: APPROVALS_TABLE, key: approvalId, value: next, expectVersion: version });
  }
}
