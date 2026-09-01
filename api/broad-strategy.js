export const BROAD_VERSION = 'broad-us-equity-v1-shadow';
export const BROAD_RULES = Object.freeze({ batchSize: 60, displayedCandidates: 10 });

const EXCLUDED_NAME = /warrant|right|unit|preferred|depositary note|bond|debenture|acquisition corp|etf|fund|portfolio|index|treasury/i;
const INCLUDED_NAME = /common stock|ordinary shares|class [a-z]|american depositary|ads each|shares/i;

export function isBroadMarketAsset(asset) {
  if (!asset?.tradable || asset.status !== 'active' || asset.asset_class !== 'us_equity') return false;
  if (!['NASDAQ', 'NYSE', 'AMEX', 'ARCA'].includes(asset.exchange)) return false;
  if (!/^[A-Z]{1,5}(?:\.[A-Z])?$/.test(asset.symbol || '')) return false;
  const name = String(asset.name || '');
  return INCLUDED_NAME.test(name) && !EXCLUDED_NAME.test(name);
}

export function rankBroadCandidates(candidates, limit = BROAD_RULES.displayedCandidates) {
  return [...(candidates || [])].sort((a, b) => Number(b.analysis?.score || -1) - Number(a.analysis?.score || -1)
    || Number(b.analysis?.metrics?.relative20 || 0) - Number(a.analysis?.metrics?.relative20 || 0)
    || a.symbol.localeCompare(b.symbol)).slice(0, limit);
}
