// Checkpoint authority: signs the ledger head with its own key and stores
// checkpoints append-only. The ledger has no access to this key.
// In this MVP it runs in the same process: a simulation of separate
// authority, not protection against a hostile administrator (see spec v1).

import { TABLES } from './tables.ts';
import { signCheckpointBody, type SigningKey } from './crypto.ts';
import type { Ledger } from './ledger.ts';
import type { TransactionalStore } from './store.ts';
import type { SignedCheckpoint, Result } from './types.ts';
import { ok, fail } from './types.ts';

export const CHECKPOINTS_TABLE = TABLES.checkpoints; // append-only
const pad = (n: number): string => String(n).padStart(12, '0');

export class CheckpointAuthority {
  readonly #key: SigningKey;
  readonly #store: TransactionalStore;
  readonly #ledger: Ledger;

  constructor(key: SigningKey, store: TransactionalStore, ledger: Ledger) {
    this.#key = key;
    this.#store = store;
    this.#ledger = ledger;
  }

  get keyId(): string {
    return this.#key.keyId;
  }

  // Signs the current head. Idempotent per sequence: an existing checkpoint is returned.
  async issue(caseId: string, now: Date): Promise<Result<SignedCheckpoint>> {
    const head = await this.#ledger.head(caseId);
    if (head.sequence === 0) return fail('NOT_FOUND', 'nothing to checkpoint');
    const key = `${caseId}#${pad(head.sequence)}`;
    const existing = await this.#store.get<SignedCheckpoint>(CHECKPOINTS_TABLE, key);
    if (existing) return ok(existing.value);
    const body = { schema: 'coc/checkpoint/v1' as const, caseId, sequence: head.sequence, headHash: head.hash, issuedAt: now.toISOString(), keyId: this.#key.keyId };
    const signed: SignedCheckpoint = { body, signatureHex: signCheckpointBody(this.#key, body) };
    const r = await this.#store.transact([{ table: CHECKPOINTS_TABLE, key, value: signed, expectVersion: null }]);
    if (!r.ok) {
      const raced = await this.#store.get<SignedCheckpoint>(CHECKPOINTS_TABLE, key);
      return raced ? ok(raced.value) : fail('LEDGER_CONFLICT', 'checkpoint write conflict');
    }
    return ok(signed);
  }

  async latest(caseId: string): Promise<SignedCheckpoint | null> {
    const rows = await this.#store.list<SignedCheckpoint>(CHECKPOINTS_TABLE, `${caseId}#`);
    return rows.length ? rows[rows.length - 1]!.item.value : null;
  }
}
