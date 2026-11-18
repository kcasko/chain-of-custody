// Custody operations that append to the ledger: transfers, historical
// assertions and corrections. Each is authorized and audited (guarded),
// validated against a closed shape, and checked against registered evidence.

import { guarded, type GuardDeps } from './audit.ts';
import { isHex64 } from './crypto.ts';
import { Ledger, type AppendOptions } from './ledger.ts';
import { TABLES } from './tables.ts';
import type { TransactionalStore } from './store.ts';
import type { CustodyEvent, EvidenceRegisteredBody, RequestContext, Result, EvidenceRef } from './types.ts';
import { fail } from './types.ts';
import { checkClosed, checkText, checkEvidenceRefs, EVIDENCE_ID, VERSION_ID } from './validate.ts';

export type CustodyDeps = GuardDeps & { ledger: Ledger; store: TransactionalStore };
// Public callers may only pass an idempotency key. Extra transactional writes
// are never accepted from outside (review finding 1: they allowed forging an
// approval inside a ledger transaction).
export interface MutationOptions { idempotencyKey?: string }
type Internal = Pick<AppendOptions, 'idempotencyKey' | 'extraWrites'>;

export type ProposalKind = 'custody_transfer' | 'historical_assertion' | 'correction';
// Capability handed only to ProposalService at wiring time. It can do exactly
// one thing: promote the draft with this ID, at the version the caller read,
// as the human in ctx. Custody reads the draft and builds its promoted state
// itself, so the capability cannot write arbitrary values (re-review N6).
export type Promoter = (ctx: RequestContext, proposalId: string, expectVersion: number) => Promise<Result<CustodyEvent>>;

interface StoredProposal { caseId: string; kind: ProposalKind; input: unknown; status: string; promotedBy: string | null }

// Registered evidence versions in a case, from the ledger (the source of truth).
export async function registrations(ledger: Ledger, caseId: string): Promise<Map<string, EvidenceRegisteredBody>> {
  const out = new Map<string, EvidenceRegisteredBody>();
  for (const e of await ledger.events(caseId)) {
    if (e.kind === 'evidence_registered') out.set(`${e.body.evidenceId}@${e.body.versionId}`, e.body);
  }
  return out;
}

const refKey = (r: EvidenceRef): string => `${r.evidenceId}@${r.versionId}`;

function pickPublic(options: MutationOptions | undefined): Internal {
  const key = options?.idempotencyKey;
  return key === undefined ? {} : { idempotencyKey: key };
}

export class CustodyService {
  readonly #deps: CustodyDeps;
  constructor(deps: CustodyDeps, options: { onPromoter?: (promoter: Promoter) => void } = {}) {
    this.#deps = deps;
    options.onPromoter?.(async (ctx, proposalId, expectVersion) => {
      if (ctx.principal?.type !== 'human') return fail('DENIED_AGENT', 'only a human can promote a proposal');
      const item = await this.#deps.store.get<StoredProposal>(TABLES.proposals, proposalId);
      if (!item || item.version !== expectVersion) return fail('LEDGER_CONFLICT', 'proposal changed since it was read');
      const p = item.value;
      if (p.status !== 'draft') return fail('INVALID_REQUEST', 'proposal is not a draft');
      const promoted = { ...p, status: 'promoted', promotedBy: ctx.principal.userId };
      const internal: Internal = { extraWrites: [{ table: TABLES.proposals, key: proposalId, value: promoted, expectVersion }] };
      switch (p.kind) {
        case 'custody_transfer': return this.#recordTransfer(ctx, p.caseId, p.input, internal);
        case 'historical_assertion': return this.#recordHistoricalAssertion(ctx, p.caseId, p.input, internal);
        case 'correction': return this.#appendCorrection(ctx, p.caseId, p.input, internal);
        default: return fail('INVALID_REQUEST', 'unsupported proposal kind');
      }
    });
  }

  // Only idempotencyKey is read from options, even if a caller passes more.
  recordTransfer(ctx: RequestContext, caseId: string, input: unknown, options: MutationOptions = {}): Promise<Result<CustodyEvent>> {
    return this.#recordTransfer(ctx, caseId, input, pickPublic(options));
  }
  recordHistoricalAssertion(ctx: RequestContext, caseId: string, input: unknown, options: MutationOptions = {}): Promise<Result<CustodyEvent>> {
    return this.#recordHistoricalAssertion(ctx, caseId, input, pickPublic(options));
  }
  appendCorrection(ctx: RequestContext, caseId: string, input: unknown, options: MutationOptions = {}): Promise<Result<CustodyEvent>> {
    return this.#appendCorrection(ctx, caseId, input, pickPublic(options));
  }

  async #recordTransfer(ctx: RequestContext, caseId: string, input: unknown, internal: Internal): Promise<Result<CustodyEvent>> {
    return guarded(this.#deps, ctx, 'add_custody_event', caseId, async (d) => {
      if (d.kind !== 'human') return fail('DENIED_AGENT', 'agents propose; they do not append');
      const o = checkClosed(input, ['evidenceId', 'versionId', 'from', 'to', 'reason']);
      if (!o.ok) return o;
      const { evidenceId, versionId } = o.value;
      if (typeof evidenceId !== 'string' || !EVIDENCE_ID.test(evidenceId) || typeof versionId !== 'string' || !VERSION_ID.test(versionId)) return fail('INVALID_REQUEST', 'bad evidence reference');
      const from = checkText(o.value.from, 'from', 200);
      if (!from.ok) return from;
      const to = checkText(o.value.to, 'to', 200);
      if (!to.ok) return to;
      const reason = checkText(o.value.reason, 'reason', 2000);
      if (!reason.ok) return reason;
      if (!(await registrations(this.#deps.ledger, caseId)).has(refKey({ evidenceId, versionId }))) return fail('NOT_FOUND', 'evidence version is not registered in this case');
      return this.#deps.ledger.append(d.actor, caseId, {
        kind: 'custody_transfer',
        body: { evidenceId, versionId, from: from.value, to: to.value, reason: reason.value },
      }, ctx.now, internal);
    });
  }

  // A past event claimed by a document. Must cite registered, pinned versions
  // and keep the raw claimed time, source clock, timezone and uncertainty.
  async #recordHistoricalAssertion(ctx: RequestContext, caseId: string, input: unknown, internal: Internal): Promise<Result<CustodyEvent>> {
    return guarded(this.#deps, ctx, 'record_historical_assertion', caseId, async (d) => {
      if (d.kind !== 'human') return fail('DENIED_AGENT', 'agents propose; they do not append');
      const o = checkClosed(input, ['evidenceId', 'sources', 'statement', 'claimedTimeRaw', 'sourceClock', 'timezone', 'offsetUncertainty']);
      if (!o.ok) return o;
      const { evidenceId } = o.value;
      if (typeof evidenceId !== 'string' || !EVIDENCE_ID.test(evidenceId)) return fail('INVALID_REQUEST', 'bad evidenceId');
      const sources = checkEvidenceRefs(o.value.sources, 1, 10);
      if (!sources.ok) return sources;
      const texts: Record<string, string> = {};
      for (const [f, max] of [['statement', 2000], ['claimedTimeRaw', 200], ['sourceClock', 200], ['timezone', 100], ['offsetUncertainty', 500]] as const) {
        const t = checkText(o.value[f], f, max);
        if (!t.ok) return t;
        texts[f] = t.value;
      }
      const reg = await registrations(this.#deps.ledger, caseId);
      if (![...reg.values()].some((b) => b.evidenceId === evidenceId)) return fail('NOT_FOUND', 'subject evidence is not registered in this case');
      for (const s of sources.value) if (!reg.has(refKey(s))) return fail('NOT_FOUND', `source ${refKey(s)} is not a registered version in this case`);
      return this.#deps.ledger.append(d.actor, caseId, {
        kind: 'historical_assertion',
        body: {
          evidenceId, sources: sources.value, statement: texts.statement!, claimedTimeRaw: texts.claimedTimeRaw!,
          sourceClock: texts.sourceClock!, timezone: texts.timezone!, offsetUncertainty: texts.offsetUncertainty!,
        },
      }, ctx.now, internal);
    });
  }

  // Appends a correction that references an earlier event by exact sequence and hash.
  async #appendCorrection(ctx: RequestContext, caseId: string, input: unknown, internal: Internal): Promise<Result<CustodyEvent>> {
    return guarded(this.#deps, ctx, 'append_correction', caseId, async (d) => {
      if (d.kind !== 'human') return fail('DENIED_AGENT', 'agents propose; they do not append');
      const o = checkClosed(input, ['targetSequence', 'targetHash', 'reason']);
      if (!o.ok) return o;
      const { targetSequence, targetHash } = o.value;
      if (!Number.isSafeInteger(targetSequence) || (targetSequence as number) < 1) return fail('INVALID_REQUEST', 'targetSequence must be a positive integer');
      if (!isHex64(targetHash)) return fail('INVALID_REQUEST', 'targetHash must be a SHA-256 hex digest');
      const reason = checkText(o.value.reason, 'reason', 2000);
      if (!reason.ok) return reason;
      const target = await this.#deps.ledger.eventAt(caseId, targetSequence as number);
      if (!target) return fail('NOT_FOUND', 'no event at that sequence in this case');
      if (target.eventHash !== targetHash) return fail('INVALID_REQUEST', 'targetHash does not match the event at that sequence');
      return this.#deps.ledger.append(d.actor, caseId, {
        kind: 'correction',
        body: { targetSequence: targetSequence as number, targetHash, reason: reason.value },
      }, ctx.now, internal);
    });
  }
}

