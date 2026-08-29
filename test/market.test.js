import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMarketRegime, completedDailyBars } from '../api/market.js';
import { evaluateMomentumCandidate, evaluateMomentumUniverse, updateTrailingPosition } from '../api/momentum.js';
import { evaluateDipOpportunity, updateDipPosition } from '../api/dip.js';
import { compareDynamicRankings, rankDynamicCandidates } from '../api/dynamic-strategy.js';

const barsFrom = (values, start = '2025-01-02T21:00:00Z') => values.map((c, index) => ({
  c,
  t: new Date(new Date(start).getTime() + index * 24 * 60 * 60 * 1000).toISOString()
}));

test('market regime fails closed with fewer than 200 SPY bars', () => {
  const result = analyzeMarketRegime(barsFrom(Array.from({ length: 199 }, (_, i) => 100 + i)));
  assert.equal(result.state, 'unavailable');
  assert.equal(result.suggestedMaxExposure, null);
  assert.match(result.reasons[0], /200/);
});

test('healthy trend produces a normal shadow regime', () => {
  const spy = barsFrom(Array.from({ length: 260 }, (_, i) => 100 + i * 0.2));
  const universe = {
    A: barsFrom(Array.from({ length: 80 }, (_, i) => 50 + i * 0.1)),
    B: barsFrom(Array.from({ length: 80 }, (_, i) => 80 + i * 0.05)),
    C: barsFrom(Array.from({ length: 80 }, (_, i) => 30 + i * 0.08)),
    D: barsFrom(Array.from({ length: 80 }, (_, i) => 60 + i * 0.03))
  };
  const result = analyzeMarketRegime(spy, universe);
  assert.equal(result.state, 'normal');
  assert.equal(result.suggestedMaxExposure, 80);
  assert.equal(result.riskScore, 0);
  assert.equal(result.confidence, '高');
});

test('deep falling trend and weak breadth produce a defensive regime', () => {
  const prices = [
    ...Array.from({ length: 210 }, (_, i) => 100 + i * 0.25),
    ...Array.from({ length: 50 }, (_, i) => 152.5 - i * 1.4)
  ];
  const falling = barsFrom(Array.from({ length: 80 }, (_, i) => 100 - i * 0.7));
  const result = analyzeMarketRegime(barsFrom(prices), { A: falling, B: falling, C: falling, D: falling });
  assert.equal(result.state, 'defensive');
  assert.equal(result.suggestedMaxExposure, 25);
  assert.ok(result.riskScore >= 4);
  assert.ok(result.reasons.length >= 2);
});

test('open-market helper excludes an in-progress daily bar', () => {
  const now = new Date('2026-08-19T15:00:00Z');
  const bars = [
    { c: 100, t: '2026-08-18T20:00:00Z' },
    { c: 101, t: '2026-08-19T15:00:00Z' }
  ];
  assert.equal(completedDailyBars(bars, true, now).length, 1);
  assert.equal(completedDailyBars(bars, false, now).length, 2);
});

test('momentum candidate must pass every liquidity and price check', () => {
  const result = evaluateMomentumCandidate({
    price: 20,
    changePercent: 12,
    currentVolume: 4_000_000,
    previousVolumes: Array(20).fill(1_000_000),
    bid: 19.95,
    ask: 20.05
  });
  assert.equal(result.qualified, true);
  assert.equal(result.metrics.relativeVolume, 4);
  assert.ok(result.metrics.spreadPercent < 1);
});

test('momentum candidate fails closed when volume history or quote is missing', () => {
  const result = evaluateMomentumCandidate({ price: 20, changePercent: 40, currentVolume: 9_000_000 });
  assert.equal(result.qualified, false);
  assert.equal(result.checks.find((check) => check.key === 'relativeVolume').passed, false);
  assert.equal(result.checks.find((check) => check.key === 'spread').passed, false);
});

test('momentum universe excludes low-priced and warrant-like movers before ranking', () => {
  assert.equal(evaluateMomentumUniverse('RNWWW', 0.02).eligible, false);
  assert.equal(evaluateMomentumUniverse('RFAIW', 10.22).eligible, false);
  assert.equal(evaluateMomentumUniverse('HOWL', 0.85).eligible, false);
  assert.equal(evaluateMomentumUniverse('RFAI', 68.55).eligible, true);
  assert.equal(evaluateMomentumUniverse('GOOGL', 344.75).eligible, true);
});

test('momentum universe keeps tracked common shares representable', () => {
  const result = evaluateMomentumUniverse('BRK.B', 500);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.reasons, []);
});

test('trailing exit rises with the high and triggers at a 15 percent drawdown', () => {
  const entry = { symbol: 'XYZ', entryPrice: 100, highWatermark: 100 };
  const rising = updateTrailingPosition(entry, 200);
  assert.equal(rising.highWatermark, 200);
  assert.equal(rising.exitTrigger, 170);
  assert.equal(rising.shouldExit, false);
  assert.equal(updateTrailingPosition(rising, 170).shouldExit, true);
  const falling = updateTrailingPosition(rising, 169.99);
  assert.equal(falling.highWatermark, 200);
  assert.equal(falling.shouldExit, true);
});

test('dip opportunity needs a material drawdown and all three confirmation checks', () => {
  const closes = [...Array(56).fill(100), 94, 90, 88, 89, 91];
  const bars = barsFrom(closes).map((bar, index) => ({ ...bar, l: index === 59 ? 87.5 : index === 60 ? 88.5 : bar.c - 1 }));
  const result = evaluateDipOpportunity(bars);
  assert.equal(result.status, 'confirmed');
  assert.equal(result.confirmed, true);
  assert.ok(result.drawdownPercent >= 8);
  assert.deepEqual(result.checks, { reboundClose: true, higherLow: true, aboveShortAverage: true });
});

test('drawdown alone stays on watch when price has not confirmed', () => {
  const closes = [...Array(57).fill(100), 95, 92, 90, 89];
  const bars = barsFrom(closes).map((bar) => ({ ...bar, l: bar.c - 1 }));
  const result = evaluateDipOpportunity(bars);
  assert.equal(result.status, 'watch');
  assert.equal(result.confirmed, false);
});

test('dip opportunity fails closed with incomplete bars and excludes extreme drawdowns', () => {
  assert.equal(evaluateDipOpportunity(barsFrom(Array(60).fill(100))).status, 'unavailable');
  const extreme = barsFrom([...Array(60).fill(100), 60]).map((bar) => ({ ...bar, l: bar.c - 1 }));
  assert.equal(evaluateDipOpportunity(extreme).status, 'excluded');
});

test('dip shadow position exits below setup low or after ten unproductive observations', () => {
  const entry = { symbol: 'XYZ', entryPrice: 100, setupLow: 90, observedDates: ['2026-08-01'] };
  const stopped = updateDipPosition(entry, 88.2, '2026-08-02');
  assert.equal(stopped.stopPrice, 88.2);
  assert.equal(stopped.shouldExit, true);
  assert.equal(stopped.exitReason, '跌破形态低点2%');
  let held = entry;
  for (let day = 2; day <= 10; day += 1) held = updateDipPosition(held, 102, `2026-08-${String(day).padStart(2, '0')}`);
  assert.equal(held.holdingDays, 10);
  assert.equal(held.shouldExit, true);
  assert.equal(held.exitReason, '10个交易日未达到5%反弹');
});

test('dynamic universe fails closed on price, history, liquidity, or missing score', () => {
  const liquidBars = Array.from({ length: 61 }, () => ({ c: 100, v: 1_000_000 }));
  const candidates = rankDynamicCandidates([
    { symbol: 'GOOD', price: 100, bars: liquidBars, analysis: { score: 80, metrics: { relative20: 2 } } },
    { symbol: 'CHEAP', price: 4, bars: liquidBars, analysis: { score: 99, metrics: { relative20: 20 } } },
    { symbol: 'SHORT', price: 100, bars: liquidBars.slice(0, 60), analysis: { score: 99, metrics: { relative20: 20 } } },
    { symbol: 'ILLIQ', price: 100, bars: Array.from({ length: 61 }, () => ({ c: 10, v: 10_000 })), analysis: { score: 99, metrics: { relative20: 20 } } },
    { symbol: 'NOSCORE', price: 100, bars: liquidBars, analysis: null }
  ]);
  assert.deepEqual(candidates.map((item) => item.symbol), ['GOOD']);
});

test('dynamic universe ranks by unchanged score then relative strength', () => {
  const bars = Array.from({ length: 61 }, () => ({ c: 100, v: 1_000_000 }));
  const candidates = rankDynamicCandidates([
    { symbol: 'B', price: 100, bars, analysis: { score: 85, metrics: { relative20: 2 } } },
    { symbol: 'A', price: 100, bars, analysis: { score: 85, metrics: { relative20: 5 } } },
    { symbol: 'C', price: 100, bars, analysis: { score: 90, metrics: { relative20: 0 } } }
  ]);
  assert.deepEqual(candidates.map((item) => item.symbol), ['C', 'A', 'B']);
  assert.deepEqual(candidates.map((item) => item.rank), [1, 2, 3]);
});

test('dynamic ranking labels new, rising, falling, same, and exited symbols', () => {
  const result = compareDynamicRankings(
    [{ symbol: 'B' }, { symbol: 'A' }, { symbol: 'D' }],
    [{ symbol: 'A' }, { symbol: 'B' }, { symbol: 'C' }]
  );
  assert.deepEqual(result.candidates.map((item) => item.movement), ['up', 'down', 'new']);
  assert.deepEqual(result.exited, [{ symbol: 'C', previousRank: 3 }]);
  assert.equal(compareDynamicRankings([{ symbol: 'A' }], [{ symbol: 'A' }]).candidates[0].movement, 'same');
});
