// T18: the investigation workspace in a real browser, driven the way a person
// uses it. Every authorization decision is the core's; these tests check that
// the page carries those decisions through faithfully and safely.

import { test, expect, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  await page.locator('#request-form').getByLabel('BW-001 original', { exact: true }).check();
  await page.locator('#request-form').getByLabel('BW-010 original', { exact: true }).check();
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
  const verification = page.getByRole('article', { name: "Export check against this server's key" });
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
  const [trustDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download trust file' }).click()]);
  expect(trustDownload.suggestedFilename()).toMatch(/^blackwater-trust-\d+\.json$/);
  // Verify the two downloaded files offline, outside the browser and the server.
  const dir = mkdtempSync(join(tmpdir(), 'coc-e2e-'));
  try {
    await download.saveAs(join(dir, 'package.json'));
    await trustDownload.saveAs(join(dir, 'trust.json'));
    const cli = spawnSync(process.execPath, ['core/tools/verify-export.ts', join(dir, 'package.json'), join(dir, 'trust.json')], { encoding: 'utf8' });
    expect(cli.status, cli.stdout + cli.stderr).toBe(0);
    expect(cli.stdout).toMatch(/Status:\s+VERIFIED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

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

test('brief, documented provenance and comparison: times stay as written, lineage explains differences', async ({ page }) => {
  const brief = page.locator('#brief');
  await expect(brief).toContainText('without assuming accident or crime');
  await expect(brief).toContainText('Everything here is fictional and synthetic');

  await page.getByRole('button', { name: 'Read BW-005 original' }).click();
  const prov = page.getByRole('region', { name: 'Documented provenance' });
  await expect(prov).toContainText('controller RTC; no NTP sync recorded');
  await expect(prov).toContainText('2021-10-13 23:44:08; 2021-10-13 23:59:50');
  await expect(prov).toContainText('drift on 2021-10-13 unverified');

  await openTab(page, 'Compare');
  const times = page.locator('#times-rows');
  // Exactly as written: the DVR time and the migration's UTC rendering are both shown, neither converted.
  await expect(times.locator('td.ws-raw', { hasText: /^2021-10-13 23:57:40$/ })).toHaveCount(1);
  await expect(times.locator('td.ws-raw', { hasText: /^2021-10-14T03:57:40Z$/ })).toHaveCount(1);
  await expect(times.locator('td.ws-raw', { hasText: /^around midnight, maybe a little before$/ })).toHaveCount(1);

  // Defaults to BW-002 original against its registered derivative.
  await expect(page.getByLabel('Left')).toHaveValue(/^BW-002\|/);
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.locator('#compare-verdict')).toContainText('Right is a registered derivative of left (2026 migration transcode');
  await expect(page.locator('#cmp-b-lines .ws-diff--only').first()).toBeVisible();
  await expect(page.locator('#compare-out li')).not.toHaveCount(0);
  expect(await page.locator('#compare-out ol').evaluateAll((ls) => ls.every((l) => [...l.children].every((li) => li.childElementCount === 0)))).toBe(true);

  // Same item, two versions with no lineage: an open question, not a finding.
  await page.getByLabel('Left').selectOption({ label: 'BW-005 original' });
  await page.getByLabel('Right').selectOption({ label: 'BW-005 version 2, added later' });
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.locator('#compare-verdict')).toContainText('no recorded lineage between them');
  await expect(page.locator('#compare-verdict')).toContainText('an open question, not a finding');
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

test('a person records a historical claim; it lands on the ledger exactly as the source stated it', async ({ page }) => {
  await actAs(page, 'auditor');
  await openTab(page, 'Custody timeline');
  await page.getByText('Record a historical claim').click();
  const form = page.locator('#claim-form');
  await form.getByLabel('About').selectOption('BW-001');
  await form.getByLabel('What the source claims').fill('No badge entry for the lab B door between 21:30 and 22:00.');
  await form.getByLabel('Claimed time, as written').fill('10/13/2021 9:40 PM');
  await form.getByLabel('Source clock').fill('badge controller clock');
  await form.getByLabel('Time zone').fill('not stated');
  await form.getByLabel('Offset uncertainty').fill('unknown; controller drifts');

  // No source chosen: refused on the page, nothing sent, nothing appended.
  await form.getByRole('button', { name: 'Append claim to the ledger' }).click();
  await expect(status(page)).toContainText('choose at least one source version');
  await expect(page.locator('#ledger-head')).toContainText('#12');

  await form.getByLabel('BW-004 original', { exact: true }).check();
  await form.getByRole('button', { name: 'Append claim to the ledger' }).click();
  await expect(status(page)).toContainText('Claim appended as ledger entry #13, recorded as stated.');
  const entry = page.locator('#timeline > li', { hasText: 'No badge entry for the lab B door' });
  await expect(entry.locator('.ws-kind')).toHaveText('historical assertion');
  await expect(entry.locator('.ws-event-body')).toHaveText('Historical claim about BW-001: No badge entry for the lab B door between 21:30 and 22:00. (claimed 10/13/2021 9:40 PM, clock badge controller clock, not stated, uncertainty unknown; controller drifts). Sources: BW-004 original');
  await expect(entry).toContainText('mara.voss (auditor)');
  await expect(page.locator('#chain-report')).toContainText('All 13 entries re-hashed and linked.');
  await expect(form.getByLabel('What the source claims')).toHaveValue('');
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
  await openTab(page, 'Security log');
  await expect(page.locator('#audit-rows')).toHaveText('Not visible: DENIED_NOT_MEMBER');
});

test('the security log: supervisors see refusals by others and their own read; other roles are refused', async ({ page }) => {
  // An auditor tries to move evidence and is refused; then tries to open the log.
  await actAs(page, 'auditor');
  await page.getByRole('button', { name: 'Read BW-007 original' }).click();
  await transferForm(page).getByLabel('From', { exact: true }).fill('a');
  await transferForm(page).getByLabel('To', { exact: true }).fill('b');
  await transferForm(page).getByLabel('Reason', { exact: true }).fill('c');
  await page.getByRole('button', { name: 'Append transfer to the ledger' }).click();
  await expectRefused(page, 'DENIED_ROLE');
  await openTab(page, 'Security log');
  await expect(page.locator('#audit-rows')).toHaveText('Not visible: DENIED_ROLE');

  await actAs(page, 'supervisor');
  const rows = page.locator('#audit-rows tr');
  await expect(rows.first()).toContainText('human:elena.ward');
  await expect(rows.first()).toContainText('read audit log');
  await expect(rows.first()).toContainText('attempted');
  await expect(page.locator('#audit-count')).toContainText('entries');
  const refusedTransfer = rows.filter({ hasText: 'human:mara.voss' }).filter({ hasText: 'add custody event' });
  await expect(refusedTransfer).toHaveCount(1);
  await expect(refusedTransfer).toContainText('DENIED_ROLE');
  await expect(rows.filter({ hasText: 'human:mara.voss' }).filter({ hasText: 'read audit log' })).toContainText('DENIED_ROLE');

  // The filter hides everything that was allowed.
  await page.getByLabel('Refusals and failures only').check();
  const outcomes = await page.locator('#audit-rows td[data-label="Outcome"]').allTextContents();
  expect(outcomes.length).toBeGreaterThanOrEqual(2);
  expect(new Set(outcomes)).toEqual(new Set(['denied']));
  await page.getByLabel('Refusals and failures only').uncheck();
  await expect(rows.filter({ hasText: 'completed' }).first()).toBeVisible();
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
  await expect(page.getByRole('tab', { name: 'Compare' })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Compare' })).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Security log' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(evidence).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Security log' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(evidence).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Evidence' })).toBeVisible();
});

test('new controls work from the keyboard alone, with a visible focus ring', async ({ page }) => {
  const outline = () => page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle + ' ' + getComputedStyle(document.activeElement!).outlineWidth);
  // Case brief folds and unfolds with Enter.
  const summary = page.locator('#brief > summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#brief')).not.toHaveAttribute('open', '');
  await page.keyboard.press('Enter');
  await expect(page.locator('#brief')).toHaveAttribute('open', '');
  // Compare: reach the tab with arrows, then Tab to the pickers and the button.
  await page.getByRole('tab', { name: 'Evidence' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tabpanel', { name: 'Compare' })).toBeVisible();
  await page.getByLabel('Left').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Right')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Compare', exact: true })).toBeFocused();
  expect(await outline()).toBe('solid 3px');
  await page.keyboard.press('Enter');
  await expect(page.locator('#compare-out')).toBeVisible();
  // Security log filter toggles with Space.
  await actAs(page, 'supervisor');
  await page.getByRole('tab', { name: 'Security log' }).click();
  await page.getByLabel('Refusals and failures only').focus();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('Refusals and failures only')).toBeChecked();
});

test('phone width: no sideways scrolling and every tab is reachable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const name of ['Evidence', 'Compare', 'Custody timeline', 'Findings & drafts', 'Approvals & export', 'Security log']) {
    await openTab(page, name);
    const tab = page.getByRole('tab', { name });
    await expect(tab).toBeInViewport();
    const box = await tab.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0);
  }
});

// WCAG 2.2 AA body-text contrast (4.5:1), measured from computed colors with
// translucent backgrounds composited up the tree, in both color schemes.
const CONTRAST_TARGETS = [
  '.ws-brief-body p', '.lede', '.ws-identity', '.ws-hint', '.ws-synthetic', '.ws-brief a', '.ws-brief-h', '.reason', '.ws-untrusted',
  '[role="tab"][aria-selected="false"]', '[role="tab"][aria-selected="true"]', '.docket thead th', '.ws-times td', '.ws-times--claim td',
  '.ws-diff li', '.ws-diff--only', '.ws-compare-verdict', '.ws-audit td', '.ws-audit--denied td', '.verdict--refused', '.verdict--allowed', '.verdict--na', '.stamp',
];

async function contrastReport(page: Page) {
  return page.evaluate((selectors) => {
    const parse = (c: string): [number, number, number, number] => {
      const n = (c.match(/[\d.]+/g) ?? []).map(Number);
      if (c.startsWith('color(srgb')) return [n[0]! * 255, n[1]! * 255, n[2]! * 255, n[3] ?? 1];
      return [n[0]!, n[1]!, n[2]!, n[3] ?? 1];
    };
    const over = (top: number[], under: number[]) => [0, 1, 2].map((i) => top[i]! * top[3]! + under[i]! * (1 - top[3]!)).concat(1);
    const bgOf = (el: Element | null): number[] => {
      const layers: number[][] = [];
      for (let e = el; e; e = e.parentElement) {
        const b = parse(getComputedStyle(e).backgroundColor);
        if (b[3] > 0) layers.push(b);
        if (b[3] >= 1) break;
      }
      let acc = [255, 255, 255, 1];
      for (const l of layers.reverse()) acc = over(l, acc);
      return acc;
    };
    const lum = (c: number[]) => {
      const [r, g, b] = c.slice(0, 3).map((v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const out: Array<{ selector: string; ratio: number }> = [];
    for (const selector of selectors) {
      const el = [...document.querySelectorAll(selector)].find((e) => (e as HTMLElement).offsetParent !== null && (e.textContent ?? '').trim() !== '');
      if (!el) { out.push({ selector, ratio: -1 }); continue; }
      const bg = bgOf(el);
      const fg = over(parse(getComputedStyle(el).color), bg);
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      out.push({ selector, ratio: Math.round(((a! + 0.05) / (b! + 0.05)) * 100) / 100 });
    }
    return out;
  }, CONTRAST_TARGETS);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`readable contrast (WCAG AA 4.5:1) in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const seen = new Map<string, number>();
    const collect = async () => { for (const r of await contrastReport(page)) if (r.ratio >= 0) seen.set(r.selector, Math.min(seen.get(r.selector) ?? Infinity, r.ratio)); };
    await collect();
    await page.getByRole('button', { name: 'Read BW-005 original' }).click();
    await collect();
    await openTab(page, 'Compare');
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.locator('#compare-out')).toBeVisible();
    await collect();
    await actAs(page, 'investigator');
    await openTab(page, 'Custody timeline');
    await page.getByText('Record a historical claim').click();
    const form = page.locator('#claim-form');
    await form.getByLabel('What the source claims').fill('Contrast check claim.');
    for (const [label, value] of [['Claimed time, as written', '1'], ['Source clock', 'x'], ['Time zone', 'x'], ['Offset uncertainty', 'x']]) await form.getByLabel(label!).fill(value!);
    await form.getByLabel('BW-004 original', { exact: true }).check();
    await form.getByRole('button', { name: 'Append claim to the ledger' }).click();
    await openTab(page, 'Compare');
    await expect(page.locator('.ws-times--claim')).toHaveCount(1);
    await collect();
    await actAs(page, 'auditor');
    await openTab(page, 'Security log');
    await actAs(page, 'supervisor');
    await expect(page.locator('.ws-audit--denied').first()).toBeVisible();
    await collect();
    const missing = CONTRAST_TARGETS.filter((t) => !seen.has(t));
    expect(missing, 'every target was measured at least once').toEqual([]);
    const low = [...seen].filter(([, r]) => r < 4.5).map(([s, r]) => `${s}: ${r}`);
    expect(low, `below 4.5:1 in ${scheme}`).toEqual([]);
  });
}

test('the Integrity Challenge page still reports every entry as expected', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Other pages' }).getByRole('link', { name: 'Integrity Challenge' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Integrity Challenge');
  await expect(page.locator('#status')).toHaveText('Challenge complete: 28 entries, all as expected.', { timeout: 20_000 });
  await expect(page.locator('#unchanged-stamp')).toHaveText('Unchanged');
});

async function streamText(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}
