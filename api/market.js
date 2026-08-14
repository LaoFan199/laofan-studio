const ALLOWED_SYMBOLS = new Set(['MSFT', 'GOOGL', 'NVDA', 'KO', 'SCHD', 'SPY']);
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

  const requested = String(req.query.symbols || 'MSFT,GOOGL,NVDA,KO,SCHD')
    .toUpperCase().split(',').map((value) => value.trim()).filter(Boolean);
  const symbols = [...new Set(requested)].filter((symbol) => ALLOWED_SYMBOLS.has(symbol)).slice(0, 6);
  if (!symbols.length) return res.status(400).json({ error: 'No supported symbols requested' });

  const headers = { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret };
  try {
    const [snapshotsResponse, clockResponse] = await Promise.all([
      fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodeURIComponent(symbols.join(','))}&feed=iex`, { headers }),
      fetch('https://paper-api.alpaca.markets/v2/clock', { headers })
    ]);
    if (!snapshotsResponse.ok || !clockResponse.ok) throw new Error('Upstream request failed');
    const snapshots = await snapshotsResponse.json();
    const clock = await clockResponse.json();
    const quotes = {};

    for (const symbol of symbols) {
      const snapshot = snapshots[symbol];
      if (!snapshot) continue;
      const price = snapshot.latestTrade?.p ?? snapshot.minuteBar?.c ?? snapshot.dailyBar?.c;
      const previousClose = snapshot.prevDailyBar?.c;
      quotes[symbol] = {
        price,
        previousClose,
        change: price && previousClose ? price - previousClose : null,
        changePercent: price && previousClose ? ((price - previousClose) / previousClose) * 100 : null,
        timestamp: snapshot.latestTrade?.t ?? snapshot.minuteBar?.t ?? snapshot.dailyBar?.t ?? null
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
