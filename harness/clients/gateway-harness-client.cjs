'use strict';
// AgentToolClient implementation that calls the AgentCore Gateway directly,
// signed as a test-harness IAM role. It stands in for Bedrock Managed Agents
// (which calls the same Gateway with its session role) until account access
// exists. It is NOT evidence of BMA compatibility.
//
// AgentToolClient contract (any implementation, including a future BMA one):
//   name: string
//   listTools(): Promise<{ ok, httpStatus, tools: string[], error }>
//   callTool(name, args): Promise<ToolResult>
// ToolResult: { httpStatus, rpcError: string|null, isError: boolean, payload: object|null, text: string }

const { execFileSync } = require('node:child_process');

const PROTOCOL_VERSION = '2025-03-26';

// Parses a JSON or SSE (text/event-stream) MCP response body into the last JSON-RPC message.
function parseMcpBody(body) {
  const trimmed = body.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const dataLines = trimmed.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean);
  if (dataLines.length === 0) return null;
  return JSON.parse(dataLines[dataLines.length - 1]);
}

// Normalizes a tools/call JSON-RPC response into a ToolResult.
function toToolResult(httpStatus, message) {
  if (!message) return { httpStatus, rpcError: 'empty response', isError: true, payload: null, text: '' };
  if (message.error) {
    return { httpStatus, rpcError: `${message.error.code}: ${message.error.message}`, isError: true, payload: null, text: '' };
  }
  const result = message.result || {};
  const text = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  return { httpStatus, rpcError: null, isError: result.isError === true, payload, text };
}

class GatewayHarnessClient {
  // credentials: { accessKeyId, secretAccessKey, sessionToken } or null for an unsigned request.
  constructor({ gatewayUrl, region, credentials, label }) {
    if (!/^https:\/\/[a-z0-9.-]+\.amazonaws\.com\/mcp$/.test(gatewayUrl)) throw new Error('gatewayUrl must be an https AgentCore Gateway /mcp URL');
    this.name = `gateway-harness:${label}`;
    this.gatewayUrl = gatewayUrl;
    this.region = region;
    this.credentials = credentials;
    this.sessionId = null;
    this.nextId = 1;
  }

  rpc(method, params) {
    const body = JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params });
    // Secrets go to curl through stdin (-K -), never as process arguments.
    const config = [];
    if (this.credentials) {
      const { accessKeyId, secretAccessKey, sessionToken } = this.credentials;
      config.push(`user = "${accessKeyId}:${secretAccessKey}"`);
      if (sessionToken) config.push(`header = "x-amz-security-token: ${sessionToken}"`);
    }
    if (this.sessionId) config.push(`header = "Mcp-Session-Id: ${this.sessionId}"`);
    const args = ['-sS', '-K', '-', '-D', '-', '-X', 'POST', '-H', 'Content-Type: application/json', '-H', 'Accept: application/json, text/event-stream', '--data-raw', body, '-w', '\n__HTTP_STATUS__%{http_code}', this.gatewayUrl];
    if (this.credentials) args.splice(3, 0, '--aws-sigv4', `aws:amz:${this.region}:bedrock-agentcore`);
    const out = execFileSync('curl', args, { input: config.join('\n'), maxBuffer: 10 * 1024 * 1024 }).toString('utf8');
    const statusMatch = /__HTTP_STATUS__(\d{3})\s*$/.exec(out);
    const httpStatus = statusMatch ? Number(statusMatch[1]) : 0;
    const withoutStatus = out.replace(/\n__HTTP_STATUS__\d{3}\s*$/, '');
    const split = withoutStatus.search(/\r?\n\r?\n/);
    const headerText = split >= 0 ? withoutStatus.slice(0, split) : '';
    const bodyText = split >= 0 ? withoutStatus.slice(split).trim() : withoutStatus;
    const sid = /^mcp-session-id:\s*(.+)$/im.exec(headerText);
    if (sid) this.sessionId = sid[1].trim();
    let message = null;
    try {
      message = parseMcpBody(bodyText);
    } catch {
      message = { error: { code: 'parse', message: bodyText.slice(0, 300) } };
    }
    return { httpStatus, message };
  }

  async initialize() {
    const { httpStatus, message } = this.rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'coc-stage-b-harness', version: '0.1.0' },
    });
    return { httpStatus, ok: httpStatus === 200 && !!message && !message.error, message };
  }

  async listTools() {
    const { httpStatus, message } = this.rpc('tools/list', {});
    if (!message || message.error) return { ok: false, httpStatus, tools: [], error: message && message.error ? message.error.message : 'empty' };
    return { ok: true, httpStatus, tools: (message.result.tools || []).map((t) => t.name).sort(), error: null };
  }

  async callTool(name, args) {
    const { httpStatus, message } = this.rpc('tools/call', { name, arguments: args });
    return toToolResult(httpStatus, message);
  }
}

// Short-lived credentials for a role, assumed by the operator's current AWS CLI profile.
function assumeRole(roleArn, sessionName, durationSeconds = 900) {
  const out = execFileSync('aws', ['sts', 'assume-role', '--role-arn', roleArn, '--role-session-name', sessionName, '--duration-seconds', String(durationSeconds), '--output', 'json']).toString();
  const c = JSON.parse(out).Credentials;
  return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken, expiration: c.Expiration };
}

// The operator's own credentials (used only for the negative "other principal" test).
function currentProfileCredentials() {
  const c = JSON.parse(execFileSync('aws', ['configure', 'export-credentials', '--format', 'process']).toString());
  return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };
}

module.exports = { GatewayHarnessClient, assumeRole, currentProfileCredentials, parseMcpBody, toToolResult, PROTOCOL_VERSION };
