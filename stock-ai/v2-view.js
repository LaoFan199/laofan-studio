import { V2_VERSION, V2_FACTORS, V2_DATA_GAPS } from './v2-strategy.js';

export function renderV2(data, root = document) {
  const $ = id => root.getElementById(id);
  if (!$('v2-status')) return;
  const supported = data?.version === V2_VERSION;
  const timestamp = Date.parse(data?.fetchedAt);
  const fresh = supported && Number.isFinite(timestamp) && timestamp <= Date.now() + 60000 && Date.now() - timestamp < 10 * 60 * 1000;
  $('v2-status').textContent = fresh ? '待盈利数据接入 · 模拟尚未启动' : 'V2 数据未连接 · 模拟尚未启动';
  $('v2-source').textContent = fresh
    ? `${data.source || '行情服务'} · 获取于 ${new Date(timestamp).toLocaleString('zh-CN')}`
    : '等待支持 V2 的行情接口；不会使用演示价格启动实验。';
  const regime = fresh ? data.regime : null;
  $('v2-regime').textContent = regime?.label || '等待数据';
  $('v2-exposure').textContent = Number.isFinite(regime?.maxExposure) ? `${Math.round(regime.maxExposure * 100)}%` : '—';
  $('v2-regime-date').textContent = regime?.signalDate
    ? `信号日 ${regime.signalDate}（美国东部）；连续两日确认，保守排除当日日线。`
    : '需要至少221个完整 SPY 交易日；不把刷新次数当成交易日。';
  const list = $('v2-gaps'); list.replaceChildren();
  for (const text of V2_DATA_GAPS) { const li = root.createElement('li'); li.textContent = text; list.append(li); }
  const factors = $('v2-factors'); factors.replaceChildren();
  for (const f of V2_FACTORS) {
    const item = root.createElement('div'), label = root.createElement('span'), weight = root.createElement('strong');
    label.textContent = f.label; weight.textContent = `${f.weight}%`;
    item.append(label, weight); factors.append(item);
  }
  // Data-feed, continuous execution and benchmark accounting are release gates.
  // A server response alone must never silently activate paper trading.
  $('v2-start').disabled = true;
}
