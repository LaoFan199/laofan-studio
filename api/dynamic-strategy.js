export const DYNAMIC_VERSION = 'dynamic-universe-v1.1-manual';
export const DYNAMIC_RULES = Object.freeze({
  minimumPrice: 5,
  minimumBars: 61,
  minimumAverageDollarVolume: 50_000_000,
  minimumScore: 75,
  displayedCandidates: 10
});

export const DYNAMIC_UNIVERSE = Object.freeze([
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'AVGO', 'TSLA', 'BRK.B', 'JPM',
  'V', 'MA', 'UNH', 'XOM', 'JNJ', 'WMT', 'PG', 'HD', 'COST', 'ABBV', 'BAC', 'CRM',
  'ORCL', 'NFLX', 'AMD', 'ADBE', 'CSCO', 'PEP', 'TMO', 'ACN', 'MCD', 'LIN', 'ABT',
  'DIS', 'IBM', 'CAT', 'GE', 'ISRG', 'INTU', 'QCOM', 'TXN', 'AMAT', 'NOW', 'BKNG',
  'PM', 'GS', 'RTX', 'SPGI', 'UBER', 'LOW', 'NEE', 'DHR', 'HON', 'COP', 'AMGN',
  'SBUX', 'GILD', 'BLK', 'MDLZ', 'ADP', 'CB', 'DE', 'LMT', 'KO'
]);

const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

const dynamicSort = (a, b) => Number(b.analysis?.score || -1) - Number(a.analysis?.score || -1)
  || Number(b.analysis?.metrics?.relative20 || 0) - Number(a.analysis?.metrics?.relative20 || 0)
  || a.symbol.localeCompare(b.symbol);

export function evaluateDynamicUniverse(inputs, rules = DYNAMIC_RULES) {
  const evaluated = (inputs || []).map((item) => {
    const bars = Array.isArray(item.bars) ? item.bars : [];
    const recent = bars.slice(-20);
    const averageDollarVolume = recent.length === 20
      ? average(recent.map((bar) => Number(bar.c) * Number(bar.v)))
      : null;
    const reasons = [];
    if (!Number.isFinite(Number(item.price)) || Number(item.price) < rules.minimumPrice) reasons.push('price');
    if (bars.length < rules.minimumBars) reasons.push('history');
    if (!Number.isFinite(averageDollarVolume) || averageDollarVolume < rules.minimumAverageDollarVolume) reasons.push('liquidity');
    if (!Number.isFinite(Number(item.analysis?.score))) reasons.push('score_unavailable');
    else if (Number(item.analysis.score) < rules.minimumScore) reasons.push('score_below_minimum');
    return { ...item, eligible: reasons.length === 0, averageDollarVolume, reasons };
  });
  const eligible = evaluated.filter((item) => item.eligible).sort(dynamicSort)
    .map((item, index) => ({ ...item, qualifiedRank: index + 1 }));
  const rejected = evaluated.filter((item) => !item.eligible).sort(dynamicSort);
  return { evaluated, eligible, rejected };
}

export function rankDynamicCandidates(inputs, rules = DYNAMIC_RULES) {
  return evaluateDynamicUniverse(inputs, rules).eligible
    .slice(0, rules.displayedCandidates)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export function compareDynamicRankings(current, previous = []) {
  const previousRanks = new Map(previous.map((item, index) => [typeof item === 'string' ? item : item.symbol, index + 1]));
  const currentSymbols = new Set(current.map((item) => item.symbol));
  const candidates = current.map((item, index) => {
    const rank = index + 1;
    const previousRank = previousRanks.get(item.symbol) ?? null;
    const movement = previousRank == null ? 'new' : rank < previousRank ? 'up' : rank > previousRank ? 'down' : 'same';
    return { ...item, rank, previousRank, movement };
  });
  const exited = previous.map((item, index) => ({
    symbol: typeof item === 'string' ? item : item.symbol,
    previousRank: index + 1
  })).filter((item) => !currentSymbols.has(item.symbol));
  return { candidates, exited };
}

export function heldOutsideDynamicPool(positions = {}, candidates = []) {
  const candidateSymbols = new Set(candidates.map((item) => item.symbol));
  return Object.entries(positions).filter(([symbol, position]) =>
    position?.source?.startsWith('dynamic') && !candidateSymbols.has(symbol));
}
