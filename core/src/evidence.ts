// Version-pinned evidence storage (T03).
//
// ObjectStore is the port for original bytes: write a new key once, read an
// exact version. No "latest", no list, no overwrite, no delete. A version is
// registered evidence only when its ledger event commits; until then it does
// not exist for readers. Failed registrations are quarantined, never exposed.

import { TABLES } from './tables.ts';
import { randomUUID } from 'node:crypto';
import { guarded, type GuardDeps } from './audit.ts';
import { sha256Hex } from './crypto.ts';
import { registrations } from './custody.ts';
import type { Ledger, AppendOptions } from './ledger.ts';
import type { TransactionalStore } from './store.ts';
import type { CustodyEvent, EvidenceRegisteredBody, EvidenceRef, RequestContext, Result } from './types.ts';
import { ok, fail } from './types.ts';
import { checkClosed, checkText, EVIDENCE_ID, VERSION_ID } from './validate.ts';

export interface ObjectStore {
  putNew(key: string, bytes: Uint8Array): Promise<{ versionId: string }>;
  getVersion(key: string, versionId: string): Promise<Uint8Array | undefined>;
}

export class ObjectExistsError extends Error {
  constructor(key: string) {
    super(`object ${key} already exists; originals are write-once`);
    this.name = 'ObjectExistsError';
  }
}

export class MemoryObjectStore implements ObjectStore {
  protected readonly objects = new Map<string, Map<string, Uint8Array>>();
  async putNew(key: string, bytes: Uint8Array): Promise<{ versionId: string }> {
    if (this.objects.has(key)) throw new ObjectExistsError(key);
    const versionId = `v-${randomUUID()}`;
    this.objects.set(key, new Map([[versionId, Uint8Array.from(bytes)]]));
    return { versionId };
  }
  async getVersion(key: string, versionId: string): Promise<Uint8Array | undefined> {
    const b = this.objects.get(key)?.get(versionId);
    return b ? Uint8Array.from(b) : undefined;
  }
}

export interface CaseScope { evidenceIdsFor(caseId: string): readonly string[] | null }

export const QUARANTINE_TABLE = TABLES.quarantine; // append-only
export const MEDIA_TYPES: ReadonlySet<string> = new Set(['text/plain', 'text/csv', 'application/json', 'application/pdf', 'image/png', 'image/jpeg', 'video/mp4']);
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

export interface EvidenceRead {
  readonly evidenceId: string;
  readonly versionId: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly size: number;
  readonly mediaType: string;
  readonly isDerivative: boolean;
  readonly derivedFrom: EvidenceRegisteredBody['derivedFrom'];
}

export type EvidenceDeps = GuardDeps & { store: TransactionalStore; ledger: Ledger; objects: ObjectStore; scope: CaseScope };

export class EvidenceService {
  readonly #deps: EvidenceDeps;
  constructor(deps: EvidenceDeps) {
    this.#deps = deps;
  }

  async register(ctx: RequestContext, caseId: string, input: { evidenceId: unknown; bytes: unknown; mediaType: unknown }, options: Pick<AppendOptions, 'idempotencyKey'> = {}): Promise<Result<CustodyEvent>> {
    return guarded(this.#deps, ctx, 'register_evidence', caseId, async (d) => {
      if (d.kind !== 'human') return fail('DENIED_AGENT', 'agents cannot register evidence');
      const v = this.#checkInput(caseId, input, ['evidenceId', 'bytes', 'mediaType']);
      if (!v.ok) return v;
      return this.#store(d.actor, ctx, caseId, v.value, null, options);
    });
  }

  // A derivative is a new version of the same evidence item, linked to an exact
  // registered parent version with a stated transformation.
  async registerDerivative(
    ctx: RequestContext,
    caseId: string,
    input: { evidenceId: unknown; parentVersionId: unknown; transformation: unknown; bytes: unknown; mediaType: unknown },
  ): Promise<Result<CustodyEvent>> {
    return guarded(this.#deps, ctx, 'register_derivative', caseId, async (d) => {
      if (d.kind !== 'human') return fail('DENIED_AGENT', 'agents cannot register evidence');
      const v = this.#checkInput(caseId, input, ['evidenceId', 'bytes', 'mediaType', 'parentVersionId', 'transformation']);
      if (!v.ok) return v;
      const { parentVersionId } = input;
      if (typeof parentVersionId !== 'string' || !VERSION_ID.test(parentVersionId)) return fail('INVALID_REQUEST', 'bad parentVersionId');
      const t = checkText(input.transformation, 'transformation', 500);
      if (!t.ok) return t;
      const reg = await registrations(this.#deps.ledger, caseId);
      if (!reg.has(`${v.value.evidenceId}@${parentVersionId}`)) return fail('NOT_FOUND', 'parent version is not registered for this evidence in this case');
      return this.#store(d.actor, ctx, caseId, v.value, { versionId: parentVersionId, transformation: t.value }, {});
    });
  }

  // Exact version only. Verifies the bytes against the registered hash on every read.
  async read(ctx: RequestContext, caseId: string, ref: EvidenceRef): Promise<Result<EvidenceRead>> {
    return guarded(this.#deps, ctx, 'read_original', caseId, async () => {
      if (!ref || typeof ref.evidenceId !== 'string' || !EVIDENCE_ID.test(ref.evidenceId) || typeof ref.versionId !== 'string' || !VERSION_ID.test(ref.versionId)) {
        return fail('INVALID_REQUEST', 'an exact evidenceId and versionId are required');
      }
      const reg = (await registrations(this.#deps.ledger, caseId)).get(`${ref.evidenceId}@${ref.versionId}`);
      if (!reg) return fail('NOT_FOUND', 'no such registered version in this case');
      let bytes: Uint8Array | undefined;
      try {
        bytes = await this.#deps.objects.getVersion(reg.objectKey, reg.versionId);
      } catch {
        return fail('STORAGE_UNAVAILABLE', 'evidence store unavailable');
      }
      if (!bytes) return fail('EVIDENCE_VERSION_MISSING', 'registered version is missing from storage');
      const sha256 = sha256Hex(bytes);
      if (sha256 !== reg.sha256 || bytes.length !== reg.size) return fail('INTEGRITY_FAILURE', 'stored bytes do not match the registered hash');
      return ok({ evidenceId: reg.evidenceId, versionId: reg.versionId, bytes, sha256, size: bytes.length, mediaType: reg.mediaType, isDerivative: reg.derivedFrom !== null, derivedFrom: reg.derivedFrom });
    });
  }

  async list(ctx: RequestContext, caseId: string): Promise<Result<EvidenceRegisteredBody[]>> {
    return guarded(this.#deps, ctx, 'read_metadata', caseId, async () => ok([...(await registrations(this.#deps.ledger, caseId)).values()]));
  }

  // Operator view of bytes that were stored but never registered. Humans only.
  async quarantined(ctx: RequestContext, caseId: string): Promise<Result<unknown[]>> {
    return guarded(this.#deps, ctx, 'read_metadata', caseId, async (d) => {
      if (d.kind !== 'human') return fail('DENIED_AGENT', 'quarantine is an operator view');
      return ok((await this.#deps.store.list(QUARANTINE_TABLE, `${caseId}#`)).map((r) => r.item.value));
    });
  }

  #checkInput(caseId: string, input: unknown, allowed: readonly string[]): Result<{ evidenceId: string; bytes: Uint8Array; mediaType: string }> {
    const o = checkClosed(input, allowed);
    if (!o.ok) return o;
    const { evidenceId, bytes, mediaType } = o.value;
    if (typeof evidenceId !== 'string' || !EVIDENCE_ID.test(evidenceId)) return fail('INVALID_REQUEST', 'bad evidenceId');
    const inScope = this.#deps.scope.evidenceIdsFor(caseId);
    if (!inScope || !inScope.includes(evidenceId)) return fail('INVALID_REQUEST', 'evidenceId is not in this case scope');
    if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_EVIDENCE_BYTES) return fail('INVALID_REQUEST', 'bytes must be 1 byte to 10 MiB');
    if (typeof mediaType !== 'string' || !MEDIA_TYPES.has(mediaType)) return fail('INVALID_REQUEST', 'media type not allowed');
    return ok({ evidenceId, bytes, mediaType });
  }

  async #store(
    actor: Extract<import('./policy.ts').Decision, { kind: 'human' }>['actor'],
    ctx: RequestContext,
    caseId: string,
    input: { evidenceId: string; bytes: Uint8Array; mediaType: string },
    derivedFrom: EvidenceRegisteredBody['derivedFrom'],
    options: Pick<AppendOptions, 'idempotencyKey'>,
  ): Promise<Result<CustodyEvent>> {
    const sha256 = sha256Hex(input.bytes);
    // Idempotency covers what the client sent, never server-generated IDs, and is
    // checked BEFORE storing bytes so a retry cannot store a second copy.
    const request = { evidenceId: input.evidenceId, sha256, size: input.bytes.length, mediaType: input.mediaType, derivedFrom };
    if (options.idempotencyKey !== undefined) {
      const check = await this.#deps.ledger.checkIdempotent(caseId, actor.userId, options.idempotencyKey, 'evidence_registered', request);
      if (check.kind === 'invalid') return fail('INVALID_REQUEST', 'invalid idempotency key');
      if (check.kind === 'reused') return fail('IDEMPOTENCY_KEY_REUSED', 'idempotency key was used for a different request');
      if (check.kind === 'replay') return ok(check.event);
    }
    const objectKey = `originals/${caseId}/${input.evidenceId}/${randomUUID()}`;
    let versionId: string;
    try {
      versionId = (await this.#deps.objects.putNew(objectKey, input.bytes)).versionId;
    } catch (err) {
      // The bytes may have been stored even though putNew failed (a lost
      // response retried into 412 on our own fresh key, or a post-write check).
      // Nothing is registered either way; record the key so they are not orphaned.
      const exists = err instanceof ObjectExistsError;
      const recorded = await this.#recordQuarantine(ctx, caseId, input.evidenceId, objectKey, null, exists ? 'object store reported our new key already exists (likely a lost response); bytes stored, version unknown' : 'object store write failed; bytes may have been stored, version unknown');
      return fail('STORAGE_UNAVAILABLE', `could not store evidence bytes; nothing was registered${recorded ? '; object key recorded for review' : ''}`);
    }
    // Storage confirmation: read the exact version back before registering it.
    let stored: Uint8Array | undefined;
    try {
      stored = await this.#deps.objects.getVersion(objectKey, versionId);
    } catch {
      stored = undefined;
    }
    if (!stored || sha256Hex(stored) !== sha256) return this.#quarantine(ctx, caseId, input.evidenceId, objectKey, versionId, 'storage confirmation failed');
    let appended: Result<CustodyEvent>;
    try {
      appended = await this.#deps.ledger.append(actor, caseId, {
        kind: 'evidence_registered',
        body: { evidenceId: input.evidenceId, versionId, objectKey, sha256, size: input.bytes.length, mediaType: input.mediaType, derivedFrom },
      }, ctx.now, options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey, idempotencyContent: request });
    } catch {
      return this.#quarantine(ctx, caseId, input.evidenceId, objectKey, versionId, 'ledger unavailable');
    }
    if (!appended.ok && appended.code === 'OUTCOME_UNKNOWN') {
      // Do not report "not registered": it may be. Record the bytes for review
      // and tell the caller to check before uploading again.
      await this.#quarantine(ctx, caseId, input.evidenceId, objectKey, versionId, 'ledger outcome unknown: check the registrations before acting; this version may also be registered');
      return fail('OUTCOME_UNKNOWN', 'the registration may or may not have been recorded; list the case evidence or retry with the same idempotency key before uploading again');
    }
    if (!appended.ok) return this.#quarantine(ctx, caseId, input.evidenceId, objectKey, versionId, `ledger append failed: ${appended.code}`);
    // Two identical retries raced: the other one registered first and this call
    // replayed its event. Our extra copy of the bytes is quarantined, not exposed.
    if (appended.value.kind === 'evidence_registered' && appended.value.body.versionId !== versionId) {
      await this.#quarantine(ctx, caseId, input.evidenceId, objectKey, versionId, 'duplicate of a concurrent idempotent retry');
    }
    return appended;
  }

  // Bytes that were stored but never registered. Kept (originals are never
  // deleted) and recorded so an operator can review them; readers never see them.
  async #recordQuarantine(ctx: RequestContext, caseId: string, evidenceId: string, objectKey: string, versionId: string | null, reason: string): Promise<boolean> {
    try {
      const r = await this.#deps.store.transact([{ table: QUARANTINE_TABLE, key: `${caseId}#${objectKey}`, value: { caseId, evidenceId, objectKey, versionId, reason, at: ctx.now.toISOString() }, expectVersion: null }]);
      return r.ok;
    } catch {
      return false;
    }
  }

  async #quarantine(ctx: RequestContext, caseId: string, evidenceId: string, objectKey: string, versionId: string | null, reason: string): Promise<Result<CustodyEvent>> {
    const recorded = await this.#recordQuarantine(ctx, caseId, evidenceId, objectKey, versionId, reason);
    return fail('REGISTRATION_FAILED', `${reason}; evidence not registered${recorded ? '; staged bytes quarantined' : '; quarantine record could not be written'}`);
  }
}

// CaseScope backed by policy/case-scope.json (the same source as the Cedar policies).
export class StaticCaseScope implements CaseScope {
  readonly #scopes: ReadonlyMap<string, readonly string[]>;
  constructor(scopes: Array<{ caseId: string; evidenceIds: string[] }>) {
    this.#scopes = new Map(scopes.map((s) => [s.caseId, Object.freeze([...s.evidenceIds])]));
  }
  evidenceIdsFor(caseId: string): readonly string[] | null {
    return this.#scopes.get(caseId) ?? null;
  }
}
