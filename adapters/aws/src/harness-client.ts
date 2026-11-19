// AgentClient for the AgentCore managed harness (ADR 0010). One fresh session
// per prompt. It sends messages only: never model, tools, allowedTools, skills
// or systemPrompt overrides, so every call runs with the deployed, reviewed
// configuration (the harness treats caller overrides as trusted input).

import { randomUUID } from 'node:crypto';
import { BedrockAgentCoreClient, InvokeHarnessCommand } from '@aws-sdk/client-bedrock-agentcore';
import { parseHarnessStream, type AgentClient, type AgentTurn } from './stress-test.ts';

export class HarnessAgentClient implements AgentClient {
  readonly name: string;
  readonly #client: Pick<BedrockAgentCoreClient, 'send'>;
  readonly #harnessArn: string;
  readonly #onEvent: ((e: Record<string, any>) => void) | undefined;

  constructor(options: { harnessArn: string; region?: string; client?: Pick<BedrockAgentCoreClient, 'send'>; onEvent?: (e: Record<string, any>) => void }) {
    if (!/^arn:aws:bedrock-agentcore:[a-z0-9-]+:[0-9]{12}:harness\/[A-Za-z0-9_-]+$/.test(options.harnessArn)) throw new Error('harnessArn is not an AgentCore harness ARN');
    this.#harnessArn = options.harnessArn;
    this.#client = options.client ?? new BedrockAgentCoreClient({ region: options.region });
    this.#onEvent = options.onEvent;
    this.name = 'agentcore-managed-harness';
  }

  async ask(prompt: string): Promise<AgentTurn> {
    const runtimeSessionId = `coc-stress-${randomUUID()}`; // 47 characters; the API needs at least 33
    const out = await this.#client.send(new InvokeHarnessCommand({
      harnessArn: this.#harnessArn,
      runtimeSessionId,
      messages: [{ role: 'user', content: [{ text: prompt }] }],
    }));
    const events: Array<Record<string, any>> = [];
    for await (const e of (out.stream ?? []) as AsyncIterable<Record<string, any>>) {
      events.push(e);
      this.#onEvent?.(e);
    }
    return parseHarnessStream(events);
  }
}
