'use strict';
// Stage B stub for the EvidenceTools Gateway target (layer L3).
//
// Enforces every rule the Gateway schema cannot, independently of Cedar and of
// the model: closed argument sets, patterns, enums, limits, case scope, exact
// registered versions and proposal provenance. Rejects by default. Returns only
// synthetic data and never persists anything (proposals and findings are
// acknowledged, not stored). Logs exactly one structured line per invocation
// so a test can prove which calls executed.

const crypto = require('node:crypto');

const TOOL_SEPARATOR = '___';

function checkValue(schema, value, field) {
  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') return `${field}: must be a string`;
      if (schema.minLength !== undefined && value.length < schema.minLength) return `${field}: too short`;
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${field}: too long`;
      if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) return `${field}: bad format`;
      if (schema.enum && !schema.enum.includes(value)) return `${field}: not an allowed value`;
      return null;
    }
    case 'integer': {
      if (!Number.isInteger(value)) return `${field}: must be an integer`;
      if (schema.minimum !== undefined && value < schema.minimum) return `${field}: below minimum`;
      return null;
    }
    case 'array': {
      if (!Array.isArray(value)) return `${field}: must be an array`;
      if (schema.minItems !== undefined && value.length < schema.minItems) return `${field}: too few items`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${field}: too many items`;
      if (schema.uniqueItems && new Set(value).size !== value.length) return `${field}: duplicate items`;
      for (let i = 0; i < value.length; i += 1) {
        const err = checkValue(schema.items, value[i], `${field}[${i}]`);
        if (err) return err;
      }
      return null;
    }
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return `${field}: must be an object`;
      const props = schema.properties || {};
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) return `${field}: unknown field ${key}`;
      }
      for (const key of schema.required || []) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) return `${field}: missing ${key}`;
      }
      for (const [key, sub] of Object.entries(props)) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const err = checkValue(sub, value[key], key);
          if (err) return err;
        }
      }
      return null;
    }
    default:
      return `${field}: unsupported schema type`;
  }
}

function evidenceIdsIn(args) {
  const ids = [];
  for (const key of ['evidence_id']) if (typeof args[key] === 'string') ids.push(args[key]);
  for (const key of ['evidence_ids', 'cited_evidence_ids', 'source_evidence_ids']) {
    if (Array.isArray(args[key])) ids.push(...args[key]);
  }
  return ids;
}

// Returns { ok: true } or { ok: false, code, detail }.
function validateCall(spec, evidence, tool, args) {
  const def = spec.tools.find((t) => t.name === tool);
  if (!def) return { ok: false, code: 'UNKNOWN_TOOL', detail: 'tool is not in the allowlist' };
  const schemaErr = checkValue(def.inputSchema, args, 'input');
  if (schemaErr) return { ok: false, code: 'INVALID_ARGUMENTS', detail: schemaErr };
  const outside = evidenceIdsIn(args).filter((id) => !spec.evidenceIds.includes(id));
  if (outside.length) return { ok: false, code: 'OUTSIDE_CASE', detail: 'evidence id is not in this case' };

  if (tool === 'read_evidence_version') {
    const versions = evidence.items[args.evidence_id].versions;
    if (!Object.prototype.hasOwnProperty.call(versions, args.version_id)) {
      return { ok: false, code: 'VERSION_NOT_REGISTERED', detail: 'pass an exact version_id from list_evidence' };
    }
  }
  if (tool === 'propose_custody_event') {
    if (args.event_kind === 'transfer' && !(args.version_id && args.from && args.to)) {
      return { ok: false, code: 'MISSING_TRANSFER_FIELDS', detail: 'transfers need version_id, from and to' };
    }
    if (args.event_kind === 'historical_assertion' && !(args.source_evidence_ids && args.source_version_ids && args.source_evidence_ids.length === args.source_version_ids.length && args.claimed_time_raw && args.source_clock && args.timezone && args.offset_uncertainty)) {
      return { ok: false, code: 'MISSING_PROVENANCE', detail: 'historical assertions need sources, raw time and source clock' };
    }
    if (args.event_kind === 'correction' && (args.corrects_sequence === undefined || args.corrects_hash === undefined)) {
      return { ok: false, code: 'MISSING_TARGET', detail: 'corrections must reference a ledger sequence' };
    }
  }
  return { ok: true };
}

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// Stable JSON (sorted keys) so a test runner can match a log line to the exact
// call it made. Only a 16-hex-character digest is logged, never the values.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const argsHash = (args) => sha256(canonical(args === undefined ? {} : args)).slice(0, 16);

function execute(spec, evidence, tool, args) {
  switch (tool) {
    case 'list_evidence':
      return {
        case_id: spec.caseId,
        synthetic: true,
        evidence: spec.evidenceIds.map((id) => ({
          evidence_id: id,
          title: evidence.items[id].title,
          versions: Object.entries(evidence.items[id].versions).map(([version_id, content]) => ({ version_id, sha256: sha256(content) })),
        })),
      };
    case 'read_evidence_version': {
      const content = evidence.items[args.evidence_id].versions[args.version_id];
      return { evidence_id: args.evidence_id, version_id: args.version_id, sha256: sha256(content), content_is_untrusted_data: true, content };
    }
    case 'compare_timestamps':
      return { evidence_ids: args.evidence_ids, synthetic: true, note: 'Stub: raw times only. Does not decide which source is correct.' };
    case 'record_finding':
      return { status: 'finding_acknowledged', persisted: false, finding_type: args.finding_type, cited_evidence_ids: args.cited_evidence_ids };
    case 'propose_custody_event':
      return { status: 'draft_acknowledged', persisted: false, ledger_changed: false, event_kind: args.event_kind, note: 'Drafts need human promotion with an independent approver.' };
    default:
      throw new Error('unreachable: validated tool without executor');
  }
}

function createHandler(spec, evidence, log = (line) => console.log(JSON.stringify(line))) {
  return async function handler(event, context) {
    const custom = (context && context.clientContext && context.clientContext.custom) || {};
    const fullName = typeof custom.bedrockAgentCoreToolName === 'string' ? custom.bedrockAgentCoreToolName : '';
    const sep = fullName.indexOf(TOOL_SEPARATOR);
    const target = sep > 0 ? fullName.slice(0, sep) : '';
    const tool = sep > 0 ? fullName.slice(sep + TOOL_SEPARATOR.length) : '';
    const args = event === undefined ? {} : event;

    // Fail closed: no trusted tool name from the Gateway means no execution.
    let verdict = target === 'EvidenceTools' ? validateCall(spec, evidence, tool, args) : { ok: false, code: 'NO_GATEWAY_CONTEXT', detail: 'missing or unexpected target' };
    let result;
    if (verdict.ok) {
      try {
        result = execute(spec, evidence, tool, args);
      } catch (err) {
        verdict = { ok: false, code: 'EXECUTION_FAILED', detail: 'internal error' };
      }
    }
    log({
      coc: 'tool-invocation',
      outcome: verdict.ok ? 'executed' : 'rejected',
      code: verdict.ok ? null : verdict.code,
      tool: tool || null,
      gatewayRequestId: custom.bedrockAgentCoreAwsRequestId || null,
      argsHash: argsHash(args),
      argKeys: args && typeof args === 'object' ? Object.keys(args).sort() : [],
      evidenceIds: args && typeof args === 'object' ? evidenceIdsIn(args) : [],
      propagatedHeaderNames: Object.keys(custom.bedrockAgentCorePropagatedHeaders || {}).sort(),
    });
    if (!verdict.ok) return { status: 'rejected', code: verdict.code, detail: verdict.detail };
    return result;
  };
}

module.exports = { createHandler, validateCall, checkValue, argsHash };

// Lambda entry point: the deploy bundle includes tool-spec.json and the
// synthetic evidence next to this file.
if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
  module.exports.handler = createHandler(require('./tool-spec.json'), require('./synthetic-evidence.json'));
}
