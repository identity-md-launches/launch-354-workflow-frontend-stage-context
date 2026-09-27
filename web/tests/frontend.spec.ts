import { test, expect } from '@playwright/test';
import { decodeFunctionData } from 'viem';
import { mockChain, deployment } from './harness';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const enter = async (page: import('@playwright/test').Page, value = '0.01') => {
  await expect(page.getByText(/Read at block/)).toBeVisible();
  await page.getByLabel('You pay').fill(value);
  await expect(page.getByText(/Quote at block/)).toBeVisible();
};
const connect = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByRole('button', { name: /Disconnect/ })).toBeVisible();
};
test('public reads, typed bonus, events and relative assets render without wallet', async ({ page }) => {
  await mockChain(page, { wallet: false });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('./'); await enter(page);
  await expect(page.locator('.pot-value')).toContainText('0.01');
  await expect(page.locator('.bonus-preview')).toContainText('0.0001 ETH');
  await expect(page.locator('.market-price')).toContainText('1,000,000 ONEW');
  await expect(page.locator('.event-list li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByRole('alert')).toContainText('No browser wallet found');
  expect(errors).toEqual([]);
});
test('unknown chain is added with exact handoff data, then switched', async ({ page }) => {
  const { calls } = await mockChain(page, { wrongChain: true });
  await page.goto('./'); await connect(page);
  await expect(page.getByText('Your wallet is on another network.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to Sepolia', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review buy', exact: true })).toBeVisible();
  const steps = calls.filter(c => c.method.startsWith('wallet_'));
  expect(steps.map(c => c.method)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
  expect(steps[1].params).toEqual([deployment.walletAddChain]);
  expect(calls.filter(c => c.method === 'eth_sendTransaction')).toHaveLength(0);
});
test('buy simulates the required router with exact input, native value and a price limit before signing', async ({ page }) => {
  const { calls, abis } = await mockChain(page);
  await page.goto('./'); await connect(page); await enter(page);
  await page.getByRole('button', { name: 'Review buy', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Review swap' })).toContainText('Pay 0.01 ETH');
  await page.getByRole('button', { name: 'Confirm buy', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Swap confirmed' })).toBeVisible();
  const sends = calls.filter(c => c.method === 'eth_sendTransaction');
  expect(sends).toHaveLength(1);
  const tx = sends[0].params[0];
  expect(tx.to.toLowerCase()).toBe(deployment.integration.poolSwapTest);
  expect(BigInt(tx.value)).toBe(10n ** 16n);
  const decoded = decodeFunctionData({ abi: abis.get(tx.to.toLowerCase())!, data: tx.data });
  expect(decoded.functionName).toBe('swap');
  const args = decoded.args as any[];
  expect(args[0].hooks.toLowerCase()).toBe(deployment.contracts.find((c: any) => c.name === 'AsymmetricTaxHook').address);
  expect(args[1].zeroForOne).toBe(true); expect(args[1].amountSpecified).toBe(-(10n ** 16n));
  expect(args[1].sqrtPriceLimitX96).toBeLessThan(1000n * (1n << 96n));
  expect(args[2]).toEqual({ takeClaims: false, settleUsingBurn: false });
  expect(args[3]).toBe('0x');
  const beforeSend = calls.slice(0, calls.indexOf(sends[0]));
  expect(beforeSend.some(c => c.method === 'eth_call' && c.params[0].to.toLowerCase() === tx.to.toLowerCase())).toBeTruthy();
  await page.screenshot({ path: '../docs/frontend/desktop-connected.png', fullPage: true });
});
test('sell approval is a separate exact-amount router approval, followed by a native-output swap', async ({ page }) => {
  const { calls, abis, token } = await mockChain(page);
  await page.goto('./'); await connect(page);
  await page.getByRole('button', { name: 'Sell ONEW', exact: true }).click(); await enter(page, '100');
  await page.getByRole('button', { name: 'Approve ONEW', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Approval confirmed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review sell', exact: true })).toBeEnabled();
  expect(calls.filter(c => c.method === 'eth_sendTransaction')).toHaveLength(1);
  await page.getByRole('button', { name: 'Review sell', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm sell', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Swap confirmed' })).toBeVisible();
  const sends = calls.filter(c => c.method === 'eth_sendTransaction');
  expect(sends).toHaveLength(2);
  const approve = decodeFunctionData({ abi: abis.get(token.address)!, data: sends[0].params[0].data });
  expect(approve.functionName).toBe('approve');
  expect(String(approve.args![0]).toLowerCase()).toBe(deployment.integration.poolSwapTest);
  expect(approve.args![1]).toBe(100n * 10n ** 18n);
  expect(BigInt(sends[1].params[0].value || 0)).toBe(0n);
  const sell = decodeFunctionData({ abi: abis.get(deployment.integration.poolSwapTest)!, data: sends[1].params[0].data });
  expect((sell.args![1] as any).zeroForOne).toBe(false);
});
test('simulation failure prevents signing and explains partial-fill recovery', async ({ page }) => {
  const { calls } = await mockChain(page, { swapFail: true });
  await page.goto('./'); await connect(page); await enter(page);
  await page.getByRole('button', { name: 'Review buy', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm buy', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('partial fill');
  expect(calls.filter(c => c.method === 'eth_sendTransaction')).toHaveLength(0);
});
test('wallet rejection has a recoverable message', async ({ page }) => {
  await mockChain(page, { rejection: true }); await page.goto('./');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByRole('alert')).toContainText('Request declined');
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).first()).toBeEnabled();
});
test('missing code blocks trading', async ({ page }) => {
  const { calls } = await mockChain(page, { codeMissing: true }); await page.goto('./'); await connect(page);
  await expect(page.getByRole('alert')).toContainText('no code');
  await page.getByLabel('You pay').fill('0.01');
  await expect(page.getByRole('button', { name: 'Review buy', exact: true })).toBeDisabled();
  expect(calls.filter(c => c.method === 'eth_sendTransaction')).toHaveLength(0);
});
test('quote errors retain the independent typed bonus and prevent trades', async ({ page }) => {
  await mockChain(page, { quoteFail: true }); await page.goto('./'); await connect(page);
  await expect(page.getByText(/Read at block/)).toBeVisible(); await page.getByLabel('You pay').fill('0.01');
  await expect(page.getByRole('alert')).toContainText('Quote unavailable');
  await expect(page.locator('.bonus-preview')).toContainText('0.0001 ETH');
  await expect(page.getByRole('button', { name: 'Review buy', exact: true })).toBeDisabled();
});
test('amount validation, insufficient balance, edits and account changes invalidate review', async ({ page }) => {
  await mockChain(page); await page.goto('./'); await connect(page); await enter(page);
  await page.getByRole('button', { name: 'Review buy', exact: true }).click();
  await page.getByLabel('You pay').fill('0.02');
  await expect(page.getByRole('button', { name: 'Confirm buy', exact: true })).toHaveCount(0);
  await page.getByLabel('You pay').fill('-1'); await expect(page.locator('#amount-help')).toContainText('positive amount');
  await expect(page.getByRole('button', { name: 'Review buy', exact: true })).toBeDisabled();
  await page.getByLabel('You pay').fill('99999'); await expect(page.locator('#amount-help')).toContainText('Insufficient');
  await enter(page); await page.getByRole('button', { name: 'Review buy', exact: true }).click();
  await page.evaluate(() => (window as any).ethereum.emit('accountsChanged', []));
  await expect(page.getByRole('button', { name: 'Confirm buy', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).first()).toBeVisible();
});
test('ABI tampering fails closed before any RPC action', async ({ page }) => {
  const { calls } = await mockChain(page);
  await page.route('**/abi/ONEW.json', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.goto('./'); await expect(page.getByRole('alert')).toContainText('ABI verification failed');
  expect(calls).toHaveLength(0);
});
test('desktop, tablet, 320px reflow, keyboard, reduced motion and accessibility', async ({ page }) => {
  await mockChain(page); await page.goto('./'); await enter(page);
  await page.addScriptTag({ path: resolve('node_modules/axe-core/axe.min.js') });
  const results = await page.evaluate(async () => (window as any).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] } }));
  writeFileSync('../docs/frontend/accessibility-results.json', JSON.stringify({ checkedAt: new Date().toISOString(), engine: results.testEngine, tags: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'], passes: results.passes.length, violations: results.violations, incomplete: results.incomplete.map((v: any) => ({ id: v.id, description: v.description, nodes: v.nodes.map((n: any) => ({ target: n.target, summary: n.failureSummary })) })) }, null, 2) + '\n');
  expect(results.violations.map((v: any) => ({ id: v.id, targets: v.nodes.map((n: any) => n.target) }))).toEqual([]);
  for (const width of [1440, 820, 680, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByLabel('You pay')).toBeVisible();
    if (width === 320) await page.screenshot({ path: '../docs/frontend/mobile-320.png', fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.keyboard.press('Control+Home');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Tab'); await expect(page.locator('.skip')).toBeFocused();
  await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Refresh pool data' })).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.getByRole('button', { name: 'Refresh pool data' }).evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  await page.locator('html').evaluate(el => { el.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('expired quote cannot be confirmed and a fresh quote restores the review action', async ({ page }) => {
  const { calls } = await mockChain(page); await page.goto('./'); await connect(page); await enter(page);
  await page.getByRole('button', { name: 'Review buy', exact: true }).click();
  await page.evaluate(() => { (window as any).originalNow = Date.now; const current = Date.now(); Date.now = () => current + 60000; });
  await expect(page.getByRole('button', { name: 'Confirm buy', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review buy', exact: true })).toBeDisabled();
  expect(calls.filter(c => c.method === 'eth_sendTransaction')).toHaveLength(0);
  await page.evaluate(() => { Date.now = (window as any).originalNow; });
  await page.getByRole('button', { name: 'Refresh quote', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review buy', exact: true })).toBeEnabled();
});
test('RPC outage is visible and disables dependent actions', async ({ page }) => {
  await mockChain(page, { readFail: true, wallet: false }); await page.goto('./');
  await expect(page.getByRole('alert')).toContainText('Check your connection and use Refresh pool data to retry');
  await page.getByLabel('You pay').fill('0.01');
  await expect(page.getByRole('button', { name: 'Refresh quote', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Refresh pool data', exact: true })).toBeEnabled();
});
