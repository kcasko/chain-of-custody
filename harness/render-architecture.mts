// Renders docs/submission/architecture.html to docs/submission/screenshots/architecture.png
// with Playwright. Local file only, no network.
//
// Usage: node harness/render-architecture.mts

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = join(import.meta.dirname, '..');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(join(root, 'docs', 'submission', 'architecture.html')).href);
  await page.locator('.wrap').screenshot({ path: join(root, 'docs', 'submission', 'screenshots', 'architecture.png') });
} finally {
  await browser.close();
}
console.log('wrote docs/submission/screenshots/architecture.png');
