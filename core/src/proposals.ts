// Agent proposals: non-authoritative drafts. The agent may create them; only
// an authorized human can promote one, and promotion re-runs the full policy
// for that human. The proposal's state change commits atomically with the
// resulting ledger event, so a draft is promoted at most once.

import { randomUUID } from 'node:crypto';
import { TABLES } from './tables.ts';
import { guarded, lookupGuarded, type GuardDeps } from './audit.ts';
import type { Promoter, ProposalKind } from './custody.ts';
import type { TransactionalStore } from './store.ts';
import type { CustodyEvent, RequestContext, Result } from './types.ts';
import { ok, fail } from './types.ts';
import { checkClosed } from './validate.ts';
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
  readonly status: 'draft' | 'promoted';
  readonly createdAt: string;
  readonly promotedBy: string | null;
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
        proposedBy: d.agentId, status: 'draft', createdAt: ctx.now.toISOString(), promotedBy: null,
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
}
