import { analyzeBars, completedDailyBars } from './market.js';
import { DYNAMIC_RULES, DYNAMIC_UNIVERSE, DYNAMIC_VERSION, rankDynamicCandidates } from './dynamic-strategy.js';

const ALLOWED_ORIGIN = 'https://laofan199.github.io';

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
  const symbols = [...DYNAMIC_UNIVERSE, 'SPY'];
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
        analysis: analyzeBars(bars, benchmarkBars)
      };
    });
    const ranked = rankDynamicCandidates(inputs, { ...DYNAMIC_RULES, displayedCandidates: DYNAMIC_UNIVERSE.length });
    const candidates = ranked.slice(0, DYNAMIC_RULES.displayedCandidates).map(({ bars, ...candidate }) => candidate);
    const quotes = Object.fromEntries(inputs.filter((item) => Number.isFinite(Number(item.price))).map((item) => [item.symbol, {
      price: Number(item.price),
      changePercent: item.changePercent,
      timestamp: item.timestamp
    }]));
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({
      version: DYNAMIC_VERSION,
      status: 'available',
      source: 'Alpaca IEX',
      fetchedAt: new Date().toISOString(),
      market: { isOpen: Boolean(clock.is_open) },
      rules: DYNAMIC_RULES,
      scanStats: { universe: DYNAMIC_UNIVERSE.length, eligible: ranked.length, displayed: candidates.length },
      quotes,
      candidates
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
