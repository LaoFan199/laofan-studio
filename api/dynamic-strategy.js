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

export function rankDynamicCandidates(inputs, rules = DYNAMIC_RULES) {
  return (inputs || []).map((item) => {
    const bars = Array.isArray(item.bars) ? item.bars : [];
    const recent = bars.slice(-20);
    const averageDollarVolume = recent.length === 20
      ? average(recent.map((bar) => Number(bar.c) * Number(bar.v)))
      : null;
    const eligible = Number(item.price) >= rules.minimumPrice
      && bars.length >= rules.minimumBars
      && Number.isFinite(averageDollarVolume)
      && averageDollarVolume >= rules.minimumAverageDollarVolume
      && Number.isFinite(Number(item.analysis?.score))
      && Number(item.analysis.score) >= rules.minimumScore;
    return { ...item, eligible, averageDollarVolume };
  }).filter((item) => item.eligible)
    .sort((a, b) => Number(b.analysis.score) - Number(a.analysis.score)
      || Number(b.analysis.metrics?.relative20 || 0) - Number(a.analysis.metrics?.relative20 || 0)
      || a.symbol.localeCompare(b.symbol))
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
