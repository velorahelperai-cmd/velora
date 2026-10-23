APPLICATION RECEIPT: approved SHA256 a81eccfa37a256f9acd609de4d2c08a4ffa0d438acec31efdb39a323759a8d6f APPLIED successfully on vmpifljyozsbtssxhoxd, migration 20261022062222. Read-only postflight PASS; functional tests pending. Original preparation record below is historical. See application-success.json.

# Production differential — approval candidate

Target: vmpifljyozsbtssxhoxd only. Status: Prepared / Pending approval; NOT APPLIED.

Final SQL: production.sql
SHA256: a81eccfa37a256f9acd609de4d2c08a4ffa0d438acec31efdb39a323759a8d6f
Migration name: es02_remaining_production_differential_20261022

Scope: B5–B8 branch setup, trial session history, reservation/settlement wallet, first operational acceptance clock, ES02 authority and native worker bridge. Already applied single_branch_scope, B4 and admin pagination are excluded. Retired master-credit rules, legacy priority adapter and account-only direct debit are excluded. No historical migration or LOCAL installer/guard is modified.

Order is contained in one BEGIN/COMMIT transaction. Native database/catalog/ACL/history/company-scope pins precede DDL. Application must target the named project through the official migration API; no claim that a PostgreSQL database name alone identifies the project. Drift, existing target objects or in-flight company_live liabilities stop application. Lock timeout 5 seconds and statement timeout 60 seconds; reconcile blocked work without resending. Do not bulk-push historical migrations or strip guards. Any changed SQL requires a new hash/review.

Business contract: reserve existing purchased units first, then eligible base units; purchased units retain no ordinary expiry. Accepted provider evidence commits once, confirmed rejection releases once, unknown remains held without automatic resend. Initial subscription starts only at the first accepted operational reply to a proven real customer. Configured test recipients, Meta test and free setup_trial do not start it. Readiness permits operation but never starts the subscription. Existing started/ended dates remain preserved.

Review permission-diff.md and manifest.json together with the entire SQL. The package creates 9 private RLS tables, 34 functions, replaces 10 definitions and preserves 8 native bodies as private aliases. Direct runtime table access remains denied. The AI usage-mode constraint explicitly admits setup_trial; the pinned full native private.ai_settle_admin definition changes only that mode admission, retaining native admin budget and settlement behavior.

No top-level existing business-data deletion, balances/prices creation, credential change, Auth session mutation or RLS weakening. New branch setting RPCs invalidate scoped launch confirmations when settings change; new join-table cascade relationships concern new dependent records. Trial-session history backfill operates on the newly created empty table. These runtime effects are part of this approval, not a blanket Production cleanup authorization.

Independent liabilities:
- PAYMOB_EXTERNAL_DEFERRED: current mounted payment action returns this code instead of invoking Paymob. Completing external Test payment/provider reconciliation is a separate pending integration, not lost consolidation work. Real payment remains OFF. No provider calls or new credentials.
- One preexisting admin_test uncertain AI attempt without a worker job is preserved unchanged, not retried or settled. It is separate from the company_live cutover fence.

Validation this preparation: read-only hosted catalog capture; deterministic generation with pinned inputs; node syntax check and ESLint. No functional tests, SQL application/compilation on a database, provider or browser tests were started. Prior local tests are historical evidence, not execution of this final Production script. This is not a Production Ready claim.

Reproduce: node supabase/upgrade-packages/es02-production-differential/build.mjs
Check: node --check supabase/upgrade-packages/es02-production-differential/build.mjs
Check: npx eslint supabase/upgrade-packages/es02-production-differential/build.mjs

Sources: the exact pinned repository sources in manifest.json and read-only actual Production pg_catalog capture in production-baseline.json. No new dependency.
