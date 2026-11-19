'use strict';
// Builds the tool specification shared by the stub Lambda (layer L3) and the
// Gateway target, from the single source of truth in policy/.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

// Full spec for the Lambda: keeps pattern/enum/limits, because the Lambda
// enforces them. The Gateway cannot (see toGatewayTool).
function buildSpec() {
  const scope = readJson('policy/case-scope.json');
  const tools = readJson('policy/tools/evidence-tools.json');
  const evidence = readJson('harness/lambda/synthetic-evidence.json');
  const missing = scope.evidenceIds.filter((id) => !evidence.items[id]);
  if (missing.length) throw new Error(`synthetic evidence missing for ${missing.join(', ')}`);
  return { caseId: scope.caseId, evidenceIds: scope.evidenceIds, tools };
}

// AgentCore Gateway SchemaDefinition supports only: type, description, items,
// properties, required. Everything else is stripped, and enforcement of the
// stripped constraints lives in Cedar and the core. But the model reads only
// what the Gateway lists, so a stripped enum is invisible to it: in T21 (Nov 19)
// the live agent sent finding_type "timestamp_discrepancy" and a paragraph as
// "uncertainty", and Cedar refused its legitimate finding. So every stripped
// constraint is restated in plain words in the property's description.
const GATEWAY_SCHEMA_KEYS = new Set(['type', 'description', 'items', 'properties', 'required']);

function describeConstraints(schema) {
  const parts = [];
  if (Array.isArray(schema.enum)) parts.push(`Must be exactly one of: ${schema.enum.join(', ')}.`);
  if (schema.pattern) parts.push(`Must match the pattern ${schema.pattern}.`);
  if (schema.minLength !== undefined || schema.maxLength !== undefined) parts.push(`Length ${schema.minLength ?? 0} to ${schema.maxLength ?? 'any'} characters.`);
  if (schema.minItems !== undefined || schema.maxItems !== undefined) parts.push(`${schema.minItems ?? 0} to ${schema.maxItems ?? 'any'} items.`);
  if (schema.uniqueItems) parts.push('No duplicates.');
  if (schema.additionalProperties === false) parts.push('No other fields are accepted.');
  if (schema.items && typeof schema.items === 'object') {
    const inner = describeConstraints(schema.items);
    if (inner) parts.push(`Each item: ${inner}`);
  }
  return parts.join(' ');
}

function toGatewaySchema(schema) {
  const out = {};
  const constraints = describeConstraints(schema);
  if (constraints) out.description = schema.description ? `${schema.description} ${constraints}` : constraints;
  for (const [key, value] of Object.entries(schema)) {
    if (!GATEWAY_SCHEMA_KEYS.has(key)) continue;
    if (key === 'properties') {
      out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toGatewaySchema(v)]));
    } else if (key === 'items') {
      out.items = toGatewaySchema(value);
    } else if (key === 'required') {
      if (value.length > 0) out.required = [...value];
    } else if (key === 'description') {
      if (!out.description) out.description = value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function toGatewayTool(tool) {
  return { name: tool.name, description: tool.description, inputSchema: toGatewaySchema(tool.inputSchema) };
}

module.exports = { buildSpec, toGatewaySchema, toGatewayTool, describeConstraints, GATEWAY_SCHEMA_KEYS };
