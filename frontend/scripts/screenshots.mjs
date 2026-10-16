// Captures every ReRoute screen from a running instance.
//   node scripts/screenshots.mjs <base-url> <app-token> <output-folder>
import { chromium } from '@playwright/test';
import path from 'node:path';

const [base = 'http://127.0.0.1:8000', token = '', out = '.'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
const shot = async (page, name, fullPage = true) => { await page.waitForTimeout(800); await page.screenshot({ path: path.join(out, name), fullPage }); console.log('saved', name); };

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(t => { sessionStorage.setItem('reroute-token', t); }, token);
const page = await context.newPage();
await page.goto(`${base}/#radar`);
await page.getByRole('heading', { name: 'See trouble before it arrives.' }).waitFor();
await shot(page, '01 Risk radar.png');

await page.goto(`${base}/#recovery`);
await page.locator('h1').waitFor();
const run = page.getByRole('button', { name: 'Run investigation' });
if (await run.isVisible()) { await run.click(); await page.getByRole('tab', { name: /Recovery options/ }).waitFor({ timeout: 120000 }); }
await shot(page, '02 Recovery.png');
if (await page.getByRole('tab', { name: /Source evidence/ }).isVisible()) {
  await page.getByRole('tab', { name: /Source evidence/ }).click();
  await shot(page, '03 Source evidence.png');
  await page.getByRole('button', { name: 'Recovery report' }).click();
  await page.getByRole('dialog', { name: 'Recovery report' }).waitFor();
  await shot(page, '04 Recovery report.png', false);
  await page.getByRole('button', { name: 'Close report' }).click();
}

await page.goto(`${base}/#ask`);
await page.getByRole('textbox', { name: 'Message ReRoute' }).fill('Which orders should I act on first, and which countries are causing the risk?');
await page.getByRole('button', { name: 'Send', exact: true }).click();
await page.locator('.typing').waitFor({ state: 'detached', timeout: 120000 });
await shot(page, '05 Ask ReRoute.png');

for (const [hash, name] of [['flow', '06 Agent flow.png'], ['suppliers', '07 Suppliers.png'], ['connections', '08 Connections.png']]) {
  await page.goto(`${base}/#${hash}`); await page.locator('h1').waitFor(); await shot(page, name);
}
await page.goto(`${base}/#radar`);
await page.getByRole('button', { name: 'Report disruption' }).click();
await shot(page, '09 Report disruption.png', false);
await context.close();

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
await mobile.addInitScript(t => { sessionStorage.setItem('reroute-token', t); }, token);
const phone = await mobile.newPage();
await phone.goto(`${base}/#radar`);
await phone.getByRole('heading', { name: 'See trouble before it arrives.' }).waitFor();
await shot(phone, '10 Mobile risk radar.png');
await browser.close();
