import { test, expect } from '@playwright/test';

test('operator changes constraints, approves and verifies a request', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const seed = await request.post('/api/cases', { data: { title: `Browser recovery ${Date.now()}` } });
  const created = await seed.json();
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(created.title) }).click();
  await page.getByRole('button', { name: 'Start investigation', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Select Atlas Components' })).toBeChecked();
  await page.getByRole('checkbox', { name: /Require certified compatibility/ }).check();
  await page.getByRole('textbox', { name: 'Instructions for your agents' }).fill('This lab requires certified components. Exclude unverified substitutes.');
  await page.getByRole('button', { name: 'Revise & replan' }).click();
  await expect(page.getByRole('radio', { name: 'Select Northstar Industrial' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Select Atlas Components' })).toBeDisabled();
  await page.screenshot({ path: 'test-results/desktop-review.png', fullPage: true });
  await page.getByRole('button', { name: 'Approve recovery plan' }).click();
  await page.getByRole('button', { name: 'Execute approved plan' }).click();
  await expect(page.getByRole('heading', { name: 'Recovery request verified.' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: new RegExp(created.title) }).click();
  await expect(page.getByRole('heading', { name: 'Recovery request verified.' })).toBeVisible();
  await page.getByRole('button', { name: 'Source evidence', exact: true }).click();
  await expect(page.getByText('QT-1042', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect(page.getByText('Local demo adapter', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run connection check' }).click();
  await expect(page.getByRole('list', { name: 'Connection check results' }).getByText('Demo mode')).toBeVisible();
  expect(errors).toEqual([]);
});

test('reviewer rejects a supplier, then a withdrawal triggers automatic re-planning', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const created = await (await request.post('/api/cases', { data: { title: `Rejection flow ${Date.now()}` } })).json();
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(created.title) }).click();
  await page.getByRole('button', { name: 'Start investigation', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Select Atlas Components' })).toBeChecked();
  await page.getByRole('button', { name: 'Reject Atlas Components' }).click();
  await expect(page.getByText('Rejection pending — replan to apply')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve recovery plan' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Instructions for your agents' }).fill('Atlas failed our last two compatibility audits.');
  await page.getByRole('button', { name: 'Revise & replan' }).click();
  await expect(page.getByRole('radio', { name: 'Select Northstar Industrial' })).toBeChecked();
  const history = page.getByRole('region', { name: 'Decision history' });
  await expect(history.getByText('Atlas Components')).toBeVisible();
  await page.getByRole('button', { name: 'Approve recovery plan' }).click();
  await expect(page.getByRole('button', { name: 'Execute approved plan' })).toBeVisible();
  // Northstar withdraws after approval; execution must catch it and re-plan.
  await page.getByText('Demo scenario controls').click();
  await page.getByRole('button', { name: 'Withdraw recommended supplier' }).click();
  await expect(page.getByText('Synthetic withdrawal recorded.')).toBeVisible();
  await page.getByRole('button', { name: 'Execute approved plan' }).click();
  await expect(page.getByText('Northstar Industrial can no longer fulfil this plan')).toBeVisible();
  await expect(history.getByText(/Invalidated/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recovery request verified.' })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Select Crescent Tech Traders' })).toBeChecked();
  await page.screenshot({ path: 'test-results/replan-alert.png', fullPage: true });
  await page.getByRole('button', { name: 'Approve recovery plan' }).click();
  await page.getByRole('button', { name: 'Execute approved plan' }).click();
  await expect(page.getByRole('heading', { name: 'Recovery request verified.' })).toBeVisible();
  await expect(page.getByText(/PKR 160,000/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile layout and case creation are usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Report disruption', exact: true }).click();
  await page.getByRole('textbox', { name: 'Case title', exact: true }).fill('Mobile supplier disruption');
  await page.getByRole('button', { name: 'Create recovery case' }).click();
  await expect(page.getByRole('heading', { name: 'Mobile supplier disruption', exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: 'test-results/mobile-workspace.png', fullPage: true });
});
