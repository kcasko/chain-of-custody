// Append-only custody ledger (T04). One hash chain per case. The head moves
// only by a conditional write, so two appends can never share a sequence.
// There is no update or delete method; corrections are new events.

import { TABLES } from './tables.ts';
import { recordHash, PURPOSE, ZERO_HASH } from './crypto.ts';
import { CanonicalizationError } from './canonical.ts';
import { deepFreeze, type TransactionalStore, type Write } from './store.ts';
import type { ActorRecord, CustodyEvent, EventDraft, Result } from './types.ts';
import { ok, fail } from './types.ts';

export const EVENTS_TABLE = TABLES.events; // append-only
export const HEADS_TABLE = TABLES.heads; // conditional updates
export const IDEMPOTENCY_TABLE = TABLES.idempotency; // append-only

const pad = (n: number): string => String(n).padStart(12, '0');
export const eventKey = (caseId: string, sequence: number): string => `${caseId}#${pad(sequence)}`;

export function computeEventHash(event: Omit<CustodyEvent, 'eventHash'>): string {
  return recordHash(PURPOSE.custodyEvent, event);
}

export interface Head { sequence: number; hash: string; version: number | null }
interface HeadValue { sequence: number; hash: string }
interface IdempotencyValue { requestDigest: string; sequence: number }

export interface AppendOptions {
  idempotencyKey?: string;
  // What the idempotency digest covers. Defaults to the event draft. Callers whose
  // drafts contain server-generated values (random version IDs, object keys) must
  // pass the client-visible request instead, or retries can never match.
  idempotencyContent?: unknown;
  approvalId?: string | null;
  extraWrites?: Write[]; // committed atomically with the event (approval or proposal state)
}

export const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,128}$/;

export type IdempotencyCheck = { kind: 'none' } | { kind: 'replay'; event: CustodyEvent } | { kind: 'reused' } | { kind: 'invalid' };

export class Ledger {
  readonly #store: TransactionalStore;
  constructor(store: TransactionalStore) {
    this.#store = store;
  }

  async head(caseId: string): Promise<Head> {
    const item = await this.#store.get<HeadValue>(HEADS_TABLE, caseId);
    return item ? { sequence: item.value.sequence, hash: item.value.hash, version: item.version } : { sequence: 0, hash: ZERO_HASH, version: null };
  }

  async events(caseId: string): Promise<CustodyEvent[]> {
    const rows = await this.#store.list<CustodyEvent>(EVENTS_TABLE, `${caseId}#`);
    return rows.map((r) => r.item.value);
  }

  async eventAt(caseId: string, sequence: number): Promise<CustodyEvent | null> {
    if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
    return (await this.#store.get<CustodyEvent>(EVENTS_TABLE, eventKey(caseId, sequence)))?.value ?? null;
  }

  #idem(caseId: string, userId: string, key: string, kind: string, content: unknown): { key: string; digest: string } {
    return {
      key: recordHash(PURPOSE.request, { caseId, userId, idempotencyKey: key }),
      digest: recordHash(PURPOSE.request, { caseId, userId, kind, content }),
    };
  }

  // Lets a caller detect a retry before doing expensive or irreversible work
  // (for example storing evidence bytes). Uses the same digest as append().
  async checkIdempotent(caseId: string, userId: string, key: unknown, kind: string, content: unknown): Promise<IdempotencyCheck> {
    if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key)) return { kind: 'invalid' };
    const r = await this.#replay(caseId, this.#idem(caseId, userId, key, kind, content));
    if (!r) return { kind: 'none' };
    return r.ok ? { kind: 'replay', event: r.value } : { kind: 'reused' };
  }

  // Callers must authorize first (see custody.ts and evidence.ts).
  async append(actor: ActorRecord, caseId: string, draft: EventDraft, now: Date, options: AppendOptions = {}): Promise<Result<CustodyEvent>> {
    let idem: { key: string; digest: string } | null = null;
    try {
      if (options.idempotencyKey !== undefined) {
        if (typeof options.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(options.idempotencyKey)) return fail('INVALID_REQUEST', 'idempotency key must be 1-128 characters of A-Z a-z 0-9 . _ : -');
        const content = 'idempotencyContent' in options ? options.idempotencyContent : draft.body;
        idem = this.#idem(caseId, actor.userId, options.idempotencyKey, draft.kind, content);
        const replay = await this.#replay(caseId, idem);
        if (replay) return replay;
      }
      const head = await this.head(caseId);
      const unsigned: Omit<CustodyEvent, 'eventHash'> = {
        schema: 'coc/custody-event/v1',
        caseId,
        sequence: head.sequence + 1,
        prevHash: head.hash,
        recordedAt: now.toISOString(),
        actor,
        approvalId: options.approvalId ?? null,
        ...draft,
      } as Omit<CustodyEvent, 'eventHash'>;
      const event = { ...unsigned, eventHash: computeEventHash(unsigned) } as CustodyEvent;
      const writes: Write[] = [
        { table: EVENTS_TABLE, key: eventKey(caseId, event.sequence), value: event, expectVersion: null },
        { table: HEADS_TABLE, key: caseId, value: { sequence: event.sequence, hash: event.eventHash } satisfies HeadValue, expectVersion: head.version },
      ];
      if (idem) writes.push({ table: IDEMPOTENCY_TABLE, key: idem.key, value: { requestDigest: idem.digest, sequence: event.sequence } satisfies IdempotencyValue, expectVersion: null });
      writes.push(...(options.extraWrites ?? []));
      const r = await this.#store.transact(writes);
      if (!r.ok) {
        if (idem) {
          const replay = await this.#replay(caseId, idem);
          if (replay) return replay;
        }
        return fail('LEDGER_CONFLICT', 'the ledger or a linked record changed concurrently; nothing was written');
      }
      return ok(deepFreeze(structuredClone(event)));
    } catch (err) {
      if (err instanceof CanonicalizationError) return fail('INVALID_REQUEST', err.message);
      throw err;
    }
  }

  async #replay(caseId: string, idem: { key: string; digest: string }): Promise<Result<CustodyEvent> | null> {
    const existing = await this.#store.get<IdempotencyValue>(IDEMPOTENCY_TABLE, idem.key);
    if (!existing) return null;
    if (existing.value.requestDigest !== idem.digest) return fail('IDEMPOTENCY_KEY_REUSED', 'idempotency key was used for a different request');
    const event = await this.eventAt(caseId, existing.value.sequence);
    return event ? ok(event) : fail('LEDGER_CONFLICT', 'idempotency record without event');
  }
}
