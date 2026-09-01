import { evaluateMomentumCandidate, evaluateMomentumUniverse, MOMENTUM_RULES, MOMENTUM_VERSION } from './momentum.js';
import { evaluateDipOpportunity, DIP_RULES, DIP_VERSION } from './dip.js';

const ALLOWED_SYMBOLS = new Set(['MSFT', 'GOOGL', 'NVDA', 'KO', 'SCHD', 'SPY']);
const ALLOWED_ORIGIN = 'https://laofan199.github.io';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

const marketDate = (value) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date(value));

export function completedDailyBars(bars, marketIsOpen, now = new Date()) {
  if (!Array.isArray(bars) || !marketIsOpen || !bars.length || !bars.at(-1)?.t) return bars || [];
  return marketDate(bars.at(-1).t) === marketDate(now) ? bars.slice(0, -1) : bars;
}

export function analyzeBars(bars, benchmarkBars) {
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

  const factors = [
    { key: 'universe', label: '流动性白名单', score: 10, max: 10 },
    { key: 'trend20', label: '20 日趋势', score: return20 > 0 ? 15 : 0, max: 15 },
    { key: 'trend60', label: '60 日趋势', score: return60 > 0 ? 15 : 0, max: 15 },
    { key: 'sma20', label: '20 日均线', score: latest > sma20 ? 5 : 0, max: 5 },
    { key: 'sma60', label: '60 日均线', score: latest > sma60 ? 5 : 0, max: 5 },
    { key: 'relative', label: '相对 SPY 强弱', score: clamp(10 + relative20 * 200, 0, 20), max: 20 },
    { key: 'volatility', label: '波动率', score: clamp(30 - volatility * 50, 0, 20), max: 20 },
    { key: 'drawdown', label: '60 日回撤', score: clamp(10 + drawdown60 * 50, 0, 10), max: 10 }
  ].map((factor) => ({ ...factor, score: Math.round(factor.score) }));
  let score = factors.reduce((sum, factor) => sum + factor.score, 0);
  score = Math.round(clamp(score, 0, 100));

  const reasons = [];
  reasons.push(return20 > 0 ? `20日趋势 +${(return20 * 100).toFixed(1)}%` : `20日趋势 ${(return20 * 100).toFixed(1)}%`);
  reasons.push(relative20 > 0 ? `跑赢SPY ${(relative20 * 100).toFixed(1)}%` : `落后SPY ${Math.abs(relative20 * 100).toFixed(1)}%`);
  reasons.push(latest > sma60 ? '价格在60日均线上方' : '价格在60日均线下方');

  return {
    score,
    confidence: closes.length >= 90 && benchmarkCloses.length >= 90 ? '高' : '中',
    risk: volatility < 0.18 ? '较低' : volatility < 0.3 ? '中等' : '较高',
    reasons,
    factors,
    metrics: {
      return20: return20 * 100,
      return60: return60 * 100,
      relative20: relative20 * 100,
      volatility: volatility * 100,
      drawdown60: drawdown60 * 100
    }
  };
}

export function analyzeMarketRegime(benchmarkBars, universeBars = {}) {
  const closes = (benchmarkBars || []).map((bar) => Number(bar.c)).filter(Number.isFinite);
  if (closes.length < 200) {
    return {
      version: 'v1.2-shadow',
      state: 'unavailable',
      label: '数据不足',
      suggestedMaxExposure: null,
      riskScore: null,
      confidence: '低',
      reasons: [`需要至少200个SPY交易日，当前只有${closes.length}个`],
      metrics: { availableBars: closes.length }
    };
  }

  const latest = closes.at(-1);
  const sma50 = average(closes.slice(-50));
  const sma200 = average(closes.slice(-200));
  const peak = Math.max(...closes.slice(-252));
  const drawdown = (latest / peak) - 1;
  const recent = closes.slice(-21);
  const returns20 = recent.slice(1).map((close, index) => (close / recent[index]) - 1);
  const mean20 = average(returns20);
  const variance20 = average(returns20.map((value) => (value - mean20) ** 2));
  const volatility20 = Math.sqrt(variance20) * Math.sqrt(252);

  const breadthSignals = Object.values(universeBars).map((bars) => {
    const stockCloses = (bars || []).map((bar) => Number(bar.c)).filter(Number.isFinite);
    if (stockCloses.length < 60) return null;
    return stockCloses.at(-1) > average(stockCloses.slice(-60));
  }).filter((value) => value != null);
  const breadth = breadthSignals.length
    ? breadthSignals.filter(Boolean).length / breadthSignals.length
    : null;

  const factors = [
    {
      key: 'longTrend',
      label: 'SPY长期趋势',
      risk: latest < sma200 ? 2 : 0,
      detail: latest < sma200 ? '价格低于200日均线' : '价格高于200日均线'
    },
    {
      key: 'trendStructure',
      label: '趋势结构',
      risk: sma50 < sma200 ? 1 : 0,
      detail: sma50 < sma200 ? '50日均线低于200日均线' : '50日均线不低于200日均线'
    },
    {
      key: 'drawdown',
      label: '大盘回撤',
      risk: drawdown <= -0.2 ? 2 : drawdown <= -0.1 ? 1 : 0,
      detail: `距近一年高点 ${(drawdown * 100).toFixed(1)}%`
    },
    {
      key: 'volatility',
      label: '短期波动',
      risk: volatility20 >= 0.4 ? 2 : volatility20 >= 0.25 ? 1 : 0,
      detail: `20日年化波动 ${(volatility20 * 100).toFixed(1)}%`
    },
    {
      key: 'breadth',
      label: '市场宽度',
      risk: breadth == null ? 0 : breadth < 0.2 ? 2 : breadth < 0.4 ? 1 : 0,
      detail: breadth == null ? '候选池数据不足' : `${Math.round(breadth * 100)}%候选股位于60日均线上方`
    }
  ];
  const riskScore = factors.reduce((sum, factor) => sum + factor.risk, 0);
  const state = riskScore >= 4 ? 'defensive' : riskScore >= 2 ? 'watch' : 'normal';
  const settings = {
    normal: { label: '正常', suggestedMaxExposure: 80 },
    watch: { label: '警戒', suggestedMaxExposure: 50 },
    defensive: { label: '防御', suggestedMaxExposure: 25 }
  }[state];
  const activeReasons = factors.filter((factor) => factor.risk > 0).map((factor) => factor.detail);

  return {
    version: 'v1.2-shadow',
    state,
    label: settings.label,
    suggestedMaxExposure: settings.suggestedMaxExposure,
    riskScore,
    confidence: closes.length >= 252 && breadthSignals.length >= 4 ? '高' : '中',
    reasons: activeReasons.length ? activeReasons : ['趋势、回撤、波动和市场宽度未触发警戒'],
    factors,
    metrics: {
      availableBars: closes.length,
      spyVsSma200: ((latest / sma200) - 1) * 100,
      drawdown: drawdown * 100,
      volatility20: volatility20 * 100,
      breadth: breadth == null ? null : breadth * 100
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

async function loadMomentumScanner(headers, marketIsOpen, trackedSymbols = []) {
  try {
    const moversResponse = await fetch('https://data.alpaca.markets/v1beta1/screener/stocks/movers?top=50', { headers });
    if (!moversResponse.ok) throw new Error('movers unavailable');
    const movers = await moversResponse.json();
    const rawGainers = (movers.gainers || []).slice(0, 50);
    const eligibleGainers = rawGainers.filter((item) => evaluateMomentumUniverse(item.symbol, item.price).eligible);
    const symbols = [...new Set([...eligibleGainers.map((item) => item.symbol), ...trackedSymbols])].filter(Boolean).slice(0, 60);
    const scanStats = { scanned: rawGainers.length, eligibleUniverse: eligibleGainers.length, excluded: rawGainers.length - eligibleGainers.length };
    if (!symbols.length) return { version: MOMENTUM_VERSION, status: 'available', rules: MOMENTUM_RULES, scanStats, candidates: [] };

    const start = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const encodedSymbols = encodeURIComponent(symbols.join(','));
    const [snapshotsResponse, barsResponse] = await Promise.all([
      fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodedSymbols}&feed=iex`, { headers }),
      fetch(`https://data.alpaca.markets/v2/stocks/bars?symbols=${encodedSymbols}&timeframe=1Day&start=${encodeURIComponent(start)}&limit=10000&adjustment=all&feed=iex`, { headers })
    ]);
    if (!snapshotsResponse.ok || !barsResponse.ok) throw new Error('candidate details unavailable');
    const snapshots = await snapshotsResponse.json();
    const historical = await barsResponse.json();

    const moverBySymbol = Object.fromEntries(rawGainers.map((mover) => [mover.symbol, mover]));
    const candidates = symbols.map((symbol) => {
      const mover = moverBySymbol[symbol] || {};
      const snapshot = snapshots[symbol] || {};
      const price = snapshot.latestTrade?.p ?? snapshot.minuteBar?.c ?? mover.price;
      const previousClose = snapshot.prevDailyBar?.c;
      const changePercent = Number.isFinite(Number(mover.percent_change))
        ? Number(mover.percent_change)
        : price && previousClose ? ((price / previousClose) - 1) * 100 : null;
      const completedBars = completedDailyBars(historical.bars?.[symbol], marketIsOpen);
      const currentBarDate = snapshot.dailyBar?.t ? marketDate(snapshot.dailyBar.t) : null;
      const previousBars = currentBarDate ? completedBars.filter((bar) => marketDate(bar.t) !== currentBarDate) : completedBars;
      const analysis = evaluateMomentumCandidate({
        price,
        changePercent,
        currentVolume: snapshot.dailyBar?.v,
        previousVolumes: previousBars.map((bar) => bar.v),
        bid: snapshot.latestQuote?.bp,
        ask: snapshot.latestQuote?.ap
      });
      return {
        symbol,
        price,
        changePercent,
        tracked: trackedSymbols.includes(symbol),
        qualified: analysis.qualified,
        metrics: analysis.metrics,
        failedChecks: analysis.checks.filter((check) => !check.passed).map((check) => check.detail),
        timestamp: snapshot.latestTrade?.t ?? snapshot.minuteBar?.t ?? null
      };
    }).filter((item) => Number.isFinite(item.price)).sort((a, b) => Number(b.qualified) - Number(a.qualified) || b.changePercent - a.changePercent);

    return { version: MOMENTUM_VERSION, status: 'available', rules: MOMENTUM_RULES, scanStats, candidates };
  } catch {
    return {
      version: MOMENTUM_VERSION,
      status: 'unavailable',
      rules: MOMENTUM_RULES,
      reason: '异动榜或候选股明细暂不可用，策略已停止产生新信号',
      candidates: []
    };
  }
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
    const start = new Date(Date.now() - 430 * 24 * 60 * 60 * 1000).toISOString();
    const historySymbols = [...new Set([...symbols, 'SPY'])];
    const [snapshotsResponse, clockResponse, barsResponse] = await Promise.all([
      fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodeURIComponent(historySymbols.join(','))}&feed=iex`, { headers }),
      fetch('https://paper-api.alpaca.markets/v2/clock', { headers }),
      fetch(`https://data.alpaca.markets/v2/stocks/bars?symbols=${encodeURIComponent(historySymbols.join(','))}&timeframe=1Day&start=${encodeURIComponent(start)}&limit=10000&adjustment=all&feed=iex`, { headers })
    ]);
    if (!snapshotsResponse.ok || !clockResponse.ok) throw new Error('Upstream request failed');
    const snapshots = await snapshotsResponse.json();
    const clock = await clockResponse.json();
    const historical = barsResponse.ok ? await barsResponse.json() : { bars: {} };
    const quotes = {};

    for (const symbol of historySymbols) {
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

    const completedHistory = Object.fromEntries(
      historySymbols.map((symbol) => [symbol, completedDailyBars(historical.bars?.[symbol], Boolean(clock.is_open))])
    );
    const universeBars = Object.fromEntries(
      symbols.filter((symbol) => symbol !== 'SPY').map((symbol) => [symbol, completedHistory[symbol] || []])
    );
    const marketRegime = analyzeMarketRegime(completedHistory.SPY, universeBars);
    const dipOpportunities = historySymbols.map((symbol) => ({
      symbol,
      ...evaluateDipOpportunity(completedHistory[symbol])
    }));
    const dip = {
      version: DIP_VERSION,
      status: dipOpportunities.some((item) => item.status !== 'unavailable') ? 'available' : 'unavailable',
      rules: DIP_RULES,
      universe: historySymbols,
      opportunities: dipOpportunities
    };
    const trackedMomentumSymbols = String(req.query.momentumSymbols || '').toUpperCase().split(',')
      .map((value) => value.trim()).filter((value) => /^[A-Z.]{1,6}$/.test(value)).slice(0, 20);
    const momentum = await loadMomentumScanner(headers, Boolean(clock.is_open), trackedMomentumSymbols);
    const marketChart = (completedHistory.SPY || []).slice(-70).map((bar) => ({
      t: bar.t, o: Number(bar.o), h: Number(bar.h), l: Number(bar.l), c: Number(bar.c)
    })).filter((bar) => [bar.o, bar.h, bar.l, bar.c].every(Number.isFinite));

    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    return res.status(200).json({
      source: 'Alpaca IEX',
      market: { isOpen: Boolean(clock.is_open), nextOpen: clock.next_open, nextClose: clock.next_close },
      marketRegime,
      momentum,
      dip,
      quotes,
      marketChart,
      fetchedAt: new Date().toISOString()
    });
  } catch {
    return res.status(502).json({ error: 'Market data is temporarily unavailable' });
  }
}
