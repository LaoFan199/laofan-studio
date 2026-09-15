import { V2_VERSION, V2_RULES, portfolioValue, planV2Order, nyDate } from './v2-strategy.js';

// Pure simulation primitives; no timers, network, broker or implicit account start.
export function newV2Account(startedAt, initialCash = 1000) {
  if (!Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(initialCash) || initialCash < 1000) throw new Error('模拟账户起点无效');
  return { version: V2_VERSION, startedAt, initialCash, cash: initialCash, realized: 0,
    highWater: initialCash, positions: {}, orders: [], journal: [], snapshots: [], costs: 0,
    paused: false, caution: false, recovery: false, lastRiskSession: null };
}
export function queueV2Order(account, row, regime, { decisionAt, nextSession, weeklyRebalance, add = false } = {}) {
  const copy = structuredClone(account);
  if (!Number.isFinite(Date.parse(decisionAt))) return { account: copy, error: '决策时间无效' };
  const id = `${V2_VERSION}:${decisionAt}:${row.symbol}:${add ? 'add' : 'buy'}`;
  if (copy.orders.some(o => o.id === id)) return { account: copy, error: '信号已处理，不能重复下单' };
  if (!weeklyRebalance || !/^\d{4}-\d{2}-\d{2}$/.test(nextSession || '') || nextSession <= nyDate(decisionAt)) return { account: copy, error: '必须在周度决策后下一交易日执行' };
  const plan = planV2Order(copy, row, regime, { add, decisionAt });
  if (!plan.valid) return { account: copy, error: plan.reason };
  copy.orders.push({ id, status: 'pending', symbol: row.symbol, sector: row.sector, ...plan,
    nextSession, decisionAt, input: structuredClone(row), regime: structuredClone(regime), version: V2_VERSION });
  copy.journal.push({ id, type: 'queued', at: decisionAt, amount: plan.amount });
  return { account: copy, orderId: id };
}
export function cancelV2Order(account, id, at) {
  const copy = structuredClone(account), order = copy.orders.find(o => o.id === id);
  if (!order || order.status !== 'pending') return { account: copy, error: '只能取消未成交订单；已成交持仓需要卖出' };
  order.status = 'cancelled'; order.cancelledAt = at;
  copy.journal.push({ id, type: 'cancelled', at });
  return { account: copy };
}
export function fillV2Order(account, id, { session, open, observedAt, corporateActionsVerified = false } = {}) {
  const copy = structuredClone(account), order = copy.orders.find(o => o.id === id);
  if (!order || order.status !== 'pending') return { account: copy, error: '订单不在待成交状态' };
  const fail = reason => {
    order.status = 'expired'; order.reason = reason;
    copy.journal.push({ id, type: 'expired', at: observedAt, reason });
    return { account: copy, error: reason };
  };
  if (session !== order.nextSession || !Number.isFinite(Date.parse(observedAt)) || Date.parse(observedAt) <= Date.parse(order.decisionAt) || nyDate(observedAt) < session) return fail('缺少指定下一交易日的成交观测，不回填假成交');
  if (!corporateActionsVerified || !Number.isFinite(open) || open <= 0) return fail('原始开盘价或公司行动未核验');
  const price = open * (1 + V2_RULES.slippage);
  // Remove this reservation while retaining every other pending reservation.
  order.status = 'checking';
  const plan = planV2Order(copy, order.input, order.regime, { price, add: order.add, decisionAt: order.decisionAt });
  if (!plan.valid) return fail(plan.reason);
  const amount = Math.min(order.amount, plan.amount), quantity = amount / price;
  const old = copy.positions[order.symbol];
  const nextQuantity = (old?.quantity || 0) + quantity;
  copy.positions[order.symbol] = { symbol: order.symbol, sector: order.sector,
    quantity: nextQuantity, averagePrice: ((old?.averagePrice || 0) * (old?.quantity || 0) + amount + V2_RULES.fee) / nextQuantity,
    firstPrice: old?.firstPrice || price, mark: open, stop: plan.stop,
    highClose: old?.highClose || price, plannedAmount: old?.plannedAmount || plan.plannedAmount,
    enteredAt: old?.enteredAt || observedAt, added: !!old, entrySession: old?.entrySession || session };
  copy.cash -= amount + V2_RULES.fee;
  copy.costs += V2_RULES.fee + quantity * (price - open);
  order.status = 'filled'; order.filledAt = observedAt; order.fillPrice = price; order.quantity = quantity; order.amount = amount;
  copy.journal.push({ id, type: 'buy', symbol: order.symbol, at: observedAt, session, quantity, price, fee: V2_RULES.fee, amount, version: V2_VERSION });
  return { account: copy };
}
export function sellV2Position(account, symbol, { price: observedPrice, at, quantity, reason, id } = {}) {
  const copy = structuredClone(account), p = copy.positions[symbol];
  if (!id || copy.journal.some(e => e.id === id && e.type === 'sell')) return { account: copy, error: '卖出记录缺少唯一标识或已处理' };
  if (!p || !Number.isFinite(observedPrice) || observedPrice <= 0 || !Number.isFinite(Date.parse(at)) || Date.parse(at) <= Date.parse(p.enteredAt)) return { account: copy, error: '卖出价格、持仓或时间无效' };
  const qty = quantity ?? p.quantity;
  if (!Number.isFinite(qty) || qty <= 0 || qty > p.quantity) return { account: copy, error: '卖出数量无效' };
  const price = observedPrice * (1 - V2_RULES.slippage), proceeds = qty * price - V2_RULES.fee;
  const pnl = proceeds - qty * p.averagePrice;
  if (copy.cash + proceeds < 0) return { account: copy, error: '卖出后现金不足支付费用' };
  copy.cash += proceeds; copy.realized += pnl;
  copy.costs += V2_RULES.fee + qty * (observedPrice - price);
  p.quantity -= qty;
  if (p.quantity < 1e-10) delete copy.positions[symbol];
  else p.mark = observedPrice;
  copy.journal.push({ id, type: 'sell', symbol, at, price, quantity: qty, fee: V2_RULES.fee, proceeds, pnl,
    enteredAt: p.enteredAt, reason, version: V2_VERSION });
  return { account: copy };
}
export function riskSession(account, { index, at, maxExposure, marketState, hadRiskExit = false }) {
  const copy = structuredClone(account);
  if (!Number.isInteger(index) || index < 0 || index <= (copy.lastRiskSession ?? -1)) return copy;
  // Only the exchange-calendar session index advances cooldown, not wall time.
  if (copy.lastRiskSession !== null && index !== copy.lastRiskSession + 1) throw new Error('缺少连续交易日，暂停推进风险状态');
  const { equity } = portfolioValue(copy);
  copy.highWater = Math.max(copy.highWater, equity);
  const drawdown = 1 - equity / copy.highWater;
  if (drawdown >= .12 && !copy.paused && !copy.recovery && (!copy.resumedAfterPause || equity < copy.lastTripEquity)) {
    copy.paused = true; copy.pauseUntil = index + 20; copy.caution = true; copy.lastTripEquity = equity;
  }
  if (copy.recovery && (hadRiskExit || drawdown >= .12 && equity < (copy.recoveryStartEquity || equity))) {
    copy.paused = true; copy.recovery = false; copy.pauseUntil = index + 20; copy.lastTripEquity = equity;
  }
  if (drawdown >= .08) copy.caution = true;
  copy.calmDays = drawdown < .05 ? (copy.calmDays || 0) + 1 : 0;
  if (copy.calmDays >= 5) copy.caution = false;
  const goodMarket = ['strong', 'neutral'].includes(marketState);
  copy.goodDays = copy.paused && index >= copy.pauseUntil && goodMarket ? (copy.goodDays || 0) + 1 : 0;
  if (copy.paused && copy.goodDays >= 5) {
    copy.paused = false; copy.recovery = true; copy.resumedAfterPause = true; copy.recoveryStart = index; copy.recoveryStartEquity = equity;
  }
  if (copy.recovery && index - copy.recoveryStart >= 10 && !hadRiskExit) copy.recovery = false;
  copy.maxExposure = copy.paused ? 0 : Number.isFinite(maxExposure) ? Math.min(maxExposure, copy.caution ? .4 : .8, copy.recovery ? .2 : .8) : null;
  copy.lastRiskSession = index;
  if (copy.maxExposure !== null && (copy.maxExposure < (account.maxExposure ?? .8) || copy.paused)) {
    for (const order of copy.orders.filter(o => o.status === 'pending')) {
      order.status = 'cancelled'; order.reason = '市场或组合风险降仓';
      copy.journal.push({ id: order.id, type: 'cancelled', at, reason: order.reason });
    }
  }
  return copy;
}
export function requiredReductions(account) {
  const { equity, marketValue } = portfolioValue(account);
  if (!Number.isFinite(account.maxExposure)) return [];
  const rows = Object.values(account.positions).map(p => ({ ...p, value: p.mark * p.quantity }))
    .sort((a, b) => (a.score ?? -1) - (b.score ?? -1) || a.symbol.localeCompare(b.symbol));
  const sectors = {};
  for (const p of rows) sectors[p.sector] = (sectors[p.sector] || 0) + p.value;
  let total = marketValue;
  return rows.flatMap(p => {
    const amount = Math.min(p.value, Math.max(0, p.value - Math.min(200, equity * .1),
      sectors[p.sector] - equity * .25, total - equity * account.maxExposure));
    total -= amount; sectors[p.sector] -= amount;
    return amount > 1e-8 ? [{ symbol: p.symbol, quantity: amount / p.mark, reason: '仓位 / 行业 / 风险限额', execute: 'next-open' }] : [];
  });
}
export function v2Metrics(account) {
  if (!account) return { started: false };
  const { equity, cash, marketValue } = portfolioValue(account);
  let peak = account.initialCash, maximumDrawdown = 0;
  for (const s of account.snapshots) { peak = Math.max(peak, s.equity); maximumDrawdown = Math.max(maximumDrawdown, 1 - s.equity / peak); }
  maximumDrawdown = Math.max(maximumDrawdown, 1 - equity / Math.max(peak, equity));
  const sells = account.journal.filter(e => e.type === 'sell'), wins = sells.filter(e => e.pnl > 0), losses = sells.filter(e => e.pnl < 0);
  const grossProfit = wins.reduce((s, e) => s + e.pnl, 0), grossLoss = -losses.reduce((s, e) => s + e.pnl, 0);
  const daily = account.snapshots.slice(1).map((s, i) => s.equity / account.snapshots[i].equity - 1);
  const mean = daily.length ? daily.reduce((s, n) => s + n, 0) / daily.length : 0;
  const variance = daily.length > 1 ? daily.reduce((s, n) => s + (n - mean) ** 2, 0) / (daily.length - 1) : null;
  return { started: true, equity, cash, marketValue, totalReturn: equity / account.initialCash - 1,
    maximumDrawdown, closedLots: sells.length, winRate: sells.length ? wins.length / sells.length : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    averageWinLoss: wins.length && losses.length ? grossProfit / wins.length / (grossLoss / losses.length) : null,
    annualizedVolatility: variance === null ? null : Math.sqrt(variance * 252),
    sharpe: variance > 0 ? mean / Math.sqrt(variance) * Math.sqrt(252) : null,
    costs: account.costs, holdingDays: sells.length ? sells.reduce((s, e) => s + (Date.parse(e.at) - Date.parse(e.enteredAt)) / 864e5, 0) / sells.length : null,
    limitedSample: account.snapshots.length < 126 || sells.length < 30 };
}
