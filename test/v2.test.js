import test from 'node:test';
import assert from 'node:assert/strict';
import { V2_VERSION, scoreV2Universe, v2MarketRegime, v2Readiness, v2CompletedBars, planV2Order, portfolioValue, v2ExitDecision } from '../stock-ai/v2-strategy.js';
import { newV2Account, queueV2Order, cancelV2Order, fillV2Order, sellV2Position, riskSession, requiredReductions, v2Metrics } from '../stock-ai/v2-paper.js';

const decisionAt = '2026-09-11T21:00:00Z';
function bars(count = 260, fn = i => 100 + i * .1) {
  const dates = []; let d = new Date('2026-09-11T20:00:00Z');
  while (dates.length < count) { if (![0, 6].includes(d.getUTCDay())) dates.unshift(d.toISOString()); d.setUTCDate(d.getUTCDate() - 1); }
  return dates.map((t, i) => ({ t, c: fn(i), o: fn(i), h: fn(i) + 3, l: fn(i) - 3, v: 1e6 }));
}
function candidates() {
  return ['AAA', 'BBB', 'CCC'].map((symbol, i) => ({ symbol, securityType: 'common_stock', exchange: 'NYSE', sector: 'XLI',
    marketCap: 3e9, availableBars: 260, close: 100, sma50: 95, sma200: 80, atr: 3, averageDollarVolume: 1e8,
    revenueGrowth: .1 + i * .1, epsGrowth: .1 + i * .1, revision90: .01 + i * .01,
    relative63: .01 + i * .01, relative126: .01 + i * .01, sectorRelative63: .01,
    fcfMargin: .1 + i * .1, roic: .1 + i * .1, netDebtEbitda: 3 - i, forwardPE: 30 - i,
    earningsSurprise: .01 + i * .01, previousEPS: 1, ebitda: 1e9, sessionsToEarnings: 20,
    source: 'verified-test-fixture', latestReportVerified: true, priceBasis: 'split-adjusted',
    publishedAt: '2026-09-10T20:00:00Z', estimatesAt: '2026-09-10T20:00:00Z', fetchedAt: decisionAt, signalDate: '2026-09-11' }));
}
const top = () => scoreV2Universe(candidates(), { decisionAt, universeComplete: true })[0];
const regime = { maxExposure: .8, signalDate: '2026-09-11' };
const account = () => newV2Account(decisionAt);
const queued = () => queueV2Order(account(), top(), regime, { decisionAt, nextSession: '2026-09-14', weeklyRebalance: true });

test('V2 scoring is deterministic, weighted, missing-data closed and does not mutate inputs', () => {
  const inputs = candidates(), before = structuredClone(inputs), result = scoreV2Universe(inputs, { decisionAt, universeComplete: true });
  assert.equal(result[0].symbol, 'CCC'); assert.equal(result[0].score, 95); assert.equal(result[0].canBuy, true);
  assert.deepEqual(inputs, before); assert.deepEqual(result[0].factors.map(f => f.weight), [30, 30, 20, 10, 10]);
  assert.ok(scoreV2Universe(inputs, { decisionAt }).every(r => r.score === null && !r.canBuy));
  inputs[2].revision90 = null;
  assert.equal(scoreV2Universe(inputs, { decisionAt, universeComplete: true }).find(r => r.symbol === 'CCC').canBuy, false);
});
test('V2 rejects future, stale, duplicate and mismatched financial inputs', () => {
  for (const changes of [{ estimatesAt: '2026-09-12' }, { estimatesAt: '2020-01-01' }, { previousEPS: -1 }, { forwardPE: null }, { sector: 'XLF' }, { latestReportVerified: false }]) {
    const inputs = candidates(); Object.assign(inputs[2], changes);
    assert.equal(scoreV2Universe(inputs, { decisionAt, universeComplete: true }).find(r => r.symbol === 'CCC').canBuy, false);
  }
  assert.ok(scoreV2Universe([...candidates(), candidates()[0]], { decisionAt, universeComplete: true }).every(r => r.score === null));
});
test('market regime uses separate completed dates and excludes current pre/postmarket bars', () => {
  const b = bars(); assert.equal(v2MarketRegime(b).state, 'strong');
  assert.equal(v2MarketRegime(b.slice(-200)).state, 'unavailable');
  const current = { ...b.at(-1), t: '2026-09-14T08:00:00Z', c: 1 };
  assert.deepEqual(v2CompletedBars([...b, current], new Date('2026-09-14T22:00:00Z')), b);
  assert.equal(v2MarketRegime([...b, { ...b.at(-1) }]).state, 'unavailable');
  assert.equal(v2MarketRegime([...b, { ...current, t: '2026-09-14T20:00:00Z' }]).state, 'strong');
  const readiness = v2Readiness(b, '2026-09-14T15:00:00Z');
  assert.equal(readiness.version, V2_VERSION); assert.equal(readiness.canStart, false); assert.equal(readiness.regime.state, 'strong');
});
test('order sizing enforces cash, sector, symbol, risk, market and pending-order constraints', () => {
  const row = top(), a = account();
  const plan = planV2Order(a, row, regime, { decisionAt });
  assert.ok(plan.valid); assert.ok(plan.amount < 1000 * .005 / .06 * 2 / 3);
  assert.equal(planV2Order(a, row, { ...regime, maxExposure: 0 }, { decisionAt }).valid, false);
  assert.equal(planV2Order({ ...a, cash: 200 }, row, regime, { decisionAt }).valid, false);
  assert.equal(planV2Order(a, row, regime, { decisionAt, price: 104 }).valid, false);
  const q = queued(); assert.ok(q.orderId);
  assert.equal(planV2Order(q.account, row, regime, { decisionAt }).valid, false);
  const full = account(); full.positions.XXX = { quantity: 3, mark: 100, stop: 99, sector: 'XLI' }; full.cash = 700;
  assert.equal(planV2Order(full, row, regime, { decisionAt }).valid, false);
});
test('cancel releases reservations but preserves immutable audit; repeated signals cannot refill', () => {
  const q = queued(), before = structuredClone(q.account);
  const c = cancelV2Order(q.account, q.orderId, '2026-09-12T00:00:00Z');
  assert.deepEqual(q.account, before); assert.equal(c.account.cash, 1000); assert.equal(c.account.orders[0].status, 'cancelled');
  assert.ok(planV2Order(c.account, top(), regime, { decisionAt }).valid);
  assert.ok(queueV2Order(c.account, top(), regime, { decisionAt, nextSession: '2026-09-14', weeklyRebalance: true }).error);
  assert.ok(fillV2Order(c.account, q.orderId, {}).error);
});
test('next-session buy and user sale reconcile equity, costs and realized P&L with no duplicate fills', () => {
  const q = queued();
  const f = fillV2Order(q.account, q.orderId, { session: '2026-09-14', open: 100, observedAt: '2026-09-14T13:30:01Z', corporateActionsVerified: true });
  assert.equal(f.error, undefined); const v = portfolioValue(f.account);
  assert.ok(Math.abs(v.equity - (1000 - f.account.costs)) < 1e-8);
  assert.ok(v.openRisk <= v.equity * .005);
  assert.ok(fillV2Order(f.account, q.orderId, {}).error); assert.ok(cancelV2Order(f.account, q.orderId, decisionAt).error);
  const sold = sellV2Position(f.account, 'CCC', { price: 110, at: '2026-09-15T15:00:00Z', reason: 'test exit', id: 'sale-1' });
  assert.equal(sold.error, undefined); assert.equal(Object.keys(sold.account.positions).length, 0);
  assert.ok(Math.abs(sold.account.cash - 1000 - sold.account.realized) < 1e-8);
  assert.ok(sellV2Position(sold.account, 'CCC', { id: 'sale-1' }).error);
  assert.equal(v2Metrics(sold.account).profitFactor, null);
});
test('wrong session, unknown corporate actions and losing add-on all fail closed', () => {
  const q = queued();
  for (const settings of [{ session: '2026-09-15', corporateActionsVerified: true }, { session: '2026-09-14', corporateActionsVerified: false }]) {
    assert.ok(fillV2Order(q.account, q.orderId, { ...settings, open: 100, observedAt: '2026-09-15T15:00:00Z' }).error);
  }
  const a = account(); a.positions.CCC = { quantity: .5, mark: 100, firstPrice: 110, averagePrice: 110, stop: 95, plannedAmount: 80, sector: 'XLI' };
  assert.equal(planV2Order(a, top(), regime, { decisionAt, add: true }).valid, false);
});
test('stop respects gaps and trailing stops only apply to later sessions', () => {
  const b = bars(), p = { firstPrice: 100, highClose: 125, stop: 90 };
  const gapped = structuredClone(b); gapped.at(-1).o = 80; gapped.at(-1).l = 79; gapped.at(-1).c = 85;
  const exit = v2ExitDecision(p, gapped); assert.equal(exit.action, 'stop'); assert.equal(exit.observedPrice, 80);
  const hold = v2ExitDecision(p, b); assert.equal(hold.action, 'hold'); assert.ok(hold.nextStop > 90);
  assert.equal(v2ExitDecision(p, b, { verified: true, revision30: -.11 }).action, 'exit-next-open');
});
test('drawdown intervention requires exchange sessions, cancels pending orders, and resumes after cooldown', () => {
  let a = queued().account; a.cash = 870;
  a = riskSession(a, { index: 0, at: decisionAt, maxExposure: .8, marketState: 'strong' });
  assert.equal(a.paused, true); assert.equal(a.maxExposure, 0); assert.equal(a.orders[0].status, 'cancelled');
  assert.deepEqual(riskSession(a, { index: 0 }), a);
  assert.throws(() => riskSession(a, { index: 2 }), /连续/);
  for (let index = 1; index <= 24; index++) a = riskSession(a, { index, at: decisionAt, maxExposure: .8, marketState: 'strong' });
  assert.equal(a.paused, false); assert.equal(a.recovery, true); assert.equal(a.maxExposure, .2);
});
test('forced reductions enforce limits and never claim missing performance', () => {
  const a = account(); a.cash = 600; a.positions.AAA = { symbol: 'AAA', sector: 'XLI', quantity: 4, mark: 100, stop: 90 }; a.maxExposure = .2;
  const reductions = requiredReductions(a); assert.equal(reductions[0].quantity, 3);
  assert.deepEqual(v2Metrics(null), { started: false });
});
