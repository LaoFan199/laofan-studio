import { snapshotState } from './financial-facts.js';
const root = document.getElementById('financial-panel');
if (root) {
  const status = document.getElementById('financial-status');
  const select = document.getElementById('financial-symbol');
  const rows = document.getElementById('financial-rows');
  const button = document.getElementById('financial-reload');
  let data = null;
  const labels = { revenue:'营收', eps:'稀释每股收益', operatingCashFlow:'经营现金流', capex:'购置固定资产现金支出' };
  function render() {
    rows.replaceChildren();
    const item = data?.companies.find(x => x.symbol === select.value);
    if (!item) return;
    const stale = snapshotState(data) === 'stale' || Date.now() - Date.parse(item.retrievedAt) > 7*86400000;
    const bad = item.status !== 'available';
    status.textContent = `${item.symbol} · ${item.name || ''} · ${item.retrievedAt ? '采集于 '+new Date(item.retrievedAt).toLocaleString('zh-CN') : '未取得数据'} · ${bad ? item.error || '当前仅支持美元 US-GAAP 标准科目，此公司暂无可展示数据' : stale ? '快照超过7天，等待更新，仅供历史查阅' : '历史快照已载入'}`;
    if (!item.series) return;
    for (const [key, label] of Object.entries(labels)) {
      const facts = [...(item.series[key]?.quarter || []).slice(0,1), ...(item.series[key]?.annual || [])];
      if (!facts.length) {
        const p = document.createElement('p'); p.textContent = `${label}：缺少可核对的标准科目`; rows.append(p); continue;
      }
      const section = document.createElement('details'); section.open = key === 'revenue';
      const title = document.createElement('summary'); title.textContent = label; section.append(title);
      for (const f of facts) {
        const row = document.createElement('div'); row.className = 'financial-row';
        const heading = document.createElement('strong');
        heading.textContent = `${f.period === 'annual' ? '全年' : '单季'} · ${f.start} 至 ${f.end}`;
        const value = document.createElement('span');
        value.textContent = f.unit === 'USD/shares' ? `${f.value.toLocaleString('zh-CN',{maximumFractionDigits:4})} 美元/股` : `${(f.value/1e8).toLocaleString('zh-CN',{maximumFractionDigits:2})} 亿美元`;
        const source = document.createElement('a'); source.textContent = `申报 ${f.filed} · ${f.form}`;
        source.href = `https://www.sec.gov/Archives/edgar/data/${item.cik}/${f.accession.replaceAll('-','')}/${f.accession}-index.html`;
        source.target = '_blank'; source.rel = 'noopener';
        row.append(heading,value,source); section.append(row);
      }
      rows.append(section);
    }
  }
  async function load() {
    button.disabled = true; status.textContent = '正在读取历史财报快照…';
    try {
      const response = await fetch(new URL('./data/financials.json',import.meta.url), { cache:'no-cache', signal:AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('HTTP');
      const next = await response.json();
      if (snapshotState(next) === 'invalid') throw new Error('Invalid snapshot');
      const chosen = select.value;
      data = next; select.replaceChildren();
      for (const item of data.companies) {
        const option = document.createElement('option'); option.value=item.symbol; option.textContent=item.symbol; select.append(option);
      }
      if (data.companies.some(x => x.symbol === chosen)) select.value=chosen;
      render();
    } catch {
      if (data) render();
      status.textContent = '财报快照加载失败；'+(data ? '以下保留上次读取的历史数据。' : '暂不展示财务数值。')+' 持仓功能不受影响，可稍后重试。';
    } finally { setTimeout(() => { button.disabled=false; },30000); }
  }
  select.addEventListener('change',render);
  button.addEventListener('click',load);
  load();
}
