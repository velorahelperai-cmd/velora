# P2 Billing Readiness report

Date: 2026-10-08. Branch: `codex/p2-billing-readiness`.

**Result:** Scoped application fixes and offline verification are complete. Live billing is still blocked by five P1 database dependencies and verification of the merchant's actual OMR processing contract. This work does not certify a deployed payment flow or database concurrency.

## Isolation and scope

- Base: last completed `feature/p0-production-readiness` commit `afe2e298bfb4ef16414b83fb7077a2ca2f1e5c62`.
- Worktree: `C:/Users/DELL/.codex/worktrees/p2-billing-readiness/Velora new`.
- Changes are local, uncommitted, and limited to Billing/Paymob source, tests, and documentation.
- No changes to the original checkout, migrations/schema, Auth/RLS, AI, WhatsApp, Admin UI, or subscription design. Dependency manifests are unchanged.
- No provider API requests, financial transactions, cloud SQL, deployment, push, merge, secret copying, or new backups.

## Findings and fixes

| Finding | Minimal correction | Verification |
| --- | --- | --- |
| Provider operation success was treated as collected payment, including authorization/capture/refund/void/child operations and incomplete evidence. | Require complete signed standalone-payment lifecycle before classifying collection success. Preserve action events as non-granting evidence. Persist the signed lifecycle summary and reject unsafe historical success rows in actual event loaders. | [Protocol tests](../../src/lib/billing/paymob/protocol-readiness.test.ts), [stored-evidence tests](../../src/lib/billing/wiring/p2-stored-evidence.test.ts). |
| Missing or malformed settlement RPC data defaulted to `granted`; arbitrary error text containing `already` could imply replay. | Require an explicit structured RPC outcome. Preserve documented semantic outcomes; reject invalid data and stop guessing replay from error messages. | [Store tests](../../src/lib/billing/wiring/p2-store-readiness.test.ts). |
| Settlement failure after durable webhook storage still returned HTTP 200, including duplicate delivery. | Return HTTP 503 and `stored_awaiting_processing` after failed/thrown settlement, permitting redelivery. Confirmed grant/replay remain HTTP 200; durable duplicate-collection review is acknowledged without claiming a grant. This intentionally changes the failure response status. | [Webhook route tests](../../src/app/api/billing/paymob/webhook/route.test.ts). |
| Transient durable-reconciliation errors became manual review instead of retry. | Retry unknown/transport/backend errors; block missing RPC/table or disabled configuration; retain review for invalid results and validation/integrity failures. | [Actual loader/RPC boundary tests](../../src/lib/billing/wiring/p2-stored-evidence.test.ts). |
| Bare provider order lookup could select the newest of multiple tenant bindings; duplicate-event acknowledgement did not compare original tenant/attempt/financial binding. | Fail closed on ambiguous order lookup, invalid persisted amounts/currency/environment, or duplicate binding mismatch. A database uniqueness constraint remains P1 work. | [Store tests](../../src/lib/billing/wiring/p2-store-readiness.test.ts), [tenant/flow tests](../../src/lib/billing/wiring/p2-flow-readiness.test.ts). |
| Intention preflight and response echoes could disagree with the locked order. | Validate server account/integration, amount unit, currency, reference, test key mode, and any returned financial/account/order echoes. Catch network exceptions without repeating the provider POST or exposing request details. | [Checkout tests](../../src/lib/billing/paymob/p2-checkout-readiness.test.ts). |
| Floating-point checkout conversion could hide precision loss. | Use exact integer conversion with the existing explicitly approved factor; reject fractional provider amounts and unsafe integers. No factor or conversion configuration was changed. | [Checkout amount tests](../../src/lib/billing/paymob/p2-checkout-readiness.test.ts), existing checkout-action tests. |
| Inquiry selected the last array item and lacked complete response identity/lifecycle checks. | Reject unsupported arrays; verify lookup identity, merchant/integration, OMR, test environment, and lifecycle completeness. Network uncertainty never permits a fresh collection. | [Inquiry tests](../../src/lib/billing/paymob/reconcile-readiness.test.ts). |

Server Actions, tenant access checks, locked price snapshots, and existing settlement contracts remain in place. Callback display hints never activate subscriptions. No fake production prices or grant outcomes were introduced.

## OMR contract evidence

Paymob's [Create Intention specification](https://developers.paymob.com/paymob-docs/intention-apis/create-intention) describes the amount unit as cents but does not establish the factor required by this Oman merchant integration. The actual merchant processing contract was not supplied or inspected. Neither 100 nor 1000 was assumed. Existing `PAYMOB_OMR_CONVERSION_VERIFIED` / `PAYMOB_OMR_UNITS_PER_OMR` semantics remain unchanged; an unverified configuration continues to block checkout.

The HMAC review used Paymob's [20-field transaction specification](https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac/hmac-transaction-callback). Inquiry authentication was preserved against the [official Postman collection](https://github.com/PaymobAccept/API-Postman-Collections/blob/main/Transaction%20Inquiry%20API.postman_collection.json); no credential or provider access was used to verify account availability.

## Final local verification

Executed in this worktree after all source changes:

- `node node_modules/vitest/vitest.mjs run src/lib/billing src/app/api/billing`: **305 passed**, **17 skipped**, **0 failed**; 27 files passed and five opted-in SQL files skipped. Baseline was 158 passed and the same 17 skipped.
- `npm run typecheck`: exit 0.
- ESLint on changed/new TypeScript files: exit 0, zero errors; one existing unused `_result` warning in `paymob/reconcile.ts`, unchanged by this work.
- `git diff --check`: exit 0.

Tests use synthetic data, mocked HTTP/RPC/database access, and real local HMAC hashing. The [12-scenario matrix](p2-p1-dependencies.md#required-scenario-coverage) distinguishes passing application checks from unresolved database guarantees. Parallel calls against an RPC double do not prove exactly-once Postgres activation. The skipped SQL tests were not executed or counted as passing.

## Required P1 dependencies before live launch

1. **D1: Live settlement/entitlement.** Existing settlement SQL and operational entitlement remain test-only or fail closed. Provide a reviewed service-only live contract.
2. **D2: Test/live subscription isolation.** The same company subscription row currently receives test paid time. Separate authoritative state so test payments cannot activate, block, or extend live purchases.
3. **D3: Atomic catalog and expiry.** Revalidate and derive the published plan's financial snapshot inside the purchase transaction. Define and enforce offer/order expiry; application pre-reads do not prevent publication races.
4. **D4: Complete lifecycle/reversal.** Add durable automatic failure/cancellation/refund handling, correlated captures, and authoritative ordering. An older genuine success can still qualify after a later reversal without transactional supersession checks. Audit historical evidence.
5. **D5: Provider identity binding.** Enforce immutable scoped provider/account/environment/order uniqueness in the database; application ambiguity rejection cannot prevent conflicting writes.

Detailed source evidence, acceptance criteria, and required real database tests are in [P1 dependencies](p2-p1-dependencies.md). These changes were recorded rather than implemented because the user explicitly excluded database, Auth, and RLS work from P2. No cloud action is pending within the authorized P2 scope.
