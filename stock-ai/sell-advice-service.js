import { DYNAMIC_UNIVERSE } from '../api/dynamic-strategy.js';
import { CORE_SYMBOLS } from './core-research.js';
import { analyzeSellAdvice, SELL_ADVICE_VERSION } from './sell-advice.js';

const SUPPORTED = new Set([...DYNAMIC_UNIVERSE, ...CORE_SYMBOLS, 'SCHD', 'SPY']);
export default async function sellAdviceService(req, res) {
  const symbols = [...new Set(String(req.query.symbols || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean))];
  if (!symbols.length || symbols.length > 20 || symbols.some(s => !SUPPORTED.has(s))) return res.status(400).json({ error: 'Unsupported holding symbols' });
  const key = process.env.ALPACA_API_KEY, secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) return res.status(503).json({ version: SELL_ADVICE_VERSION, status: 'unavailable', reason: '行情服务未配置' });
  const headers = { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret };
  const encoded = encodeURIComponent(symbols.join(',')), start = new Date(Date.now() - 430 * 864e5).toISOString();
  try {
    const get = async url => { const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) }); if (!response.ok) throw new Error('upstream'); return response.json(); };
    const [history, snapshots, clock] = await Promise.all([
      get(`https://data.alpaca.markets/v2/stocks/bars?symbols=${encoded}&timeframe=1Day&start=${encodeURIComponent(start)}&limit=10000&adjustment=split&feed=iex`),
      get(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encoded}&feed=iex`),
      get('https://paper-api.alpaca.markets/v2/clock')
    ]);
    if (history.next_page_token) throw new Error('incomplete history');
    const now = new Date(), items = {};
    for (const symbol of symbols) {
      const quote = snapshots[symbol] || {};
      const price = quote.latestTrade?.p ?? quote.minuteBar?.c;
      const quoteAt = quote.latestTrade?.t ?? quote.minuteBar?.t;
      items[symbol] = { ...analyzeSellAdvice(history.bars?.[symbol], now), symbol,
        price: Number.isFinite(price) && price > 0 ? price : null, quoteAt: quoteAt || null };
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ version: SELL_ADVICE_VERSION, status: 'available', source: 'Alpaca IEX · 拆股调整日线',
      fetchedAt: now.toISOString(), marketIsOpen: clock.is_open === true, items });
  } catch {
    return res.status(502).json({ version: SELL_ADVICE_VERSION, status: 'unavailable', reason: '卖出评估数据暂不可用', items: {} });
  }
}
