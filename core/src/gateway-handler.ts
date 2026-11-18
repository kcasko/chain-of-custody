// Transport adapter: AgentCore Gateway Lambda target -> AgentToolService.
//
// Trust boundary (ADR 0003 decision 2, Stage B findings): the Gateway does not
// pass the caller's identity to the Lambda. The agent identity and case are
// therefore deployment configuration, valid only because:
//   - the Lambda's only invoker is the Gateway execution role (IAM), and
//   - the Gateway admits only the BMA session role (Cedar boundary forbid).
// The tool name comes from the Gateway's client context; with no such context
// the call is refused (fail closed).

import { randomUUID } from 'node:crypto';
import type { AgentToolService } from './agent-tools.ts';
import type { RequestContext } from './types.ts';
import { CASE_ID } from './validate.ts';

export const TARGET_NAME = 'EvidenceTools';
const SEPARATOR = '___';

export interface GatewayHandlerConfig {
  readonly caseId: string;
  readonly agentId: string;
  readonly tools: AgentToolService;
  readonly clock?: () => Date;
  readonly log?: (line: Record<string, unknown>) => void;
}

interface LambdaContext { clientContext?: { custom?: Record<string, unknown> } }

export function createGatewayHandler(config: GatewayHandlerConfig) {
  if (!CASE_ID.test(config.caseId)) throw new Error('invalid case id in configuration');
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(config.agentId)) throw new Error('invalid agent id in configuration');
  const clock = config.clock ?? (() => new Date());
  const log = config.log ?? ((line) => console.log(JSON.stringify(line)));

  return async function handler(event: unknown, context: LambdaContext | undefined): Promise<unknown> {
    const custom = context?.clientContext?.custom ?? {};
    const full = typeof custom.bedrockAgentCoreToolName === 'string' ? custom.bedrockAgentCoreToolName : '';
    const at = full.indexOf(SEPARATOR);
    const target = at > 0 ? full.slice(0, at) : '';
    const tool = at > 0 ? full.slice(at + SEPARATOR.length) : '';
    const gatewayRequestId = typeof custom.bedrockAgentCoreAwsRequestId === 'string' ? custom.bedrockAgentCoreAwsRequestId.slice(0, 128) : null;
    const ctx: RequestContext = {
      principal: { type: 'agent', agentId: config.agentId },
      channel: 'gateway',
      requestId: gatewayRequestId ?? `local-${randomUUID()}`,
      now: clock(),
    };
    if (target !== TARGET_NAME || !tool) {
      log({ coc: 'tool-call', outcome: 'rejected', code: 'NO_GATEWAY_CONTEXT', requestId: ctx.requestId });
      return { status: 'rejected', code: 'NO_GATEWAY_CONTEXT', detail: 'missing or unexpected gateway target' };
    }
    const r = await config.tools.call(ctx, config.caseId, tool, event === undefined ? {} : event);
    log({ coc: 'tool-call', outcome: r.ok ? 'executed' : 'rejected', code: r.ok ? null : r.code, tool, requestId: ctx.requestId });
    return r.ok ? r.value : { status: 'rejected', code: r.code, detail: r.detail };
  };
}
