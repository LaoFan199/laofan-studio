export const SELL_ADVICE_VERSION = 'holding-exit-v1-advisory';
const marketDate = value => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date(value));
const average = values => values.reduce((s, v) => s + v, 0) / values.length;

export function analyzeSellAdvice(bars, now = new Date()) {
  const unavailable = reason => ({ version: SELL_ADVICE_VERSION, status: 'unavailable', recommend: false, reasons: [reason], signalDate: null });
  const today = marketDate(now);
  const completed = (Array.isArray(bars) ? bars : []).filter(b => Number.isFinite(Date.parse(b.t)) && marketDate(b.t) < today);
  if (completed.length < 201) return unavailable('需要至少201个完整交易日，暂不能判断退出趋势');
  if (completed.some((b, i) => !Number.isFinite(b.c) || b.c <= 0 || (i && marketDate(b.t) <= marketDate(completed[i - 1].t)))) return unavailable('历史价格存在缺失、重复或顺序异常');
  if (new Date(now) - new Date(completed.at(-1).t) > 4 * 864e5) return unavailable('完整日线已过期，等待更新');
  const closes = completed.map(b => b.c), close = closes.at(-1), previousClose = closes.at(-2);
  const sma50 = average(closes.slice(-50)), previousSma50 = average(closes.slice(-51, -1)), sma200 = average(closes.slice(-200));
  const reasons = [];
  if (close < sma200) reasons.push('最近完整交易日收盘价跌破200日均线');
  if (close < sma50 && previousClose < previousSma50) reasons.push('连续两个完整交易日收盘价低于50日均线');
  return { version: SELL_ADVICE_VERSION, status: 'available', recommend: reasons.length > 0,
    reasons: reasons.length ? reasons : ['尚未触发50日 / 200日趋势退出条件'], signalDate: marketDate(completed.at(-1).t),
    metrics: { close, sma50, sma200, previousClose, previousSma50 } };
}
export function sellAdviceState(data, symbol, now = new Date()) {
  const item = data?.items?.[symbol];
  const age = new Date(now) - new Date(data?.fetchedAt);
  if (data?.version !== SELL_ADVICE_VERSION || !Number.isFinite(age) || age < -60000 || age > 120000 || item?.status !== 'available') {
    return { active: false, canExecute: false, label: '等待卖出评估', reasons: item?.reasons || ['数据不足或已过期，建议暂停'], item: null };
  }
  const quoteAge = new Date(now) - new Date(item.quoteAt);
  const freshPrice = Number.isFinite(item.price) && item.price > 0 && Number.isFinite(quoteAge) && quoteAge >= -60000 && quoteAge <= 15 * 60000;
  return { active: item.recommend === true, canExecute: item.recommend === true && data.marketIsOpen === true && freshPrice,
    label: item.recommend ? '建议卖出' : '建议卖出（未触发）', reasons: item.reasons, item,
    executionReason: data.marketIsOpen !== true ? '当前休市，等待开市后的有效报价再确认' : !freshPrice ? '最新报价不足或超过15分钟，等待更新后确认' : '' };
}
