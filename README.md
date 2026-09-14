# laofan-studio
My personal website and AI projects

## Authentication and cloud paper accounts

Email/password Auth uses the existing Supabase project. The SDK verifies users
before loading the stock app. Sessions persist/refresh and logout clears the
current browser session. Public market-data endpoints remain public.

`paper_accounts` stores each user's complete simulated account and notification
preference. SELECT/INSERT/UPDATE require the authenticated user's ID under RLS;
anonymous access is revoked. Browser notification permission remains per device.

The account loads from Supabase before trading initializes. Initial legacy local
accounts are imported only if no cloud account exists; the original browser key
is preserved, and tied to the first user on that browser. A manual legacy import
button backs up the cloud state first. With simultaneous edits, revision-checked
updates reject the stale writer. Unsent edits are saved locally, trading is
paused on sync failure/conflict, and a download-backup/reload UI is provided.
Reload displays the cloud account and retains any pending snapshot as a backup;
it does not silently replay stale trades. Other open devices poll every 15s.

Run `npm ci`, then `npm run dev` for http://127.0.0.1:8877/stock-ai/.
Run `npm test` for Auth, cloud-sync and existing strategy/risk tests.

`npm run build` creates `dist/` and updates the checked-in static release
`stock-ai/auth.bundle.js` and `stock-ai/auth-config.js` for the existing GitHub
Pages branch deployment. The latter intentionally contains ONLY a public project
URL and publishable key. Set PUBLIC_SUPABASE_URL and
PUBLIC_SUPABASE_PUBLISHABLE_KEY in ignored `.env.local` or build environment to
regenerate it; otherwise Vercel reuses the public release config. Never use a
secret/service-role key. No env files are included in dist. Vercel retains its
serverless API and publishes dist; GitHub Pages retains its original main/root
publication. Strategy rules and market-data calculations are unchanged.

Supabase Auth URL Configuration should allow:
- http://127.0.0.1:8877/stock-ai/login.html
- https://laofan199.github.io/laofan-studio/stock-ai/login.html
- https://laofan-studio.vercel.app/stock-ai/login.html

Keep email confirmation enabled. Dashboard login is still needed to configure
these redirect URLs; existing verified accounts can sign in without that change.

Verification 2026-09-14: 48 tests pass. Real registered user loaded and saved the
cloud account, a second page read the same account, and mobile 390px rendered
SPY candles and five candidate rows without horizontal overflow. Empty account
reconciles to $1,000 cash + $0 holdings. A different authenticated user sees zero
rows under RLS. Existing Supabase advisor warning: leaked-password protection is
disabled (https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
