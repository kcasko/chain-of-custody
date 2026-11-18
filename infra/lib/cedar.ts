// Cedar policies for CloudFormation, from the same files and the same
// injection-safe renderer (policy/lib.cjs) the local tests and Stage B used.
//
// The Gateway ARN is unknown until deploy, so the set is rendered with a
// sentinel ARN that passes the renderer's strict format, validated with the
// Cedar engine in strict mode, split per @id, and each sentinel occurrence is
// replaced with the Gateway's ARN attribute (Fn::Join). Nothing else in the
// text comes from deploy time.

import { createRequire } from 'node:module';
import * as cdk from 'aws-cdk-lib';

const require = createRequire(import.meta.url);
const policyLib = require('../../policy/lib.cjs') as {
  renderPolicies(values: Record<string, string>): string;
  policiesById(text: string): Record<string, string>;
  validatePolicies(text: string): { ok: boolean; errors: string[]; warnings: string[] };
};

export const SENTINEL_GATEWAY_ID = 'cdk-gateway-arn-sentinel';

export type PolicyKind = 'boundary' | 'permit' | 'forbid';
export interface CfnReadyPolicy {
  readonly id: string;
  readonly name: string;
  readonly kind: PolicyKind;
  readonly validationMode: 'IGNORE_ALL_FINDINGS' | 'FAIL_ON_ANY_FINDINGS';
  readonly renderedWithSentinel: string;
  statement(gatewayArn: string): string;
}

// Stage B load order (ADR 0004 update): boundary forbids, then permits, then
// tool forbids. Boundary forbids are the only ones loaded with IGNORE_ALL_FINDINGS.
const ORDER: Record<PolicyKind, number> = { boundary: 0, permit: 1, forbid: 2 };

function kindOf(id: string, text: string): PolicyKind {
  if (id.startsWith('boundary-')) return 'boundary';
  const body = text.replace(/^\s*(@[a-z]+\("[^"]*"\)\s*)+/, '');
  if (body.startsWith('permit')) return 'permit';
  if (body.startsWith('forbid')) return 'forbid';
  throw new Error(`cedar: cannot classify policy ${id}`);
}

export function cfnPolicies(account: string, region: string, sessionRoleName: string): CfnReadyPolicy[] {
  const sentinelArn = `arn:aws:bedrock-agentcore:${region}:${account}:gateway/${SENTINEL_GATEWAY_ID}`;
  const text = policyLib.renderPolicies({ ACCOUNT_ID: account, SESSION_ROLE_NAME: sessionRoleName, GATEWAY_ARN: sentinelArn });
  const validation = policyLib.validatePolicies(text);
  if (!validation.ok) throw new Error(`cedar: rendered policies fail strict validation: ${[...validation.errors, ...validation.warnings].join('; ')}`);
  const byId = policyLib.policiesById(text);
  const out = Object.entries(byId).map(([id, policyText]) => {
    const kind = kindOf(id, policyText);
    const name = id.replace(/-/g, '_');
    if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(name)) throw new Error(`cedar: policy name ${name} does not fit AgentCore naming`);
    const parts = policyText.split(sentinelArn);
    return {
      id, name, kind,
      validationMode: kind === 'boundary' ? 'IGNORE_ALL_FINDINGS' as const : 'FAIL_ON_ANY_FINDINGS' as const,
      renderedWithSentinel: policyText,
      statement: (gatewayArn: string) => (parts.length === 1 ? policyText : cdk.Fn.join(gatewayArn, parts)),
    };
  });
  return out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.id.localeCompare(b.id));
}
