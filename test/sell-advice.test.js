import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSellAdvice, sellAdviceState, SELL_ADVICE_VERSION } from '../stock-ai/sell-advice.js';
import service from '../stock-ai/sell-advice-service.js';

const now = new Date('2026-09-15T15:00:00Z');
function history(last = 110) {
  const dates = []; let date = new Date('2026-09-14T20:00:00Z');
  while (dates.length < 220) { if (![0, 6].includes(date.getUTCDay())) dates.unshift(date.toISOString()); date.setUTCDate(date.getUTCDate() - 1); }
  return dates.map((t, i) => ({ t, c: i < 218 ? 100 : last }));
}
const payload = () => ({ version: SELL_ADVICE_VERSION, fetchedAt: now.toISOString(), marketIsOpen: true,
  items: { KO: { ...analyzeSellAdvice(history(90), now), price: 90, quoteAt: now.toISOString() } } });

test('held stock advice activates only on specified complete-session exit rules', () => {
  const weak = analyzeSellAdvice(history(90), now); assert.equal(weak.recommend, true); assert.equal(weak.reasons.length, 2); assert.equal(weak.signalDate, '2026-09-14');
  const strong = analyzeSellAdvice(history(), now); assert.equal(strong.recommend, false);
  assert.equal(analyzeSellAdvice(history(100), now).recommend, false);
  const today = [...history(), { t: '2026-09-15T14:00:00Z', c: 1 }];
  assert.equal(analyzeSellAdvice(today, now).recommend, false);
  assert.equal(analyzeSellAdvice(history().slice(-200), now).status, 'unavailable');
});
test('bad/stale daily data does not trigger advice or infer a safe hold', () => {
  const b = history(90); b[30].c = null; assert.equal(analyzeSellAdvice(b, now).status, 'unavailable');
  const duplicate = history(90); duplicate[30].t = duplicate[29].t; assert.equal(analyzeSellAdvice(duplicate, now).recommend, false);
  assert.equal(analyzeSellAdvice(history(90), new Date('2026-10-01')).status, 'unavailable');
});
test('recommendation review and execution are separately gated by fresh data and open market', () => {
  const data = payload(); assert.equal(sellAdviceState(data, 'KO', now).canExecute, true);
  data.marketIsOpen = false; assert.equal(sellAdviceState(data, 'KO', now).active, true); assert.equal(sellAdviceState(data, 'KO', now).canExecute, false);
  data.marketIsOpen = true; data.items.KO.quoteAt = '2026-09-15T14:30:00Z'; assert.equal(sellAdviceState(data, 'KO', now).canExecute, false);
  data.fetchedAt = '2026-09-15T14:57:00Z'; assert.equal(sellAdviceState(data, 'KO', now).active, false);
  assert.equal(sellAdviceState(null, 'KO', now).active, false);
});
test('holdings endpoint includes non-top-ten names, fails closed on pagination, and never calls an order endpoint', async () => {
  const oldFetch = global.fetch, key = process.env.ALPACA_API_KEY, secret = process.env.ALPACA_SECRET_KEY;
  process.env.ALPACA_API_KEY = 'fixture'; process.env.ALPACA_SECRET_KEY = 'fixture';
  const requests = []; let paginate = false, body, status;
  global.fetch = async url => { requests.push(url); return { ok: true, json: async () => url.includes('/clock') ? { is_open: true }
    : url.includes('/bars?') ? { bars: { KO: history(90), TMO: history(90) }, next_page_token: paginate ? 'more' : null }
    : { KO: { latestTrade: { p: 90, t: new Date().toISOString() } }, TMO: { latestTrade: { p: 90, t: new Date().toISOString() } } } }; };
  const res = { setHeader() {}, status(n) { status = n; return this; }, json(value) { body = value; return this; } };
  try {
    await service({ query: { symbols: 'KO,TMO' } }, res); assert.equal(status, 200); assert.equal(body.version, SELL_ADVICE_VERSION); assert.ok(body.items.TMO);
    assert.ok(requests.every(url => !url.includes('/orders'))); assert.ok(requests.some(url => url.includes('adjustment=split')));
    paginate = true; await service({ query: { symbols: 'KO,TMO' } }, res); assert.equal(status, 502);
    await service({ query: { symbols: 'NOT_VALID' } }, res); assert.equal(status, 400);
  } finally { global.fetch = oldFetch; if (key === undefined) delete process.env.ALPACA_API_KEY; else process.env.ALPACA_API_KEY = key; if (secret === undefined) delete process.env.ALPACA_SECRET_KEY; else process.env.ALPACA_SECRET_KEY = secret; }
});
