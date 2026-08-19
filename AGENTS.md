# LaoFan Studio Agent Guide

These instructions apply to the entire repository. Read this file and
`STRATEGY_GOVERNANCE.md` before changing the stock research or paper-trading
application.

## Product boundary

- The stock application is a research and paper-trading tool.
- It must not connect to a brokerage account, submit live orders, use leverage,
  or trade options without a new, explicit decision from the repository owner.
- Never describe a score, signal, or backtest result as a guarantee of future
  performance.
- Keep market-data timestamps, simulation status, and data-source failures
  visible to the user.

## Three permanent rules

1. Preserve the previous strategy. Every core strategy change must be versioned
   and reversible.
2. Record the hypothesis, reason, and expected measurement for every strategy
   change.
3. Run a challenger strategy alongside the current strategy. Replace the
   current strategy only after the challenger meets the acceptance criteria in
   `STRATEGY_GOVERNANCE.md`.

## Change discipline

- Separate product/UI changes from strategy changes in both reasoning and Git
  history.
- Do not tune strategy rules in response to a few recent winning or losing
  sessions.
- Change one primary strategy variable per experiment whenever possible.
- Do not overwrite historical signals with calculations made from newer data.
- Avoid look-ahead bias: a signal may only use information available at its
  recorded decision time, and simulated execution must happen afterward.
- Keep transaction costs, slippage, dividends, splits, and adjusted-price
  handling explicit whenever they affect reported performance.
- Prefer deterministic calculations for scores and risk limits. AI may explain
  results, but it must not silently invent or alter numeric scores.
- Low-confidence or incomplete data must fail closed: show the limitation and
  prevent a misleading trade action.

## Required workflow

Before changing strategy logic:

1. Read `STRATEGY_GOVERNANCE.md` and the relevant Git history.
2. State the hypothesis and the one primary variable being changed.
3. Define the comparison baseline and acceptance criteria before inspecting the
   result.
4. Add or update a version entry in `STRATEGY_GOVERNANCE.md`.

Before handing off any change:

1. Run syntax checks and available tests.
2. Verify the stock page visually at desktop and narrow viewport sizes when UI
   code changes.
3. Check that account equity reconciles with cash and position market value.
4. Check that risk limits are enforced in code, not merely displayed as text.
5. Review the diff for accidental changes and document the verification result.

## Evaluation priorities

Do not optimize win rate alone. Evaluate at least:

- total return and excess return versus SPY;
- maximum drawdown;
- profit factor and average win/loss ratio;
- volatility-adjusted performance;
- number of trades and average holding period;
- performance after estimated costs and slippage.

Favor a simpler strategy when additional complexity does not produce a stable,
out-of-sample improvement.
