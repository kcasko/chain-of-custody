// Renders the submission figures from local HTML to PNG with Playwright.
// Local files only, no network. All three share docs/submission/figures.css.
//
//   docs/submission/architecture.html        -> screenshots/architecture.png
//   docs/submission/timeline.html            -> screenshots/evidence-timeline.png
//   docs/submission/injection-sequence.html  -> screenshots/injection-sequence.png
//   docs/submission/architecture-detailed.html, injection-sequence-detailed.html -> the full versions
//
// Usage: node harness/render-architecture.mts

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = join(import.meta.dirname, '..');
const figures: ReadonlyArray<readonly [string, string, { width: number; height: number }?]> = [
  ['architecture.html', 'architecture.png'],
  ['timeline.html', 'evidence-timeline.png'],
  ['injection-sequence.html', 'injection-sequence.png'],
  ['architecture-detailed.html', 'architecture-detailed.png'],
  ['injection-sequence-detailed.html', 'injection-sequence-detailed.png'],
];

const browser = await chromium.launch();
try {
  for (const [source, png, size] of figures) {
    const page = await browser.newPage({ viewport: size ?? { width: 1180, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(join(root, 'docs', 'submission', source)).href);
    await page.locator('.wrap').screenshot({ path: join(root, 'docs', 'submission', 'screenshots', png) });
    console.log(`wrote docs/submission/screenshots/${png}`);
    await page.close();
  }
} finally {
  await browser.close();
}
