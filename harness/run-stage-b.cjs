'use strict';
// Stage B live run against a real AgentCore Gateway + Policy engine + stub Lambda.
// Not part of `npm test` (it needs AWS). Run with: npm run harness:stage-b
//
// Reads .local/stage-b.json (gitignored):
//   { "region", "gatewayUrl", "harnessRoleArn", "logGroup" }
// Uses the operator's current AWS CLI profile only to assume the harness role,
// to export its own credentials for the negative principal test, and to read
// the stub Lambda's logs.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { GatewayHarnessClient, assumeRole, currentProfileCredentials } = require('./clients/gateway-harness-client.cjs');
const { SCENARIOS } = require('./scenarios.cjs');
const { argsHash } = require('./lambda/handler.cjs');

const OTHER_PRINCIPAL_PROBE = { tool: 'read_evidence_version', args: { evidence_id: 'BW-001', version_id: 'probe-other-principal' } };

const TARGET = 'EvidenceTools';
const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, '.local', 'stage-b.json'), 'utf8'));
const redact = (s) => JSON.parse(JSON.stringify(s).replace(/\b\d{12}\b/g, '<account>'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fetchLogLines(startMs) {
  const out = execFileSync('aws', ['logs', 'filter-log-events', '--log-group-name', cfg.logGroup, '--start-time', String(startMs), '--filter-pattern', '"tool-invocation"', '--region', cfg.region, '--output', 'json'], { maxBuffer: 20 * 1024 * 1024 }).toString();
  const lines = [];
  for (const e of JSON.parse(out).events) {
    const i = e.message.indexOf('{"coc"');
    if (i >= 0) lines.push({ ts: e.timestamp, ...JSON.parse(e.message.slice(i).trim()) });
  }
  return lines;
}

// Maps engine policy names (coc_t09_NN) to our @id values (stored as descriptions).
function policyNameMap() {
  const out = execFileSync('aws', ['bedrock-agentcore-control', 'list-policies', '--policy-engine-id', cfg.policyEngineId, '--region', cfg.region, '--output', 'json']).toString();
  return Object.fromEntries(JSON.parse(out).policies.map((p) => [p.name, p.description]));
}

const BOUNDARY_IDS = new Set(['boundary-session-role-only', 'boundary-this-gateway-only']);

// Returns which rules denied a call, from the Gateway's error text.
function deniedBy(rpcError, names) {
  if (!rpcError) return [];
  if (/denied by default/i.test(rpcError)) return ['default-deny'];
  const m = /denied due to ([^\]]+)\]/.exec(rpcError);
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim().replace(/-[a-z0-9]{10}$/, '')).map((n) => names[n] || n);
}

async function timed(fn) {
  const t0 = Date.now();
  const r = await fn();
  return { r, t0, t1: Date.now() };
}

async function main() {
  const started = Date.now() - 2000;
  const names = policyNameMap();
  const report = { ranAt: new Date().toISOString(), gatewayHost: new URL(cfg.gatewayUrl).host.replace(/^[^.]+/, '<gateway-id>'), checks: [], scenarios: [] };
  const check = (name, pass, detail) => report.checks.push({ name, pass, detail });

  // 1. No anonymous access.
  const anon = new GatewayHarnessClient({ gatewayUrl: cfg.gatewayUrl, region: cfg.region, credentials: null, label: 'unsigned' });
  const anonInit = await anon.initialize();
  check('unsigned request is rejected', !anonInit.ok && [401, 403].includes(anonInit.httpStatus), { httpStatus: anonInit.httpStatus });

  // 2. A different IAM principal (operator admin role) gets no tool execution.
  const other = new GatewayHarnessClient({ gatewayUrl: cfg.gatewayUrl, region: cfg.region, credentials: currentProfileCredentials(), label: 'operator-admin' });
  const otherInit = await other.initialize();
  const otherTools = otherInit.ok ? await other.listTools() : { ok: false, tools: [], httpStatus: otherInit.httpStatus };
  const otherCall = await timed(() => other.callTool(`${TARGET}___${OTHER_PRINCIPAL_PROBE.tool}`, OTHER_PRINCIPAL_PROBE.args));
  report.otherPrincipal = { initStatus: otherInit.httpStatus, toolsListed: otherTools.tools, call: otherCall.r };

  // 3. The harness role.
  const harness = new GatewayHarnessClient({ gatewayUrl: cfg.gatewayUrl, region: cfg.region, credentials: assumeRole(cfg.harnessRoleArn, 'coc-t09-stage-b'), label: 'harness-role' });
  const init = await harness.initialize();
  check('harness initialize succeeds', init.ok, { httpStatus: init.httpStatus });
  const listed = await harness.listTools();
  const expectedTools = ['compare_timestamps', 'list_evidence', 'propose_custody_event', 'read_evidence_version', 'record_finding'].map((t) => `${TARGET}___${t}`);
  check('harness sees exactly the five tools (preflight B3)', JSON.stringify(listed.tools) === JSON.stringify(expectedTools), { tools: listed.tools });

  const runs = [];
  for (const s of SCENARIOS) {
    const t = await timed(() => harness.callTool(`${TARGET}___${s.tool}`, s.args));
    runs.push({ s, ...t });
  }

  // 4. Match Lambda log lines exactly by tool + canonical-args hash
  //    (CloudWatch delivery lags a few seconds; clocks may skew, so no time windows).
  await sleep(15000);
  const lines = fetchLogLines(started);
  const logsFor = (tool, args) => lines.filter((l) => l.tool === tool && l.argsHash === argsHash(args));

  const expectedExecuted = SCENARIOS.filter((s) => s.expect === 'executed').length;
  const totalExecuted = lines.filter((l) => l.outcome === 'executed').length;
  check('Lambda executed exactly the legitimate scenarios (no leaks)', totalExecuted === expectedExecuted, { totalExecuted, expectedExecuted, totalLogLines: lines.length });

  const otherLines = logsFor(OTHER_PRINCIPAL_PROBE.tool, OTHER_PRINCIPAL_PROBE.args);
  const otherDeniedBy = deniedBy(otherCall.r.rpcError, names);
  check('other principal: denied by the session-role boundary, nothing executed', otherLines.length === 0 && otherDeniedBy.includes('boundary-session-role-only'), { toolsListed: otherTools.tools, lambdaLines: otherLines.length, deniedBy: otherDeniedBy });

  for (const { s, r } of runs) {
    const logs = logsFor(s.tool, s.args);
    const executed = logs.filter((l) => l.outcome === 'executed');
    const rejected = logs.filter((l) => l.outcome === 'rejected');
    let pass;
    let stoppedBy = null;
    if (s.expect === 'executed') {
      pass = !r.isError && !r.rpcError && executed.length === 1 && rejected.length === 0 && r.payload && r.payload.status !== 'rejected';
    } else if (s.expect === 'cedar-deny') {
      // Must be denied by the intended rule, not merely by the boundary.
      const by = deniedBy(r.rpcError, names);
      const specific = by.some((id) => !BOUNDARY_IDS.has(id));
      pass = (r.isError || !!r.rpcError) && logs.length === 0 && specific;
      stoppedBy = logs.length === 0 ? `cedar:${by.join('+') || 'unknown'}` : 'reached-lambda';
    } else if (s.expect === 'l3-reject') {
      pass = executed.length === 0 && rejected.length === 1 && rejected[0].code === s.l3Code;
      stoppedBy = 'lambda-l3';
    } else {
      pass = executed.length === 0 && (r.isError || !!r.rpcError || (r.payload && r.payload.status === 'rejected'));
      stoppedBy = logs.length === 0 ? 'gateway' : `lambda-l3:${rejected[0] && rejected[0].code}`;
    }
    report.scenarios.push({
      id: s.id, tool: s.tool, expect: s.expect, pass, stoppedBy,
      httpStatus: r.httpStatus, isError: r.isError, rpcError: r.rpcError,
      gatewayText: r.payload ? null : r.text.slice(0, 300),
      lambda: logs.map((l) => ({ outcome: l.outcome, code: l.code, argKeys: l.argKeys, propagatedHeaderNames: l.propagatedHeaderNames })),
    });
  }

  const all = [...report.checks.map((c) => c.pass), ...report.scenarios.map((s) => s.pass)];
  report.summary = { passed: all.filter(Boolean).length, failed: all.filter((p) => !p).length, total: all.length };
  const outDir = path.join(ROOT, 'docs', 'research', 't09-evidence');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'stage-b-live.json'), `${JSON.stringify(redact(report), null, 2)}\n`);

  for (const c of report.checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  check  ${c.name}`);
  for (const s of report.scenarios) console.log(`${s.pass ? 'PASS' : 'FAIL'}  ${s.id.padEnd(5)} ${s.expect.padEnd(12)} ${s.tool.padEnd(22)} ${s.stoppedBy || ''} ${s.rpcError || ''}`);
  console.log(`\n${report.summary.passed}/${report.summary.total} passed, ${report.summary.failed} failed`);
  process.exitCode = report.summary.failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(`stage-b run failed: ${err.message}`);
  process.exitCode = 2;
});
