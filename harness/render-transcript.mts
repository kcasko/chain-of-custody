// Renders a captured terminal transcript (from `npm run agent:ask ... > file`)
// as a terminal-styled PNG for the submission screenshot. The text is the real
// output, unchanged except that 12-digit account IDs are masked. No network.
//
// Usage: node harness/render-transcript.mts <transcript.txt> <out.png>

import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node harness/render-transcript.mts <transcript.txt> <out.png>');
  process.exit(2);
}
const text = readFileSync(input, 'utf8').replace(/\b\d{12}\b/g, '<account>');
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #1b1d1f; }
  .bar { background: #2b2e31; color: #b9bcbf; font: 13px/1 system-ui, sans-serif; padding: 10px 14px; }
  pre { margin: 0; padding: 16px 18px 22px; color: #e6e6e6; font: 14px/1.5 Consolas, "Cascadia Mono", monospace; white-space: pre-wrap; word-break: break-word; }
</style><div class="bar">Terminal: npm run agent:ask (Blackwater audit agent, Amazon Bedrock AgentCore managed harness)</div><pre>${escape(text)}</pre>`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.setContent(html);
  await page.screenshot({ path: output, fullPage: true });
} finally {
  await browser.close();
}
console.log(`wrote ${output}`);
