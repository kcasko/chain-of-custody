// Investigation workflow API (T17). A thin transport over the domain core:
// it parses requests, builds a RequestContext for the person acting, calls one
// core operation, and maps the Result to HTTP. It makes no authorization
// decision of its own; every allow or deny comes from the core and is audited
// there.
//
// Identity is LOCAL DEMO ONLY: the browser says who it is acting as
// (x-coc-user), chosen from the synthetic case staff. There is no login. A
// deployed version replaces this with authenticated identity (Cognito, not
// built). Every state-changing and data request also needs the per-launch
// token from /api/session (x-coc-csrf), and the server checks Host and Origin.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { EXPORT_DESTINATIONS } from '../../core/src/approvals.ts';
import { FINDING_TYPES, UNCERTAINTY } from '../../core/src/findings.ts';
import { createGatewayHandler } from '../../core/src/gateway-handler.ts';
import { createLocalDomain, DEMO, humanCtx, seedFixtures, type LocalDomain } from '../../core/src/local.ts';
import type { ErrorCode, Result } from '../../core/src/types.ts';
import { verifyExport } from '../../core/src/verifier.ts';
import { bind } from './challenge.ts';

const require = createRequire(import.meta.url);
const { SCENARIOS } = require('../../harness/scenarios.cjs') as { SCENARIOS: Array<{ id: string; tool: string; args: Record<string, unknown>; expect: string }> };

export const PERSONAS = [
  { userId: DEMO.users.investigator, name: 'Owen Hale', role: 'investigator', note: 'Registers evidence and records custody' },
  { userId: DEMO.users.auditor, name: 'Mara Voss', role: 'auditor', note: 'Reads, records findings and corrections; cannot move evidence' },
  { userId: DEMO.users.supervisor, name: 'Elena Ward', role: 'supervisor', note: 'Approves exports requested by others' },
  { userId: DEMO.users.supervisor2, name: 'Ruth Kim', role: 'supervisor', note: 'Second supervisor' },
  { userId: DEMO.users.outsider, name: 'Adrian Cole', role: 'supervisor of another case', note: 'Not a member of this case' },
] as const;
const PERSONA_IDS: ReadonlySet<string> = new Set(PERSONAS.map((p) => p.userId));
const TEXT_LIMIT = 256 * 1024;

export interface ApiRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
}
export interface ApiResponse { readonly status: number; readonly body: unknown }

const STATUS: Partial<Record<ErrorCode, number>> = {
  DENIED_NO_IDENTITY: 401, NOT_FOUND: 404, EVIDENCE_VERSION_MISSING: 404,
  INVALID_REQUEST: 400, CONTENT_RULE_VIOLATION: 422, IDEMPOTENCY_KEY_REUSED: 422,
  LEDGER_CONFLICT: 409, OUTCOME_UNKNOWN: 503, STORAGE_UNAVAILABLE: 503, REGISTRATION_FAILED: 500, INTEGRITY_FAILURE: 500,
};
function reply<T>(r: Result<T>, map: (v: T) => unknown = (v) => v): ApiResponse {
  if (r.ok) return { status: 200, body: { ok: true, value: map(r.value) } };
  const status = STATUS[r.code] ?? (r.code.startsWith('DENIED_') ? 403 : 400);
  return { status, body: { ok: false, code: r.code, detail: r.detail } };
}
const bad = (status: number, code: string, detail: string): ApiResponse => ({ status, body: { ok: false, code, detail } });

function sameToken(a: string | undefined, b: string): boolean {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export class Workflow {
  readonly csrf: string;
  readonly #now: () => Date;
  #d!: LocalDomain;
  #versions!: Map<string, string>;
  #n = 0;

  private constructor(now: () => Date) {
    this.csrf = randomBytes(24).toString('base64url');
    this.#now = now;
  }

  static async create(now: () => Date = () => new Date()): Promise<Workflow> {
    const w = new Workflow(now);
    await w.#reset();
    return w;
  }

  async #reset(): Promise<void> {
    this.#d = createLocalDomain();
    this.#versions = await seedFixtures(this.#d);
    await this.#checkpoint();
  }

  // Stands in for the scheduled checkpoint authority: a system process, not a
  // user action, so it has no API endpoint.
  async #checkpoint(): Promise<void> {
    await this.#d.checkpoints.issue(DEMO.caseId, this.#now());
  }

  #ctx(userId: string) {
    this.#n += 1;
    return humanCtx(userId, `ui-${this.#n}`, this.#now());
  }

  async handle(req: ApiRequest): Promise<ApiResponse> {
    const route = `${req.method} ${req.path}`;
    if (route === 'GET /api/session') {
      return { status: 200, body: { ok: true, value: { csrf: this.csrf, caseId: DEMO.caseId, personas: PERSONAS, findingTypes: FINDING_TYPES, uncertainty: UNCERTAINTY, destinations: [...EXPORT_DESTINATIONS], localIdentityNotice: 'Local demo: no login. You choose who you act as; the core authorizes and audits each action as that person.' } } };
    }
    if (!sameToken(req.headers['x-coc-csrf'], this.csrf)) return bad(403, 'DENIED_SESSION', 'missing or wrong session token; reload the page');
    const userId = req.headers['x-coc-user'];
    if (typeof userId !== 'string' || !PERSONA_IDS.has(userId)) return bad(401, 'DENIED_NO_IDENTITY', 'choose who you are acting as');
    const d = this.#d;
    const c = DEMO.caseId;
    const body = (req.body ?? {}) as Record<string, unknown>;

    switch (route) {
      case 'GET /api/case': {
        const t = await d.caseRead.timeline(this.#ctx(userId), c);
        if (!t.ok) return reply(t);
        const titles = Object.fromEntries(d.manifest.items.map((i: { evidenceId: string; title: string }) => [i.evidenceId, i.title]));
        return reply(t, (v) => ({ caseId: c, head: v.head, chain: v.chain, checkpoint: v.checkpoint ? { sequence: v.checkpoint.body.sequence, issuedAt: v.checkpoint.body.issuedAt, keyId: v.checkpoint.body.keyId } : null, titles }));
      }
      // Storage keys are internal; the page identifies versions by evidence and version ID.
      case 'GET /api/evidence': return reply(await d.evidence.list(this.#ctx(userId), c), (list) => list.map(({ objectKey: _key, ...rest }) => rest));
      case 'GET /api/evidence/read': {
        const ref = { evidenceId: req.query.get('evidenceId') ?? '', versionId: req.query.get('versionId') ?? '' };
        return reply(await d.evidence.read(this.#ctx(userId), c, ref), (v) => ({
          evidenceId: v.evidenceId, versionId: v.versionId, sha256: v.sha256, size: v.size, mediaType: v.mediaType, isDerivative: v.isDerivative, derivedFrom: v.derivedFrom,
          text: new TextDecoder('utf-8', { fatal: false }).decode(v.bytes.subarray(0, TEXT_LIMIT)), truncated: v.bytes.length > TEXT_LIMIT,
        }));
      }
      case 'GET /api/timeline': return reply(await d.caseRead.timeline(this.#ctx(userId), c));
      case 'GET /api/findings': return reply(await d.findings.list(this.#ctx(userId), c));
      case 'GET /api/proposals': return reply(await d.caseRead.proposals(this.#ctx(userId), c));
      case 'GET /api/approvals': return reply(await d.caseRead.approvals(this.#ctx(userId), c));
      case 'GET /api/quarantine': return reply(await d.evidence.quarantined(this.#ctx(userId), c));

      case 'POST /api/custody/transfer': return this.#ledgerWrite(await d.custody.recordTransfer(this.#ctx(userId), c, body));
      case 'POST /api/custody/correction': return this.#ledgerWrite(await d.custody.appendCorrection(this.#ctx(userId), c, body));
      case 'POST /api/proposals/promote': return this.#ledgerWrite(await d.proposals.promote(this.#ctx(userId), String(body.proposalId ?? '')));
      case 'POST /api/findings': return reply(await d.findings.record(this.#ctx(userId), c, body));
      case 'POST /api/approvals/request': return reply(await d.approvals.requestExport(this.#ctx(userId), c, body));
      case 'POST /api/approvals/approve': return reply(await d.approvals.approve(this.#ctx(userId), String(body.approvalId ?? '')));
      case 'POST /api/approvals/revoke': return reply(await d.approvals.revoke(this.#ctx(userId), String(body.approvalId ?? '')));
      case 'POST /api/exports': {
        const r = await d.exports.exportCase(this.#ctx(userId), c, String(body.approvalId ?? ''), body.payload);
        if (!r.ok) return reply(r);
        const head = await d.ledger.head(c);
        const trust = {
          expectedCaseId: c,
          keys: [{ keyId: d.signingKey.keyId, publicKeyHex: d.signingKey.publicKeyRaw.toString('hex') }],
          reference: { caseId: c, minSequence: head.sequence, headHashAtMinSequence: head.hash, retrievedAt: this.#now().toISOString() },
        };
        // Verify a copy that has been through JSON, as a recipient would receive it.
        const pkg = JSON.parse(JSON.stringify(r.value));
        return { status: 200, body: { ok: true, value: { package: pkg, verification: verifyExport(pkg, trust) } } };
      }
      case 'POST /api/agent/run': return this.#scriptedAgentPass();
      case 'POST /api/reset': {
        await this.#reset();
        return { status: 200, body: { ok: true, value: { reset: true } } };
      }
      default: return bad(404, 'NOT_FOUND', 'no such endpoint');
    }
  }

  async #ledgerWrite<T>(r: Result<T>): Promise<ApiResponse> {
    if (r.ok) await this.#checkpoint();
    return reply(r);
  }

  // NOT a model. Bedrock Managed Agents access is blocked (RB-1), so this
  // replays the seven legitimate Stage B agent calls through the same Gateway
  // Lambda handler the real agent will use, to produce findings and drafts for
  // humans to review. Labeled as scripted everywhere it appears.
  async #scriptedAgentPass(): Promise<ApiResponse> {
    const handler = createGatewayHandler({ caseId: DEMO.caseId, agentId: DEMO.agentId, tools: this.#d.agentTools, clock: this.#now, log: () => {} });
    const calls = [];
    for (const s of SCENARIOS.filter((x) => x.expect === 'executed')) {
      this.#n += 1;
      const out = await handler(bind(s.args, this.#versions), { clientContext: { custom: { bedrockAgentCoreToolName: `EvidenceTools___${s.tool}`, bedrockAgentCoreAwsRequestId: `scripted-${this.#n}` } } }) as { status?: string; code?: string };
      calls.push({ id: s.id, tool: s.tool, outcome: out?.status === 'rejected' ? `refused: ${out.code}` : 'executed' });
    }
    return { status: 200, body: { ok: true, value: { scripted: true, notice: 'Scripted replay of seven agent tool calls, not a model (RB-1).', calls } } };
  }
}
