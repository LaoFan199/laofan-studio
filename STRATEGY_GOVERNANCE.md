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
