import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoreResearch, CORE_SYMBOLS, selectedToday } from '../stock-ai/core-research.js';
import { analyzeBars } from '../api/market.js';
import { DYNAMIC_UNIVERSE } from '../api/dynamic-strategy.js';

test('core watchlist retains all seven even with missing or below-threshold data', () => {
  const bars = Array.from({ length: 90 }, (_, i) => ({ c: 100 + i, v: 1000000, t: '2026-09-11T04:00:00Z' }));
  const analysis = { ...analyzeBars(bars, bars), score: 72 };
  const inputs = [{ symbol: 'NVDA', price: 189, bars, analysis }];
  const before = JSON.stringify(inputs);
  const result = buildCoreResearch(inputs);
  assert.deepEqual(result.map(x => x.symbol), CORE_SYMBOLS);
  assert.equal(result[0].analysis, analysis);
  assert.equal(result[0].price, 189);
  assert.equal(result[0].name, 'NVIDIA');
  assert.equal(result[1].price, null);
  assert.ok(result[0].reasons.includes('未达到75分门槛'));
  assert.equal(result[1].analysis, null);
  assert.equal(JSON.stringify(inputs), before);
  assert.ok(!DYNAMIC_UNIVERSE.includes('ETN'));
});

test('core watchlist distinguishes passing score from daily candidate membership', () => {
  const bars = Array.from({ length: 61 }, () => ({ c: 100, v: 1000000 }));
  const item = buildCoreResearch([{ symbol: 'ETN', price: 100, bars, analysis: { score: 75 } }])[2];
  assert.match(item.reasons.join(''), /仍需每日候选筛选/);
  const missing = buildCoreResearch([{ symbol: 'NVDA', bars, analysis: { score: null } }]);
  assert.equal(missing[0].analysis, null);
});

test('research endpoint returns unfiltered scores using the existing analyzer', async () => {
  const { default: handler } = await import('../api/core-research.js');
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.ALPACA_API_KEY, oldSecret = process.env.ALPACA_SECRET_KEY;
  const bars = Array.from({ length: 90 }, (_, i) => ({ c: 100 + i, v: 1000000, t: '2026-09-11T04:00:00Z' }));
  process.env.ALPACA_API_KEY = 'test'; process.env.ALPACA_SECRET_KEY = 'test';
  globalThis.fetch = async (url) => ({ ok: true, json: async () => url.includes('/clock') ? { is_open: false }
    : url.includes('/bars?') ? { bars: Object.fromEntries([...CORE_SYMBOLS, 'SPY'].map(s => [s, bars])) }
    : Object.fromEntries(CORE_SYMBOLS.map(s => [s, { latestTrade: { p: 189 }, prevDailyBar: { c: 188 } }])) });
  let result, status;
  const res = { setHeader() {}, status(code) { status = code; return this; }, json(data) { result = data; } };
  try {
    await handler({ method: 'GET', headers: {} }, res);
    assert.equal(status, 200);
    assert.deepEqual(result.items.map(x => x.symbol), CORE_SYMBOLS);
    assert.deepEqual(result.items[0].analysis, analyzeBars(bars, bars));
    globalThis.fetch = async () => { throw new Error('offline'); };
    await handler({ method: 'GET', headers: {} }, res);
    assert.equal(status, 502);
    assert.equal(result.status, 'unavailable');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.ALPACA_API_KEY; else process.env.ALPACA_API_KEY = oldKey;
    if (oldSecret === undefined) delete process.env.ALPACA_SECRET_KEY; else process.env.ALPACA_SECRET_KEY = oldSecret;
  }
});

test('selection badge reads candidate membership without mutating rankings', () => {
  const dynamic = { status: 'available', fetchedAt: new Date().toISOString(), candidates: [{ symbol: 'VRT', rank: 3 }, { symbol: 'NVDA', rank: 7 }] };
  const before = JSON.stringify(dynamic);
  assert.equal(selectedToday('VRT', [], dynamic), true);
  assert.equal(selectedToday('ETN', [], dynamic), false);
  assert.equal(selectedToday('NVDA', ['NVDA']), true);
  assert.equal(selectedToday('VRT', [], { ...dynamic, status: 'unavailable' }), false);
  assert.equal(selectedToday('VRT', [], { ...dynamic, fetchedAt: '2020-01-01' }), false);
  assert.equal(JSON.stringify(dynamic), before);
});
