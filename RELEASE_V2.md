# V2 research and held-position sell advice — handoff

Base: `a542e238432a72f33b55c95c0902e861a99b00ba`.
Branch: `codex/v2-growth-trend`.

Implemented:

- Add “建议卖出” beside “全部卖出” for existing fixed and dynamic holdings.
  Versioned 50/200-session trend rules, a reason/date display, confirmation and
  cancel dialog, fresh-quote gates, and an audit signal on confirmed paper sales.
- Reuse `/api/market?mode=sell-advice&symbols=...` for held-symbol analysis,
  with a bounded symbol allowlist, split-adjusted history and explicit failure
  on truncated data. No additional serverless function endpoint is introduced.
- Add an independent V2 readiness panel and frozen calculation/paper-ledger
  components. V2 remains blocked until real fundamental inputs and continuous
  simulation/corporate-action/benchmark accounting are connected. It must not
  be described as a running strategy or completed backtest.
- Version the app loader and release assets to avoid an old cached UI.

Verified:

- `npm test`: 67/67 pass.
- `npm run build`: pass; checked-in static auth bundle regenerated.
- JS syntax and `git diff --check`: pass.
- `scripts/verify-stock-ui.mjs`: isolated 1280px and 390px Playwright sessions;
  no real Auth, cloud records or market requests. Checked trigger/non-trigger,
  cancel, one confirmed sale, ledger reconciliation, market closed, missing
  data, disabled V2 startup, horizontal overflow and page exceptions. Chinese
  glyphs visually reviewed using optional QA-only Noto Sans SC fonts.
- Optional browser environment: `CHROMIUM_MODULE`, `CHROMIUM_EXECUTABLE`,
  `UI_FONT_DIR`, `UI_SCREENSHOT_DIR`; installed Playwright or the Codex runtime
  supplies the browser driver. Without `UI_BASE_URL` the script starts and stops
  its own local preview. None of the QA runtime dependencies enter the product.

Publishing is pending, not complete:

1. Authenticate GitHub write access, review upstream changes, and publish the
   reviewed commits to `LaoFan199/laofan-studio` through its existing workflow.
2. Verify BOTH GitHub Pages frontend and the existing Vercel backend release.
   Pushing the frontend alone does not prove the backend deployed.
3. The Vercel `mode=sell-advice` response must report
   `holding-exit-v1-advisory`; then check a real holding's source/date and button
   state without executing an actual user paper trade.
4. The V2 startup button must remain disabled. Additional data and execution work
   is listed in `stock-ai/V2_RULES.md`; no additional funding or data subscription
   has been purchased and no financial performance has been demonstrated.

GitHub App repository authorization was completed on 2026-09-15 after an initial
403 during setup. Authenticated upload now succeeds and its first tree hash
matches the tested local code. Both hosting targets still require the live
verification described above; an upload alone is not a deployment success.
No Supabase schema, RLS policy, Auth permissions or cloud data changed.
