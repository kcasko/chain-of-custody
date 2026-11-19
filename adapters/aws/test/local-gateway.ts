// A local stand-in for the AgentCore Gateway, for testing the T19 runner on
// this machine: the project's real Cedar policies, evaluated by the official
// Cedar engine the way the live engine behaved in Stage B, in front of the real
// tool handler. Unsigned callers are refused, unknown tools are refused, and a
// Cedar denial is reported in the live Gateway's error format. This emulates
// the Gateway's observable behavior; it is not the Gateway.

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { parseDeniedBy, TARGET, TOOL_NAMES, type ToolClient, type ToolResult } from '../src/stage-b-core.ts';

const require = createRequire(import.meta.url);
const cedar = require('../../../policy/lib.cjs') as {
  renderPolicies(v: Record<string, string>): string;
  authorize(req: unknown, opts: { policies: string; validateRequest: boolean }): { decision: 'allow' | 'deny'; reasons: string[] };
};

const ACCOUNT = '000000000000';
const SESSION_ROLE = 'CocBmaSessionRole';
const GATEWAY_ARN = `arn:aws:bedrock-agentcore:us-east-1:${ACCOUNT}:gateway/coc-local-gw-0000000000`;
const POLICIES = cedar.renderPolicies({ ACCOUNT_ID: ACCOUNT, SESSION_ROLE_NAME: SESSION_ROLE, GATEWAY_ARN });
// As AgentCore presents an assumed role: the role ARN with the session name removed.
const PRINCIPAL_ARN = { session: `arn:aws:sts::${ACCOUNT}:assumed-role/${SESSION_ROLE}`, other: `arn:aws:sts::${ACCOUNT}:assumed-role/OperatorAdmin` } as const;

type Handler = (event: unknown, context: { clientContext?: { custom?: Record<string, unknown> } } | undefined) => Promise<unknown>;

export class LocalGatewayClient implements ToolClient {
  readonly name: string;
  readonly #handler: Handler;
  readonly #principal: keyof typeof PRINCIPAL_ARN | null;
  readonly #enforceCedar: boolean;
  /** principal null = unsigned. enforceCedar false is only for proving the runner notices a bypass. */
  constructor(handler: Handler, principal: keyof typeof PRINCIPAL_ARN | null, options: { enforceCedar?: boolean } = {}) {
    this.#handler = handler;
    this.#principal = principal;
    this.#enforceCedar = options.enforceCedar ?? true;
    this.name = `local-gateway:${principal ?? 'unsigned'}`;
  }

  async initialize() {
    return this.#principal ? { ok: true, httpStatus: 200 } : { ok: false, httpStatus: 403 };
  }

  async listTools() {
    if (!this.#principal) return { ok: false, httpStatus: 403, tools: [] };
    return { ok: true, httpStatus: 200, tools: [...TOOL_NAMES] };
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.#principal) return { httpStatus: 403, rpcError: 'unsigned request', isError: true, payload: null, text: '' };
    if (!TOOL_NAMES.includes(name)) return { httpStatus: 200, rpcError: `-32602: Unknown tool: ${name.slice(0, 80)}`, isError: true, payload: null, text: '' };
    if (this.#enforceCedar) {
      const principal = { type: 'IamEntity', id: this.#principal, arn: PRINCIPAL_ARN[this.#principal] };
      const d = cedar.authorize({ principal, action: name, resource: GATEWAY_ARN, input: args }, { policies: POLICIES, validateRequest: false });
      if (d.decision !== 'allow') {
        const why = d.reasons.length ? `denied due to ${d.reasons.join(', ')}]` : 'denied by default]';
        return { httpStatus: 200, rpcError: `-32002: Tool Execution Denied: Tool call not allowed due to policy enforcement [${why}`, isError: true, payload: null, text: '' };
      }
    }
    const out = await this.#handler(args, { clientContext: { custom: { bedrockAgentCoreToolName: name, bedrockAgentCoreAwsRequestId: `gw-${randomUUID()}` } } });
    const text = JSON.stringify(out);
    return { httpStatus: 200, rpcError: null, isError: false, payload: JSON.parse(text), text };
  }
}

// The live runner maps engine policy names to IDs; locally the reasons are the IDs.
export const localDeniedBy = (rpcError: string | null): string[] => parseDeniedBy(rpcError);

export { TARGET };
