import { updateTrailingPosition } from '../api/momentum.js';
import { updateDipPosition } from '../api/dip.js';
import { compareDynamicRankings } from '../api/dynamic-strategy.js';
import { calculateFractionalOrder, FRACTIONAL_EXECUTION_VERSION, MIN_ORDER_AMOUNT } from './trading.js';

(() => {
  'use strict';
  const STARTING_CASH = 1000;
  const MIN_CASH = 200;
  const MAX_POSITION = 200;
  const BUY_SCORE = 75;
  const API_BASE = document.querySelector('meta[name="api-base"]')?.content.replace(/\/$/, '') || '';
  const ideas = [
    { symbol: 'MSFT', name: 'Microsoft', price: 421.18, score: null, changePercent: null, risk: '待计算', reasons: [] },
    { symbol: 'GOOGL', name: 'Alphabet', price: 196.42, score: null, changePercent: null, risk: '待计算', reasons: [] },
    { symbol: 'NVDA', name: 'NVIDIA', price: 181.62, score: null, changePercent: null, risk: '待计算', reasons: [] },
    { symbol: 'KO', name: 'Coca-Cola', price: 77.35, score: null, changePercent: null, risk: '待计算', reasons: [] },
    { symbol: 'SCHD', name: 'Dividend ETF', price: 29.14, score: null, changePercent: null, risk: '待计算', reasons: [] }
  ];

  const saved = JSON.parse(localStorage.getItem('laofan-paper-account') || 'null');
  let state = saved || { cash: STARTING_CASH, realized: 0, positions: {}, history: [], snapshots: [], benchmark: null };
  state.snapshots ||= [];
  state.benchmark ||= null;
  state.regimeSnapshots ||= [];
  state.momentum ||= { positions: {}, completed: [], signals: [] };
  state.momentum.positions ||= {};
  state.momentum.completed ||= [];
  state.momentum.signals ||= [];
  state.dip ||= { positions: {}, completed: [], signals: [] };
  state.dip.positions ||= {};
  state.dip.completed ||= [];
  state.dip.signals ||= [];
  state.dynamicSnapshots ||= [];
  let selected = null;
  let marketRegime = null;
  let momentumScanner = null;
  let dipScanner = null;
  let dynamicScanner = null;
  let dynamicQuotes = {};
  const $ = (id) => document.getElementById(id);
  const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  const percent = (n) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
  const shares = (n) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 6 })} 股`;

  function save() { localStorage.setItem('laofan-paper-account', JSON.stringify(state)); }
  function currentPrice(symbol) {
    return ideas.find((item) => item.symbol === symbol)?.price
      || dynamicQuotes[symbol]?.price
      || state.positions[symbol]?.lastPrice
      || 0;
  }
  function marketValue() { return Object.entries(state.positions).reduce((sum, [s, p]) => sum + currentPrice(s) * p.quantity, 0); }

  function signalFor(item) {
    if (item.score == null) return { label: '等待数据', className: 'waiting', canBuy: false };
    if (item.score >= BUY_SCORE) return { label: '候选买入', className: 'buy', canBuy: true };
    if (item.score >= 50) return { label: '继续观察', className: 'watch', canBuy: false };
    return { label: '暂不参与', className: 'avoid', canBuy: false };
  }

  function factorDetails(item) {
    if (!item.factors?.length) return '';
    return `<details class="score-details"><summary>查看评分 · 置信度${item.confidence}</summary><div>${item.factors.map((factor) =>
      `<span><b>${factor.label}</b><em>${factor.score}/${factor.max}</em></span>`
    ).join('')}</div></details>`;
  }

  function renderMarketShield() {
    if (!marketRegime) return;
    const value = marketValue();
    const equity = state.cash + value;
    const actualExposure = equity ? (value / equity) * 100 : 0;
    const stateClass = ['normal', 'watch', 'defensive'].includes(marketRegime.state) ? marketRegime.state : 'unavailable';
    $('shield-panel').className = `panel shield ${stateClass}`;
    $('shield-state').textContent = marketRegime.label;
    $('shield-state').className = `shield-state ${stateClass}`;
    $('shield-version').textContent = `${marketRegime.version} · 旁路观察 · 置信度${marketRegime.confidence}`;
    $('shield-exposure').textContent = marketRegime.suggestedMaxExposure == null ? '—' : `${marketRegime.suggestedMaxExposure}%`;
    $('shield-current-exposure').textContent = `${actualExposure.toFixed(1)}%`;
    $('shield-score').textContent = marketRegime.riskScore == null ? '—' : `${marketRegime.riskScore}/9`;
    $('shield-reasons').innerHTML = marketRegime.reasons.map((reason) => `<li>${reason}</li>`).join('');
  }

  function notifyMomentum(title, body) {
    if (!('Notification' in window) || localStorage.getItem('laofan-momentum-alerts') !== 'enabled' || Notification.permission !== 'granted') return;
    new Notification(title, { body, tag: `laofan-${title}` });
  }

  function updateMomentum(data, fetchedAt, marketIsOpen) {
    momentumScanner = data;
    if (!data || data.status !== 'available') return;
    const bySymbol = Object.fromEntries(data.candidates.map((candidate) => [candidate.symbol, candidate]));

    Object.entries(state.momentum.positions).forEach(([symbol, position]) => {
      const candidate = bySymbol[symbol];
      if (!candidate?.price) return;
      const updated = { ...updateTrailingPosition(position, candidate.price), lastObservedAt: fetchedAt };
      state.momentum.positions[symbol] = updated;
      if (updated.shouldExit) {
        state.momentum.completed.push({
          ...updated,
          exitPrice: candidate.price,
          exitedAt: fetchedAt,
          returnPercent: ((candidate.price / position.entryPrice) - 1) * 100,
          reason: '较最高价回撤15%'
        });
        delete state.momentum.positions[symbol];
        notifyMomentum(`${symbol} 模拟退出`, `现价 ${money(candidate.price)} 已低于移动线 ${money(updated.exitTrigger)}`);
      }
    });

    if (marketIsOpen && marketRegime?.state !== 'defensive') {
      const date = new Date(fetchedAt).toISOString().slice(0, 10);
      data.candidates.filter((candidate) => candidate.qualified).forEach((candidate) => {
        const signalId = `${date}:${candidate.symbol}`;
        if (state.momentum.signals.some((signal) => signal.id === signalId)) return;
        const position = {
          symbol: candidate.symbol,
          version: data.version,
          entryPrice: candidate.price,
          currentPrice: candidate.price,
          highWatermark: candidate.price,
          exitTrigger: candidate.price * 0.85,
          enteredAt: fetchedAt,
          lastObservedAt: fetchedAt,
          signalMetrics: candidate.metrics
        };
        state.momentum.signals.push({ id: signalId, symbol: candidate.symbol, price: candidate.price, time: fetchedAt, version: data.version, metrics: candidate.metrics });
        if (!state.momentum.positions[candidate.symbol]) state.momentum.positions[candidate.symbol] = position;
        notifyMomentum(`${candidate.symbol} 异动买入信号`, `影子入场 ${money(candidate.price)}；初始15%回撤线 ${money(position.exitTrigger)}`);
      });
    }
    state.momentum.signals = state.momentum.signals.slice(-300);
    state.momentum.completed = state.momentum.completed.slice(-200);
  }

  function renderMomentumPositions(positions) {
    return positions.map((position) => `<div class="momentum-row qualified">
      <span><strong class="ticker">${position.symbol}</strong><small>影子持仓 · ${position.version}</small></span>
      <span><small>模拟入场</small>${money(position.entryPrice)}</span>
      <span><small>持仓后最高</small>${money(position.highWatermark)}</span>
      <span><small>15%退出线</small>${money(position.exitTrigger)}</span>
      <span class="${position.currentPrice >= position.entryPrice ? 'positive' : 'negative'}"><small>当前模拟收益</small>${percent(((position.currentPrice / position.entryPrice) - 1) * 100)}</span>
    </div>`).join('');
  }

  function renderMomentum() {
    const active = Object.values(state.momentum.positions);
    const rules = momentumScanner?.rules;
    $('momentum-summary').innerHTML = rules ? [
      `涨幅 <strong>≥${rules.minimumChangePercent}%</strong>`,
      `相对量 <strong>≥${rules.minimumRelativeVolume}×</strong>`,
      `成交额 <strong>≥${money(rules.minimumDollarVolume)}</strong>`,
      `回撤退出 <strong>${rules.trailingDrawdownPercent}%</strong>`,
      '候选池 <strong>排除权证/低价股</strong>'
    ].map((item) => `<span class="momentum-pill">${item}</span>`).join('') : '';

    if (!momentumScanner || momentumScanner.status !== 'available') {
      $('momentum-status').textContent = momentumScanner?.reason || '等待异动榜数据';
      $('momentum-list').innerHTML = active.length ? renderMomentumPositions(active) : '<div class="momentum-empty">数据不足时停止产生新信号</div>';
      return;
    }
    const qualifiedCount = momentumScanner.candidates.filter((candidate) => candidate.qualified).length;
    const defensiveNote = marketRegime?.state === 'defensive' ? ' · 防御状态暂停新入场' : '';
    const scanStats = momentumScanner.scanStats;
    const scanLabel = scanStats ? `扫描 ${scanStats.scanned} 只 · 排除 ${scanStats.excluded} 只权证/低价证券 · ${scanStats.eligibleUniverse} 只进入候选池` : `候选及跟踪股 ${momentumScanner.candidates.length} 只`;
    $('momentum-status').textContent = `${scanLabel} · ${qualifiedCount} 只通过全部条件 · ${active.length} 个影子持仓 · ${state.momentum.completed.length} 次已退出${defensiveNote}`;
    const candidates = momentumScanner.candidates.slice(0, 5).map((candidate) => `<div class="momentum-row ${candidate.qualified ? 'qualified' : ''}">
      <span><strong class="ticker">${candidate.symbol}</strong><small>${candidate.qualified ? '模拟买入信号' : '未通过全部过滤'}</small></span>
      <span><small>现价</small>${money(candidate.price)}</span>
      <span class="positive"><small>当日涨幅</small>${percent(candidate.changePercent)}</span>
      <span><small>相对成交量</small>${candidate.metrics.relativeVolume == null ? '—' : `${candidate.metrics.relativeVolume.toFixed(1)}×`}</span>
      <span><small>买卖价差</small>${candidate.metrics.spreadPercent == null ? '—' : `${candidate.metrics.spreadPercent.toFixed(2)}%`}</span>
    </div>`).join('');
    $('momentum-list').innerHTML = renderMomentumPositions(active) + candidates || '<div class="momentum-empty">当前没有可显示的异动股票</div>';
  }

  function updateDip(data, fetchedAt, marketIsOpen, quotes) {
    dipScanner = data;
    if (!data || data.status !== 'available') return;
    Object.entries(state.dip.positions).forEach(([symbol, position]) => {
      const price = Number(quotes?.[symbol]?.price);
      const observedDate = quotes?.[symbol]?.timestamp ? new Date(quotes[symbol].timestamp).toISOString().slice(0, 10) : null;
      const updated = updateDipPosition(position, price, observedDate, data.rules);
      if (!updated) return;
      state.dip.positions[symbol] = { ...updated, lastObservedAt: fetchedAt };
      if (updated.shouldExit) {
        state.dip.completed.push({ ...updated, exitPrice: price, exitedAt: fetchedAt, reason: updated.exitReason });
        delete state.dip.positions[symbol];
      }
    });
    if (marketIsOpen) {
      data.opportunities.filter((item) => item.confirmed).forEach((item) => {
        const signalId = `${item.signalTime}:${item.symbol}`;
        if (state.dip.signals.some((signal) => signal.id === signalId)) return;
        const price = Number(quotes?.[item.symbol]?.price);
        const observedDate = quotes?.[item.symbol]?.timestamp ? new Date(quotes[item.symbol].timestamp).toISOString().slice(0, 10) : null;
        if (!Number.isFinite(price) || price <= 0 || !observedDate) return;
        const position = {
          symbol: item.symbol,
          version: data.version,
          entryPrice: price,
          currentPrice: price,
          setupLow: item.setupLow,
          stopPrice: item.setupLow * 0.98,
          drawdownAtSignalPercent: item.drawdownPercent,
          enteredAt: fetchedAt,
          lastObservedAt: fetchedAt,
          observedDates: [observedDate],
          holdingDays: 1,
          returnPercent: 0,
          shadowAmount: data.rules.shadowAmount
        };
        state.dip.signals.push({ id: signalId, symbol: item.symbol, time: fetchedAt, price, setupLow: item.setupLow, version: data.version });
        if (!state.dip.positions[item.symbol]) state.dip.positions[item.symbol] = position;
      });
    }
    state.dip.signals = state.dip.signals.slice(-300);
    state.dip.completed = state.dip.completed.slice(-200);
  }

  function renderDipPositions(positions) {
    return positions.map((position) => `<div class="momentum-row dip-confirmed">
      <span><strong class="ticker">${position.symbol}</strong><small>影子试仓 · ${position.version}</small></span>
      <span><small>模拟入场</small>${money(position.entryPrice)}</span>
      <span><small>认错退出线</small>${money(position.stopPrice)}</span>
      <span><small>已观察交易日</small>${position.holdingDays}/10</span>
      <span class="${position.returnPercent >= 0 ? 'positive' : 'negative'}"><small>当前模拟收益</small>${percent(position.returnPercent)}</span>
    </div>`).join('');
  }

  function renderDip() {
    const active = Object.values(state.dip.positions);
    const rules = dipScanner?.rules;
    $('dip-summary').innerHTML = rules ? [
      `回撤区间 <strong>${rules.minimumDrawdownPercent}%–${rules.maximumDrawdownPercent}%</strong>`,
      `止跌确认 <strong>上涨/高低点/5日线</strong>`,
      `影子试仓 <strong>${money(rules.shadowAmount)}</strong>`,
      `跌破形态低点 <strong>${rules.stopBelowSetupLowPercent}%退出</strong>`,
      `时间退出 <strong>${rules.maximumHoldingDays}日</strong>`
    ].map((item) => `<span class="momentum-pill">${item}</span>`).join('') : '';
    if (!dipScanner || dipScanner.status !== 'available') {
      $('dip-status').textContent = '完整日线不足，停止产生新信号';
      $('dip-list').innerHTML = active.length ? renderDipPositions(active) : '<div class="momentum-empty">等待数据</div>';
      return;
    }
    const watched = dipScanner.opportunities.filter((item) => item.status === 'watch').length;
    const confirmed = dipScanner.opportunities.filter((item) => item.status === 'confirmed').length;
    $('dip-status').textContent = `扫描 ${dipScanner.universe.length} 只白名单标的 · ${watched} 只等待确认 · ${confirmed} 只确认 · ${active.length} 个影子试仓 · ${state.dip.completed.length} 次已退出`;
    const opportunities = dipScanner.opportunities.filter((item) => ['watch', 'confirmed', 'excluded'].includes(item.status)).map((item) => {
      const statusLabel = item.status === 'confirmed' ? '止跌已确认' : item.status === 'watch' ? '等待止跌确认' : '回撤过深，排除';
      const checks = item.checks ? Object.values(item.checks).filter(Boolean).length : 0;
      return `<div class="momentum-row dip-${item.status}">
        <span><strong class="ticker">${item.symbol}</strong><small>${statusLabel}</small></span>
        <span><small>距60日高点</small>${percent(-item.drawdownPercent)}</span>
        <span><small>最新完整收盘</small>${money(item.latestClose)}</span>
        <span><small>确认条件</small>${item.checks ? `${checks}/3` : '—'}</span>
        <span><small>形态低点</small>${item.setupLow ? money(item.setupLow) : '—'}</span>
      </div>`;
    }).join('');
    $('dip-list').innerHTML = renderDipPositions(active) + opportunities || '<div class="momentum-empty">当前没有进入8%回撤观察区的标的</div>';
  }

  function updateDynamic(data) {
    dynamicScanner = data;
    if (!data || data.status !== 'available') return;
    dynamicQuotes = data.quotes || {};
    Object.entries(state.positions).forEach(([symbol, position]) => {
      const quote = dynamicQuotes[symbol];
      if (!quote?.price || !position.source?.startsWith('dynamic')) return;
      position.lastPrice = quote.price;
      position.lastPriceAt = quote.timestamp || data.fetchedAt;
    });
    if (!data.candidates?.length) return;
    const marketDate = data.candidates.find((item) => item.timestamp)?.timestamp
      ? new Date(data.candidates.find((item) => item.timestamp).timestamp).toISOString().slice(0, 10)
      : new Date(data.fetchedAt).toISOString().slice(0, 10);
    const previous = state.dynamicSnapshots.filter((item) => item.date !== marketDate).at(-1)?.candidates || [];
    const comparison = compareDynamicRankings(data.candidates, previous);
    dynamicScanner = { ...data, marketDate, ...comparison };
    const snapshot = {
      date: marketDate,
      version: data.version,
      fetchedAt: data.fetchedAt,
      candidates: data.candidates.map((item) => ({ symbol: item.symbol, rank: item.rank, score: item.analysis.score, price: item.price }))
    };
    const sameDate = state.dynamicSnapshots.findIndex((item) => item.date === marketDate);
    if (sameDate >= 0) state.dynamicSnapshots[sameDate] = snapshot;
    else state.dynamicSnapshots.push(snapshot);
    state.dynamicSnapshots = state.dynamicSnapshots.slice(-120);
  }

  function renderDynamic() {
    if (!dynamicScanner || dynamicScanner.status !== 'available') {
      $('dynamic-status').textContent = dynamicScanner?.reason || '等待动态候选池数据';
      $('dynamic-list').innerHTML = '<div class="momentum-empty">数据不完整时不更新排名</div>';
      $('dynamic-exits').textContent = '';
      return;
    }
    const stats = dynamicScanner.scanStats;
    const time = new Date(dynamicScanner.fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    $('dynamic-status').textContent = `扫描 ${stats.universe} 只 · ${stats.eligible} 只达到75分且全部合格 · 候选池 ${stats.displayed} 只 · ${dynamicScanner.marketDate} ${time} 更新`;
    const movementText = { new: '新进入', up: '排名上升', down: '排名下降', same: '排名不变' };
    const movementMark = (item) => item.movement === 'new' ? 'NEW' : item.movement === 'same' ? '—' : `${item.movement === 'up' ? '↑' : '↓'} ${Math.abs(item.previousRank - item.rank)}`;
    const candidateSymbols = new Set(dynamicScanner.candidates.map((item) => item.symbol));
    const activeCandidates = dynamicScanner.candidates.map((item) => `<div class="momentum-row dynamic-row">
      <span><strong class="dynamic-rank">#${item.rank}</strong><strong class="ticker">${item.symbol}</strong><small>${item.analysis.risk}风险 · 置信度${item.analysis.confidence}</small></span>
      <span class="score"><small>量化分数</small>${item.analysis.score}/100</span>
      <span><small>最新价格</small>${money(item.price)}</span>
      <span class="${item.analysis.metrics.relative20 >= 0 ? 'positive' : 'negative'}"><small>20日相对SPY</small>${percent(item.analysis.metrics.relative20)}</span>
      <span><span class="movement movement-${item.movement}"><small>${movementText[item.movement]}</small>${movementMark(item)}</span><button class="trade-button dynamic-buy" data-dynamic-symbol="${item.symbol}" ${item.analysis.score >= BUY_SCORE ? '' : 'disabled'}>模拟买入</button></span>
    </div>`).join('');
    const heldOutsidePool = Object.entries(state.positions).filter(([symbol, position]) => position.source?.startsWith('dynamic') && !candidateSymbols.has(symbol));
    const heldRows = heldOutsidePool.map(([symbol, position]) => {
      const price = currentPrice(symbol);
      const pnlRate = position.avgPrice ? ((price / position.avgPrice) - 1) * 100 : 0;
      return `<div class="momentum-row dynamic-row dynamic-held">
        <span><strong class="ticker">${symbol}</strong><small>已持有 · 已退出候选池</small></span>
        <span><small>候选资格</small>已失效</span>
        <span><small>最近有效价格</small>${money(price)}</span>
        <span class="${pnlRate >= 0 ? 'positive' : 'negative'}"><small>持仓收益</small>${percent(pnlRate)}</span>
        <span><small>处理方式</small>继续跟踪，不自动卖出</span>
      </div>`;
    }).join('');
    $('dynamic-list').innerHTML = activeCandidates + heldRows;
    const heldExited = dynamicScanner.exited.filter((item) => state.positions[item.symbol]?.source?.startsWith('dynamic'));
    $('dynamic-exits').textContent = dynamicScanner.exited.length
      ? `本次自动退出候选池：${dynamicScanner.exited.map((item) => `${item.symbol}（原#${item.previousRank}${heldExited.some((held) => held.symbol === item.symbol) ? '，已持有继续跟踪' : ''}）`).join('、')}`
      : '本次没有股票退出前10；首次记录时全部显示为“新进入”。';
  }

  function renderIdeas() {
    $('ideas-body').innerHTML = ideas.map((item) => { const signal = signalFor(item); return `<tr>
      <td><span class="ticker">${item.symbol}</span><span class="company">${item.name}</span><span class="reason">${item.reasons.join(' · ') || '等待历史数据计算'}</span>${factorDetails(item)}</td>
      <td>${money(item.price)}</td><td class="score">${item.score == null ? '待计算' : `${item.score}/100`}</td><td class="${item.changePercent >= 0 ? 'positive' : 'negative'}">${percent(item.changePercent)}</td>
      <td class="${item.risk === '较低' ? 'risk-low' : 'risk-medium'}">${item.risk}</td>
      <td><span class="signal ${signal.className}">${signal.label}</span><button class="trade-button" data-symbol="${item.symbol}" ${signal.canBuy ? '' : 'disabled'}>模拟买入</button></td>
    </tr>`; }).join('');
  }

  function render() {
    const value = marketValue();
    const equity = state.cash + value;
    const rate = ((equity - STARTING_CASH) / STARTING_CASH) * 100;
    $('equity').textContent = money(equity);
    $('cash').textContent = money(state.cash);
    $('market-value').textContent = money(value);
    $('realized').textContent = money(state.realized);
    $('realized').className = state.realized >= 0 ? 'positive' : 'negative';
    $('return-rate').textContent = `总收益 ${rate >= 0 ? '+' : ''}${rate.toFixed(2)}%`;
    $('position-count').textContent = `${Object.keys(state.positions).length} 个持仓`;
    const unrealized = Object.entries(state.positions).reduce((sum, [symbol, p]) => sum + (currentPrice(symbol) - p.avgPrice) * p.quantity, 0);
    $('unrealized').textContent = `${unrealized >= 0 ? '+' : ''}${money(unrealized)}`;
    $('unrealized').className = unrealized >= 0 ? 'positive' : 'negative';
    if (state.benchmark?.startPrice && state.benchmark.currentPrice) {
      const benchmarkRate = ((state.benchmark.currentPrice / state.benchmark.startPrice) - 1) * 100;
      const excess = rate - benchmarkRate;
      $('benchmark-return').textContent = `SPY ${percent(benchmarkRate)} · 超额 ${percent(excess)}`;
    }
    renderMarketShield();
    renderMomentum();
    renderDip();
    renderDynamic();

    const entries = Object.entries(state.positions);
    $('positions').className = entries.length ? '' : 'empty';
    $('positions').innerHTML = entries.length ? entries.map(([symbol, p]) => {
      const price = currentPrice(symbol); const pnl = (price - p.avgPrice) * p.quantity;
      const pnlRate = p.avgPrice ? ((price / p.avgPrice) - 1) * 100 : 0;
      const priceLabel = p.source?.startsWith('dynamic') && p.lastPriceAt ? `最近有效价 · ${new Date(p.lastPriceAt).toLocaleDateString('zh-CN')}` : '现价';
      return `<div class="position"><strong>${symbol}<span class="company">${shares(p.quantity)}</span></strong><span>成本 ${money(p.avgPrice * p.quantity)}<small>均价 ${money(p.avgPrice)}</small></span><span>现值 ${money(price * p.quantity)}<small>${priceLabel} ${money(price)}</small></span><span class="${pnl >= 0 ? 'positive' : 'negative'}">${pnl >= 0 ? '+' : ''}${money(pnl)}<small>${percent(pnlRate)}</small></span><button class="sell-button" data-sell="${symbol}">全部卖出</button></div>`;
    }).join('') : '还没有持仓。可从候选股中发起模拟买入。';

    $('history').className = state.history.length ? '' : 'empty';
    $('history').innerHTML = state.history.length ? state.history.slice().reverse().map((h) => `<div class="history-row"><strong>${h.type} ${h.symbol}</strong><span>${shares(h.quantity)}</span><span>${money(h.price)}</span><span>${h.time}</span><span>${money(h.total)}</span></div>`).join('') : '交易记录为空。';
    save();
  }

  function openOrder(symbol, source = 'fixed') {
    selected = source === 'fixed' ? ideas.find((item) => item.symbol === symbol) : null;
    if (source === 'dynamic') {
      const candidate = dynamicScanner?.candidates?.find((item) => item.symbol === symbol);
      if (candidate) selected = {
        symbol: candidate.symbol,
        name: '动态候选',
        price: candidate.price,
        score: candidate.analysis.score,
        risk: candidate.analysis.risk,
        confidence: candidate.analysis.confidence,
        source: 'dynamic-manual-v1',
        strategyVersion: dynamicScanner.version,
        timestamp: candidate.timestamp
      };
    }
    if (!selected || !signalFor(selected).canBuy) return;
    $('order-symbol').textContent = selected.symbol;
    $('order-price').textContent = `模拟成交参考价 ${money(selected.price)}`;
    $('order-signal').textContent = `量化分数 ${selected.score}/100 · 置信度${selected.confidence} · 风险${selected.risk}${selected.source ? ' · 动态候选，由你确认' : ''}`;
    $('order-shield').textContent = marketRegime
      ? `危机防护挑战者：${marketRegime.label}，建议总仓位不超过 ${marketRegime.suggestedMaxExposure ?? '—'}%（当前不自动拦截）`
      : '危机防护挑战者：等待市场状态数据';
    const current = state.positions[selected.symbol] ? state.positions[selected.symbol].quantity * selected.price : 0;
    const initial = calculateFractionalOrder({ amount: 50, price: selected.price, cash: state.cash, currentPositionValue: current, minimumCash: MIN_CASH, maximumPosition: MAX_POSITION });
    $('order-amount').value = Math.min(50, initial.maximumAllowed).toFixed(2);
    validateOrder(); $('trade-dialog').showModal();
  }

  function validateOrder() {
    const current = selected && state.positions[selected.symbol] ? state.positions[selected.symbol].quantity * selected.price : 0;
    const order = calculateFractionalOrder({
      amount: $('order-amount').value,
      price: selected?.price,
      cash: state.cash,
      currentPositionValue: current,
      minimumCash: MIN_CASH,
      maximumPosition: MAX_POSITION,
      minimumOrder: MIN_ORDER_AMOUNT
    });
    $('order-check').innerHTML = `预计获得：<strong>${shares(order.quantity)}</strong><br>本次金额：<strong>${money(order.amount)}</strong> · 当前最多还可投入 ${money(order.maximumAllowed)}<br>单股累计最多 ${money(MAX_POSITION)}，账户至少保留 ${money(MIN_CASH)} 现金。`;
    $('confirm-order').disabled = !order.valid;
    return order;
  }

  function buy() {
    const order = validateOrder(); if (!order.valid) return;
    const old = state.positions[selected.symbol] || { quantity: 0, avgPrice: 0 };
    const quantity = old.quantity + order.quantity;
    state.positions[selected.symbol] = {
      ...old,
      quantity,
      avgPrice: ((old.quantity * old.avgPrice) + order.amount) / quantity,
      executionVersion: FRACTIONAL_EXECUTION_VERSION,
      source: old.source || selected.source || 'fixed-v1.1',
      strategyVersion: old.strategyVersion || selected.strategyVersion || 'v1.1',
      lastPrice: selected.price,
      lastPriceAt: selected.timestamp || new Date().toISOString()
    };
    state.cash = Math.round((state.cash - order.amount + Number.EPSILON) * 100) / 100;
    state.history.push({ type: '买入', symbol: selected.symbol, quantity: order.quantity, price: selected.price, total: order.amount, score: selected.score, confidence: selected.confidence, source: selected.source || 'fixed-v1.1', strategyVersion: selected.strategyVersion || 'v1.1', executionVersion: FRACTIONAL_EXECUTION_VERSION, time: new Date().toLocaleDateString('zh-CN') });
    render(); $('trade-dialog').close();
  }

  function sell(symbol) {
    const p = state.positions[symbol]; const price = currentPrice(symbol); const total = price * p.quantity;
    state.cash += total; state.realized += (price - p.avgPrice) * p.quantity;
    state.history.push({ type: '卖出', symbol, quantity: p.quantity, price, total, executionVersion: p.executionVersion || 'legacy-whole-share', time: new Date().toLocaleDateString('zh-CN') });
    delete state.positions[symbol]; render();
  }

  async function loadMarketData() {
    if (!API_BASE) {
      $('market-status').textContent = '演示行情 · 等待服务器连接';
      return;
    }
    try {
      const symbols = ideas.map((item) => item.symbol).join(',');
      const momentumSymbols = Object.keys(state.momentum.positions).join(',');
      const response = await fetch(`${API_BASE}/api/market?symbols=${encodeURIComponent(symbols)}&momentumSymbols=${encodeURIComponent(momentumSymbols)}`);
      if (!response.ok) throw new Error('market request failed');
      const data = await response.json();
      marketRegime = data.marketRegime || null;
      ideas.forEach((item) => {
        const quote = data.quotes[item.symbol];
        if (quote?.price) item.price = quote.price;
        if (quote?.changePercent != null) item.changePercent = quote.changePercent;
        if (quote?.analysis) {
          item.score = quote.analysis.score;
          item.risk = quote.analysis.risk;
          item.reasons = quote.analysis.reasons || [];
          item.factors = quote.analysis.factors || [];
          item.confidence = quote.analysis.confidence || '中';
        }
      });
      updateMomentum(data.momentum || null, data.fetchedAt, Boolean(data.market.isOpen));
      updateDip(data.dip || null, data.fetchedAt, Boolean(data.market.isOpen), data.quotes);
      const spy = data.quotes.SPY;
      if (spy?.price) {
        state.benchmark ||= { startPrice: spy.price, startedAt: data.fetchedAt };
        state.benchmark.currentPrice = spy.price;
      }
      ideas.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      const time = new Date(data.fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      $('market-status').className = `updated ${data.market.isOpen ? 'market-open' : 'market-closed'}`;
      $('market-status').textContent = `${data.market.isOpen ? '● 美股已开市' : '● 美股已收盘'} · Alpaca IEX · ${time} 更新`;
      const snapshotDate = new Date(data.fetchedAt).toISOString().slice(0, 10);
      const snapshot = { date: snapshotDate, equity: state.cash + marketValue(), spy: spy?.price || null };
      const existingSnapshot = state.snapshots.findIndex((item) => item.date === snapshotDate);
      if (existingSnapshot >= 0) state.snapshots[existingSnapshot] = snapshot;
      else state.snapshots.push(snapshot);
      state.snapshots = state.snapshots.slice(-120);
      if (marketRegime) {
        const regimeSnapshot = {
          date: snapshotDate,
          version: marketRegime.version,
          state: marketRegime.state,
          riskScore: marketRegime.riskScore,
          suggestedMaxExposure: marketRegime.suggestedMaxExposure,
          actualExposure: ((marketValue() / (state.cash + marketValue())) * 100) || 0,
          metrics: marketRegime.metrics
        };
        const existingRegime = state.regimeSnapshots.findIndex((item) => item.date === snapshotDate);
        if (existingRegime >= 0) state.regimeSnapshots[existingRegime] = regimeSnapshot;
        else state.regimeSnapshots.push(regimeSnapshot);
        state.regimeSnapshots = state.regimeSnapshots.slice(-120);
      }
      renderIdeas(); render();
    } catch {
      $('market-status').textContent = '真实行情暂不可用 · 显示演示价格';
    }
  }

  async function loadDynamicData() {
    if (!API_BASE) return;
    try {
      const response = await fetch(`${API_BASE}/api/dynamic`);
      if (!response.ok) throw new Error('dynamic request failed');
      updateDynamic(await response.json());
    } catch {
      dynamicScanner = { status: 'unavailable', reason: '动态候选池暂不可用，固定5只基准组不受影响' };
    }
    renderDynamic(); save();
  }

  document.addEventListener('click', (e) => {
    if (e.target.matches('[data-symbol]')) openOrder(e.target.dataset.symbol);
    if (e.target.matches('[data-dynamic-symbol]')) openOrder(e.target.dataset.dynamicSymbol, 'dynamic');
    if (e.target.matches('[data-sell]')) sell(e.target.dataset.sell);
  });
  $('order-amount').addEventListener('input', validateOrder);
  document.querySelectorAll('[data-order-amount]').forEach((button) => button.addEventListener('click', () => {
    const current = selected && state.positions[selected.symbol] ? state.positions[selected.symbol].quantity * selected.price : 0;
    const limit = calculateFractionalOrder({ amount: 0, price: selected?.price, cash: state.cash, currentPositionValue: current, minimumCash: MIN_CASH, maximumPosition: MAX_POSITION }).maximumAllowed;
    $('order-amount').value = button.dataset.orderAmount === 'max' ? limit.toFixed(2) : button.dataset.orderAmount;
    validateOrder();
  }));
  $('trade-form').addEventListener('submit', (e) => { e.preventDefault(); buy(); });
  $('enable-momentum-alerts').addEventListener('click', async () => {
    if (!('Notification' in window)) { $('enable-momentum-alerts').textContent = '浏览器不支持通知'; return; }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      localStorage.setItem('laofan-momentum-alerts', 'enabled');
      $('enable-momentum-alerts').textContent = '网页通知已开启';
    } else $('enable-momentum-alerts').textContent = '通知未授权';
  });
  if ('Notification' in window && Notification.permission === 'granted' && localStorage.getItem('laofan-momentum-alerts') === 'enabled') $('enable-momentum-alerts').textContent = '网页通知已开启';
  $('reset-button').addEventListener('click', () => { if (confirm('确定清除全部模拟交易记录并恢复到 $1,000 吗？')) { state = { cash: STARTING_CASH, realized: 0, positions: {}, history: [], snapshots: [], benchmark: null, regimeSnapshots: [], momentum: { positions: {}, completed: [], signals: [] }, dip: { positions: {}, completed: [], signals: [] }, dynamicSnapshots: [] }; render(); } });
  renderIdeas(); render(); loadMarketData(); loadDynamicData();
  setInterval(loadMarketData, 60 * 1000);
  setInterval(loadDynamicData, 5 * 60 * 1000);
})();
