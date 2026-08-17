(() => {
  'use strict';
  const STARTING_CASH = 1000;
  const MIN_CASH = 200;
  const MAX_POSITION = 200;
  const API_BASE = document.querySelector('meta[name="api-base"]')?.content.replace(/\/$/, '') || '';
  const ideas = [
    { symbol: 'MSFT', name: 'Microsoft', price: 421.18, score: null, changePercent: null, risk: '待计算', reasons: [] },
    { symbol: 'GOOGL', name: 'Alphabet', price: 196.42, score: null, changePercent: null, risk: '待计算', reasons: [] },
    { symbol: 'NVDA', name: 'NVIDIA', price: 181.62, score: null, changePercent: null, risk: '待计算', reasons: [] },
    { symbol: 'KO', name: 'Coca-Cola', price: 77.35, score: null, changePercent: null, risk: '待计算', reasons: [] },
    { symbol: 'SCHD', name: 'Dividend ETF', price: 29.14, score: null, changePercent: null, risk: '待计算', reasons: [] }
  ];

  const saved = JSON.parse(localStorage.getItem('laofan-paper-account') || 'null');
  let state = saved || { cash: STARTING_CASH, realized: 0, positions: {}, history: [] };
  let selected = null;
  const $ = (id) => document.getElementById(id);
  const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  const percent = (n) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

  function save() { localStorage.setItem('laofan-paper-account', JSON.stringify(state)); }
  function currentPrice(symbol) { return ideas.find((item) => item.symbol === symbol)?.price || 0; }
  function marketValue() { return Object.entries(state.positions).reduce((sum, [s, p]) => sum + currentPrice(s) * p.quantity, 0); }

  function renderIdeas() {
    $('ideas-body').innerHTML = ideas.map((item) => `<tr>
      <td><span class="ticker">${item.symbol}</span><span class="company">${item.name}</span><span class="reason">${item.reasons.join(' · ') || '等待历史数据计算'}</span></td>
      <td>${money(item.price)}</td><td class="score">${item.score == null ? '待计算' : `${item.score}/100`}</td><td class="${item.changePercent >= 0 ? 'positive' : 'negative'}">${percent(item.changePercent)}</td>
      <td class="${item.risk === '较低' ? 'risk-low' : 'risk-medium'}">${item.risk}</td>
      <td><button class="trade-button" data-symbol="${item.symbol}">模拟买入</button></td>
    </tr>`).join('');
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

    const entries = Object.entries(state.positions);
    $('positions').className = entries.length ? '' : 'empty';
    $('positions').innerHTML = entries.length ? entries.map(([symbol, p]) => {
      const price = currentPrice(symbol); const pnl = (price - p.avgPrice) * p.quantity;
      return `<div class="position"><strong>${symbol}<span class="company">${p.quantity} 股</span></strong><span>成本 ${money(p.avgPrice)}</span><span>现值 ${money(price * p.quantity)}</span><span class="${pnl >= 0 ? 'positive' : 'negative'}">${pnl >= 0 ? '+' : ''}${money(pnl)}</span><button class="sell-button" data-sell="${symbol}">全部卖出</button></div>`;
    }).join('') : '还没有持仓。可从候选股中发起模拟买入。';

    $('history').className = state.history.length ? '' : 'empty';
    $('history').innerHTML = state.history.length ? state.history.slice().reverse().map((h) => `<div class="history-row"><strong>${h.type} ${h.symbol}</strong><span>${h.quantity} 股</span><span>${money(h.price)}</span><span>${h.time}</span><span>${money(h.total)}</span></div>`).join('') : '交易记录为空。';
    save();
  }

  function openOrder(symbol) {
    selected = ideas.find((item) => item.symbol === symbol);
    $('order-symbol').textContent = selected.symbol;
    $('order-price').textContent = `模拟成交参考价 ${money(selected.price)}`;
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
      const response = await fetch(`${API_BASE}/api/market?symbols=${encodeURIComponent(symbols)}`);
      if (!response.ok) throw new Error('market request failed');
      const data = await response.json();
      ideas.forEach((item) => {
        const quote = data.quotes[item.symbol];
        if (quote?.price) item.price = quote.price;
        if (quote?.changePercent != null) item.changePercent = quote.changePercent;
        if (quote?.analysis) {
          item.score = quote.analysis.score;
          item.risk = quote.analysis.risk;
          item.reasons = quote.analysis.reasons || [];
        }
      });
      ideas.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      const time = new Date(data.fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      $('market-status').className = `updated ${data.market.isOpen ? 'market-open' : 'market-closed'}`;
      $('market-status').textContent = `${data.market.isOpen ? '● 美股已开市' : '● 美股已收盘'} · Alpaca IEX · ${time} 更新`;
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
  $('reset-button').addEventListener('click', () => { if (confirm('确定清除全部模拟交易记录并恢复到 $1,000 吗？')) { state = { cash: STARTING_CASH, realized: 0, positions: {}, history: [] }; render(); } });
  renderIdeas(); render(); loadMarketData();
  setInterval(loadMarketData, 60 * 1000);
})();
