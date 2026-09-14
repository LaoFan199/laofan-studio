import { analyzeBars, completedDailyBars } from './market.js';
import { DYNAMIC_RULES } from './dynamic-strategy.js';
import { CORE_SYMBOLS, buildCoreResearch } from '../stock-ai/core-research.js';

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
  const symbols = CORE_SYMBOLS;
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
    const items = buildCoreResearch(inputs);
    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json({ status: 'available', items,
      minimumScore: DYNAMIC_RULES.minimumScore, fetchedAt: new Date().toISOString(), source: 'Alpaca IEX' });
  } catch {
    return res.status(502).json({ status: 'unavailable', reason: '观察池行情暂不可用，等待下次刷新' });
  }
}
