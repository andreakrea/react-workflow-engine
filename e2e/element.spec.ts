import { expect, test } from '@playwright/test';

// <vise-workflow-editor> from the built dist/element.mjs, in a page without React.

test.beforeEach(async ({ page }) => {
  await page.goto('./element.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('renders in a plain page, isolated from the host CSS, themed by variables', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const el = page.locator('vise-workflow-editor');
  await expect(el.locator('.react-flow__node')).toHaveCount(1);

  const styles = await el.evaluate((host) => {
    const save = host.shadowRoot!.querySelector('.vwe-btn--primary')!;
    const cs = getComputedStyle(save);
    return { bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, font: cs.fontFamily };
  });
  expect(styles.bg).toBe('rgb(15, 118, 110)'); // --vwe-primary set on the tag
  expect(styles.radius).toBe('6px'); // host's `button { border-radius: 0 }` doesn't apply
  expect(styles.font).not.toContain('Georgia');
  expect(await page.locator('#host-btn').evaluate((b) => getComputedStyle(b).backgroundColor)).toBe('rgb(255, 105, 180)');

  const size = await el.evaluate((host) => ({ el: host.getBoundingClientRect().height, slot: host.parentElement!.clientHeight }));
  expect(size.el).toBe(size.slot);
  expect(errors).toEqual([]);
});

test('edits, keeps keyboard inside the editor, saves and emits events', async ({ page }) => {
  const el = page.locator('vise-workflow-editor');
  await el.locator('.react-flow__node', { hasText: 'New request' }).click();
  await el.locator('.vwe-item', { hasText: 'Notify customer' }).click();
  await expect(el.locator('.react-flow__edge')).toHaveCount(1);
  await expect(el.locator('.react-flow__node', { hasText: 'Notify customer' }).locator('.vwe-chip svg')).toBeVisible();

  // Backspace while typing must not delete the selected node (shadow DOM focus handling).
  const email = el.getByLabel(/Email/);
  await email.fill('a@b.co');
  await email.press('Backspace');
  await expect(el.locator('.react-flow__node')).toHaveCount(2);

  // Ctrl+Z on the host page must not undo inside the editor.
  await page.locator('#host-btn').focus();
  await page.keyboard.press('Control+z');
  await expect(el.locator('.react-flow__node')).toHaveCount(2);

  // …but it does when focus is in the editor.
  await el.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(el.locator('.react-flow__node')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  await expect(el.locator('.react-flow__node')).toHaveCount(2);

  await el.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#last')).toHaveText('Saved “Untitled workflow”');
});

test('switches language through the attribute', async ({ page }) => {
  const el = page.locator('vise-workflow-editor');
  await el.evaluate((host) => host.setAttribute('lang', 'it'));
  await expect(el.getByRole('button', { name: 'Salva' })).toBeVisible();
});
