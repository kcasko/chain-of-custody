// Renders a captured terminal transcript (from `npm run agent:ask ... > file`)
// as a terminal-styled PNG for the submission screenshot. The text is the real
// output, unchanged except that 12-digit account IDs are masked. No network.
//
// Usage:
//   node harness/render-transcript.mts <transcript.txt> <out.png>
//   node harness/render-transcript.mts <transcript.txt> <out.png> --lines 1-2,8,13-19 [--bar "Source description"] [--clip 220]
//
// With --lines, only the listed lines are shown, verbatim, in a larger and
// easier-to-read layout; every run of omitted lines is replaced by a visibly
// different marker ("[n lines omitted]") so nothing looks like output that
// wasn't there. With --clip N, a kept line longer than N characters is cut at the last
// space before N and ends in a marker giving the number of characters omitted. A line can
// also be cut to exact character ranges with N@start-end (several ranges joined by ";"),
// for example 13@0-28 to show a tool call's name without its JSON arguments; each
// omitted segment gets a "[n characters omitted]" marker. The bar names
// the full transcript file. Excerpts use the compact 900 px canvas of the article
// figures (shown 790 px wide on Builder Center).

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { chromium } from '@playwright/test';

const [input, output, ...rest] = process.argv.slice(2);
const opts: Record<string, string> = {};
for (let i = 0; i < rest.length; i += 2) {
  const k = rest[i]!, v = rest[i + 1];
  if (!['--lines', '--bar', '--clip'].includes(k) || !v) { opts.bad = k; break; }
  opts[k] = v;
}
const spec = opts['--lines'], barText = opts['--bar'], clip = opts['--clip'] ? Number(opts['--clip']) : undefined;
if (!input || !output || opts.bad !== undefined || ((barText || clip) && !spec) || (clip !== undefined && !(clip > 0))) {
  console.error('usage: node harness/render-transcript.mts <transcript.txt> <out.png> [--lines 1-2,8,13-19 [--bar "Source description"] [--clip 220]]');
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
  // Per-line character ranges: "13@0-28" keeps only characters 0 to 27 of line 13;
  // "28@0-16;140-" keeps two segments. Every omitted segment gets a marker.
  const segments = new Map<number, Array<[number, number | undefined]>>();
  for (const part of spec.split(',')) {
    if (part.includes('@')) {
      const [ln, ranges] = part.split('@');
      const n = Number(ln);
      if (!Number.isInteger(n) || n < 1 || n > lines.length) throw new Error(`bad line: ${part}`);
      const segs = ranges!.split(';').map((r) => {
        const [s, e] = r.split('-');
        const start = Number(s), end = e === '' || e === undefined ? undefined : Number(e);
        if (!Number.isInteger(start) || (end !== undefined && !(Number.isInteger(end) && end > start))) throw new Error(`bad range: ${part}`);
        return [start, end] as [number, number | undefined];
      });
      segments.set(n, segs);
      keep.add(n);
      continue;
    }
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
  const cut = (line: string) => {
    if (!clip || line.length <= clip) return escape(line);
    const space = line.lastIndexOf(' ', clip);
    const keepTo = space > clip / 2 ? space : clip; // end on a whole word where possible
    return escape(line.slice(0, keepTo)) + ` <span class="gap">[${line.length - keepTo} more characters omitted]</span>`;
  };
  const pick = (line: string, segs: Array<[number, number | undefined]>) => {
    const mark = (n: number) => ` <span class="gap">[${n} character${n === 1 ? '' : 's'} omitted]</span> `;
    let html = '', pos = 0;
    for (const [s, e] of segs) {
      const end = Math.min(e ?? line.length, line.length);
      if (s > pos) html += mark(s - pos);
      html += escape(line.slice(s, end));
      pos = end;
    }
    if (pos < line.length) html += mark(line.length - pos);
    return html.trimEnd();
  };
  lines.forEach((line, i) => {
    if (!keep.has(i + 1)) { skipped++; return; }
    flush();
    const segs = segments.get(i + 1);
    out.push(segs ? pick(line, segs) : cut(line));
  });
  flush();
  body = out.join('\n');
  bar = barText ?? `Excerpt of the real terminal output: npm run agent:ask on the AgentCore managed harness. Lines verbatim; omissions marked. Full transcript: docs/research/t21-evidence/${basename(input)}`;
  fontSize = 22;
  width = 900;
} else {
  body = escape(text);
}

const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #1b1d1f; }
  .bar { background: #2b2e31; color: #b9bcbf; font: ${spec ? 17 : 13}px/1.4 system-ui, sans-serif; padding: 10px 14px; }
  pre { margin: 0; padding: ${spec ? "18px 24px 22px" : "18px 22px 24px"}; color: #e6e6e6; font: ${fontSize}px/1.55 Consolas, "Cascadia Mono", monospace; white-space: pre-wrap; word-break: break-word; }
  .gap { display: inline-block; color: #e3a23b; font: italic ${spec ? 18 : 13}px/1.4 system-ui, sans-serif; border: 1px dashed #6b5a35; padding: 1px 8px; margin: 2px 0; }
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
