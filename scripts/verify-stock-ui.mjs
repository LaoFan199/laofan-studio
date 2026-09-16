// Local fixture-only browser verification. Never authenticates or writes cloud data.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const runtime = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const { chromium } = runtime ? await import(`${runtime}/playwright/index.mjs`) : await import('playwright');
let launchOptions = { headless: true };
if (process.env.CHROMIUM_MODULE) {
  const { default: bundled } = await import(process.env.CHROMIUM_MODULE);
  launchOptions = { ...launchOptions, executablePath: process.env.CHROMIUM_EXECUTABLE || await bundled.executablePath(),
    args: bundled.args.filter(arg => !['--single-process', '--disable-web-security', '--allow-running-insecure-content'].includes(arg)) };
}
const browser = await chromium.launch(launchOptions);
const server = process.env.UI_BASE_URL ? null : spawn(process.execPath, ['scripts/serve.mjs'], { stdio: ['ignore', 'pipe', 'inherit'] });
if (server) await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => { throw new Error('Preview server exited'); })]);
const output = process.env.UI_SCREENSHOT_DIR || '/tmp/laofan-v2-ui';
await mkdir(output, { recursive: true });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (process.env.UI_FONT_DIR) await page.route('**/__qa-fonts/**', async route => {
      const relative = new URL(route.request().url()).pathname.split('/__qa-fonts/')[1];
      if (!relative || relative.includes('..')) return route.abort();
      await route.fulfill({ body: await readFile(`${process.env.UI_FONT_DIR}/${relative}`), contentType: relative.endsWith('.css') ? 'text/css' : 'font/woff2' });
    });
    const fixture = { cash: 750, realized: 0, positions: {
      KO: { quantity: 2, avgPrice: 100, lastPrice: 90 },
      MSFT: { quantity: .5, avgPrice: 100, lastPrice: 100 }
    }, history: [], snapshots: [], benchmark: null };
    await page.route('**/stock-ai/cloud-sync.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      export const accountSync = { initial: ${JSON.stringify(fixture)}, settings: {}, blocked: false,
        save(state) { window.__saved = structuredClone(state); }, async flush() { return true; } };
    ` }));
    await page.route('**/stock-ai/auth.bundle.js*', route => route.fulfill({ contentType: 'text/javascript', body: `
      await import('./app.js'); const root=document.getElementById('app-root'); root.hidden=false; root.inert=false;
      document.getElementById('auth-status').textContent='本地测试 · 合成数据';
    ` }));
    let offline = false, closed = false;
    await page.route('https://laofan-studio.vercel.app/api/**', async route => {
      const url = new URL(route.request().url()), now = new Date().toISOString();
      let json = { status: 'unavailable', reason: '隔离测试，不连接实际服务', items: [], candidates: [] };
      if (url.pathname === '/api/market' && url.searchParams.get('mode') === 'sell-advice') {
        json = offline ? {} : { version: 'holding-exit-v1-advisory', fetchedAt: now, marketIsOpen: !closed, items: {
          KO: { status: 'available', recommend: true, reasons: ['最近完整交易日收盘价跌破200日均线'], price: 90, quoteAt: now, signalDate: '2026-09-14', metrics: { close: 90, sma200: 100 } },
          MSFT: { status: 'available', recommend: false, reasons: ['尚未触发50日 / 200日趋势退出条件'], price: 100, quoteAt: now, signalDate: '2026-09-14' }
        } };
      } else if (url.pathname === '/api/market') {
        json = { fetchedAt: now, source: 'Synthetic UI fixture', market: { isOpen: true }, marketChart: [],
          quotes: Object.fromEntries(['KO', 'MSFT', 'GOOGL', 'NVDA', 'SCHD', 'SPY'].map(s => [s, { price: s === 'KO' ? 90 : 100, timestamp: now,
            analysis: { score: 85, risk: '中等', reasons: ['测试数据'], confidence: '高', factors: [] } }])),
          v2: { version: 'growth-trend-v2.0-research', fetchedAt: now, source: '本地合成数据', regime: { label: '强势', maxExposure: .8, signalDate: '2026-09-14' } } };
      }
      await route.fulfill({ json, headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:8877' } });
    });
    await page.goto(process.env.UI_BASE_URL || 'http://127.0.0.1:8877/stock-ai/');
    await page.locator('#app-root').waitFor({ state: 'visible' });
    if (process.env.UI_FONT_DIR) {
      await page.addStyleTag({ url: 'http://127.0.0.1:8877/__qa-fonts/400.css' });
      await page.addStyleTag({ content: ':root { font-family: "Noto Sans SC", sans-serif; }' });
      await page.evaluate(() => document.fonts.ready);
    }
    await page.waitForFunction(() => document.querySelector('[data-suggested-sell="KO"]')?.disabled === false);
    assert.equal(await page.locator('#v2-start').isDisabled(), true);
    assert.equal(await page.locator('[data-suggested-sell="MSFT"]').isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('.v2-panel').screenshot({ path: `${output}/v2-${width}.png` });
    await page.waitForFunction(() => document.querySelector('#financial-symbol option'));
    await page.locator('#financial-symbol').selectOption('MSFT');
    assert.ok((await page.locator('#financial-rows').textContent()).includes('全年'));
    const captureStyle = await page.addStyleTag({content:'header { position: static !important; }'});
    await page.locator('#financial-panel').screenshot({ path: `${output}/financial-${width}.png` });
    await captureStyle.evaluate(el => el.remove());
    await page.locator('#financial-symbol').selectOption('CCJ');
    assert.ok((await page.locator('#financial-status').textContent()).includes('暂无可展示数据'));
    assert.equal(await page.locator('#v2-start').isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('#positions').scrollIntoViewIfNeeded();
    const a = await page.locator('[data-suggested-sell="KO"]').boundingBox(), b = await page.locator('[data-sell="KO"]').boundingBox();
    assert.ok(Math.abs(a.y - b.y) < 2, 'both buttons must be side by side');
    await page.locator('#positions').screenshot({ path: `${output}/holdings-${width}.png` });
    await page.locator('[data-suggested-sell="KO"]').click();
    await page.locator('#sell-advice-cancel').click();
    assert.equal(await page.evaluate(() => window.__saved.positions.KO.quantity), 2);
    assert.equal(await page.evaluate(() => window.__saved.history.length), 0);
    await page.locator('[data-suggested-sell="KO"]').click();
    await page.locator('#sell-advice-dialog').screenshot({ path: `${output}/sell-dialog-${width}.png` });
    await page.locator('#sell-advice-confirm').click();
    await page.waitForFunction(() => !window.__saved.positions.KO);
    const saved = await page.evaluate(() => window.__saved);
    assert.equal(saved.cash, 930); assert.equal(saved.realized, -20); assert.equal(saved.history.length, 1);
    assert.equal(saved.history[0].exitSignal.version, 'holding-exit-v1-advisory');
    assert.equal(saved.cash + saved.positions.MSFT.quantity * 100, 980);
    // Re-enter only the isolated fixture, then exercise market-closed and API-loss states.
    closed = true;
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-suggested-sell="KO"]')?.disabled === false);
    await page.locator('[data-suggested-sell="KO"]').click();
    assert.equal(await page.locator('#sell-advice-confirm').isDisabled(), true);
    await page.locator('#sell-advice-close').click();
    await page.route('**/data/financials.json', route => route.fulfill({status:503,body:'Unavailable'}));
    offline = true; await page.reload();
    await page.waitForFunction(() => document.querySelector('#financial-status').textContent.includes('加载失败'));
    assert.equal(await page.locator('#financial-rows').textContent(), '');

    await page.locator('#app-root').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-suggested-sell="KO"]').isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log(`${width}px: side-by-side buttons, cancel, confirmed sale, ledger, closed market, missing data, no overflow or page errors passed.`);
    await context.close();
  }
} finally { await browser.close(); server?.kill(); }
