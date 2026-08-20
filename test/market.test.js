import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMarketRegime, completedDailyBars } from '../api/market.js';

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
