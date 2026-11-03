import { expect, test, type Page } from '@playwright/test';

/** Collects console errors and uncaught exceptions. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('vise-wfe-demo-theme', '"light"');
    localStorage.setItem('vise-wfe-demo-lang', '"en"');
  });
  await page.reload();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
});

test('opens the example workflow without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.reload();
  await expect(page.getByLabel('Workflow name')).toHaveValue('Support ticket');
  await expect(page.locator('.react-flow__node')).toHaveCount(10);
  await expect(page.locator('.vwe-pill')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('adds a block under the selected node, connected, and undoes it', async ({ page }) => {
  // A new workflow has only a Start node with a free exit, so a clicked block chains onto it.
  await page.getByRole('button', { name: 'Workflows' }).click();
  await page.getByRole('button', { name: 'New workflow' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);

  await page.locator('.react-flow__node', { hasText: 'Start' }).click();
  await page.locator('.vwe-item', { hasText: 'Manual Review' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect(page.locator('.vwe-status')).toHaveText('Unsaved changes');

  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('Control+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});

test('shows a validation error for a missing required field', async ({ page }) => {
  await page.locator('.react-flow__node', { hasText: 'Send Email' }).click();
  await page.getByLabel(/Recipient/).fill('');
  await expect(page.locator('.vwe-pill')).toContainText('1 error');
  await expect(page.locator('.react-flow__node', { hasText: 'Send Email' }).locator('.vwe-node__flag--error')).toBeVisible();
  await page.locator('.vwe-pill').click();
  await expect(page.getByRole('dialog', { name: 'Problems' })).toContainText('Recipient is required');
});

test('saves and reloads a change', async ({ page }) => {
  await page.getByLabel('Workflow name').fill('Support ticket v2');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.vwe-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.getByLabel('Workflow name')).toHaveValue('Support ticket v2');
});

test('manages hooks from the sidebar', async ({ page }) => {
  await page.getByRole('tab', { name: /Hooks/ }).click();
  await page.locator('.vwe-hookrow__main', { hasText: 'Slack Alert' }).click();
  await expect(page.locator('.vwe-inspector')).toContainText('When a node is entered');
  await page.getByRole('switch', { name: 'Slack Alert enabled' }).uncheck({ force: true });
  await expect(page.locator('.vwe-hookrow', { hasText: 'Slack Alert' })).toHaveClass(/is-off/);
});

test('switches the editor to Italian', async ({ page }) => {
  await page.getByRole('radio', { name: 'IT' }).click();
  await expect(page.getByRole('button', { name: 'Salva' })).toBeVisible();
  await expect(page.locator('.vwe-sidebar__title').first()).toHaveText('Inizio');
});

test('runs tickets through the real engine, including a timed wait', async ({ page }) => {
  await page.getByRole('button', { name: 'Simulator' }).click();
  await page.getByLabel('Workflow').selectOption({ label: 'Support ticket' });
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'New ticket' }).click();
  await expect(page.locator('.sim__row')).toHaveCount(6);
  const row = page.locator('.sim__row').first();
  await row.getByRole('button', { name: 'History' }).click();
  await expect(row.locator('.sim__history li').first()).toContainText('Started at Start');
  // Low-priority tickets wait 10 s for a reply, then resolve on their own.
  // Match the ticket's current position only, not text inside an opened history.
  const waiting = page.locator('.sim__row-sub', { hasText: 'Wait for reply' });
  if ((await waiting.count()) > 0) await expect(waiting).toHaveCount(0, { timeout: 15_000 });
});

test('works on a phone: no sideways scroll, blocks open as a sheet @phone', async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.vwe-sheet--left')).toHaveClass(/is-open/);
  const size = await page.getByPlaceholder('Search blocks').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
});
