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
- Results: implementation validation pending.
- Decision: product execution improvement; strategy thresholds unchanged
- Related commit: pending

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
