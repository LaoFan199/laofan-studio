# SEC historical financial snapshot

Version: `sec-facts-v1`, research display only. This is the first partial data
integration, not the completed V2 fundamental feed. No signal or account mutation.

Sources:
- https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- https://www.sec.gov/about/developer-resources
- https://www.sec.gov/files/company_tickers.json

Run from repository root: `python scripts/update-financials.py`, then `npm test`
and `npm run build`. Review the diff, timestamps, issuer identities and missing
rows before publishing the updated snapshot through Git. `SEC_USER_AGENT` may
supply a maintainer's accurate contact identity. No API key or paid service.

Current scope: MSFT, GOOGL, KO and the seven core research symbols (NVDA overlaps
with the fixed pool). SCHD is an ETF; other held symbols are not yet covered.
Only standard US-GAAP/USD tags and 10-K/10-Q (including amendments) are supported.
CCJ IFRS/CAD facts are explicitly unsupported; never convert currency or infer a
missing metric. Both integer and zero-padded decimal-string SEC CIKs are checked.

Normalization keeps five annual periods per metric and eight direct quarterly
revenue/EPS periods. UI shows the most recent direct quarter and five annual
observations. Annual duration 330–380 days, quarter 75–105 days. No Q4 subtraction,
YTD-as-quarter conversion, FCF calculation, or EPS growth inference. Q4 may be
absent. Operating cash flow and PP&E purchases are annual only. There is no
assumption that missing capital expenditure equals zero.

For each identical start/end select latest filing strictly before the UTC
retrieval date; retain tag, unit, dates, accession and form. These are current
restated historical observations, NOT a point-in-time backtest dataset. A filing
may restate earlier EPS after a split. The filing date is not the earnings
announcement date. Financial periods are not silently forced to calendar years.

Downloads are sequential, paced under two requests/second with 25-second timeout,
no retry storm and no browser-to-SEC calls. Raw payloads are temporary. Mapping
failure or total company failure preserves the published file. A partial company
failure preserves its previous record/time with an explicit cached status.
A temporary output is renamed only after normalization. Browser reads a small
same-origin snapshot once, allows manual reread after 30 seconds, times out after
8 seconds, and clearly labels snapshots older than seven days. A failed read is
isolated from holdings. No scheduled updater is configured yet; rerunning the
script and deploying is required to publish new filings. A UI reread does not
collect newer SEC facts.

Still required before V2 activation: verified quarterly growth, full quality and
valuation inputs, dated analyst-consensus revisions/surprises, earnings calendar,
complete universe, corporate-action ledger and continuous matched simulation.
