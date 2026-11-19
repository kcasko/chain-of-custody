// T18: the investigation workspace in a real browser, driven the way a person
// uses it. Every authorization decision is the core's; these tests check that
// the page carries those decisions through faithfully and safely.

import { test, expect, type Page } from '@playwright/test';

const PEOPLE = {
  investigator: 'Owen Hale, investigator',
  auditor: 'Mara Voss, auditor',
  supervisor: 'Elena Ward, supervisor',
  outsider: 'Adrian Cole, supervisor of another case',
} as const;

// Any script error or CSP violation fails the test that caused it.
let problems: string[] = [];
test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('console', (msg) => {
    // Refusals are ordinary 4xx answers, which Chromium also logs as failed loads;
    // anything else (script errors, CSP violations) counts.
    if (msg.type() === 'error' && !/^Failed to load resource: the server responded with a status of 4\d\d /.test(msg.text())) problems.push(`console error: ${msg.text()}`);
  });
  await page.goto('/');
  await expect(page.locator('#chain-stamp')).toHaveText('Chain intact');
  await page.getByRole('button', { name: 'Reset demo data' }).click();
  await expect(status(page)).toContainText('Demo data reset');
});
test.afterEach(() => {
  expect(problems, problems.join('\n')).toEqual([]);
});

const status = (page: Page) => page.getByRole('status');
const transferForm = (page: Page) => page.locator('#transfer-form');

async function actAs(page: Page, who: keyof typeof PEOPLE) {
  await page.getByLabel('Acting as').selectOption({ label: PEOPLE[who] });
  await expect(status(page)).toContainText(`Now acting as ${PEOPLE[who].split(',')[0]}`);
}

async function openTab(page: Page, name: string) {
  await page.getByRole('tab', { name }).click();
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
}

async function expectRefused(page: Page, code: string) {
  await expect(status(page)).toContainText('Refused');
  await expect(status(page).locator('code')).toHaveText(code);
}

test('a full audit: transfer, refusal by role, draft promotion, approved export, correction', async ({ page }) => {
  // Evidence: the investigator reads an exact version and records a transfer.
  await actAs(page, 'investigator');
  await page.getByRole('button', { name: 'Read BW-007 original' }).click();
  await expect(page.getByRole('heading', { name: /^BW-007:/ })).toBeVisible();
  await transferForm(page).getByLabel('From', { exact: true }).fill('evidence locker');
  await transferForm(page).getByLabel('To', { exact: true }).fill('audit review');
  await transferForm(page).getByLabel('Reason', { exact: true }).fill('Scheduled audit review');
  await page.getByRole('button', { name: 'Append transfer to the ledger' }).click();
  await expect(status(page)).toContainText('Transfer appended as ledger entry #13.');
  await expect(page.locator('#ledger-head')).toContainText('#13');
  await expect(page.locator('#ledger-checkpoint')).toContainText('Signed checkpoint at #13');

  // The auditor may read but not move evidence; the core refuses by role.
  await actAs(page, 'auditor');
  await page.getByRole('button', { name: 'Read BW-007 original' }).click();
  await transferForm(page).getByLabel('From', { exact: true }).fill('a');
  await transferForm(page).getByLabel('To', { exact: true }).fill('b');
  await transferForm(page).getByLabel('Reason', { exact: true }).fill('c');
  await page.getByRole('button', { name: 'Append transfer to the ledger' }).click();
  await expectRefused(page, 'DENIED_ROLE');
  await expect(page.locator('#ledger-head')).toContainText('#13');

  // Findings: the scripted agent pass (labeled as such) makes drafts; a person promotes one.
  await openTab(page, 'Findings & drafts');
  await expect(page.getByText('Scripted replay, not a model.')).toBeVisible();
  await page.getByRole('button', { name: 'Run scripted agent pass' }).click();
  await expect(page.locator('#agent-calls li')).toHaveCount(7);
  await expect(page.locator('#agent-calls li', { hasText: 'executed' })).toHaveCount(7);
  await expect(page.getByRole('button', { name: 'Promote to the ledger' })).toHaveCount(2);
  await actAs(page, 'investigator');
  const transferDraft = page.locator('#drafts li', { hasText: 'custody transfer' });
  await transferDraft.getByRole('button', { name: 'Promote to the ledger' }).click();
  await expect(status(page)).toContainText('Draft promoted as ledger entry #14, attributed to Owen Hale.');
  await expect(transferDraft).toContainText('Promoted by');
  await expect(page.getByRole('button', { name: 'Promote to the ledger' })).toHaveCount(1);

  // Export: request, self-approval refused, a different supervisor approves, export verifies.
  await openTab(page, 'Approvals & export');
  await page.getByLabel('BW-001 original', { exact: true }).check();
  await page.getByLabel('BW-010 original', { exact: true }).check();
  await page.getByRole('button', { name: 'Request approval' }).click();
  await expect(status(page)).toContainText('Export requested.');
  const request = page.locator('#approvals li').first();
  await expect(request).toContainText('pending');
  await request.getByRole('button', { name: 'Approve' }).click();
  await expect(status(page)).toContainText('Refused');
  await expect(request).toContainText('pending');

  await actAs(page, 'supervisor');
  await request.getByRole('button', { name: 'Approve' }).click();
  await expect(status(page)).toContainText('Approved.');
  await expect(request).toContainText('approved');
  await expect(request).toContainText('Decided by elena.ward');

  await actAs(page, 'investigator');
  await request.getByRole('button', { name: 'Export' }).click();
  const verification = page.getByRole('article', { name: 'Independent verification of the export' });
  await expect(verification).toBeVisible();
  await expect(page.locator('#verify-stamp')).toHaveText('VERIFIED');
  await expect(verification).toContainText('FRESH');
  await expect(verification).toContainText('2 of 2');
  await expect(request).toContainText('consumed');
  await expect(request.getByRole('button')).toHaveCount(0);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download package (JSON)' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^blackwater-export-\d+\.json$/);
  const pkg = JSON.parse(await streamText(await download.createReadStream()));
  expect(pkg.evidence.map((e: { evidenceId: string }) => e.evidenceId).sort()).toEqual(['BW-001', 'BW-010']);

  // Timeline: the auditor appends a correction; the original line stays as recorded.
  await actAs(page, 'auditor');
  await openTab(page, 'Custody timeline');
  const original = page.locator('#timeline > li', { hasText: 'moved from "evidence locker" to "audit review"' });
  const originalText = await original.locator('.ws-event-body').textContent();
  await original.getByText('Append a correction').click();
  await original.getByLabel('What was wrong').fill('Destination room was recorded wrongly');
  await original.getByRole('button', { name: 'Append correction to #13' }).click();
  await expect(status(page)).toContainText('Correction appended as #15; #13 is unchanged.');
  await expect(original).toContainText('Corrected by #15. This entry is kept as recorded.');
  await expect(original.locator('.ws-event-body')).toHaveText(originalText ?? '');
  await expect(page.locator('#chain-report')).toContainText('Intact');
  await expect(page.locator('#chain-report')).toContainText('All 15 entries re-hashed and linked.');
  await expect(page.locator('#chain-stamp')).toHaveText('Chain intact');
});

test('a person dismisses an agent draft with a reason; it stays listed and the ledger is unchanged', async ({ page }) => {
  await actAs(page, 'auditor');
  await openTab(page, 'Findings & drafts');
  await page.getByRole('button', { name: 'Run scripted agent pass' }).click();
  await expect(page.getByRole('button', { name: 'Promote to the ledger' })).toHaveCount(2);
  const head = await page.locator('#ledger-head').textContent();

  const draft = page.locator('#drafts li', { hasText: 'historical assertion' });
  await draft.getByText('Dismiss this draft').click();
  // A reason is required: the browser blocks an empty submit before any request.
  await draft.getByRole('button', { name: 'Dismiss draft' }).click();
  await expect(draft).toContainText('draft');
  await draft.getByLabel('Why it should not be acted on').fill('The claimed time contradicts the BW-004 access log');
  await draft.getByRole('button', { name: 'Dismiss draft' }).click();
  await expect(status(page)).toContainText('Draft dismissed by Mara Voss. It stays listed and can no longer be promoted; the ledger is unchanged.');

  await expect(draft.locator('.stamp')).toHaveText('dismissed');
  await expect(draft).toContainText('Dismissed by mara.voss');
  await expect(draft).toContainText('The claimed time contradicts the BW-004 access log');
  await expect(draft.getByRole('button')).toHaveCount(0);
  await expect(page.locator('#drafts li')).toHaveCount(2);
  await expect(page.locator('#ledger-head')).toHaveText(head ?? '');

  // Other people see the same dismissal; the other draft is still open.
  await actAs(page, 'investigator');
  await expect(draft).toContainText('Dismissed by mara.voss');
  await expect(page.getByRole('button', { name: 'Promote to the ledger' })).toHaveCount(1);
});

test('a person outside the case sees nothing but the refusal', async ({ page }) => {
  await actAs(page, 'outsider');
  await expect(page.locator('#chain-stamp')).toHaveText('DENIED_NOT_MEMBER');
  await expect(page.locator('#ledger-head')).toHaveText('not visible to this person');
  await expect(page.locator('#evidence-rows')).toHaveText('Not visible: DENIED_NOT_MEMBER');
  await expect(page.getByRole('button', { name: /^Read / })).toHaveCount(0);

  await openTab(page, 'Custody timeline');
  await expect(page.locator('#chain-report')).toHaveText('Not visible: DENIED_NOT_MEMBER');
  await expect(page.locator('#timeline > li')).toHaveCount(0);
  await openTab(page, 'Findings & drafts');
  await expect(page.locator('#findings')).toHaveText('Not visible: DENIED_NOT_MEMBER');
  await expect(page.locator('#drafts')).toHaveText('Not visible: DENIED_NOT_MEMBER');
  await openTab(page, 'Approvals & export');
  await expect(page.locator('#approvals')).toHaveText('Not visible: DENIED_NOT_MEMBER');
});

test('the reader shows exactly the bytes the core returned for every version', async ({ page }) => {
  // Ask the API directly, as the same person, for every version in row order.
  const expected = await page.evaluate(async () => {
    const csrf = (await (await fetch('/api/session')).json()).value.csrf;
    const headers = { 'x-coc-csrf': csrf, 'x-coc-user': (document.getElementById('actor') as HTMLSelectElement).value };
    const list = (await (await fetch('/api/evidence', { headers })).json()).value as { evidenceId: string; versionId: string }[];
    return Promise.all(list.map(async (e) => {
      const r = await (await fetch(`/api/evidence/read?evidenceId=${encodeURIComponent(e.evidenceId)}&versionId=${encodeURIComponent(e.versionId)}`, { headers })).json();
      return { versionId: e.versionId, text: r.value.text + (r.value.truncated ? '\n[truncated]' : '') };
    }));
  });
  const reads = page.getByRole('button', { name: /^Read / });
  await expect(reads).toHaveCount(12);
  expect(expected).toHaveLength(12);
  for (const [i, e] of expected.entries()) {
    await reads.nth(i).click();
    await expect(page.locator('#reader-meta')).toContainText(e.versionId);
    // Meta and text are set in the same step, so the text is current here. Strict
    // equality: toHaveText would normalize whitespace.
    expect(await page.locator('#reader-text').evaluate((n) => n.textContent)).toBe(e.text);
    expect(await page.locator('#reader-text').evaluate((n) => n.childElementCount)).toBe(0);
  }
});

test('hostile text typed into the record comes back as inert text', async ({ page }) => {
  // The seeded evidence has no markup, so drive markup through fields the page echoes back.
  const hostile = `<img src=x onerror="document.title='pwned'"><b>bold</b> & <script>window.pwned=1</script>`;
  const title = await page.title();
  await actAs(page, 'investigator');
  await page.getByRole('button', { name: 'Read BW-007 original' }).click();
  await transferForm(page).getByLabel('From', { exact: true }).fill('evidence locker');
  await transferForm(page).getByLabel('To', { exact: true }).fill('audit review');
  await transferForm(page).getByLabel('Reason', { exact: true }).fill(hostile);
  await page.getByRole('button', { name: 'Append transfer to the ledger' }).click();
  await expect(status(page)).toContainText('Transfer appended as ledger entry #13.');

  await openTab(page, 'Custody timeline');
  const entry = page.locator('#timeline > li', { hasText: 'audit review' });
  await expect(entry.locator('.ws-event-body')).toHaveText(`BW-007 moved from "evidence locker" to "audit review". Reason: ${hostile}`);
  await expect(page.locator('#timeline img, #timeline b, #timeline script')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();
  expect(await page.title()).toBe(title);
  expect(await page.evaluate(() => document.querySelectorAll('script').length)).toBe(1);
});

test('tabs work from the keyboard', async ({ page }) => {
  const evidence = page.getByRole('tab', { name: 'Evidence' });
  await evidence.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Custody timeline' })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Custody timeline' })).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Approvals & export' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(evidence).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Approvals & export' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(evidence).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Evidence' })).toBeVisible();
});

test('phone width: no sideways scrolling and every tab is reachable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const name of ['Evidence', 'Custody timeline', 'Findings & drafts', 'Approvals & export']) {
    await openTab(page, name);
    const tab = page.getByRole('tab', { name });
    await expect(tab).toBeInViewport();
    const box = await tab.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0);
  }
});

test('the Integrity Challenge page still reports every entry as expected', async ({ page }) => {
  await page.getByRole('link', { name: 'Integrity Challenge' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Integrity Challenge');
  await expect(page.locator('#status')).toHaveText('Challenge complete: 28 entries, all as expected.', { timeout: 20_000 });
  await expect(page.locator('#unchanged-stamp')).toHaveText('Unchanged');
});

async function streamText(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}
