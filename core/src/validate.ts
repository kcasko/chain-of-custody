// Input validation at the domain boundary. Closed shapes, bounded sizes,
// explicit formats. Everything else is rejected.

import type { EvidenceRef, Result } from './types.ts';
import { ok, fail } from './types.ts';

export const EVIDENCE_ID = /^BW-[0-9]{3}$/;
export const VERSION_ID = /^[A-Za-z0-9._-]{1,128}$/;
export const CASE_ID = /^[A-Z0-9-]{3,64}$/;
export const USER_ID = /^[a-z0-9._-]{1,64}$/;

export function checkText(value: unknown, field: string, max: number): Result<string> {
  if (typeof value !== 'string' || value.trim().length === 0) return fail('INVALID_REQUEST', `${field} must be non-empty text`);
  if (value.length > max) return fail('INVALID_REQUEST', `${field} is too long`);
  if (value.normalize('NFC') !== value) return fail('INVALID_REQUEST', `${field} must be Unicode NFC`);
  return ok(value);
}

export function checkClosed(value: unknown, allowed: readonly string[]): Result<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_REQUEST', 'request must be an object');
  const extra = Object.keys(value).filter((k) => !allowed.includes(k));
  if (extra.length) return fail('INVALID_REQUEST', `unknown field ${extra[0]}`);
  return ok(value as Record<string, unknown>);
}

export function checkEvidenceRef(value: unknown): Result<EvidenceRef> {
  const o = checkClosed(value, ['evidenceId', 'versionId']);
  if (!o.ok) return o;
  const { evidenceId, versionId } = o.value;
  if (typeof evidenceId !== 'string' || !EVIDENCE_ID.test(evidenceId)) return fail('INVALID_REQUEST', 'bad evidenceId');
  if (typeof versionId !== 'string' || !VERSION_ID.test(versionId)) return fail('INVALID_REQUEST', 'bad versionId');
  return ok({ evidenceId, versionId });
}

export function checkEvidenceRefs(value: unknown, min: number, max: number): Result<EvidenceRef[]> {
  if (!Array.isArray(value) || value.length < min || value.length > max) return fail('INVALID_REQUEST', `expected ${min} to ${max} evidence references`);
  const out: EvidenceRef[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    const r = checkEvidenceRef(v);
    if (!r.ok) return r;
    const key = `${r.value.evidenceId}@${r.value.versionId}`;
    if (seen.has(key)) return fail('INVALID_REQUEST', 'duplicate evidence reference');
    seen.add(key);
    out.push(r.value);
  }
  return ok(out);
}
