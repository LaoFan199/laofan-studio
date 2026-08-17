const ALLOWED_SYMBOLS = new Set(['MSFT', 'GOOGL', 'NVDA', 'KO', 'SCHD', 'SPY']);
const ALLOWED_ORIGIN = 'https://laofan199.github.io';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function analyzeBars(bars, benchmarkBars) {
  if (!Array.isArray(bars) || bars.length < 61) return null;
  const closes = bars.map((bar) => Number(bar.c)).filter(Number.isFinite);
  const benchmarkCloses = (benchmarkBars || []).map((bar) => Number(bar.c)).filter(Number.isFinite);
  if (closes.length < 61) return null;

  const latest = closes.at(-1);
  const return20 = (latest / closes.at(-21)) - 1;
  const return60 = (latest / closes.at(-61)) - 1;
  const benchmark20 = benchmarkCloses.length >= 21 ? (benchmarkCloses.at(-1) / benchmarkCloses.at(-21)) - 1 : 0;
  const sma20 = average(closes.slice(-20));
  const sma60 = average(closes.slice(-60));
  const dailyReturns = closes.slice(-61).slice(1).map((close, index) => (close / closes.at(-61 + index)) - 1);
  const meanReturn = average(dailyReturns);
  const variance = average(dailyReturns.map((value) => (value - meanReturn) ** 2));
  const volatility = Math.sqrt(variance) * Math.sqrt(252);
  const peak60 = Math.max(...closes.slice(-60));
  const drawdown60 = (latest / peak60) - 1;
  const relative20 = return20 - benchmark20;

  let score = 10; // 通过高流动性白名单的基础分
  if (return20 > 0) score += 15;
  if (return60 > 0) score += 15;
  if (latest > sma20) score += 5;
  if (latest > sma60) score += 5;
  score += clamp(10 + relative20 * 200, 0, 20);
  score += clamp(30 - volatility * 50, 0, 20);
  score += clamp(10 + drawdown60 * 50, 0, 10);
  score = Math.round(clamp(score, 0, 100));

  const reasons = [];
  reasons.push(return20 > 0 ? `20日趋势 +${(return20 * 100).toFixed(1)}%` : `20日趋势 ${(return20 * 100).toFixed(1)}%`);
  reasons.push(relative20 > 0 ? `跑赢SPY ${(relative20 * 100).toFixed(1)}%` : `落后SPY ${Math.abs(relative20 * 100).toFixed(1)}%`);
  reasons.push(latest > sma60 ? '价格在60日均线上方' : '价格在60日均线下方');

  return {
    score,
    risk: volatility < 0.18 ? '较低' : volatility < 0.3 ? '中等' : '较高',
    reasons,
    metrics: {
      return20: return20 * 100,
      return60: return60 * 100,
      relative20: relative20 * 100,
      volatility: volatility * 100,
      drawdown60: drawdown60 * 100
    }
  };
}

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

  const requested = String(req.query.symbols || 'MSFT,GOOGL,NVDA,KO,SCHD')
    .toUpperCase().split(',').map((value) => value.trim()).filter(Boolean);
  const symbols = [...new Set(requested)].filter((symbol) => ALLOWED_SYMBOLS.has(symbol)).slice(0, 6);
  if (!symbols.length) return res.status(400).json({ error: 'No supported symbols requested' });

  const headers = { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret };
  try {
    const start = new Date(Date.now() - 130 * 24 * 60 * 60 * 1000).toISOString();
    const historySymbols = [...new Set([...symbols, 'SPY'])];
    const [snapshotsResponse, clockResponse, barsResponse] = await Promise.all([
      fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodeURIComponent(symbols.join(','))}&feed=iex`, { headers }),
      fetch('https://paper-api.alpaca.markets/v2/clock', { headers }),
      fetch(`https://data.alpaca.markets/v2/stocks/bars?symbols=${encodeURIComponent(historySymbols.join(','))}&timeframe=1Day&start=${encodeURIComponent(start)}&limit=1000&adjustment=all&feed=iex`, { headers })
    ]);
    if (!snapshotsResponse.ok || !clockResponse.ok) throw new Error('Upstream request failed');
    const snapshots = await snapshotsResponse.json();
    const clock = await clockResponse.json();
    const historical = barsResponse.ok ? await barsResponse.json() : { bars: {} };
    const quotes = {};

    for (const symbol of symbols) {
      const snapshot = snapshots[symbol];
      if (!snapshot) continue;
      const price = snapshot.latestTrade?.p ?? snapshot.minuteBar?.c ?? snapshot.dailyBar?.c;
      const previousClose = snapshot.prevDailyBar?.c;
      const analysis = analyzeBars(historical.bars?.[symbol], historical.bars?.SPY);
      quotes[symbol] = {
        price,
        previousClose,
        change: price && previousClose ? price - previousClose : null,
        changePercent: price && previousClose ? ((price - previousClose) / previousClose) * 100 : null,
        timestamp: snapshot.latestTrade?.t ?? snapshot.minuteBar?.t ?? snapshot.dailyBar?.t ?? null,
        analysis
      };
    }

    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    return res.status(200).json({
      source: 'Alpaca IEX',
      market: { isOpen: Boolean(clock.is_open), nextOpen: clock.next_open, nextClose: clock.next_close },
      quotes,
      fetchedAt: new Date().toISOString()
    });
  } catch {
    return res.status(502).json({ error: 'Market data is temporarily unavailable' });
  }
}
