# G07 — Financial return and Admin KPI qualification

Date: 2026-10-09. Branch: `integration/overnight-velora`.
Base: `31f1fc04052e255f95f948a7c57f60588bd25c37`.
The final implementation SHA is supplied with the delivery; this report is in that commit.

## Root cause and correction

The return reader treated any entitlement application as a confirmed payment. It did not qualify the immutable collection receipt or check revoked/otherwise ineligible grants. The Admin reader accepted an aggregate RPC that summed grant-backed orders without the canonical proof or lifecycle qualification.

The application now shares a **read-only** financial projection over existing server-authorized tables. It qualifies the same bound order, plan snapshot, attempt, event, grant and settlement outcome used by `private.billing_verified_collection_history` and `private.billing_proven_entitlement_grants`. It checks company, merchant account, environment, transaction, commercial/provider amount, currency, period, HMAC receiver attestation and standalone collection flags. Timestamp equality preserves PostgreSQL microseconds; a computed JSONB text selector preserves the exact signed account comparison.

Confirmed display requires both proven collection and eligible per-order entitlement. Revoked proven receipts are recorded reversals; retained legacy/unproven grants, duplicate collections, signed refund/void observations and C1 first-collection policy blockers require review. Partial refund observations never imply a full refund or an invented refunded amount. Test receipts are explicitly labelled and never presented as paid Live service. Current service remains the existing subscription guard's responsibility.

Admin shows proven **gross** Live collections for the Asia/Muscat calendar month, separate from Test. It counts distinct orders with financial activity this month by reversed/review/pending/failed/unknown state. Old receipt activity does not move its collection into this month's gross. `reversed_collection_baisa` and `review_collection_baisa` describe original proven order exposure, **not refund amounts**. Refund amount and net revenue remain `null`, because neither refund extent nor fees are attested by this ledger. Read failures or safety-limit exhaustion show unavailable data, never fabricated zero totals.

No historical SQL, financial mutation contract, ACL, RLS, price, renewal/refund policy, paid-entitlement guard or styling was changed. No migration was needed. The historical `admin_financial_summary()` definition is retained but no longer consumed by the application; it must not be reused as a qualified/net financial read. The projection cannot grant or revoke service.

## Modified files

| Area | Files |
| --- | --- |
| Read-only evidence and aggregation | `src/lib/billing/financial-truth.ts`, `src/lib/billing/financial-read.ts` |
| Return loader/status | `src/lib/billing/wiring/return-load.ts`, `return-status.ts` |
| Existing Admin read | `src/lib/answers/runtime/admin-truth.ts` |
| Financial wording in existing UI | `src/components/app/admin-list.tsx`, `subscription-payment-status.tsx` |
| New regressions and synthetic fixtures | `src/lib/billing/wiring/g07-financial-truth.test.ts`, `g07-postgres.test.ts`, `financial-truth.fixtures.ts` |
| Existing tests upgraded to qualified receipts | `src/lib/billing/wiring/fix-01.test.ts`, `fix-02.test.ts`, `journey.test.ts`, `p2-flow-readiness.test.ts`, `selection-return.test.tsx` |
| Local PostgreSQL SELECT adapter | `scripts/billing-acceptance/app-database-adapter.mjs` |
| Delivery evidence | This report |

## Verification

| Check | Result |
| --- | --- |
| Initial RED against original implementation | 10 FAIL / 5 PASS, including authorization, legacy grant, reversal, partial refund and missing-evidence errors |
| Additional review RED checks | 3 policy-blocker failures; 1 microsecond mismatch failure; 1 JSONB account-text mismatch failure, each reproduced before its fix |
| Final G07 regression | 44 PASS / 0 FAIL |
| SSR return wording, navigation and forged-query tests | 14 PASS / 0 FAIL, including 4 new financial wording regressions |
| Full application suite on final code | 1301 PASS / 0 FAIL / 43 SKIPPED, 111 passing files / 12 skipped files |
| TypeScript | PASS, exit 0 |
| Lint | PASS, exit 0; one pre-existing unused `_result` warning in Paymob reconciliation |
| Production build | PASS, exit 0; 33 pages generated |
| Actual PostgreSQL G07 parity/integration | **2 NOT RUN** (counted among skipped tests, never passing) |
| Cloud/payment/AI/Meta execution | NOT RUN, prohibited by task |

G07 coverage includes documented payment, authorization without collection, unqualified legacy grant, recorded reversal after stale success, partial refund, duplicate event vs duplicate collection, review, forged return HTTP query, cross-tenant reads/evidence, read failures, Test/Live separation, existing C1 deadline/late-payment blockers, exact timestamps/account text and pagination beyond one page. All provider calls use synthetic fixtures/mocks.

An independent read-only review found the first-collection classification and timestamp precision issues. Both were corrected with RED/GREEN. A final review found no remaining Critical/Important issues; the archival account-text edge was also corrected and re-reviewed.

## Unverified boundary and closure

Docker's local Linux engine pipe was unavailable. There was no safe reachable PostgreSQL instance, so neither G07 PostgreSQL test ran. No PGlite result is substituted for PostgreSQL. The two prepared cases exercise Test/Live SQL-view parity and a real local SQL settlement → partial-refund review/replay → return/aggregate read, with retained history after the existing one-way revoked transition. They use only the task-labelled network-disabled ephemeral container checked by the existing harness.

The SQL/API projection still needs execution against that local PostgreSQL environment. The read-only application queries are bounded at 10,000 rows per read; exceeding the bound yields unavailable metrics rather than partial totals. Multi-query reads are observational and do not authorize any mutation or claim transaction-snapshot guarantees.

**G07 closure: PARTIAL** — local implementation, regression checks, typecheck, lint and build are complete; canonical PostgreSQL runtime parity remains unverified. No staging/production readiness is claimed. No next task was started.

The four prior untracked HTTP-test files were retained and excluded from this commit. C1/C2 ancestry and the manual-reply paid-entitlement checks were verified and left untouched. No push, deployment, cloud SQL, provider execution, secret change, backup or financial-data mutation was performed.

Local rerun (from this worktree):

```powershell
node node_modules/vitest/vitest.mjs run src/lib/billing
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
node node_modules/next/dist/bin/next build
```

After the existing isolated local PostgreSQL harness has been safely provisioned, the G07-only opt-in run is:

```powershell
$env:BILLING_ACCEPTANCE_POSTGRES_TESTS = '1'
node node_modules/vitest/vitest.mjs run src/lib/billing/wiring/g07-postgres.test.ts
Remove-Item Env:BILLING_ACCEPTANCE_POSTGRES_TESTS
```
