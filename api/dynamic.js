import { analyzeBars, completedDailyBars } from './market.js';
import { DYNAMIC_RULES, DYNAMIC_UNIVERSE, DYNAMIC_VERSION, evaluateDynamicUniverse } from './dynamic-strategy.js';
import { diagnoseDownside, DOWNSIDE_VERSION } from './downside.js';
import { evaluateDipOpportunity, DIP_DYNAMIC_VERSION, DIP_RULES } from './dip.js';

const ALLOWED_ORIGIN = 'https://laofan199.github.io';
const SECTOR_BY_SYMBOL = Object.freeze({
  AAPL:'XLK',MSFT:'XLK',GOOGL:'XLC',AMZN:'XLY',NVDA:'XLK',META:'XLC',AVGO:'XLK',TSLA:'XLY','BRK.B':'XLF',JPM:'XLF',V:'XLF',MA:'XLF',UNH:'XLV',XOM:'XLE',JNJ:'XLV',WMT:'XLP',PG:'XLP',HD:'XLY',COST:'XLP',ABBV:'XLV',BAC:'XLF',CRM:'XLK',ORCL:'XLK',NFLX:'XLC',AMD:'XLK',ADBE:'XLK',CSCO:'XLK',PEP:'XLP',TMO:'XLV',ACN:'XLK',MCD:'XLY',LIN:'XLB',ABT:'XLV',DIS:'XLC',IBM:'XLK',CAT:'XLI',GE:'XLI',ISRG:'XLV',INTU:'XLK',QCOM:'XLK',TXN:'XLK',AMAT:'XLK',NOW:'XLK',BKNG:'XLY',PM:'XLP',GS:'XLF',RTX:'XLI',SPGI:'XLF',UBER:'XLI',LOW:'XLY',NEE:'XLU',DHR:'XLV',HON:'XLI',COP:'XLE',AMGN:'XLV',SBUX:'XLY',GILD:'XLV',BLK:'XLF',MDLZ:'XLP',ADP:'XLI',CB:'XLF',DE:'XLI',LMT:'XLI',KO:'XLP'
});
const SECTOR_ETFS = [...new Set(Object.values(SECTOR_BY_SYMBOL))];
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin === ALLOWED_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) return res.status(503).json({ error: 'Market data service is not configured' });

  const headers = { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret };
  const symbols = [...DYNAMIC_UNIVERSE, 'SPY', ...SECTOR_ETFS];
  const encodedSymbols = encodeURIComponent(symbols.join(','));
  const start = new Date(Date.now() - 170 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const [snapshotsResponse, barsResponse, clockResponse] = await Promise.all([
      fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodedSymbols}&feed=iex`, { headers }),
      fetch(`https://data.alpaca.markets/v2/stocks/bars?symbols=${encodedSymbols}&timeframe=1Day&start=${encodeURIComponent(start)}&limit=10000&adjustment=all&feed=iex`, { headers }),
      fetch('https://paper-api.alpaca.markets/v2/clock', { headers })
    ]);
    if (!snapshotsResponse.ok || !barsResponse.ok || !clockResponse.ok) throw new Error('dynamic universe data unavailable');
    const snapshots = await snapshotsResponse.json();
    const historical = await barsResponse.json();
    const clock = await clockResponse.json();
    const benchmarkBars = completedDailyBars(historical.bars?.SPY, Boolean(clock.is_open));
    if (benchmarkBars.length < DYNAMIC_RULES.minimumBars) throw new Error('benchmark history incomplete');

    const inputs = DYNAMIC_UNIVERSE.map((symbol) => {
      const snapshot = snapshots[symbol] || {};
      const price = snapshot.latestTrade?.p ?? snapshot.minuteBar?.c ?? snapshot.dailyBar?.c;
      const previousClose = snapshot.prevDailyBar?.c;
      const bars = completedDailyBars(historical.bars?.[symbol], Boolean(clock.is_open));
      return {
        symbol,
        price,
        changePercent: price && previousClose ? ((price / previousClose) - 1) * 100 : null,
        timestamp: snapshot.latestTrade?.t ?? snapshot.minuteBar?.t ?? snapshot.dailyBar?.t ?? null,
        bars,
        analysis: analyzeBars(bars, benchmarkBars),
        downside: diagnoseDownside(
          bars,
          benchmarkBars,
          completedDailyBars(historical.bars?.[SECTOR_BY_SYMBOL[symbol]], Boolean(clock.is_open))
        ),
        sectorEtf: SECTOR_BY_SYMBOL[symbol]
      };
    });
    const evaluation = evaluateDynamicUniverse(inputs, DYNAMIC_RULES);
    const ranked = evaluation.eligible;
    const candidates = ranked.slice(0, DYNAMIC_RULES.displayedCandidates).map(({ bars, ...candidate }) => candidate);
    const nearMisses = ranked.slice(DYNAMIC_RULES.displayedCandidates, DYNAMIC_RULES.displayedCandidates + 10)
      .map(({ bars, ...candidate }) => candidate);
    const diagnostics = evaluation.evaluated.map(({ bars, eligible, reasons, averageDollarVolume, ...item }) => ({
      symbol: item.symbol,
      eligible,
      inCandidatePool: eligible && ranked.findIndex((candidate) => candidate.symbol === item.symbol) < DYNAMIC_RULES.displayedCandidates,
      qualifiedRank: ranked.find((candidate) => candidate.symbol === item.symbol)?.qualifiedRank ?? null,
      reasons,
      price: Number.isFinite(Number(item.price)) ? Number(item.price) : null,
      score: Number.isFinite(Number(item.analysis?.score)) ? Number(item.analysis.score) : null,
      relative20: Number.isFinite(Number(item.analysis?.metrics?.relative20)) ? Number(item.analysis.metrics.relative20) : null,
      averageDollarVolume
    }));
    const quotes = Object.fromEntries(inputs.filter((item) => Number.isFinite(Number(item.price))).map((item) => [item.symbol, {
      price: Number(item.price),
      changePercent: item.changePercent,
      timestamp: item.timestamp
    }]));
    const dipUniverse = inputs.filter((item) => {
      const recent = item.bars.slice(-20);
      const averageDollarVolume = recent.length === 20
        ? average(recent.map((bar) => Number(bar.c) * Number(bar.v)))
        : null;
      return Number(item.price) >= DYNAMIC_RULES.minimumPrice
        && item.bars.length >= DIP_RULES.minimumBars
        && Number.isFinite(averageDollarVolume)
        && averageDollarVolume >= DYNAMIC_RULES.minimumAverageDollarVolume;
    });
    const dip = {
      version: DIP_DYNAMIC_VERSION,
      status: dipUniverse.length ? 'available' : 'unavailable',
      rules: DIP_RULES,
      universe: dipUniverse.map((item) => item.symbol),
      opportunities: dipUniverse.map((item) => ({ symbol: item.symbol, ...evaluateDipOpportunity(item.bars) }))
    };
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({
      version: DYNAMIC_VERSION,
      downsideVersion: DOWNSIDE_VERSION,
      status: 'available',
      source: 'Alpaca IEX',
      fetchedAt: new Date().toISOString(),
      market: { isOpen: Boolean(clock.is_open) },
      rules: DYNAMIC_RULES,
      scanStats: { universe: DYNAMIC_UNIVERSE.length, eligible: ranked.length, displayed: candidates.length },
      quotes,
      candidates,
      nearMisses,
      diagnostics,
      dip
    });
  } catch {
    return res.status(502).json({
      version: DYNAMIC_VERSION,
      status: 'unavailable',
      reason: '动态候选池数据不完整，已停止更新排名',
      candidates: []
    });
  }
}
