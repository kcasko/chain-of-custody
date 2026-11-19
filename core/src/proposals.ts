// Agent proposals: non-authoritative drafts. The agent may create them; only
// an authorized human can promote one, and promotion re-runs the full policy
// for that human. The proposal's state change commits atomically with the
// resulting ledger event, so a draft is promoted at most once.
// A human may instead dismiss a draft with a reason. Dismissal is final, keeps
// the draft (it is marked, not deleted) and never touches the ledger: a draft
// was never part of the record. A dismissed draft can never be promoted.

import { randomUUID } from 'node:crypto';
import { TABLES } from './tables.ts';
import { guarded, lookupGuarded, type GuardDeps } from './audit.ts';
import type { Promoter, ProposalKind } from './custody.ts';
import type { TransactionalStore } from './store.ts';
import type { CustodyEvent, RequestContext, Result } from './types.ts';
import { ok, fail } from './types.ts';
import { checkClosed, checkText } from './validate.ts';
import { canonicalBytes } from './canonical.ts';

export const PROPOSALS_TABLE = TABLES.proposals;
export type { ProposalKind };
const KINDS: readonly ProposalKind[] = ['custody_transfer', 'historical_assertion', 'correction'];
const MAX_INPUT_BYTES = 8192;

export interface Proposal {
  readonly proposalId: string;
  readonly caseId: string;
  readonly kind: ProposalKind;
  readonly input: unknown;
  readonly proposedBy: string;
  readonly status: 'draft' | 'promoted' | 'dismissed';
  readonly createdAt: string;
  readonly promotedBy: string | null;
  readonly dismissal: { readonly by: string; readonly at: string; readonly reason: string } | null;
}

export class ProposalService {
  readonly #deps: GuardDeps & { store: TransactionalStore };
  readonly #promoter: Promoter;
  constructor(deps: GuardDeps & { store: TransactionalStore }, promoter: Promoter) {
    this.#deps = deps;
    this.#promoter = promoter;
  }

  async create(ctx: RequestContext, caseId: string, request: unknown): Promise<Result<Proposal>> {
    return guarded(this.#deps, ctx, 'create_proposal', caseId, async (d) => {
      if (d.kind !== 'agent') return fail('DENIED_ROLE', 'humans act directly instead of proposing');
      const o = checkClosed(request, ['kind', 'input']);
      if (!o.ok) return o;
      const kind = o.value.kind;
      if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) return fail('INVALID_REQUEST', 'unsupported proposal kind');
      let size: number;
      try {
        size = canonicalBytes(o.value.input).length;
      } catch {
        return fail('INVALID_REQUEST', 'proposal input is not canonical data');
      }
      if (size > MAX_INPUT_BYTES) return fail('INVALID_REQUEST', 'proposal input too large');
      const proposal: Proposal = {
        proposalId: randomUUID(), caseId, kind: kind as ProposalKind, input: o.value.input,
        proposedBy: d.agentId, status: 'draft', createdAt: ctx.now.toISOString(), promotedBy: null, dismissal: null,
      };
      const r = await this.#deps.store.transact([{ table: PROPOSALS_TABLE, key: proposal.proposalId, value: proposal, expectVersion: null }]);
      return r.ok ? ok(proposal) : fail('LEDGER_CONFLICT', 'proposal id collision');
    });
  }

  // Internal: no authorization or case check. Never expose through a transport.
  async getUnchecked(proposalId: string): Promise<Proposal | null> {
    return (await this.#deps.store.get<Proposal>(PROPOSALS_TABLE, proposalId))?.value ?? null;
  }

  // Runs the proposed operation as the promoting human. All validation and
  // authorization of that operation apply exactly as if the human submitted it.
  async promote(ctx: RequestContext, proposalId: string): Promise<Result<CustodyEvent>> {
    const lookup = async () => (typeof proposalId === 'string' && proposalId.length <= 64 ? this.#deps.store.get<Proposal>(PROPOSALS_TABLE, proposalId) : undefined);
    return lookupGuarded(this.#deps, ctx, 'promote_proposal', lookup, (item) => item.value.caseId, async (d, item) => {
      if (d.kind !== 'human') return fail('DENIED_AGENT', 'only a human can promote a proposal');
      if (item.value.status !== 'draft') return fail('INVALID_REQUEST', 'proposal is not a draft');
      return this.#promoter(ctx, proposalId, item.version);
    });
  }

  // Marks a draft dismissed, conditional on the version just read, so a
  // dismissal and a concurrent promotion cannot both succeed.
  async dismiss(ctx: RequestContext, request: unknown): Promise<Result<Proposal>> {
    const o = checkClosed(request, ['proposalId', 'reason']);
    // Find the draft even if the request has extra fields, so the refusal is
    // INVALID_REQUEST (after authorization) rather than a misleading NOT_FOUND.
    const proposalId = request && typeof request === 'object' ? (request as Record<string, unknown>).proposalId : undefined;
    const lookup = async () => (typeof proposalId === 'string' && proposalId.length <= 64 ? this.#deps.store.get<Proposal>(PROPOSALS_TABLE, proposalId) : undefined);
    return lookupGuarded(this.#deps, ctx, 'dismiss_proposal', lookup, (item) => item.value.caseId, async (d, item) => {
      if (d.kind !== 'human') return fail('DENIED_AGENT', 'only a human can dismiss a proposal');
      if (!o.ok) return o;
      const reason = checkText(o.value.reason, 'reason', 2000);
      if (!reason.ok) return reason;
      if (item.value.status !== 'draft') return fail('INVALID_REQUEST', 'proposal is not a draft');
      const dismissed: Proposal = { ...item.value, status: 'dismissed', dismissal: { by: d.actor.userId, at: ctx.now.toISOString(), reason: reason.value } };
      const r = await this.#deps.store.transact([{ table: PROPOSALS_TABLE, key: item.value.proposalId, value: dismissed, expectVersion: item.version }]);
      return r.ok ? ok(dismissed) : fail('LEDGER_CONFLICT', 'proposal changed since it was read');
    });
  }
}
