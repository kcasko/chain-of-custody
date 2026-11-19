// Renders a captured terminal transcript (from `npm run agent:ask ... > file`)
// as a terminal-styled PNG for the submission screenshot. The text is the real
// output, unchanged except that 12-digit account IDs are masked. No network.
//
// Usage:
//   node harness/render-transcript.mts <transcript.txt> <out.png>
//   node harness/render-transcript.mts <transcript.txt> <out.png> --lines 1-2,8,13-19 [--bar "Source description"]
//
// With --lines, only the listed lines are shown, verbatim, in a larger and
// easier-to-read layout; every run of omitted lines is replaced by a visibly
// different marker ("[n lines omitted]") so nothing looks like output that
// wasn't there. The bar names the full transcript file.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { chromium } from '@playwright/test';

const [input, output, flag, spec, barFlag, barText] = process.argv.slice(2);
if (!input || !output || (flag !== undefined && (flag !== '--lines' || !spec)) || (barFlag !== undefined && (barFlag !== '--bar' || !barText))) {
  console.error('usage: node harness/render-transcript.mts <transcript.txt> <out.png> [--lines 1-2,8,13-19 [--bar "Source description"]]');
  process.exit(2);
}
const text = readFileSync(input, 'utf8').replace(/\b\d{12}\b/g, '<account>');
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let body: string;
let bar = 'Terminal: npm run agent:ask (Blackwater audit agent, Amazon Bedrock AgentCore managed harness)';
let fontSize = 14;
let width = 1100;
if (spec) {
  const lines = text.replace(/\n$/, '').split('\n');
  const keep = new Set<number>();
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map(Number);
    if (!Number.isInteger(a) || (b !== undefined && !Number.isInteger(b))) throw new Error(`bad range: ${part}`);
    for (let n = a!; n <= (b ?? a!); n++) {
      if (n < 1 || n > lines.length) throw new Error(`line ${n} is outside the transcript (1-${lines.length})`);
      keep.add(n);
    }
  }
  const out: string[] = [];
  let skipped = 0;
  const flush = () => { if (skipped) out.push(`<span class="gap">[${skipped} line${skipped === 1 ? '' : 's'} omitted]</span>`); skipped = 0; };
  lines.forEach((line, i) => { if (keep.has(i + 1)) { flush(); out.push(escape(line)); } else skipped++; });
  flush();
  body = out.join('\n');
  bar = barText ?? `Excerpt of the real terminal output: npm run agent:ask on the AgentCore managed harness. Lines verbatim; omissions marked. Full transcript: docs/research/t21-evidence/${basename(input)}`;
  fontSize = 17;
  width = 1180;
} else {
  body = escape(text);
}

const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #1b1d1f; }
  .bar { background: #2b2e31; color: #b9bcbf; font: 13px/1.4 system-ui, sans-serif; padding: 10px 14px; }
  pre { margin: 0; padding: 18px 22px 24px; color: #e6e6e6; font: ${fontSize}px/1.55 Consolas, "Cascadia Mono", monospace; white-space: pre-wrap; word-break: break-word; }
  .gap { display: inline-block; color: #e3a23b; font: italic 13px/1.4 system-ui, sans-serif; border: 1px dashed #6b5a35; padding: 1px 8px; margin: 2px 0; }
</style><div class="bar">${escape(bar)}</div><pre>${body}</pre>`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width, height: spec ? 120 : 800 }, deviceScaleFactor: spec ? 2 : 1 });
  await page.setContent(html);
  await page.screenshot({ path: output, fullPage: true });
} finally {
  await browser.close();
}
console.log(`wrote ${output}`);
