const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

export const DIP_VERSION = 'dip-v1-shadow';
export const DIP_DYNAMIC_VERSION = 'dip-v1.1-shadow';
export const DIP_RULES = Object.freeze({
  minimumBars: 61,
  minimumDrawdownPercent: 8,
  maximumDrawdownPercent: 30,
  confirmationAverageDays: 5,
  stopBelowSetupLowPercent: 2,
  maximumHoldingDays: 10,
  profitTargetPercent: 5,
  shadowAmount: 50
});

export function evaluateDipOpportunity(bars, rules = DIP_RULES) {
  if (!Array.isArray(bars) || bars.length < rules.minimumBars) {
    return { status: 'unavailable', confirmed: false, reason: `需要至少${rules.minimumBars}个完整交易日` };
  }
  const recent = bars.slice(-rules.minimumBars).map((bar) => ({
    close: Number(bar.c), low: Number(bar.l ?? bar.c), time: bar.t
  }));
  if (recent.some((bar) => !Number.isFinite(bar.close) || !Number.isFinite(bar.low) || bar.close <= 0 || bar.low <= 0)) {
    return { status: 'unavailable', confirmed: false, reason: '完整日线价格不足' };
  }
  const latest = recent.at(-1);
  const previous = recent.at(-2);
  const peak60 = Math.max(...recent.slice(-61, -1).map((bar) => bar.close));
  const drawdownPercent = (1 - latest.close / peak60) * 100;
  const sma5 = average(recent.slice(-rules.confirmationAverageDays).map((bar) => bar.close));
  const inDrawdownRange = drawdownPercent >= rules.minimumDrawdownPercent && drawdownPercent <= rules.maximumDrawdownPercent;
  const checks = {
    reboundClose: latest.close > previous.close,
    higherLow: latest.low > previous.low,
    aboveShortAverage: latest.close > sma5
  };
  const confirmed = inDrawdownRange && Object.values(checks).every(Boolean);
  const status = drawdownPercent > rules.maximumDrawdownPercent
    ? 'excluded'
    : confirmed ? 'confirmed' : inDrawdownRange ? 'watch' : 'none';
  return {
    status,
    confirmed,
    drawdownPercent,
    peak60,
    latestClose: latest.close,
    setupLow: Math.min(latest.low, previous.low),
    sma5,
    checks,
    signalTime: latest.time,
    latestCompletedDate: latest.time,
    recentTradingDates: recent.slice(-15).map((bar) => bar.time).filter(Boolean),
    reason: status === 'excluded' ? '回撤超过安全观察范围' : confirmed ? '回撤后出现止跌确认' : inDrawdownRange ? '已进入回撤区间，等待止跌确认' : '尚未进入回撤机会区间'
  };
}

export function updateDipPosition(position, price, observedDate, rules = DIP_RULES, tradingDates = []) {
  const currentPrice = Number(price);
  if (!position || !Number.isFinite(currentPrice) || currentPrice <= 0 || !observedDate) return null;
  const firstObservedDate = (position.observedDates || [observedDate]).filter(Boolean).sort()[0] || observedDate;
  const elapsedTradingDates = (tradingDates || []).map((value) => new Date(value).toISOString().slice(0, 10))
    .filter((date) => date >= firstObservedDate && date <= observedDate);
  const dates = [...new Set([...(position.observedDates || []), ...elapsedTradingDates, observedDate])].sort();
  const returnPercent = ((currentPrice / Number(position.entryPrice)) - 1) * 100;
  const stopPrice = Number(position.setupLow) * (1 - rules.stopBelowSetupLowPercent / 100);
  const stopped = currentPrice <= stopPrice;
  const expired = dates.length >= rules.maximumHoldingDays && returnPercent < rules.profitTargetPercent;
  return {
    ...position,
    currentPrice,
    observedDates: dates,
    holdingDays: dates.length,
    returnPercent,
    stopPrice,
    shouldExit: stopped || expired,
    exitReason: stopped ? '跌破形态低点2%' : expired ? '10个交易日未达到5%反弹' : null
  };
}
