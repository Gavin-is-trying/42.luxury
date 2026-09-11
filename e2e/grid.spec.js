import { test, expect } from '@playwright/test';

const key = 'calvin.grid.v1';
const saved = (page) => page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key);
async function waitForSave(page) {
  await expect(page.locator('#save-status')).toHaveText('Saved on this device');
}
async function clickCell(page, col, row) {
  await page.locator('#grid-scroll').click({ position: { x: col * 24 + 12, y: row * 32 + 16 } });
}

test('fixed cell margins, anchored typing, tab, overwrite, undo, and reload', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const frame = await page.locator('#grid-frame').boundingBox();
  expect(frame).toEqual({ x: 48, y: 64, width: 1184, height: 772 });
  await clickCell(page, 2, 3);
  await page.keyboard.type('hello');
  await page.keyboard.press('Enter');
  await page.keyboard.type('A');
  await page.keyboard.press('Tab');
  await page.keyboard.type('B');
  await waitForSave(page);
  let data = await saved(page);
  expect(data.draft.cells).toMatchObject({ '2,3': 'h', '6,3': 'o', '2,4': 'A', '6,4': 'B' });
  expect(data.draft.cursor).toEqual({ col: 7, row: 4 });
  await page.keyboard.press('Backspace');
  await waitForSave(page);
  expect((await saved(page)).draft.cells['6,4']).toBeUndefined();
  await page.keyboard.press('ControlOrMeta+z');
  await waitForSave(page);
  expect((await saved(page)).draft.cells['6,4']).toBe('B');
  await clickCell(page, 2, 3);
  await page.keyboard.type('H');
  await waitForSave(page);
  await page.reload();
  await expect(page.locator('#grid-transcript')).toHaveValue(/Row 4, column 3: Hello/);
  expect((await saved(page)).draft.cells['2,3']).toBe('H');
  expect(errors).toEqual([]);
});

test('finish snapshots preserve appearance and open as copies, newest first', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-mode="dark"]').click();
  await clickCell(page, 1, 1);
  await page.keyboard.type('First');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('#history-count')).toHaveText('01');
  expect((await saved(page)).draft.cells).toEqual({});
  await page.locator('[data-mode="light"]').click();
  await clickCell(page, 0, 0);
  await page.keyboard.type('Second');
  await page.locator('#finish-grid').click();
  await expect(page.locator('.history-preview')).toHaveText(['Second', 'First']);
  await page.locator('.history-open').nth(1).click();
  await expect(page.locator('[data-mode="dark"]')).toHaveAttribute('aria-pressed', 'true');
  await clickCell(page, 1, 1);
  await page.keyboard.type('X');
  await waitForSave(page);
  const data = await saved(page);
  expect(data.draft.cells['1,1']).toBe('X');
  expect(data.history[1].cells['1,1']).toBe('F');
  await page.reload();
  await expect(page.locator('.history-preview')).toHaveText(['Second', 'First']);
});

test('custom colors persist, launcher collapses, and Escape leaves editing', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-mode="custom"]').click();
  await page.locator('#color-background').fill('#123456');
  await page.locator('#color-grid').fill('#abcdef');
  await page.locator('#color-text').fill('#ffffff');
  await waitForSave(page);
  await page.reload();
  await expect(page.locator('#color-background')).toHaveValue('#123456');
  expect(await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(18, 52, 86)');
  await page.locator('#toggle-launcher').click();
  await expect(page.locator('#launcher-panel')).toBeHidden();
  await clickCell(page, 0, 0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#toggle-launcher')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#launcher-panel')).toBeVisible();
});

test('multiline paste and composition commit characters once', async ({ page }) => {
  await page.goto('/');
  await clickCell(page, 2, 2);
  await page.keyboard.insertText('ab\ncd\te');
  await waitForSave(page);
  expect((await saved(page)).draft.cells).toMatchObject({ '2,2': 'a', '3,2': 'b', '2,3': 'c', '3,3': 'd', '7,3': 'e' });
  await page.locator('#grid-input').evaluate((el) => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el.value = '漢';
    el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: '漢' }));
  });
  await expect(page.locator('#grid-input')).toHaveClass('composing');
  await page.locator('#grid-input').evaluate((el) => {
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '漢' }));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: '漢' }));
  });
  await waitForSave(page);
  const data = await saved(page);
  expect(data.draft.cells['8,3']).toBe('漢');
  expect(data.draft.cursor).toEqual({ col: 9, row: 3 });
});

test('mobile viewport keeps margins and reveals cursor after keyboard-sized resize', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#launcher-panel')).toBeHidden();
  const frame = await page.locator('#grid-frame').boundingBox();
  expect(frame).toEqual({ x: 48, y: 64, width: 294, height: 716 });
  await clickCell(page, 2, 18);
  await page.keyboard.type('m');
  await page.setViewportSize({ width: 390, height: 440 });
  await expect.poll(() => page.locator('#grid-scroll').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await waitForSave(page);
  expect((await saved(page)).draft.cells['2,18']).toBe('m');
  await page.locator('#toggle-launcher').click();
  const panel = await page.locator('#launcher').boundingBox();
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.y).toBeGreaterThanOrEqual(0);
  expect(panel.y + panel.height).toBeLessThanOrEqual(440);
});

test('home and end navigation keys work correctly', async ({ page }) => {
  await page.goto('/');
  await clickCell(page, 2, 3);
  await page.keyboard.type('Hello');
  await waitForSave(page);
  // Cursor is now at column 7, row 3
  await page.keyboard.press('Home');
  // Cursor should be at column 0, row 3
  await waitForSave(page);
  let data = await saved(page);
  expect(data.draft.cursor).toEqual({ col: 0, row: 3 });
  
  await page.keyboard.press('End');
  // Cursor should be at column 6 (rightmost occupied cell), row 3
  await waitForSave(page);
  data = await saved(page);
  expect(data.draft.cursor).toEqual({ col: 6, row: 3 });
  
  // Test with empty row
  await clickCell(page, 2, 5);
  await page.keyboard.press('End');
  // Cursor should be at column 0 (empty row)
  await waitForSave(page);
  data = await saved(page);
  expect(data.draft.cursor).toEqual({ col: 0, row: 5 });
  
  await page.keyboard.press('Home');
  // Cursor should be at column 0
  await waitForSave(page);
  data = await saved(page);
  expect(data.draft.cursor).toEqual({ col: 0, row: 5 });
});

test('scrolling expands canvas without changing existing coordinates', async ({ page }) => {
  await page.goto('/');
  await clickCell(page, 0, 0);
  await page.keyboard.type('A');
  const before = await page.locator('#grid-extent').evaluate((el) => el.offsetHeight);
  await page.locator('#grid-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => page.locator('#grid-extent').evaluate((el) => el.offsetHeight)).toBeGreaterThan(before);
  await clickCell(page, 1, 1);
  await page.keyboard.type('B');
  await waitForSave(page);
  const cells = (await saved(page)).draft.cells;
  expect(cells['0,0']).toBe('A');
  expect(Object.values(cells)).toEqual(['A', 'B']);
  expect(Object.keys(cells)[1]).not.toBe('1,1');
});

test('storage failures remain usable and are not reported as saved', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  });
  await page.goto('/');
  await clickCell(page, 0, 0);
  await page.keyboard.type('Keep me');
  await expect(page.locator('#save-status')).toHaveText('Not saved — export a backup');
  await page.locator('#finish-grid').click();
  await expect(page.locator('.history-preview')).toHaveText('Keep me');
  await expect(page.locator('#toast')).toContainText('memory only');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-grids').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^calvin-grids-.*\.json$/);
});

test('concurrent changes keep the local draft in memory without overwriting remote storage', async ({ page }) => {
  await page.goto('/');
  await clickCell(page, 0, 0);
  await waitForSave(page);
  await page.evaluate((storageKey) => {
    const input = document.querySelector('#grid-input');
    input.value = 'Local';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'Local' }));
    const oldValue = localStorage.getItem(storageKey);
    const remote = JSON.parse(oldValue);
    remote.draft.cells = { '0,0': 'R' };
    const newValue = JSON.stringify(remote);
    localStorage.setItem(storageKey, newValue);
    window.dispatchEvent(new StorageEvent('storage', { key: storageKey, oldValue, newValue }));
  }, key);
  await expect(page.locator('#save-status')).toHaveText('Changed in another tab — export, then reload');
  await expect(page.locator('#grid-transcript')).toHaveValue('Row 1, column 1: Local');
  expect((await saved(page)).draft.cells).toEqual({ '0,0': 'R' });
  await page.locator('#finish-grid').click();
  await expect(page.locator('.history-preview')).toHaveText('Local');
  expect((await saved(page)).history).toEqual([]);
});

test('an idle second tab receives finished grids and cannot erase them when closed', async ({ page, context }) => {
  await page.goto('/');
  const second = await context.newPage();
  await second.goto('/');
  await page.bringToFront();
  await clickCell(page, 0, 0);
  await page.keyboard.type('Shared');
  await page.locator('#finish-grid').click();
  await second.bringToFront();
  await expect(second.locator('.history-preview')).toHaveText('Shared');
  await second.close();
  await page.bringToFront();
  await page.reload();
  await expect(page.locator('.history-preview')).toHaveText('Shared');
});