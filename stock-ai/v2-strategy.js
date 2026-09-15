// Frozen research challenger. Ratios are decimals; USD is the account currency.
// Missing inputs never become zero or get replaced by an AI estimate.
export const V2_VERSION = 'growth-trend-v2.0-research';
export const V2_RULES = Object.freeze({
  minimumScore: 80, minimumBars: 252, minimumPrice: 5, minimumMarketCap: 2e9,
  minimumDollarVolume: 2e7, maxSymbols: 8, maxSymbolWeight: .10,
  maxSymbolDollars: 200, minimumCash: 200, maxSectorWeight: .25,
  tradeRisk: .005, portfolioRisk: .03, minStopDistance: .04, maxStopDistance: .10,
  slippage: .001, fee: .50, minimumEvaluationDays: 126, minimumClosedTrades: 30
});
export const V2_FACTORS = Object.freeze([
  { key: 'growth', label: '盈利增长 / 上修', weight: 30, metrics: ['revenueGrowth', 'epsGrowth', 'revision90'] },
  { key: 'trend', label: '趋势 / 相对强度', weight: 30, metrics: ['relative63', 'relative126', 'sectorRelative63'] },
  { key: 'quality', label: '企业质量', weight: 20, metrics: ['fcfMargin', 'roic', 'netDebtEbitda'] },
  { key: 'valuation', label: '行业内估值', weight: 10, metrics: ['forwardPE'] },
  { key: 'catalyst', label: '财报催化剂', weight: 10, metrics: ['earningsSurprise'] }
]);
export const V2_DATA_GAPS = Object.freeze([
  '财报、现金流与企业质量数据尚未接入',
  '带历史时间戳的盈利一致预期与上修数据尚未接入',
  '财报日历、市值与完整股票池尚未核验',
  '分红、拆股与连续模拟执行数据尚未接通'
]);
const finite = Number.isFinite;
const positive = n => finite(n) && n > 0;
const mean = a => a.reduce((s, n) => s + n, 0) / a.length;
export const nyDate = value => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date(value));

function validBars(bars, minimum) {
  return Array.isArray(bars) && bars.length >= minimum && bars.every((b, i) =>
    positive(b.c) && finite(Date.parse(b.t)) && (!i || nyDate(b.t) > nyDate(bars[i - 1].t)));
}
export function v2CompletedBars(bars, now = new Date()) {
  // Conservative when exchange-calendar close times are unavailable: never use
  // today's bar, even post-close. Label the actual signal date, not today's date.
  const today = nyDate(now);
  return (Array.isArray(bars) ? bars : []).filter(b => finite(Date.parse(b.t)) && nyDate(b.t) < today);
}
function rawRegime(bars) {
  const closes = bars.map(b => b.c), close = closes.at(-1);
  const sma50 = mean(closes.slice(-50)), sma200 = mean(closes.slice(-200));
  const previous200 = mean(closes.slice(-220, -20));
  const state = close > sma50 && sma50 > sma200 && sma200 > previous200 ? 'strong'
    : close >= sma200 ? 'neutral' : sma200 >= previous200 ? 'weak' : 'defensive';
  return { state, close, sma50, sma200, previous200 };
}
const REGIMES = Object.freeze({ strong: ['强势', .8], neutral: ['中性', .5], weak: ['弱势', .2], defensive: ['防守', 0] });
export function v2MarketRegime(bars) {
  const missing = { state: 'unavailable', label: '数据不足', maxExposure: null, signalDate: null };
  if (!validBars(bars, 221)) return missing;
  // Replay the two-close confirmation from observable history, without browser
  // polling counts. Same-day refreshes cannot count as two confirmations.
  let confirmed = null, prior = null;
  for (let end = 220; end <= bars.length; end++) {
    const raw = rawRegime(bars.slice(0, end));
    if (prior === raw.state) confirmed = raw.state;
    prior = raw.state;
  }
  if (!confirmed) return missing;
  return { ...rawRegime(bars), state: confirmed, pendingState: prior !== confirmed ? prior : null,
    label: REGIMES[confirmed][0], maxExposure: REGIMES[confirmed][1], signalDate: nyDate(bars.at(-1).t) };
}
export function atr14(bars) {
  if (!validBars(bars, 15) || bars.some(b => !positive(b.h) || !positive(b.l) || b.h < b.l || b.c > b.h || b.c < b.l)) return null;
  const ranges = bars.slice(1).map((b, i) => Math.max(b.h - b.l, Math.abs(b.h - bars[i].c), Math.abs(b.l - bars[i].c)));
  let value = mean(ranges.slice(0, 14));
  for (const range of ranges.slice(14)) value = (value * 13 + range) / 14;
  return value;
}
export function priceInputs(bars, spy, sector) {
  if (![bars, spy, sector].every(b => validBars(b, 252))) return null;
  const dates = bars.slice(-252).map(b => nyDate(b.t));
  if (![spy, sector].every(series => series.slice(-252).every((b, i) => nyDate(b.t) === dates[i]))) return null;
  const ret = (series, n) => series.at(-1).c / series.at(-1 - n).c - 1;
  const atr = atr14(bars);
  if (!positive(atr) || bars.slice(-20).some(b => !positive(b.v))) return null;
  return { close: bars.at(-1).c, sma50: mean(bars.slice(-50).map(b => b.c)),
    sma200: mean(bars.slice(-200).map(b => b.c)), atr,
    relative63: ret(bars, 63) - ret(spy, 63), relative126: ret(bars, 126) - ret(spy, 126),
    sectorRelative63: ret(sector, 63) - ret(spy, 63),
    averageDollarVolume: mean(bars.slice(-20).map(b => b.c * b.v)),
    signalDate: nyDate(bars.at(-1).t), availableBars: bars.length };
}
const METRICS = V2_FACTORS.flatMap(f => f.metrics);
function timestampValid(value, decisionAt, maxDays = Infinity) {
  const time = Date.parse(value), decision = Date.parse(decisionAt);
  return finite(time) && finite(decision) && time <= decision && decision - time <= maxDays * 864e5;
}
export function candidateProblems(row, decisionAt) {
  const problems = [];
  if (!row || typeof row.symbol !== 'string' || !/^[A-Z][A-Z.]{0,5}$/.test(row.symbol)) return ['股票标识无效'];
  if (row.securityType !== 'common_stock' || !['NYSE', 'NASDAQ'].includes(row.exchange)) problems.push('不在普通股范围');
  if (!row.sector || row.sector === 'XLF') problems.push('行业模型不适用或缺失');
  if (!finite(row.marketCap) || row.marketCap < V2_RULES.minimumMarketCap) problems.push('市值未达标或缺失');
  if (!finite(row.availableBars) || row.availableBars < 252 || !positive(row.close) || row.close < 5) problems.push('价格 / 历史不足');
  if (!finite(row.averageDollarVolume) || row.averageDollarVolume < 2e7) problems.push('流动性不足');
  if (METRICS.some(key => !finite(row[key]))) problems.push('评分指标缺失');
  if (!positive(row.forwardPE) || !positive(row.previousEPS) || !positive(row.ebitda)) problems.push('财务比率不适用');
  if (![row.sma50, row.sma200, row.atr].every(positive)) problems.push('趋势 / 波动数据不足');
  if (!Number.isInteger(row.sessionsToEarnings) || row.sessionsToEarnings < 0) problems.push('财报日历未核验');
  if (!row.source || row.latestReportVerified !== true || row.priceBasis !== 'split-adjusted') problems.push('来源 / 最新财报 / 价格口径未核验');
  if (!timestampValid(row.publishedAt, decisionAt) || !timestampValid(row.fetchedAt, decisionAt, 7) ||
      !timestampValid(row.estimatesAt, decisionAt, 7) || !timestampValid(row.signalDate, decisionAt, 4)) problems.push('数据过期或晚于决策时间');
  return problems;
}
export function scoreV2Universe(rows, { decisionAt, universeComplete = false } = {}) {
  const diagnostics = (Array.isArray(rows) ? rows : []).map(row => ({ ...row,
    problems: candidateProblems(row, decisionAt), score: null, factors: [], canBuy: false }));
  const unique = new Set(diagnostics.map(r => r.symbol)).size === diagnostics.length;
  const eligible = diagnostics.filter(row => !row.problems.length);
  if (!universeComplete || !unique || eligible.length < 2) return diagnostics.map(row => ({ ...row,
    problems: [...row.problems, '完整评分股票池未核验，禁止排名买入'] }));
  const percentile = (row, key) => {
    const peers = key === 'forwardPE' ? eligible.filter(r => r.sector === row.sector) : eligible;
    if (peers.length < 2) return null;
    const values = peers.map(r => r[key]);
    const less = values.filter(v => v < row[key]).length;
    const tied = values.filter(v => v === row[key]).length;
    const rank = (less + (tied - 1) / 2) / (values.length - 1) * 100;
    return ['netDebtEbitda', 'forwardPE'].includes(key) ? 100 - rank : rank;
  };
  for (const row of eligible) {
    const factors = V2_FACTORS.map(f => ({ key: f.key, label: f.label, weight: f.weight,
      values: f.metrics.map(key => percentile(row, key)) }));
    if (factors.some(f => f.values.some(v => v === null))) { row.problems.push('行业估值比较样本不足'); continue; }
    row.factors = factors.map(f => ({ key: f.key, label: f.label, weight: f.weight, score: mean(f.values) * f.weight / 100 }));
    row.score = row.factors.reduce((s, f) => s + f.score, 0);
    row.entryReasons = [];
    if (row.score < 80) row.entryReasons.push('未达到80分');
    if (!(row.close > row.sma50 && row.sma50 > row.sma200)) row.entryReasons.push('均线趋势不满足');
    if (![row.relative63, row.relative126, row.sectorRelative63, row.revenueGrowth, row.epsGrowth, row.revision90].every(v => v > 0)) row.entryReasons.push('增长 / 上修 / 相对强度不满足');
    if (row.close / row.sma50 > 1.15) row.entryReasons.push('偏离50日均线超过15%');
    if (row.sessionsToEarnings <= 5) row.entryReasons.push('临近财报，暂停新买');
    const distance = 2 * row.atr / row.close;
    if (distance < .04 || distance > .10) row.entryReasons.push('初始止损距离不在4%–10%');
    row.canBuy = !row.entryReasons.length;
  }
  return diagnostics.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || String(a.symbol).localeCompare(String(b.symbol)));
}

export function portfolioValue(account) {
  const positions = Object.values(account.positions || {});
  if (!finite(account.cash) || account.cash < 0 || positions.some(p => !positive(p.quantity) || !positive(p.mark))) throw new Error('账户估值数据无效');
  const marketValue = positions.reduce((s, p) => s + p.quantity * p.mark, 0);
  return { cash: account.cash, marketValue, equity: account.cash + marketValue,
    openRisk: positions.reduce((s, p) => s + (positive(p.stop) ? Math.max(0, p.mark - p.stop) * p.quantity : Infinity), 0) };
}

export function planV2Order(account, row, regime, { price = row?.close, add = false, decisionAt } = {}) {
  const fail = reason => ({ valid: false, reason, amount: 0 });
  if (candidateProblems(row, decisionAt).length || !row.canBuy || !finite(row.score) || row.score < 80) return fail('评分或数据不满足买入条件');
  if (!finite(regime?.maxExposure) || regime.maxExposure <= 0 || regime.maxExposure > .8 ||
      !timestampValid(regime.signalDate, decisionAt, 4)) return fail('市场状态不允许买入');
  const { equity, cash, marketValue, openRisk } = portfolioValue(account);
  if (!positive(price) || price / row.close > 1.03) return fail('开盘价格无效或跳空超过3%');
  const held = account.positions[row.symbol];
  if (add && (!held || held.added || price < held.firstPrice * 1.05 || price <= held.averagePrice)) return fail('只对上涨至少5%的盈利持仓加仓一次');
  if (!add && held) return fail('已有持仓，不重复开仓');
  const reservedSymbols = new Set([...Object.keys(account.positions), ...(account.orders || []).filter(o => o.status === 'pending').map(o => o.symbol)]);
  if (!held && reservedSymbols.size >= 8) return fail('已达到8只持仓或待成交股票');
  const stop = held?.stop ?? price - 2 * row.atr;
  const distance = (price - stop) / price;
  if (!positive(stop) || (distance < .04 && !add) || (!add && distance > .10) || distance <= 0) return fail('止损距离不满足规则');
  const drawdown = account.highWater > 0 ? 1 - equity / account.highWater : 0;
  if (account.paused || (drawdown >= .12 && !(account.resumedAfterPause && equity >= account.lastTripEquity))) return fail('组合回撤暂停新买');
  const exposure = Math.min(regime.maxExposure, drawdown >= .08 || account.caution ? .4 : .8, account.recovery ? .2 : .8);
  const pending = (account.orders || []).filter(o => o.status === 'pending');
  if (pending.some(o => o.symbol === row.symbol)) return fail('该股票已有待成交订单');
  const reserved = pending.reduce((s, o) => s + o.amount + V2_RULES.fee, 0);
  const reservedRisk = pending.reduce((s, o) => s + o.amount * o.distance, 0);
  const sectorValue = Object.values(account.positions).filter(p => p.sector === row.sector).reduce((s, p) => s + p.quantity * p.mark, 0)
    + pending.filter(o => o.sector === row.sector).reduce((s, o) => s + o.amount, 0);
  const heldValue = held ? held.quantity * price : 0;
  const heldRisk = held ? Math.max(0, price - stop) * held.quantity : 0;
  // Conservative post-fee/slippage denominator, including other reservations.
  const riskEquity = equity - (pending.length + 1) * (V2_RULES.fee + 200 * V2_RULES.slippage);
  const plan = add ? held.plannedAmount : Math.min(riskEquity * .1, 200, riskEquity * .005 / distance);
  const amount = Math.min(plan * (add ? 1 / 3 : 2 / 3), riskEquity * .1 - heldValue, 200 - heldValue,
    (riskEquity * .005 - heldRisk) / distance, (riskEquity * .03 - openRisk - reservedRisk) / distance,
    cash - Math.max(200, equity * (1 - exposure)) - reserved - V2_RULES.fee,
    riskEquity * exposure - marketValue - reserved - V2_RULES.fee,
    riskEquity * .25 - sectorValue);
  const rounded = Math.floor(amount * 100) / 100;
  if (!finite(rounded) || rounded < 1) return fail('现金、行业、仓位或风险额度不足');
  return { valid: true, amount: rounded, plannedAmount: plan, stop, distance, price, add };
}

export function v2ExitDecision(position, bars, fundamentals = {}, holdingSessions = 0, relativeReturn = null) {
  if (!validBars(bars, 200) || !positive(position.stop)) return { action: 'unavailable', reason: '持仓价格历史不足，等待核验' };
  const latest = bars.at(-1), closes = bars.map(b => b.c);
  // Use the stop that was set before this session. A new trailing stop becomes
  // effective NEXT session and may not be applied to today's low retroactively.
  if (positive(latest.o) && finite(latest.l) && latest.l <= position.stop) return {
    action: 'stop', observedPrice: Math.min(latest.o, position.stop), reason: '触及保护价（含开盘跳空）'
  };
  const sma50 = mean(closes.slice(-50)), previous50 = mean(closes.slice(-51, -1));
  if (latest.c < mean(closes.slice(-200)) || latest.c < sma50 && closes.at(-2) < previous50) return { action: 'exit-next-open', reason: '趋势破坏' };
  if (fundamentals.verified === true && (finite(fundamentals.revision30) && fundamentals.revision30 <= -.10 ||
      fundamentals.revenueGrowth < 0 && fundamentals.epsGrowth < 0)) return { action: 'exit-next-open', reason: '盈利下修或营收与盈利双降' };
  if (holdingSessions >= 60 && finite(relativeReturn) && relativeReturn <= 0 && finite(fundamentals.score) && fundamentals.score < 75) return { action: 'exit-next-open', reason: '持仓60日未跑赢基准且评分低于75' };
  const high = Math.max(position.highClose || position.firstPrice, latest.c);
  const atr = atr14(bars);
  const trailing = high >= position.firstPrice * 1.15;
  return { action: 'hold', highClose: high, nextStop: trailing && positive(atr) ? Math.max(position.stop, high - 3 * atr) : position.stop,
    reason: trailing ? '盈利持有，下一交易日上移保护价' : '持有，等待退出条件' };
}

export function v2Readiness(benchmarkBars, fetchedAt = new Date().toISOString()) {
  const bars = v2CompletedBars(benchmarkBars, fetchedAt);
  let regime = v2MarketRegime(bars);
  if (regime.signalDate && !timestampValid(regime.signalDate, fetchedAt, 4)) regime = { state: 'unavailable', label: '行情过期', maxExposure: null, signalDate: regime.signalDate };
  return { version: V2_VERSION, status: 'blocked', canStart: false, source: 'Alpaca IEX · 仅价格数据', fetchedAt,
    regime, gaps: [...V2_DATA_GAPS], factors: V2_FACTORS.map(({ key, label, weight }) => ({ key, label, weight })),
    reason: '完整 V2 尚未启动：现有行情不包含盈利增长与盈利预期数据。' };
}
