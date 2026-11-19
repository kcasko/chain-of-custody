// Ask the deployed Blackwater audit agent one question and stream its work to
// the terminal: text as it arrives, each tool call and its result. Used for the
// submission screenshot of the agent running. NOT YET RUN.
//
// Usage: npm run agent:ask -- "Compare the recorded times in BW-001 and BW-005."
// Reads .local/agent.json (git-ignored): { "region", "harnessArn" }

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HarnessAgentClient } from '../adapters/aws/src/harness-client.ts';
import { turnCostUsd } from '../adapters/aws/src/stress-test.ts';

const CONFIG = join(import.meta.dirname, '..', '.local', 'agent.json');
const prompt = process.argv.slice(2).join(' ').trim();
if (!prompt || !existsSync(CONFIG)) {
  console.error('usage: npm run agent:ask -- "<question>"   (needs .local/agent.json with region and harnessArn)');
  process.exit(2);
}
const cfg = JSON.parse(readFileSync(CONFIG, 'utf8')) as { region: string; harnessArn: string };
const names = new Map<number, string>();
const agent = new HarnessAgentClient({
  harnessArn: cfg.harnessArn, region: cfg.region,
  onEvent: (e) => {
    const start = e.contentBlockStart;
    if (start?.start?.toolUse) { names.set(start.contentBlockIndex, start.start.toolUse.name); process.stdout.write(`\n\n[tool] ${String(start.start.toolUse.name).replace(/^.*___/, '')} `); }
    if (start?.start?.toolResult) process.stdout.write(`\n[result ${start.start.toolResult.status ?? ''}] `);
    const d = e.contentBlockDelta?.delta;
    if (typeof d?.text === 'string') process.stdout.write(d.text);
    if (d?.toolUse?.input) process.stdout.write(d.toolUse.input);
    if (d?.toolResult) for (const b of (Array.isArray(d.toolResult) ? d.toolResult : [d.toolResult])) process.stdout.write(String(b?.text ?? JSON.stringify(b?.json ?? '')).slice(0, 300));
  },
});
console.log(`Blackwater audit agent (AgentCore managed harness)\n> ${prompt}\n`);
const turn = await agent.ask(prompt);
console.log(`\n\n[stop: ${turn.stopReason ?? 'none'}; tools used: ${turn.toolUses.length}; tokens out ${turn.usage?.outputTokens ?? 0}, cache read ${turn.usage?.cacheReadInputTokens ?? 0}, cache write ${turn.usage?.cacheWriteInputTokens ?? 0}; model cost about $${turnCostUsd(turn.usage).toFixed(3)}]`);
