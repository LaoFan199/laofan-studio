import { BROAD_VERSION, isBroadMarketAsset } from './broad-strategy.js';

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
  const key = process.env.ALPACA_API_KEY, secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) return res.status(503).json({ error: 'Market data service is not configured' });
  try {
    const response = await fetch('https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity', {
      headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret }
    });
    if (!response.ok) throw new Error('asset universe unavailable');
    const assets = await response.json();
    const symbols = assets.filter(isBroadMarketAsset).map((asset) => asset.symbol).sort();
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ version: BROAD_VERSION, status: 'available', symbols, count: symbols.length, fetchedAt: new Date().toISOString() });
  } catch {
    return res.status(502).json({ version: BROAD_VERSION, status: 'unavailable', reason: '全市场证券名单暂不可用' });
  }
}
