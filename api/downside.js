export const DOWNSIDE_VERSION = 'downside-diagnostic-v1-shadow';

const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function dailyChange(bars) {
  if (!Array.isArray(bars) || bars.length < 2) return null;
  const latest = Number(bars.at(-1)?.c);
  const previous = Number(bars.at(-2)?.c);
  return Number.isFinite(latest) && Number.isFinite(previous) && previous > 0 ? ((latest / previous) - 1) * 100 : null;
}

export function diagnoseDownside(stockBars, marketBars, sectorBars) {
  if (!Array.isArray(stockBars) || stockBars.length < 21) {
    return { version: DOWNSIDE_VERSION, status: 'unavailable', confidence: '低', reason: '股票完整日线不足21根' };
  }
  const closes = stockBars.map((bar) => Number(bar.c));
  const latest = closes.at(-1);
  const previous20 = stockBars.slice(-21, -1);
  const previousVolumes = previous20.map((bar) => Number(bar.v)).filter(Number.isFinite);
  const currentVolume = Number(stockBars.at(-1)?.v);
  const volumeRatio = previousVolumes.length === 20 && Number.isFinite(currentVolume) && average(previousVolumes) > 0
    ? currentVolume / average(previousVolumes) : null;
  const sma20 = average(closes.slice(-20));
  const riskLine = Math.min(...previous20.map((bar) => Number(bar.l ?? bar.c)).filter(Number.isFinite));
  const stockChange = dailyChange(stockBars);
  const marketChange = dailyChange(marketBars);
  const sectorChange = dailyChange(sectorBars);
  const dataComplete = [stockChange, marketChange, sectorChange, volumeRatio, riskLine].every(Number.isFinite);
  let source = '未下跌';
  if (stockChange < 0) {
    if (Number.isFinite(marketChange) && marketChange <= -0.75) source = '市场同步下跌';
    else if (Number.isFinite(sectorChange) && sectorChange <= -0.75) source = '行业同步下跌';
    else source = '个股相对走弱';
  }
  const belowTrend = latest < sma20;
  const belowRiskLine = latest < riskLine;
  const volumeState = !Number.isFinite(volumeRatio) ? '数据不足' : volumeRatio >= 2 ? '显著放量' : volumeRatio >= 1.3 ? '温和放量' : '未见异常放量';
  const action = belowRiskLine ? '暂停参与，检查风险' : belowTrend ? '等待重新站回20日线' : stockChange < 0 ? '继续观察，不猜洗盘' : '趋势尚完整';
  return {
    version: DOWNSIDE_VERSION,
    status: 'available',
    confidence: dataComplete ? '高' : '低',
    source,
    action,
    fundamentals: '尚未接入可靠财报/监管事件源',
    metrics: { stockChange, marketChange, sectorChange, volumeRatio, sma20, riskLine, belowTrend, belowRiskLine },
    labels: { volumeState }
  };
}
