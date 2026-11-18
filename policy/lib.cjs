'use strict';
// Render, validate and evaluate the Cedar policies locally.
// The same rendered text is what spike T09 will upload to AgentCore Policy.
// Any engine failure is treated as DENY (fail closed).

const fs = require('node:fs');
const path = require('node:path');
const cedar = require('@cedar-policy/cedar-wasm/nodejs');

const POLICY_DIR = path.join(__dirname, 'cedar');
const SCHEMA_PATH = path.join(__dirname, 'agentcore.cedarschema');
const SCOPE_PATH = path.join(__dirname, 'case-scope.json');
const TOOLS_PATH = path.join(__dirname, 'tools', 'evidence-tools.json');

const TARGET_NAME = 'EvidenceTools';
const ACTION_SEPARATOR = '___'; // AgentCore names actions <Target>___<tool>

// Strict formats so a deploy value cannot inject Cedar syntax (quotes,
// parentheses, semicolons) or a `like` wildcard (*) into the policy text.
const PLACEHOLDER_FORMATS = {
  ACCOUNT_ID: /^[0-9]{12}$/,
  SESSION_ROLE_NAME: /^[A-Za-z0-9+=,.@_-]{1,64}$/,
  GATEWAY_ARN: /^arn:aws:bedrock-agentcore:[a-z0-9-]+:[0-9]{12}:gateway\/[A-Za-z0-9-]{1,100}$/,
};
const EVIDENCE_ID_FORMAT = /^BW-[0-9]{3}$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadTools() {
  return readJson(TOOLS_PATH);
}

function loadScope() {
  const scope = readJson(SCOPE_PATH);
  const ids = scope.evidenceIds;
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('case-scope: evidenceIds must be a non-empty array');
  for (const id of ids) {
    if (typeof id !== 'string' || !EVIDENCE_ID_FORMAT.test(id)) throw new Error(`case-scope: invalid evidence id ${JSON.stringify(id)}`);
  }
  if (new Set(ids).size !== ids.length) throw new Error('case-scope: duplicate evidence ids');
  return scope;
}

function loadSchemaText() {
  return fs.readFileSync(SCHEMA_PATH, 'utf8');
}

function actionName(tool) {
  return `${TARGET_NAME}${ACTION_SEPARATOR}${tool}`;
}

// Returns the full policy set text with placeholders replaced.
function renderPolicies(values) {
  for (const [key, format] of Object.entries(PLACEHOLDER_FORMATS)) {
    const value = values[key];
    if (typeof value !== 'string' || !format.test(value)) {
      throw new Error(`render: ${key} is missing or has an invalid format`);
    }
  }
  const scope = loadScope();
  const replacements = {
    ...values,
    EVIDENCE_ID_SET: `[${scope.evidenceIds.map((id) => `"${id}"`).join(', ')}]`,
  };
  const files = fs.readdirSync(POLICY_DIR).filter((f) => f.endsWith('.cedar')).sort();
  let text = files.map((f) => `// ---- ${f}\n${fs.readFileSync(path.join(POLICY_DIR, f), 'utf8')}`).join('\n');
  text = text.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(replacements, key)) throw new Error(`render: unknown placeholder ${match}`);
    return replacements[key];
  });
  if (/\{\{|\}\}/.test(text)) throw new Error('render: unresolved placeholder');
  return text;
}

// Splits the policy set into { "<@id>": "<policy text>" } so decisions report
// readable policy IDs. Every policy must carry a unique @id annotation.
function policiesById(policyText) {
  const parts = cedar.policySetTextToParts(policyText);
  if (parts.type !== 'success') throw new Error(`parse: ${parts.errors.map((e) => e.message).join('; ')}`);
  const byId = {};
  for (const text of parts.policies) {
    const match = /^\s*@id\("([a-z0-9-]+)"\)/.exec(text);
    if (!match) throw new Error(`parse: policy without @id: ${text.slice(0, 60)}`);
    if (byId[match[1]]) throw new Error(`parse: duplicate @id ${match[1]}`);
    byId[match[1]] = text;
  }
  return byId;
}

// Strict validation, like AgentCore's FAIL_ON_ANY_FINDINGS mode.
function validatePolicies(policyText) {
  const result = cedar.validate({
    schema: loadSchemaText(),
    policies: { staticPolicies: policyText },
    validationSettings: { mode: 'strict' },
  });
  if (result.type !== 'success') {
    return { ok: false, errors: result.errors.map((e) => e.message), warnings: [] };
  }
  return {
    ok: result.validationErrors.length === 0 && result.validationWarnings.length === 0,
    errors: result.validationErrors.map((e) => `${e.policyId}: ${e.error.message}`),
    warnings: result.validationWarnings.map((w) => `${w.policyId}: ${w.error.message}`),
  };
}

// request: { principal: {type, id, arn, tags?}, action: toolName or full action,
//            resource: gatewayArn, input: object }
// options: { policies, validateRequest }
// Returns { decision: 'allow' | 'deny', reasons, errors }.
function authorize(request, { policies, validateRequest }) {
  const principalUid = { type: `AgentCore::${request.principal.type}`, id: request.principal.id };
  const principalEntity = { uid: principalUid, attrs: { id: request.principal.arn }, parents: [] };
  if (request.principal.tags) principalEntity.tags = request.principal.tags;
  const resourceUid = { type: 'AgentCore::Gateway', id: request.resource };
  const call = {
    principal: principalUid,
    action: {
      type: 'AgentCore::Action',
      id: request.action.includes(ACTION_SEPARATOR) ? request.action : actionName(request.action),
    },
    resource: resourceUid,
    context: { input: request.input },
    policies: { staticPolicies: typeof policies === 'string' ? policiesById(policies) : policies },
    entities: [principalEntity, { uid: resourceUid, attrs: {}, parents: [] }],
    validateRequest,
  };
  if (validateRequest) call.schema = loadSchemaText();

  let result;
  try {
    result = cedar.isAuthorized(call);
  } catch (err) {
    return { decision: 'deny', reasons: [], errors: [`engine threw: ${err.message}`] };
  }
  if (result.type !== 'success') {
    return { decision: 'deny', reasons: [], errors: result.errors.map((e) => e.message) };
  }
  const { decision, diagnostics } = result.response;
  return {
    decision: decision === 'allow' ? 'allow' : 'deny',
    reasons: diagnostics.reason,
    errors: diagnostics.errors.map((e) => `${e.policyId}: ${e.error.message}`),
  };
}

module.exports = {
  PLACEHOLDER_FORMATS,
  actionName,
  authorize,
  loadSchemaText,
  loadScope,
  loadTools,
  policiesById,
  renderPolicies,
  validatePolicies,
};
