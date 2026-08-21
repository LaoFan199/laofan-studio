import { updateTrailingPosition } from '../api/momentum.js';

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
  let selected = null;
  let marketRegime = null;
  let momentumScanner = null;
  const $ = (id) => document.getElementById(id);
  const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  const percent = (n) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

  function save() { localStorage.setItem('laofan-paper-account', JSON.stringify(state)); }
  function currentPrice(symbol) { return ideas.find((item) => item.symbol === symbol)?.price || 0; }
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
      `回撤退出 <strong>${rules.trailingDrawdownPercent}%</strong>`
    ].map((item) => `<span class="momentum-pill">${item}</span>`).join('') : '';

    if (!momentumScanner || momentumScanner.status !== 'available') {
      $('momentum-status').textContent = momentumScanner?.reason || '等待异动榜数据';
      $('momentum-list').innerHTML = active.length ? renderMomentumPositions(active) : '<div class="momentum-empty">数据不足时停止产生新信号</div>';
      return;
    }
    const qualifiedCount = momentumScanner.candidates.filter((candidate) => candidate.qualified).length;
    const defensiveNote = marketRegime?.state === 'defensive' ? ' · 防御状态暂停新入场' : '';
    $('momentum-status').textContent = `扫描涨幅榜及跟踪股共 ${momentumScanner.candidates.length} 只 · ${qualifiedCount} 只通过全部条件 · ${active.length} 个影子持仓 · ${state.momentum.completed.length} 次已退出${defensiveNote}`;
    const candidates = momentumScanner.candidates.slice(0, 5).map((candidate) => `<div class="momentum-row ${candidate.qualified ? 'qualified' : ''}">
      <span><strong class="ticker">${candidate.symbol}</strong><small>${candidate.qualified ? '模拟买入信号' : '未通过全部过滤'}</small></span>
      <span><small>现价</small>${money(candidate.price)}</span>
      <span class="positive"><small>当日涨幅</small>${percent(candidate.changePercent)}</span>
      <span><small>相对成交量</small>${candidate.metrics.relativeVolume == null ? '—' : `${candidate.metrics.relativeVolume.toFixed(1)}×`}</span>
      <span><small>买卖价差</small>${candidate.metrics.spreadPercent == null ? '—' : `${candidate.metrics.spreadPercent.toFixed(2)}%`}</span>
    </div>`).join('');
    $('momentum-list').innerHTML = renderMomentumPositions(active) + candidates || '<div class="momentum-empty">当前没有可显示的异动股票</div>';
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

    const entries = Object.entries(state.positions);
    $('positions').className = entries.length ? '' : 'empty';
    $('positions').innerHTML = entries.length ? entries.map(([symbol, p]) => {
      const price = currentPrice(symbol); const pnl = (price - p.avgPrice) * p.quantity;
      const pnlRate = p.avgPrice ? ((price / p.avgPrice) - 1) * 100 : 0;
      return `<div class="position"><strong>${symbol}<span class="company">${p.quantity} 股</span></strong><span>成本 ${money(p.avgPrice * p.quantity)}<small>均价 ${money(p.avgPrice)}</small></span><span>现值 ${money(price * p.quantity)}<small>现价 ${money(price)}</small></span><span class="${pnl >= 0 ? 'positive' : 'negative'}">${pnl >= 0 ? '+' : ''}${money(pnl)}<small>${percent(pnlRate)}</small></span><button class="sell-button" data-sell="${symbol}">全部卖出</button></div>`;
    }).join('') : '还没有持仓。可从候选股中发起模拟买入。';

    $('history').className = state.history.length ? '' : 'empty';
    $('history').innerHTML = state.history.length ? state.history.slice().reverse().map((h) => `<div class="history-row"><strong>${h.type} ${h.symbol}</strong><span>${h.quantity} 股</span><span>${money(h.price)}</span><span>${h.time}</span><span>${money(h.total)}</span></div>`).join('') : '交易记录为空。';
    save();
  }

  function openOrder(symbol) {
    selected = ideas.find((item) => item.symbol === symbol);
    if (!selected || !signalFor(selected).canBuy) return;
    $('order-symbol').textContent = selected.symbol;
    $('order-price').textContent = `模拟成交参考价 ${money(selected.price)}`;
    $('order-signal').textContent = `量化分数 ${selected.score}/100 · 置信度${selected.confidence} · 风险${selected.risk}`;
    $('order-shield').textContent = marketRegime
      ? `危机防护挑战者：${marketRegime.label}，建议总仓位不超过 ${marketRegime.suggestedMaxExposure ?? '—'}%（当前不自动拦截）`
      : '危机防护挑战者：等待市场状态数据';
    $('order-quantity').value = 1;
    validateOrder(); $('trade-dialog').showModal();
  }

  function validateOrder() {
    const qty = Math.max(0, parseInt($('order-quantity').value, 10) || 0);
    const total = selected ? selected.price * qty : 0;
    const current = selected && state.positions[selected.symbol] ? state.positions[selected.symbol].quantity * selected.price : 0;
    const valid = qty > 0 && total <= state.cash - MIN_CASH && total + current <= MAX_POSITION;
    $('order-check').innerHTML = `订单金额：<strong>${money(total)}</strong><br>单股最多 ${money(MAX_POSITION)}，账户至少保留 ${money(MIN_CASH)} 现金。`;
    $('confirm-order').disabled = !valid;
    return { qty, total, valid };
  }

  function buy() {
    const order = validateOrder(); if (!order.valid) return;
    const old = state.positions[selected.symbol] || { quantity: 0, avgPrice: 0 };
    const quantity = old.quantity + order.qty;
    state.positions[selected.symbol] = { quantity, avgPrice: ((old.quantity * old.avgPrice) + order.total) / quantity };
    state.cash -= order.total;
    state.history.push({ type: '买入', symbol: selected.symbol, quantity: order.qty, price: selected.price, total: order.total, time: new Date().toLocaleDateString('zh-CN') });
    render(); $('trade-dialog').close();
  }

  function sell(symbol) {
    const p = state.positions[symbol]; const price = currentPrice(symbol); const total = price * p.quantity;
    state.cash += total; state.realized += (price - p.avgPrice) * p.quantity;
    state.history.push({ type: '卖出', symbol, quantity: p.quantity, price, total, time: new Date().toLocaleDateString('zh-CN') });
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
      updateMomentum(data.momentum || null, data.fetchedAt, Boolean(data.market.isOpen));
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

  document.addEventListener('click', (e) => {
    if (e.target.matches('[data-symbol]')) openOrder(e.target.dataset.symbol);
    if (e.target.matches('[data-sell]')) sell(e.target.dataset.sell);
  });
  $('order-quantity').addEventListener('input', validateOrder);
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
  $('reset-button').addEventListener('click', () => { if (confirm('确定清除全部模拟交易记录并恢复到 $1,000 吗？')) { state = { cash: STARTING_CASH, realized: 0, positions: {}, history: [], snapshots: [], benchmark: null, regimeSnapshots: [], momentum: { positions: {}, completed: [], signals: [] } }; render(); } });
  renderIdeas(); render(); loadMarketData();
  setInterval(loadMarketData, 60 * 1000);
})();
