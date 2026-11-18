// Restricted export (minimal MVP form). Every export needs an independent
// approval for the exact evidence and destination. All evidence, the event
// chain and the checkpoint are read (and evidence hash-verified) BEFORE the
// approval is consumed, so a storage or integrity failure never burns an
// approval. Consuming the approval and recording the export are one
// transaction: one approval, at most one logical export. Residual: if the
// process dies between that commit and returning the package, the approval is
// spent with no package delivered; the P2 staging state machine addresses this.
//
// Not yet implemented (P2, ADR 0003): private staging, the recoverable
// staging -> verified -> ready state machine and download authorization.

import { TABLES } from './tables.ts';
import { Buffer } from 'node:buffer';
import { isDeepStrictEqual } from 'node:util';
import { guarded, type GuardDeps } from './audit.ts';
import { validateExportPayload, type ApprovalService } from './approvals.ts';
import type { CheckpointAuthority } from './checkpoint.ts';
import type { EvidenceService } from './evidence.ts';
import type { Ledger } from './ledger.ts';
import { OutcomeUnknownError, type TransactionalStore } from './store.ts';
import type { CustodyEvent, RequestContext, Result, SignedCheckpoint } from './types.ts';
import { ok, fail } from './types.ts';

export const EXPORTS_TABLE = TABLES.exports; // append-only

export interface ExportPackage {
  readonly schema: 'coc/export/v1';
  readonly caseId: string;
  readonly events: readonly CustodyEvent[];
  readonly checkpoint: SignedCheckpoint | null;
  readonly evidence: ReadonlyArray<{ evidenceId: string; versionId: string; sha256: string; size: number; path: string }>;
  readonly files: Readonly<Record<string, string>>; // path -> base64 bytes
}

export type ExportDeps = GuardDeps & {
  store: TransactionalStore;
  ledger: Ledger;
  evidence: EvidenceService;
  approvals: ApprovalService;
  checkpoints: CheckpointAuthority;
};

export class ExportService {
  readonly #deps: ExportDeps;
  constructor(deps: ExportDeps) {
    this.#deps = deps;
  }

  async exportCase(ctx: RequestContext, caseId: string, approvalId: string, payload: unknown): Promise<Result<ExportPackage>> {
    return guarded(this.#deps, ctx, 'request_export', caseId, async (d) => {
      if (d.kind !== 'human') return fail('DENIED_AGENT', 'only humans export');
      const p = validateExportPayload(payload);
      if (!p.ok) return p;

      // 1. Read and verify every requested version first.
      const evidence: Array<{ evidenceId: string; versionId: string; sha256: string; size: number; path: string }> = [];
      const files: Record<string, string> = {};
      for (const ref of p.value.evidence) {
        const r = await this.#deps.evidence.read(ctx, caseId, ref);
        if (!r.ok) return r;
        const path = `evidence/${ref.evidenceId}/${ref.versionId}`;
        evidence.push({ evidenceId: ref.evidenceId, versionId: ref.versionId, sha256: r.value.sha256, size: r.value.size, path });
        files[path] = Buffer.from(r.value.bytes).toString('base64');
      }

      // 2. Read the chain and the latest signed checkpoint, also before consuming,
      //    so a storage failure here leaves the approval unused (review finding 4).
      //    No public key is included on purpose. The checkpoint is read FIRST:
      //    the ledger only grows, so events read afterwards always cover it
      //    (re-review N2: the reverse order could pair a snapshot with a newer
      //    checkpoint and burn the approval on an unverifiable package).
      const checkpoint = await this.#deps.checkpoints.latest(caseId);
      const events = await this.#deps.ledger.events(caseId);

      // 3. Consume the approval and record the export atomically. Nothing after
      //    this point can fail, so a consumed approval always yields a package.
      const consume = await this.#deps.approvals.consumptionWrite(d.actor.userId, ctx.now, approvalId, caseId, p.value);
      if (!consume.ok) return consume;
      const record = { approvalId, caseId, evidence: p.value.evidence, destination: p.value.destination, createdBy: d.actor.userId, createdAt: ctx.now.toISOString() };
      const pkg: ExportPackage = { schema: 'coc/export/v1', caseId, events, checkpoint, evidence, files };
      let t;
      try {
        t = await this.#deps.store.transact([consume.value, { table: EXPORTS_TABLE, key: approvalId, value: record, expectVersion: null }]);
      } catch (err) {
        if (!(err instanceof OutcomeUnknownError)) throw err;
        // The consumption and the export record commit together. If our exact
        // record is there, the approval was consumed for this package: deliver it.
        const written = await this.#deps.store.get(EXPORTS_TABLE, approvalId).catch(() => undefined);
        if (written && isDeepStrictEqual(written.value, record)) return ok(pkg);
        return fail('OUTCOME_UNKNOWN', 'the export may or may not have been recorded; check the approval status before retrying');
      }
      if (!t.ok) return fail('DENIED_APPROVAL_INVALID', 'approval was used concurrently');
      return ok(pkg);
    });
  }
}
