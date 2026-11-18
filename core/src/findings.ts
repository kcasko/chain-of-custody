// Audit findings: append-only, cited, scoped to one case. Both humans and the
// agent may record them (SECURITY-RULES: "Audit report: scoped and validated").
// A finding describes records (discrepancies, gaps, open questions). It never
// states guilt, intent, admissibility or blame; that rule is enforced here,
// deterministically, not left to the model.

import { randomUUID } from 'node:crypto';
import { guarded, type GuardDeps } from './audit.ts';
import { registrations } from './custody.ts';
import type { Ledger } from './ledger.ts';
import type { TransactionalStore } from './store.ts';
import { TABLES } from './tables.ts';
import type { RequestContext, Result } from './types.ts';
import { ok, fail } from './types.ts';
import { checkClosed, checkText, EVIDENCE_ID } from './validate.ts';

export const FINDING_TYPES = ['discrepancy', 'provenance_gap', 'clock_uncertainty', 'unresolved_question', 'integrity_check_result'] as const;
export const UNCERTAINTY = ['low', 'medium', 'high'] as const;

// Conclusions an audit finding must not draw. Matched case-insensitively as
// whole words. Deliberately strict: "no evidence of sabotage" is also refused,
// and the author rephrases ("the record does not show who changed it").
export const FORBIDDEN_CONCLUSIONS: readonly RegExp[] = [
  /\bguilt(y|ily)?\b/i, /\binnocen(t|ce)\b/i, /\bculprit\b/i, /\bperpetrator\b/i,
  /\bmurder(ed|er)?\b/i, /\barson(ist)?\b/i, /\bsabotag(e|ed|ing)\b/i, /\bcriminal\b/i, /\bcrime\b/i,
  /\blie[ds]?\b/i, /\blying\b/i, /\bliar\b/i, /\bperjur(y|ed)\b/i, /\bfalsif(y|ied|ication)\b/i, /\bframed\b/i, /\bcover[- ]?up\b/i,
  /\b(in)?admissib(le|ility)\b/i, /\bdeliberately\b/i, /\bintentional(ly)?\b/i, /\bon purpose\b/i,
  /\bis responsible for\b/i, /\bcaused the fire\b/i,
];

export interface Finding {
  readonly findingId: string;
  readonly caseId: string;
  readonly findingType: (typeof FINDING_TYPES)[number];
  readonly summary: string;
  readonly citedEvidenceIds: readonly string[];
  readonly uncertainty: (typeof UNCERTAINTY)[number];
  readonly recordedBy: string;
  readonly recordedAt: string;
}

export function forbiddenConclusion(text: string): string | null {
  for (const re of FORBIDDEN_CONCLUSIONS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

export class FindingService {
  readonly #deps: GuardDeps & { store: TransactionalStore; ledger: Ledger };
  constructor(deps: GuardDeps & { store: TransactionalStore; ledger: Ledger }) {
    this.#deps = deps;
  }

  async record(ctx: RequestContext, caseId: string, input: unknown): Promise<Result<Finding>> {
    return guarded(this.#deps, ctx, 'record_finding', caseId, async (d) => {
      const o = checkClosed(input, ['findingType', 'summary', 'citedEvidenceIds', 'uncertainty']);
      if (!o.ok) return o;
      const { findingType, uncertainty, citedEvidenceIds } = o.value;
      if (typeof findingType !== 'string' || !(FINDING_TYPES as readonly string[]).includes(findingType)) return fail('INVALID_REQUEST', 'unsupported finding type');
      if (typeof uncertainty !== 'string' || !(UNCERTAINTY as readonly string[]).includes(uncertainty)) return fail('INVALID_REQUEST', 'uncertainty must be low, medium or high');
      const summary = checkText(o.value.summary, 'summary', 2000);
      if (!summary.ok) return summary;
      const banned = forbiddenConclusion(summary.value);
      if (banned) return fail('CONTENT_RULE_VIOLATION', `findings describe records; they may not conclude guilt, intent, blame or admissibility (found "${banned}")`);
      if (!Array.isArray(citedEvidenceIds) || citedEvidenceIds.length < 1 || citedEvidenceIds.length > 10) return fail('INVALID_REQUEST', 'cite 1 to 10 evidence items');
      if (new Set(citedEvidenceIds).size !== citedEvidenceIds.length) return fail('INVALID_REQUEST', 'duplicate citation');
      const registered = new Set([...(await registrations(this.#deps.ledger, caseId)).values()].map((b) => b.evidenceId));
      for (const id of citedEvidenceIds) {
        if (typeof id !== 'string' || !EVIDENCE_ID.test(id)) return fail('INVALID_REQUEST', 'bad evidence id');
        if (!registered.has(id)) return fail('NOT_FOUND', `${id} is not registered in this case`);
      }
      const finding: Finding = {
        findingId: randomUUID(), caseId,
        findingType: findingType as Finding['findingType'], summary: summary.value,
        citedEvidenceIds: [...(citedEvidenceIds as string[])], uncertainty: uncertainty as Finding['uncertainty'],
        recordedBy: d.kind === 'human' ? `human:${d.actor.userId}` : `agent:${d.agentId}`,
        recordedAt: ctx.now.toISOString(),
      };
      const r = await this.#deps.store.transact([{ table: TABLES.findings, key: `${caseId}#${finding.recordedAt}#${finding.findingId}`, value: finding, expectVersion: null }]);
      return r.ok ? ok(finding) : fail('LEDGER_CONFLICT', 'finding id collision');
    });
  }

  async list(ctx: RequestContext, caseId: string): Promise<Result<Finding[]>> {
    return guarded(this.#deps, ctx, 'read_metadata', caseId, async () =>
      ok((await this.#deps.store.list<Finding>(TABLES.findings, `${caseId}#`)).map((r) => r.item.value)));
  }
}
