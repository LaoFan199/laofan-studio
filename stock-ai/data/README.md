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

## Full archive ingestion and progress

Run `python scripts/bulk-financials.py --cache /path/outside/repo --resume`.
`--archive /path/companyfacts.zip` accepts an official downloaded archive;
`--retry-failed` reattempts failed issuer members. No scheduler is installed.
An ETag/length check protects download resumption. ZIP members are CRC checked;
archive and ticker-map hashes pin processing checkpoints. Missing cached issuer
records are reprocessed. Reports distinguish attempted, usable, unsupported,
failed and pending. Missing ticker-directory issuers are separate from failures.
All companyfacts files are scanned, including historical and delisted issuers;
this is not a tradable universe or a strategy change.

The website shows the last published checkpoint, not a live background service.
A full archive is never fetched by the browser. Selected issuer details come
from one of 64 small shards, with at most four cached in memory and run IDs checked.
Only latest direct quarter/annual observations are retained for bulk lookup.
Original first-batch longer history remains separate. US-GAAP/USD scope and all
previous normalization and point-in-time limitations still apply.

If the archive or mapping cannot be obtained, keep any last published statistics
with an update-error warning. Without previous results, publish a blocked state
with unknown counts, not fake zero/completion. Do not bypass SEC access denials.
On 2026-09-21 SEC HEAD and GET both returned HTTP 403 (undeclared automated tool).
The unpublished 2026-09-16 full result is not present in the restored workspace;
its historical conversation counts are not relabelled as current data.

Validation: `npm test`, `python scripts/test-bulk-financials.py`, `npm run build`
and the fixture-only desktop/mobile UI verifier. Whole-archive data publishing
remains pending restoration of permitted access or provision of an official ZIP.
