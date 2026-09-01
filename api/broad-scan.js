import { analyzeBars, completedDailyBars } from './market.js';
import { DYNAMIC_RULES, evaluateDynamicUniverse } from './dynamic-strategy.js';
import { BROAD_RULES, BROAD_VERSION, rankBroadCandidates } from './broad-strategy.js';

const ALLOWED_ORIGIN = 'https://laofan199.github.io';
function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin === ALLOWED_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '')) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const symbols = [...new Set(String(req.query.symbols || '').toUpperCase().split(',').map((s) => s.trim())
    .filter((s) => /^[A-Z]{1,5}(?:\.[A-Z])?$/.test(s)))].slice(0, BROAD_RULES.batchSize);
  if (!symbols.length) return res.status(400).json({ error: 'No valid symbols' });
  const key = process.env.ALPACA_API_KEY, secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) return res.status(503).json({ error: 'Market data service is not configured' });
  const headers = { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret };
  const requested = [...symbols, 'SPY'];
  const encoded = encodeURIComponent(requested.join(','));
  const start = new Date(Date.now() - 170 * 86400000).toISOString();
  try {
    const [snapshotsResponse, barsResponse, clockResponse] = await Promise.all([
      fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encoded}&feed=iex`, { headers }),
      fetch(`https://data.alpaca.markets/v2/stocks/bars?symbols=${encoded}&timeframe=1Day&start=${encodeURIComponent(start)}&limit=10000&adjustment=all&feed=iex`, { headers }),
      fetch('https://paper-api.alpaca.markets/v2/clock', { headers })
    ]);
    if (!snapshotsResponse.ok || !barsResponse.ok || !clockResponse.ok) throw new Error('batch unavailable');
    const snapshots = await snapshotsResponse.json(), historical = await barsResponse.json(), clock = await clockResponse.json();
    const spyBars = completedDailyBars(historical.bars?.SPY, Boolean(clock.is_open));
    if (spyBars.length < DYNAMIC_RULES.minimumBars) throw new Error('benchmark incomplete');
    const inputs = symbols.map((symbol) => {
      const snapshot = snapshots[symbol] || {};
      const price = snapshot.latestTrade?.p ?? snapshot.minuteBar?.c ?? snapshot.dailyBar?.c;
      const previousClose = snapshot.prevDailyBar?.c;
      const bars = completedDailyBars(historical.bars?.[symbol], Boolean(clock.is_open));
      return { symbol, price, changePercent: price && previousClose ? ((price / previousClose) - 1) * 100 : null,
        timestamp: snapshot.latestTrade?.t ?? snapshot.minuteBar?.t ?? snapshot.dailyBar?.t ?? null,
        bars, analysis: analyzeBars(bars, spyBars) };
    });
    const evaluation = evaluateDynamicUniverse(inputs, DYNAMIC_RULES);
    const candidates = rankBroadCandidates(evaluation.eligible).map(({ bars, averageDollarVolume, eligible, reasons, ...item }) => item);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ version: BROAD_VERSION, status: 'available', scanned: symbols.length,
      eligible: evaluation.eligible.length, candidates, fetchedAt: new Date().toISOString() });
  } catch {
    return res.status(502).json({ version: BROAD_VERSION, status: 'unavailable', reason: '本批市场数据不完整，未计入全市场排名' });
  }
}
