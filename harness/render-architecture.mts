// Renders the submission figures from local HTML to PNG with Playwright.
// Local files only, no network. All three share docs/submission/figures.css.
//
//   docs/submission/architecture.html        -> screenshots/architecture.png
//   docs/submission/timeline.html            -> screenshots/evidence-timeline.png
//   docs/submission/injection-sequence.html  -> screenshots/injection-sequence.png
//
// Usage: node harness/render-architecture.mts

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = join(import.meta.dirname, '..');
const figures: ReadonlyArray<readonly [string, string]> = [
  ['architecture.html', 'architecture.png'],
  ['timeline.html', 'evidence-timeline.png'],
  ['injection-sequence.html', 'injection-sequence.png'],
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 });
  for (const [source, png] of figures) {
    await page.goto(pathToFileURL(join(root, 'docs', 'submission', source)).href);
    await page.locator('.wrap').screenshot({ path: join(root, 'docs', 'submission', 'screenshots', png) });
    console.log(`wrote docs/submission/screenshots/${png}`);
  }
} finally {
  await browser.close();
}
