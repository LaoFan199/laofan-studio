import { DYNAMIC_RULES, evaluateDynamicUniverse } from '../api/dynamic-strategy.js';

export const CORE_SYMBOLS = Object.freeze(['NVDA', 'AVGO', 'ETN', 'GEV', 'VRT', 'CCJ', 'ORCL']);

export const CORE_NAMES = Object.freeze({ NVDA: 'NVIDIA', AVGO: 'Broadcom', ETN: 'Eaton', GEV: 'GE Vernova', VRT: 'Vertiv', CCJ: 'Cameco', ORCL: 'Oracle' });

export function isToday(timestamp) {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) && date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) === new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function selectedToday(symbol, fixed = [], dynamic = null) {
  return fixed.includes(symbol) || (dynamic?.status === 'available' && isToday(dynamic.fetchedAt) && dynamic.candidates?.some(item => item.symbol === symbol)) || false;
}

// Presentation only: retain every research symbol without changing score or candidate universes.
export function buildCoreResearch(inputs = []) {
  const evaluated = evaluateDynamicUniverse(inputs).evaluated;
  return CORE_SYMBOLS.map((symbol) => {
    const item = evaluated.find((entry) => entry.symbol === symbol);
    const valid = item?.analysis && Number.isFinite(item.analysis.score)
      && item.bars?.length >= DYNAMIC_RULES.minimumBars;
    const analysis = valid ? item.analysis : null;
    const reasons = [];
    if (!analysis) reasons.push('评分数据不足，等待更新');
    else if (analysis.score < DYNAMIC_RULES.minimumScore) reasons.push(`未达到${DYNAMIC_RULES.minimumScore}分门槛`);
    if (item?.reasons.includes('price')) reasons.push('价格条件未满足');
    if (item?.reasons.includes('liquidity')) reasons.push('流动性条件未满足');
    if (analysis && !reasons.length) reasons.push('评分及基础条件达标，仍需每日候选筛选');
    return { symbol, name: CORE_NAMES[symbol], price: Number.isFinite(item?.price) && item.price > 0 ? item.price : null, analysis, reasons, scoreDate: item?.bars?.at(-1)?.t || null,
      timestamp: item?.timestamp || null };
  });
}
