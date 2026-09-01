# Stock Strategy Governance

This document is the durable memory for the LaoFan AI stock research and
paper-trading project. Update it whenever strategy behavior or evaluation rules
change.

## Objective

Build a transparent, conservative paper-trading research tool that can be
improved without overfitting recent market behavior. Product usability should
improve continuously; claims about strategy quality must be supported by
recorded evidence.

The optimization target is not win rate by itself. The target is robust return
after risk and estimated trading costs, measured against a relevant benchmark.

## Strategy promotion process

```text
hypothesis -> frozen challenger -> parallel paper simulation -> evaluation
           -> promote only if criteria pass -> otherwise retain or revert
```

### 1. Propose

Record before implementation:

- the problem being addressed;
- the exact variable or rule being changed;
- why the change might improve future behavior;
- the baseline and challenger versions;
- the evaluation window and acceptance criteria.

### 2. Freeze

Give the challenger a version identifier and preserve its complete rules.
Historical decisions must retain the version, inputs, score, confidence, and
timestamp that existed when the decision was made.

### 3. Validate

- Use an out-of-sample or walk-forward period that was not used to choose the
  parameters.
- Run the baseline and challenger over the same instruments, timestamps,
  execution assumptions, and costs.
- Continue paper simulation for at least 20-40 trading days before interpreting
  a strategy change. Prefer 8-12 weeks for an initial promotion decision.
- A very small number of trades is inconclusive even if the result is positive.

### 4. Promote or revert

A challenger may replace the baseline only when it:

- does not materially worsen maximum drawdown;
- improves or preserves excess return versus SPY after estimated costs;
- does not depend on one ticker or a single exceptional trade;
- behaves consistently across more than one market interval;
- remains understandable enough to audit and reproduce.

If evidence is mixed, keep the current baseline and collect more data. Do not
combine several unsuccessful experiments into a more complex strategy.

## Standard scorecard

Every strategy comparison should report:

| Metric | Purpose |
| --- | --- |
| Total return | Absolute portfolio result |
| SPY excess return | Value added over a passive benchmark |
| Maximum drawdown | Largest peak-to-trough loss |
| Annualized volatility | Variability of returns |
| Sharpe/Sortino ratio | Risk-adjusted performance |
| Win rate | Frequency of profitable completed trades |
| Profit factor | Gross profits divided by gross losses |
| Average win/loss | Payoff quality independent of win rate |
| Trade count | Whether the sample is meaningful |
| Average holding period | Strategy behavior and turnover |
| Cost-adjusted return | Result after slippage and fees |

## Current baseline

### v1.1 - Explainable momentum and risk score

- Introduced: 2026-08-18
- Git commit: `a0a220f`
- Universe: MSFT, GOOGL, NVDA, KO, SCHD
- Benchmark: SPY
- Inputs: 20/60-day returns, 20/60-day moving-average position, 20-day
  relative strength versus SPY, annualized volatility, and 60-day drawdown
- Score range: 0-100, calculated deterministically
- Signal thresholds:
  - 75-100: candidate buy
  - 50-74: watch
  - 0-49: avoid
- Position limit: USD 200 per symbol on a USD 1,000 starting account
- Minimum cash: USD 200
- Live brokerage trading: disabled

Known limitations:

- The universe is fixed and small.
- No formal historical backtest report is stored yet.
- Slippage and transaction costs are not yet applied to simulated fills.
- Daily equity snapshots are collected, but no full performance chart or
  promotion report exists yet.
- The displayed 5% drawdown threshold is a warning, not an automated stop.

## Experiment log template

### Experiment: v1.2 crisis shield challenger

- Date proposed: 2026-08-19
- Baseline version: v1.1
- Challenger version: v1.2-shadow
- Hypothesis: combining the SPY long-term trend, trailing drawdown,
  short-term realized volatility, and breadth across the tracked universe can
  identify defensive market regimes earlier than stock-level scores alone and
  eventually reduce portfolio drawdown.
- One primary change: add a deterministic, three-state market-regime classifier
  that runs in shadow mode without changing v1.1 scores, orders, or holdings.
- Instruments and dates: SPY plus the existing MSFT, GOOGL, NVDA, KO, and SCHD
  universe; use at least 200 completed daily bars for each regime decision.
- Execution/cost assumptions: no orders are generated in shadow mode. Future
  promotion tests must use the same next-session execution and cost assumptions
  for baseline and challenger.
- Acceptance criteria chosen before evaluation:
  - display normal, watch, defensive, or unavailable state with reproducible
    factor explanations;
  - report suggested maximum equity exposure and current exposure without
    automatically buying or selling;
  - fail closed and disclose insufficient data;
  - store one dated regime snapshot per day without rewriting earlier days;
  - pass deterministic unit tests and desktop/narrow viewport checks;
  - do not promote until stress tests covering the 2007-2009, 2020, and 2022
    declines plus 20-40 forward paper-trading days show lower maximum drawdown
    without an unacceptable loss of cost-adjusted excess return versus SPY.
- Results: implementation validation passed on 2026-08-19. Deterministic tests
  cover insufficient data, normal markets, defensive markets, and exclusion of
  an incomplete open-session daily bar. Desktop and 390px-class narrow layouts
  passed with no console errors. Historical stress tests and the forward
  observation window remain pending.
- Decision: pending; shadow observation only
- Related commit: `a6eb347`

The v1.2 thresholds are frozen for the initial observation period. Do not tune
them in response to a few recent sessions.

### Experiment: Momentum Challenger v1

- Date proposed: 2026-08-20
- Baseline version: v1.1 (unchanged)
- Challenger version: momentum-v1-shadow
- Hypothesis: a fail-closed scan of liquid top gainers, followed by a fixed
  15% trailing exit from the post-entry high, can capture persistent momentum
  while making the loss of open profit deterministic and auditable.
- One primary change: add an independent momentum-event strategy; do not alter
  the v1.1 score, universe, holdings, or crisis-shield rules.
- Instruments and dates: Alpaca's US stock top-gainers feed during regular
  sessions; begin forward collection after deployment and retain the version
  and decision-time inputs for every signal.
- Frozen entry filters: price at least $5; daily gain at least 10%; current
  volume at least 3 times the prior 20-session average; current dollar volume
  at least $20 million; quoted spread no greater than 1%; no new entry while
  the v1.2 crisis shield is defensive.
- Frozen exit: update the high-water mark from observations after entry and
  flag an exit when price is at or below 85% of that high. A signal is not a
  guaranteed execution price; evaluation must separately model gaps and
  slippage.
- Execution/cost assumptions: shadow positions only, entered at the first
  observed qualifying price after the signal; no brokerage order, leverage, or
  options. Browser polling is not continuous and missed observations must not
  be reconstructed with hindsight.
- Acceptance criteria chosen before evaluation:
  - fail closed if mover, volume-history, quote, or spread data is incomplete;
  - preserve signal time, entry price, high-water mark, exit trigger, observed
    exit price, and strategy version without rewriting historical decisions;
  - pass deterministic entry-filter and 15% trailing-exit tests;
  - pass desktop and narrow viewport checks with simulation/data-source status
    visible;
  - observe at least 20-40 trading days, preferably 8-12 weeks, and report the
    standard scorecard after estimated slippage;
  - do not promote if results depend on one ticker or one exceptional trade, or
    if maximum drawdown and cost-adjusted excess return are unacceptable.
- Results: implementation validation passed on 2026-08-20. Seven deterministic
  tests pass, including complete-filter, fail-closed missing-data, rising
  high-water mark, and exact 15% exit-trigger cases. Desktop and 390px narrow
  layouts have no horizontal overflow or console errors. Forward observation
  and cost-adjusted scorecard remain pending.
- Decision: pending; shadow observation only
- Related commit: `d0fff83`

### Experiment: Momentum Challenger v1.1 candidate quality filter

- Date proposed: 2026-08-21
- Baseline version: momentum-v1-shadow (retained in Git history and existing
  recorded signals)
- Challenger version: momentum-v1.1-shadow
- Hypothesis: applying a deterministic security-quality filter before detailed
  momentum analysis will prevent warrants, acquisition units, rights, and
  sub-$5 securities from consuming the limited mover list, allowing more
  liquid common-stock candidates to be evaluated without weakening risk rules.
- One primary change: candidate-universe eligibility. Request the maximum 50
  top gainers, then exclude symbol patterns associated with warrants/units/
  rights and prices below $5 before fetching detailed inputs.
- Frozen rules: the 10% gain, 3x relative volume, $20 million dollar volume,
  1% maximum spread, defensive-regime pause, and 15% trailing exit are unchanged.
- Instruments and dates: Alpaca US stock top-gainers feed beginning after this
  version is deployed. Existing shadow positions remain tracked even if their
  symbol would not qualify for a new v1.1 entry.
- Execution/cost assumptions: unchanged from momentum-v1-shadow; shadow only,
  first observed qualifying price, and observed exit price with future gap and
  slippage modeling.
- Acceptance criteria chosen before evaluation:
  - exclude the observed warrant-like and sub-$5 examples before display and
    detailed qualification while retaining ordinary symbols and class shares;
  - report scanned, excluded, and eligible-universe counts visibly;
  - never drop price monitoring for an existing shadow position;
  - preserve all original entry and exit thresholds and fail-closed behavior;
  - pass deterministic tests plus desktop/narrow visual checks;
  - compare coverage, trade count, cost-adjusted return, profit factor, and
    maximum drawdown over at least 20-40 trading days before any promotion.
- Results: implementation validation passed on 2026-08-21. Nine deterministic
  tests pass, including exclusion of the observed low-price/warrant examples,
  retention of ordinary and class-share symbols, unchanged entry/exit checks,
  and the exact 15% trailing exit. Desktop and 390px layouts have no horizontal
  overflow or console errors; account equity reconciles to cash plus holdings.
  Forward observation and comparative scorecard remain pending.
- Decision: pending; shadow observation only
- Related commit: `720a89a`

### Paper execution change: fractional-v1

- Date proposed: 2026-08-25
- Previous execution: whole-share paper orders
- New execution version: fractional-v1
- Hypothesis: dollar-denominated paper orders remove an unintended bias against
  high-priced stocks without altering selection signals or dollar risk limits.
- One primary change: replace whole-share quantity entry with a dollar amount
  and calculate fractional simulated shares at the displayed decision price.
- Frozen strategy rules: score threshold 75, single-symbol maximum $200,
  minimum account cash $200, crisis shield, momentum rules, and all candidate
  scores remain unchanged.
- Compatibility: existing positions and history retain their original quantity
  and records; new buys record `fractional-v1` without rewriting old trades.
- Acceptance criteria chosen before implementation:
  - allow a $50 order in a stock priced above $200 when its signal is eligible;
  - reject orders below $10, above remaining cash capacity, or above the
    cumulative $200 symbol limit;
  - display fractional quantities consistently in holdings and history;
  - reconcile equity to cash plus current position value after buy and sell;
  - pass deterministic tests and desktop/narrow interactive checks.
- Results: implementation validation passed on 2026-08-25. Thirteen tests pass,
  including $50 fractional execution above a $200 share price and code-level
  rejection for minimum-cash, maximum-position, and minimum-order violations.
  Interactive MSFT validation produced 0.101719 shares for $50 at $491.55,
  rejected $250, reconciled $1,000 equity before/after a round trip, and passed
  desktop and 390px checks without console errors or horizontal overflow.
- Decision: product execution improvement; strategy thresholds unchanged
- Related commit: `535550b`

### Experiment: Dip Opportunity Challenger v1

- Date proposed: 2026-08-27
- Baseline version: v1.1 (unchanged)
- Challenger version: dip-v1-shadow
- Hypothesis: requiring a material drawdown followed by deterministic price
  confirmation can find better entry timing in the existing liquid quality
  whitelist without turning a falling price alone into a buy signal.
- One primary change: add an independent post-drawdown entry-timing strategy;
  do not alter v1.1 scores, main paper holdings, momentum, or crisis-shield
  behavior.
- Instruments and dates: SPY plus MSFT, GOOGL, NVDA, KO, and SCHD, beginning
  after deployment. The fixed whitelist is a liquidity/quality proxy, not a
  live fundamental-safety determination.
- Frozen entry rules: require at least 61 completed daily bars; price must be
  8%-30% below its trailing 60-session high; the latest completed session must
  close above the previous close, remain above the previous session low, and
  close above its 5-session average. Enter one $50 shadow position at the first
  subsequently observed price; never average down.
- Frozen exit rules: record an exit at the first observation at or below 98% of
  the setup low, or after 10 distinct observed market dates without reaching a
  5% gain. These are shadow observations, not guaranteed execution prices;
  future evaluation must model gaps and slippage.
- Execution/cost assumptions: one shadow position per symbol, no main-account
  cash usage, brokerage order, leverage, or option. Browser polling is not
  continuous and missed prices must not be reconstructed with hindsight.
- Acceptance criteria chosen before evaluation:
  - distinguish watch, confirmed, shadow-held, expired, and invalidated states;
  - fail closed with incomplete daily bars or invalid prices;
  - never create an entry from drawdown magnitude alone;
  - preserve setup time, setup low, entry price, exit rule, observed exit price,
    and strategy version without rewriting historical decisions;
  - pass deterministic tests and desktop/narrow viewport checks with the
    shadow-only limitation visible;
  - observe at least 20-40 trading days, preferably 8-12 weeks, and compare
    total return, SPY excess return, maximum drawdown, profit factor, average
    win/loss, holding period, and cost-adjusted results before promotion.
- Results: implementation validation passed on 2026-08-27. Seventeen
  deterministic tests pass, including incomplete-data failure, drawdown without
  confirmation remaining watch-only, all-three-check confirmation, extreme
  drawdown exclusion, exact setup-low stop, and 10-day time exit. The deployed
  API reports `dip-v1-shadow`; the desktop page reconciles $1,000 equity to
  $1,000 cash plus $0 holdings in an isolated browser test, shows the
  shadow-only limitation, and has no horizontal overflow. The narrow layout
  reuses the previously validated two-column momentum-row breakpoint and wraps
  the new panel heading. Forward observation and cost-adjusted evaluation
  remain pending.
- Decision: pending; shadow observation only
- Related commits: `05a68de`, `816b897`

### Experiment: Dynamic Universe Challenger v1

- Date proposed: 2026-08-29
- Baseline version: v1.1 fixed five-symbol universe (unchanged)
- Challenger version: dynamic-universe-v1-shadow
- Hypothesis: applying the unchanged v1.1 deterministic score to a broader,
  predeclared liquid large-company universe can surface stronger candidates
  and reveal ranking turnover that the fixed five-symbol baseline cannot see.
- One primary change: candidate-universe breadth. The score weights, 75-point
  candidate threshold, SPY benchmark, main holdings, and all account risk limits
  remain unchanged.
- Instruments and dates: a frozen list of approximately 60 established,
  actively traded US-listed companies across multiple sectors, plus SPY as the
  benchmark, beginning after deployment. The list is a research/liquidity
  proxy and is not a live fundamental-quality guarantee.
- Frozen eligibility: price at least $5, at least 61 completed adjusted daily
  bars, and average 20-session dollar volume of at least $50 million. Rank by
  the unchanged v1.1 score, then 20-day relative strength versus SPY, then
  symbol for deterministic ties; display the top 10.
- Execution/cost assumptions: ranking and history only. No shadow order, main
  paper order, brokerage connection, leverage, or option is created from this
  challenger. Any later portfolio simulation must use next-session execution
  and explicit costs/slippage.
- Acceptance criteria chosen before evaluation:
  - retain the fixed five-symbol table unchanged as the comparison baseline;
  - visibly report universe size, eligible count, data timestamp, strategy
    version, and data failures;
  - label top-10 members as new, rising, falling, or unchanged relative to the
    prior stored market-day snapshot and show names that left the top 10;
  - store at most one immutable ranking snapshot per market date, replacing
    only the same date's in-progress observation;
  - fail closed when benchmark/history/liquidity inputs are incomplete;
  - pass deterministic ranking/change tests and desktop/narrow viewport checks;
  - observe at least 20-40 trading days, preferably 8-12 weeks, before deciding
    whether to simulate entries; compare turnover, coverage, forward top-10
    return, SPY excess return, drawdown, and estimated costs.
- Results: implementation validation passed on 2026-08-29. Twenty total
  deterministic tests pass, including dynamic fail-closed price/history/
  liquidity checks, score-and-relative-strength ordering, and all new/up/down/
  same/exited ranking transitions. The deployed endpoint scanned 64 frozen
  symbols, found 37 eligible, and returned 10 ranked candidates with
  `dynamic-universe-v1-shadow`. Desktop browser validation displayed all 10,
  the source timestamp, first-snapshot NEW labels, and the ranking-only warning
  without horizontal overflow; isolated account equity reconciled to cash plus
  holdings. The panel reuses the previously validated 390px two-column row
  breakpoint. Forward ranking history and outcome evaluation remain pending.
- Decision: pending; shadow ranking only
- Related commits: `ddcb560`, `1609c64`

### Paper interface change: dynamic-manual-v1

- Date proposed: 2026-08-29
- Ranking source: `dynamic-universe-v1-shadow` (unchanged)
- New execution interface: `dynamic-manual-v1`
- Hypothesis: automatically presenting score-qualified dynamic top-10 names as
  manual paper-order candidates lets the user consider a broader opportunity
  set without creating automatic trades or weakening dollar risk limits.
- One primary change: allow a user-confirmed fractional paper order from a
  dynamic top-10 candidate only when its unchanged v1.1 score is at least 75.
- Frozen safeguards: no automatic order; $10 minimum order, $200 cumulative
  symbol maximum, $200 minimum account cash, no leverage/options/live broker,
  and crisis-shield disclosure are unchanged. Dynamic names remain separate
  from the fixed-five baseline and retain their ranking/source/version at buy.
- Pricing continuity: the dynamic endpoint must return current observations for
  the whole frozen universe, and a purchased position must retain its last
  valid observed price if the symbol later leaves the top 10 or data is briefly
  unavailable. A stale price must remain identifiable and must not silently
  become zero.
- Acceptance criteria chosen before implementation:
  - show a manual paper-buy button only for score-75+ dynamic top-10 names;
  - open the existing amount dialog and enforce the existing limits in code;
  - record dynamic source, strategy version, score, confidence, and price;
  - keep valuing and selling a dynamic position after it leaves the top 10;
  - reconcile equity to cash plus all fixed and dynamic position values;
  - pass deterministic tests and desktop/narrow interactive checks.
- Results: implementation validation passed on 2026-08-29. All 20 tests pass,
  including the existing code-level minimum-order, minimum-cash, and cumulative
  symbol-limit checks. The deployed dynamic endpoint returned current
  observations for the frozen universe. Interactive TMO validation opened a
  user-confirmed $50 order at score 93, produced 0.080368 fractional shares at
  $622.14, reconciled $1,000 equity to $950 cash plus $50 market value, visibly
  identified the last valid price date, and returned to $1,000 after a manual
  round trip. Ten qualified dynamic rows showed manual buttons; no automatic
  order occurred and the page had no desktop horizontal overflow.
- Decision: user-controlled paper interface; no strategy promotion or automatic trade
- Related commits: `4ee05e3`, `03c4297`

### Experiment: Dynamic Universe v1.1 candidate exit discipline

- Date proposed: 2026-08-29
- Baseline version: `dynamic-universe-v1-shadow` (preserved in Git history)
- Challenger version: `dynamic-universe-v1.1-manual`
- Hypothesis: requiring the existing 75-point candidate threshold for pool
  membership and automatically removing names that cease to qualify will keep
  the actionable list current without forcing a sale of an owned position.
- One primary change: dynamic candidate-pool membership. Price, history,
  liquidity, scoring weights, top-10 ranking, and account limits are unchanged.
- Frozen entry/pool rule: a name is actionable only while all data/liquidity
  checks pass, its unchanged v1.1 score is at least 75, and it remains in the
  resulting top 10. Failure of any condition removes it at the next successful
  refresh.
- Held-position exception: removal from the candidate pool never creates an
  automatic sale. A dynamic position already bought remains visibly pinned as
  “held / no longer qualified,” continues using the latest valid universe quote,
  and can only be sold by the user.
- Acceptance criteria chosen before implementation:
  - deterministically exclude a score-74 name from pool membership;
  - retain all existing fail-closed price/history/liquidity checks;
  - show automatic exits relative to the prior market-day snapshot;
  - show a held-but-exited symbol without a new-buy button;
  - never mutate cash, quantity, or realized P&L merely because membership
    changes;
  - pass tests and desktop/narrow checks with the rule stated visibly.
- Results: implementation validation passed on 2026-08-29. Twenty-one tests
  pass, including deterministic score-74 exclusion and retention of a purchased
  dynamic position after it leaves the qualified pool without changing its
  quantity. The deployed endpoint reports `dynamic-universe-v1.1-manual`, a
  75-point minimum, 18 currently qualified names, and a 10-name pool. Desktop
  validation shows 10 manual buttons, the automatic-exit/held-position rule,
  reconciled $1,000 isolated equity, and no horizontal overflow. Versioned
  assets ensure an ordinary refresh loads the new client logic. Forward
  candidate turnover remains pending.
- Decision: pending; automatic pool maintenance, manual holdings only
- Related commits: `2a50e9c`, `911b4ee`, `238c4aa`, `e70da20`

### Product change: dynamic candidate transparency

- Date proposed: 2026-08-30
- Strategy version: `dynamic-universe-v1.1-manual` (unchanged)
- Problem: a stock can appear in news research yet be absent from the dynamic
  top 10, while the interface does not reveal whether it narrowly missed the
  ranking or failed a price, history, liquidity, or score rule.
- Change: expose qualified ranks 11-20 and per-symbol deterministic eligibility
  diagnostics; add an on-page ticker lookup for the frozen 64-symbol universe.
- Strategy impact: none. The universe, v1.1 score, 75-point threshold, top-10
  pool, ranking tie-breakers, paper-order limits, and automatic pool exit rules
  remain unchanged.
- Acceptance criteria chosen before implementation:
  - show up to ten qualified stocks immediately below the top-10 cutoff;
  - explain every failed eligibility rule rather than guessing one reason;
  - distinguish “qualified but outside top 10” from “not qualified” and “not in
    the frozen universe”;
  - keep diagnostics informational with no buy button or automatic order;
  - pass deterministic tests plus desktop/narrow visual checks.
- Results: implementation and deployment validation passed on 2026-08-30.
  Twenty-two deterministic tests pass, including qualified rank ordering and
  simultaneous disclosure of every failed eligibility rule. The deployed API
  returns ranks 11-20 and diagnostics for all 64 frozen symbols. An interactive
  AVGO lookup reported its exact current reason (score 16, below the 75-point
  threshold), rather than inferring from news or price movement. Desktop and
  390px layouts have no horizontal overflow or console errors; the isolated
  account reconciled to $1,000 cash plus $0 holdings and no order was created.
- Decision: product transparency improvement; no strategy promotion
- Related commits: `b48ef74`, `59c9421`

### Experiment: Downside Diagnostic v1

- Date proposed: 2026-08-31
- Baseline version: `dynamic-universe-v1.1-manual` (unchanged)
- Challenger version: `downside-diagnostic-v1-shadow`
- Hypothesis: separating market, sector, and stock-specific weakness while
  exposing volume, trend, and a prior-20-session risk line will reduce vague
  “washout” narratives and make downside decisions more auditable.
- One primary change: add a deterministic downside explanation layer; it does
  not change the v1.1 score, 75-point threshold, ranking, orders, or holdings.
- Frozen diagnostics: compare latest completed-session return with SPY and the
  mapped Select Sector SPDR; flag volume at 1.3x and 2x its prior-20-session
  average; show the 20-day average and the lowest low of the preceding 20
  sessions as an informational risk line.
- Missing information: until a reliable filing/regulatory-event source is
  connected, display “not yet verified” and never infer that no event exists.
- Acceptance criteria chosen before evaluation:
  - deterministic source, volume, trend, and risk-line outputs;
  - sector or volume gaps lower confidence rather than inventing a conclusion;
  - diagnostics remain shadow-only and create no order or automatic exit;
  - pass tests and desktop/narrow checks without breaking account reconciliation.
- Results: implementation and deployment validation passed on 2026-08-31.
  Twenty-four deterministic tests pass, including market/sector/stock source
  separation, abnormal-volume labeling, insufficient-data failure, and the
  prior-session risk line. The deployed endpoint reports
  `downside-diagnostic-v1-shadow`; all 10 dynamic candidates expose the panel.
  An interactive V check showed stock-relative weakness, 0.7x volume, price
  above its 20-day average, and a $358.20 reference risk line with no order.
  Desktop and 390px layouts have no overflow or console errors; isolated equity
  reconciled to $1,000 cash plus $0 holdings and all 10 manual buttons remained.
- Decision: pending; shadow explanation only
- Related commits: `f8fa324`, `a5b5390`

### Product change: SPY market candlestick overview

- Date proposed: 2026-09-01
- Change: show approximately 70 completed SPY daily OHLC bars and a 20-session
  moving average near the top of the page using a lightweight responsive SVG.
- Strategy impact: none. The chart is observational and does not affect scores,
  candidate membership, orders, holdings, or the crisis-shield classifier.
- Acceptance criteria: visibly disclose SPY, interval and update time; fail
  clearly with fewer than 20 bars; render desktop and 390px without overflow;
  preserve account reconciliation and all enforced risk limits.
- Results: deployed and validated on 2026-09-01. The live API returned 70
  completed SPY bars; desktop rendered a 1,146 x 300 chart and 390px mobile
  rendered a 313 x 220 chart with no horizontal overflow. Both showed 70
  candles, the 20-session moving average, SPY price/change and update time with
  no console errors. The reset test account reconciled at $1,000 total assets =
  $1,000 cash + $0 holdings, while the 20% single-stock and minimum-cash limits
  remained visible.
- Decision: product observability improvement; no strategy promotion

Copy this section for each future strategy experiment:

```markdown
### Experiment: <name>

- Date proposed:
- Baseline version:
- Challenger version:
- Hypothesis:
- One primary change:
- Instruments and dates:
- Execution/cost assumptions:
- Acceptance criteria chosen before evaluation:
- Results:
- Decision: pending / promote / retain baseline / revert
- Related commit:
```

## Product changes versus strategy changes

Product changes such as accessibility, clearer P&L, error handling, responsive
layout, and faster loading may ship frequently when tested. Changes to score
weights, thresholds, portfolio construction, exits, or the stock universe must
follow the strategy promotion process above.
