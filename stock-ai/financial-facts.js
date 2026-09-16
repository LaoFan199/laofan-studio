// Research display only. Never feeds a score or historical trading decision.
export const FINANCIAL_VERSION = 'sec-facts-v1';
const metrics = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'],
  eps: ['EarningsPerShareDiluted'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment']
};
const dateOK = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s));
export function normalizeFacts(raw, symbol, retrievedAt) {
  const cik = /^\d{1,10}$/.test(String(raw?.cik)) ? Number(raw.cik) : NaN;
  if (!Number.isFinite(Date.parse(retrievedAt)) || !Number.isSafeInteger(cik) || cik <= 0 || !raw?.entityName) throw new Error('Invalid SEC identity or time');
  const asOf = retrievedAt.slice(0, 10), series = {};
  for (const [metric, tags] of Object.entries(metrics)) {
    const unit = metric === 'eps' ? 'USD/shares' : 'USD';
    const selected = new Map();
    for (const tag of tags) {
      for (const f of raw.facts?.['us-gaap']?.[tag]?.units?.[unit] || []) {
        if (!Number.isFinite(f.val) || !dateOK(f.start) || !dateOK(f.end) || !dateOK(f.filed) || f.filed >= asOf || f.end > f.filed || !/^\d{10}-\d{2}-\d{6}$/.test(f.accn || '') || !['10-K','10-Q','10-K/A','10-Q/A'].includes(f.form)) continue;
        const days = (Date.parse(f.end) - Date.parse(f.start)) / 86400000 + 1;
        const period = days >= 330 && days <= 380 ? 'annual' : days >= 75 && days <= 105 && ['revenue','eps'].includes(metric) ? 'quarter' : null;
        if (!period) continue; // Never mislabel YTD cash flow as a quarter or derive Q4 EPS.
        const key = `${f.start}/${f.end}`;
        const old = selected.get(key);
        if (!old || f.filed > old.filed || (f.filed === old.filed && tags.indexOf(tag) < tags.indexOf(old.tag))) {
          selected.set(key, { start: f.start, end: f.end, filed: f.filed, value: f.val, unit, tag, period, accession: f.accn, form: f.form });
        }
      }
    }
    const values = [...selected.values()].sort((a,b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
    series[metric] = { annual: values.filter(f => f.period === 'annual').slice(0,5), quarter: values.filter(f => f.period === 'quarter').slice(0,8) };
  }
  const available = Object.values(series).some(x => x.annual.length || x.quarter.length);
  return { symbol, cik, name: raw.entityName, retrievedAt, status: available ? 'available' : 'unsupported', series,
    source: `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10,'0')}.json` };
}
export function snapshotState(data, now = Date.now()) {
  const t = Date.parse(data?.generatedAt);
  if (data?.version !== FINANCIAL_VERSION || !Array.isArray(data.companies) || !Number.isFinite(t) || t > now + 60000) return 'invalid';
  for (const item of data.companies) {
    if (!item || !/^[A-Z.]{1,8}$/.test(item.symbol || '') || !['available','cached','unsupported','unavailable'].includes(item.status)) return 'invalid';
    if (item.status === 'unavailable') continue;
    if (!Number.isSafeInteger(item.cik) || !Number.isFinite(Date.parse(item.retrievedAt)) || Date.parse(item.retrievedAt) > now + 60000 || !item.series) return 'invalid';
    for (const key of Object.keys(metrics)) {
      for (const period of ['annual','quarter']) {
        const values = item.series[key]?.[period];
        if (!Array.isArray(values)) return 'invalid';
        if (values.some(f => !f || !Number.isFinite(f.value) || !dateOK(f.start) || !dateOK(f.end) || !dateOK(f.filed) || !/^\d{10}-\d{2}-\d{6}$/.test(f.accession || '') || !['USD','USD/shares'].includes(f.unit) || f.period !== period)) return 'invalid';
      }
    }
  }
  return now - t > 7 * 86400000 ? 'stale' : 'available';
}
