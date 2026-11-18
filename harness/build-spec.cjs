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
// properties, required. Strip everything else. Enforcement of the stripped
// constraints lives in the Lambda.
const GATEWAY_SCHEMA_KEYS = new Set(['type', 'description', 'items', 'properties', 'required']);

function toGatewaySchema(schema) {
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!GATEWAY_SCHEMA_KEYS.has(key)) continue;
    if (key === 'properties') {
      out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toGatewaySchema(v)]));
    } else if (key === 'items') {
      out.items = toGatewaySchema(value);
    } else if (key === 'required') {
      if (value.length > 0) out.required = [...value];
    } else {
      out[key] = value;
    }
  }
  return out;
}

function toGatewayTool(tool) {
  return { name: tool.name, description: tool.description, inputSchema: toGatewaySchema(tool.inputSchema) };
}

module.exports = { buildSpec, toGatewaySchema, toGatewayTool, GATEWAY_SCHEMA_KEYS };
