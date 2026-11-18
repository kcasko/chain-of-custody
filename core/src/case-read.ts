// Human read views for the investigation workflow (T17): the custody timeline
// with a chain self-check, agent drafts, and export approvals. Every read goes
// through `guarded` (authorized as read_metadata, audited) and is humans only:
// these are operator views, and the agent's surface stays the five tools.

import { guarded, type GuardDeps } from './audit.ts';
import type { Approval } from './approvals.ts';
import type { CheckpointAuthority } from './checkpoint.ts';
import { ZERO_HASH } from './crypto.ts';
import { computeEventHash, type Ledger } from './ledger.ts';
import type { Proposal } from './proposals.ts';
import type { TransactionalStore } from './store.ts';
import { TABLES } from './tables.ts';
import type { CustodyEvent, RequestContext, Result, SignedCheckpoint } from './types.ts';
import { fail, ok } from './types.ts';

export interface ChainCheck {
  readonly intact: boolean;
  readonly length: number;
  /** First problems found, in sequence order; empty when intact. */
  readonly problems: ReadonlyArray<{ sequence: number; problem: 'SEQUENCE_GAP' | 'PREV_HASH_MISMATCH' | 'EVENT_HASH_MISMATCH' | 'HEAD_MISMATCH' }>;
}

export interface Timeline {
  readonly events: readonly CustodyEvent[];
  readonly head: { sequence: number; hash: string };
  readonly checkpoint: SignedCheckpoint | null;
  readonly chain: ChainCheck;
}

// Recomputes every event hash and link from storage. The independent verifier
// is still the authority for exports; this is the operator's quick check.
export function checkChain(events: readonly CustodyEvent[], head: { sequence: number; hash: string }): ChainCheck {
  const problems: Array<ChainCheck['problems'][number]> = [];
  let prev = ZERO_HASH;
  events.forEach((e, i) => {
    if (e.sequence !== i + 1) problems.push({ sequence: e.sequence, problem: 'SEQUENCE_GAP' });
    if (e.prevHash !== prev) problems.push({ sequence: e.sequence, problem: 'PREV_HASH_MISMATCH' });
    const { eventHash, ...rest } = e;
    if (computeEventHash(rest as Omit<CustodyEvent, 'eventHash'>) !== eventHash) problems.push({ sequence: e.sequence, problem: 'EVENT_HASH_MISMATCH' });
    prev = eventHash;
  });
  if (head.sequence !== events.length || head.hash !== (events.at(-1)?.eventHash ?? ZERO_HASH)) problems.push({ sequence: head.sequence, problem: 'HEAD_MISMATCH' });
  return { intact: problems.length === 0, length: events.length, problems: problems.slice(0, 20) };
}

export type CaseReadDeps = GuardDeps & { store: TransactionalStore; ledger: Ledger; checkpoints: CheckpointAuthority };

export class CaseReadService {
  readonly #deps: CaseReadDeps;
  constructor(deps: CaseReadDeps) {
    this.#deps = deps;
  }

  async timeline(ctx: RequestContext, caseId: string): Promise<Result<Timeline>> {
    return guarded(this.#deps, ctx, 'read_metadata', caseId, async (d) => {
      if (d.kind !== 'human') return fail('DENIED_AGENT', 'the timeline is an operator view; the agent uses its tools');
      // Checkpoint first, then events: the ledger only grows, so the events read
      // afterwards always cover the checkpoint (same rule as export).
      const checkpoint = await this.#deps.checkpoints.latest(caseId);
      const events = await this.#deps.ledger.events(caseId);
      const h = await this.#deps.ledger.head(caseId);
      const head = { sequence: h.sequence, hash: h.hash };
      return ok({ events, head, checkpoint, chain: checkChain(events, head) });
    });
  }

  async proposals(ctx: RequestContext, caseId: string): Promise<Result<Proposal[]>> {
    return guarded(this.#deps, ctx, 'read_metadata', caseId, async (d) => {
      if (d.kind !== 'human') return fail('DENIED_AGENT', 'draft review is an operator view');
      const rows = await this.#deps.store.list<Proposal>(TABLES.proposals, '');
      return ok(rows.map((r) => r.item.value).filter((p) => p.caseId === caseId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.proposalId.localeCompare(b.proposalId)));
    });
  }

  async approvals(ctx: RequestContext, caseId: string): Promise<Result<Approval[]>> {
    return guarded(this.#deps, ctx, 'read_metadata', caseId, async (d) => {
      if (d.kind !== 'human') return fail('DENIED_AGENT', 'approvals are an operator view');
      const rows = await this.#deps.store.list<Approval>(TABLES.approvals, '');
      return ok(rows.map((r) => r.item.value).filter((a) => a.caseId === caseId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.approvalId.localeCompare(b.approvalId)));
    });
  }
}
