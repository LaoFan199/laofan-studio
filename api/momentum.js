const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

export const MOMENTUM_VERSION = 'momentum-v1-shadow';
export const MOMENTUM_RULES = Object.freeze({
  minimumPrice: 5,
  minimumChangePercent: 10,
  minimumRelativeVolume: 3,
  minimumDollarVolume: 20_000_000,
  maximumSpreadPercent: 1,
  trailingDrawdownPercent: 15
});

export function evaluateMomentumCandidate(input, rules = MOMENTUM_RULES) {
  const price = Number(input?.price);
  const changePercent = Number(input?.changePercent);
  const currentVolume = Number(input?.currentVolume);
  const previousVolumes = (input?.previousVolumes || []).map(Number).filter((value) => Number.isFinite(value) && value > 0);
  const bid = Number(input?.bid);
  const ask = Number(input?.ask);
  const averageVolume = previousVolumes.length >= 10 ? average(previousVolumes.slice(-20)) : null;
  const relativeVolume = averageVolume ? currentVolume / averageVolume : null;
  const dollarVolume = Number.isFinite(price) && Number.isFinite(currentVolume) ? price * currentVolume : null;
  const midpoint = bid > 0 && ask > 0 ? (bid + ask) / 2 : null;
  const spreadPercent = midpoint ? ((ask - bid) / midpoint) * 100 : null;

  const checks = [
    { key: 'price', passed: price >= rules.minimumPrice, detail: `股价需不低于 $${rules.minimumPrice}` },
    { key: 'change', passed: changePercent >= rules.minimumChangePercent, detail: `当日涨幅需达到 ${rules.minimumChangePercent}%` },
    { key: 'relativeVolume', passed: relativeVolume != null && relativeVolume >= rules.minimumRelativeVolume, detail: `相对成交量需达到 ${rules.minimumRelativeVolume.toFixed(1)} 倍` },
    { key: 'dollarVolume', passed: dollarVolume != null && dollarVolume >= rules.minimumDollarVolume, detail: `成交额需达到 $${Math.round(rules.minimumDollarVolume / 1_000_000)}M` },
    { key: 'spread', passed: spreadPercent != null && spreadPercent <= rules.maximumSpreadPercent, detail: `买卖价差需不高于 ${rules.maximumSpreadPercent}%` }
  ];

  return {
    qualified: checks.every((check) => check.passed),
    checks,
    metrics: { price, changePercent, currentVolume, averageVolume, relativeVolume, dollarVolume, spreadPercent }
  };
}

export function updateTrailingPosition(position, price, trailingDrawdownPercent = MOMENTUM_RULES.trailingDrawdownPercent) {
  const currentPrice = Number(price);
  if (!position || !Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  const highWatermark = Math.max(Number(position.highWatermark) || Number(position.entryPrice), currentPrice);
  const exitTrigger = highWatermark * (1 - trailingDrawdownPercent / 100);
  return {
    ...position,
    currentPrice,
    highWatermark,
    exitTrigger,
    drawdownFromHighPercent: ((currentPrice / highWatermark) - 1) * 100,
    shouldExit: currentPrice <= exitTrigger
  };
}
