# Subscription redesign verification — 2026-10-08

Implemented: supplied 10-second video and poster, responsive persona cards, published-price selection, Basic/Premium invalidation, comparison disclosure, checkout summary, Test checkout server action, durable claim/persistence, owner-scoped resume, actual billing subscription display, verified webhook settlement and owner-page retry.

## Evidence

- npm run typecheck: PASS.
- npm run build: PASS, including TypeScript and page generation. Proxy entry detected.
- ESLint on changed application files: PASS.
- Vitest on src, excluding archived artifact snapshots: 366 passed, 18 skipped; skipped cases need separate local SQL/storage setup.
- New checkout/action/webhook tests cover Test-only configuration, missing prerequisites, owner authorization, amount isolation, live response rejection, duplicate/unresolved claims, persistence before redirect, saved checkout resume, terminal attempt guard, and settlement after verified durable insertion.
- PGlite: new SQL migration runs against a minimal fixture schema; amount pinning, tenant isolation, claim/replay, complete/resume, paid guard and authenticated-role denial passed. Not a full integration test of all existing migrations.
- Browser: desktop and 390px mobile, AR/EN, video, card selection, package invalidation, preview checkout disabled, no page errors and no horizontal overflow passed.
- Reduced motion: video starts paused; explicit play works.
- Independent code review: resume and yearly-cycle findings fixed; final review found no critical or important issue in the inspected additions.

## Still required for a real Paymob Test transaction

Test credentials, confirmed OMR provider units, published catalog, matching billing migrations plus the new checkout migration on the TEST database, and an HTTPS test deployment with callbacks. These were not enabled or deployed. No real or provider Test transaction was attempted; no cloud database was modified.

See docs/paymob-test-setup.md. Development-only /preview/subscription uses visibly labelled illustrative prices and cannot submit checkout. Production surfaces use the actual published catalog, with no invented fallback prices.

Existing local middleware deletion and prior CSS work were preserved. No commit or production deployment was made.
