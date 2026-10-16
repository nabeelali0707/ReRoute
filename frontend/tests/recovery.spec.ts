import { test, expect, type Page } from '@playwright/test';

const watchErrors = (page: Page) => { const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); return errors; };
async function openCase(page: Page, title: string) {
  await page.goto('/#recovery');
  await page.getByRole('listitem').filter({ hasText: title }).click();
  await expect(page.getByRole('heading', { name: title, level: 2 })).toBeVisible();
}

test('reject, replan, withdrawal guard, automatic re-plan and verified request', async ({ page, request }) => {
  const errors = watchErrors(page);
  const created = await (await request.post('/api/cases', { data: { title: `Adapters ${Date.now()}` } })).json();
  await openCase(page, created.title);
  await page.getByRole('button', { name: 'Run investigation' }).click();
  await expect(page.getByRole('radio', { name: 'Choose Atlas Components' })).toBeChecked();

  // Human redirects the plan: reject the cheapest supplier with a reason.
  await page.getByRole('button', { name: 'Reject Atlas Components' }).click();
  await expect(page.getByText('Rejection pending')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve plan' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Instructions for your agents' }).fill('Atlas failed our last two compatibility audits.');
  await page.getByRole('button', { name: 'Revise & replan' }).click();
  await expect(page.getByRole('radio', { name: 'Choose Northstar Industrial' })).toBeChecked();
  await expect(page.getByRole('region', { name: 'How this plan evolved' })).toContainText('Atlas failed our last two compatibility audits.');

  // Supplier withdraws before approval: the execution guard must catch it and re-plan.
  await page.getByText('Demo scenario controls').click();
  await page.getByRole('button', { name: 'Withdraw Northstar Industrial' }).click();
  await page.getByRole('button', { name: 'Approve plan' }).click();
  await expect(page.getByText('Northstar Industrial can no longer fulfil this plan')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Choose Crescent Tech Traders' })).toBeChecked();
  await expect(page.getByRole('region', { name: 'How this plan evolved' })).toContainText('Invalidated');

  await page.getByRole('button', { name: 'Approve plan' }).click();
  await expect(page.getByText('Recovery request verified.')).toBeVisible();
  await expect(page.getByText(/PKR 160,000 · Saved as a draft/)).toBeVisible();
  await page.screenshot({ path: 'test-results/recovery-verified.png', fullPage: true });

  // Persistence, report and evidence.
  await page.reload();
  await page.getByRole('listitem').filter({ hasText: created.title }).click();
  await expect(page.getByText('Recovery request verified.')).toBeVisible();
  await page.getByRole('tab', { name: /Source evidence/ }).click();
  await expect(page.getByText('QT-1045', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Recovery report' }).click();
  const report = page.getByRole('dialog', { name: 'Recovery report' });
  await expect(report).toContainText('Options compared');
  await expect(report).toContainText('Invalidated');
  await report.getByRole('button', { name: 'Close report' }).click();
  expect(errors).toEqual([]);
});

test('risk radar: analyst, map, start recovery, ask and report disruption', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'See trouble before it arrives.' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'High risk orders' }).getByRole('row', { name: /PO-2401/ })).toBeVisible();
  await page.getByRole('button', { name: /Run AI risk analysis|Refresh rule-based analysis/ }).click();
  await expect(page.getByRole('region', { name: 'AI risk analyst' }).locator('.priority').first()).toContainText('PO-2401');
  await page.locator('.map path[aria-label="China"]').click();
  await expect(page.locator('.country-card')).toContainText('SIG-11');
  await page.screenshot({ path: 'test-results/radar.png', fullPage: true });

  await page.getByRole('button', { name: /(Start recovery|Open RR-\w+) for PO-2402/ }).click();
  await expect(page.getByRole('heading', { name: /Temperature sensor at risk \(PO-2402\)/, level: 2 })).toBeVisible();
  const run = page.getByRole('button', { name: 'Run investigation' });
  if (await run.isVisible()) await run.click();
  await expect(page.getByRole('radio').first()).toBeVisible();

  await page.getByRole('link', { name: 'Ask ReRoute' }).click();
  await page.getByRole('textbox', { name: 'Message ReRoute' }).fill('Which orders are at risk?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.msg:not(.msg--me) .bubble').last()).toContainText('PO-2401');
  await expect(page.getByRole('button', { name: /PO-2401/ }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/ask.png', fullPage: true });

  await page.getByRole('button', { name: 'Report disruption' }).click();
  const form = page.getByRole('dialog', { name: 'Report disruption' });
  await form.getByRole('combobox').selectOption('PO-2407');
  await form.getByRole('textbox', { name: 'Title' }).fill('PLC modules held at Pune');
  await form.getByRole('button', { name: 'Report disruption' }).click();
  await expect(page.getByRole('heading', { name: 'PLC modules held at Pune', level: 2 })).toBeVisible();
  await expect(page.getByText('Needs investigation.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('agent flow, suppliers and connections', async ({ page, request }) => {
  const errors = watchErrors(page);
  const created = await (await request.post('/api/cases', { data: { title: `Flow ${Date.now()}` } })).json();
  await request.post(`/api/cases/${created.id}/investigate`);
  await page.goto('/#flow');
  await page.getByRole('listitem').filter({ hasText: created.title }).click();
  const flow = page.getByRole('region', { name: 'Agent flow' });
  await expect(flow.getByText('Sourcing agent', { exact: true })).toBeVisible();
  await flow.getByRole('button', { name: 'Show output' }).nth(2).click();
  await expect(flow.locator('.output')).toBeVisible();
  await page.screenshot({ path: 'test-results/flow.png', fullPage: true });

  await page.getByRole('link', { name: 'Suppliers' }).click();
  await expect(page.getByText('Crescent Tech Traders').first()).toBeVisible();
  await page.getByRole('tab', { name: 'List' }).click();
  await expect(page.getByRole('table')).toContainText('QT-1045');

  await page.getByRole('link', { name: 'Connections' }).click();
  await page.getByRole('button', { name: 'Run connection check' }).click();
  await expect(page.getByLabel('Connection check results')).toContainText('Demo mode');
  await page.getByRole('button', { name: 'How ReRoute works' }).click();
  await expect(page.getByRole('dialog', { name: 'How ReRoute works' })).toContainText('Approve and verify');
  expect(errors).toEqual([]);
});

test('mobile layout has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const hash of ['radar', 'recovery', 'ask']) {
    await page.goto(`/#${hash}`);
    await page.locator('h1').waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  }
  await page.goto('/');
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});
