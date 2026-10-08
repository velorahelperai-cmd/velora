# C1 critical security and billing hardening

**Local correction gate: PASS. Release Security Gate: BLOCKED. Payment/AI production readiness is not certified.**

Branch `overnight/security-foundation`. Fixed base `a5b8d141ec629d3129e3fb57c00360b7a0cbba35`; final commit is the independent local commit containing this report, with exact SHA supplied in the delivery message. Original integration `485d21e44eb0c676a3aec9cfe47c5f5f40f86ade` and saved security correction `61163a67fe7230300b333d66a04fb5202a80d355` are ancestors. No duplicate merge/review of closed findings. Antigravity worktrees and original branches were preserved.

## Critical / High findings repaired

| Severity | Proved finding | Correction / evidence |
|---|---|---|
| Critical | A server persistence client could rewrite HMAC-attested Authorization/capture flags into a collected-payment event, then obtain a grant; an unprocessed refund could be erased | `20261008161000_vel_billing_receipt_immutability.sql:17`: immutable original provider receipts, DELETE/TRUNCATE protection and restricted service privileges. Actual PostgreSQL RED obtained `granted` after mutation; final tests reject it. This was a persistence-boundary defect, not a demonstrated browser attack. |
| High | Financial grant periods/provenance could be overwritten, revoked grants resurrected, settlement evidence deleted | Same forward migration `:21`, `:26`, `:46`: preserve receipt fields and history. Only existing active-to-revoked status and replay detail updates remain. Row/statement triggers also reject ordinary SQL-administrator maintenance mistakes. |
| High | Service clients could reset/delete lifetime AI budget accounting and edit outcomes directly | `20261008160000_vel_ai_security_accounting_boundary.sql:6`: service table CRUD revoked; guarded fixed-search-path definer RPCs perform the existing transactions. RLS remains enabled; no parallel ledger or budget reset introduced by the migration. |
| High | Administrative attempts could skip sequence, change tenant/session on fallback or retry unknown paid work | AI migration `:13`: bind original execution, pricing model/version, tenant/actor/session; consecutive attempts and whitelisted definite-zero rejection required. Existing customer-live disabled branch preserved. |
| High | Known AI success could settle without start; actual response/model metadata was lost; unknown costs could be reported as known or positive USD as zero baisa | AI migration `:86`, `:101`; `src/lib/answers/runtime/store.ts:31`: validate lifecycle, full token breakdown, finite monetary values and actual model; persist both provider references. Unknown holds remain reserved. |
| Medium | Settlement/reconciliation retries could give an ambiguous failure after a committed accounting result | AI migration `:120`, `:189`: exact stored outcome/usage/evidence comparisons acknowledge identical retries, reject conflicts, and charge once under ordered locks. |

Detailed before/after source evidence and tests: [Billing review](billing-review.md), [AI review](ai-review.md). Independent read-only source/SQL/shared-contract review returned **PASS** with no actionable Critical/High/Important issue in the local changes.

## Forward migrations and integration contract

1. `20261008160000_vel_ai_security_accounting_boundary.sql`.
2. `20261008161000_vel_billing_receipt_immutability.sql`.

Both were initially created through the installed Supabase CLI and ordered after the existing future-dated `152000` migration chain. Historical migration files were unchanged. Apply only through a separately approved cloud procedure after verifying every prerequisite and historical data; local execution is not cloud migration-history proof.

Deploy the AI migration and the updated store together: current admin calls use `ai_settle_admin_attempt` with response and actual-model fields. The old eight-argument API remains a compatibility path. WhatsApp reservation/start/settlement and joint capacity/cost contracts remain operational. Direct service accounting writes are intentionally denied: any future budget provisioning needs a reviewed SQL-owner or restricted RPC workflow, not restoring blanket CRUD. No existing in-flight holds or costs are reset by deployment SQL.

Financial receipts are append-only. Existing replay detail and active-to-revoked lifecycle remain available. Correcting/restoring historical evidence requires a reviewed forward reconciliation path; deleting receipts or overwriting an old grant is not a rollback strategy.

## Final verification

| Category | PASS | FAIL | Skipped / NOT RUN |
|---|---:|---:|---|
| Default application suite | 1046 | 0 | 35 skipped; 98 files passed, 8 skipped |
| Existing actual PostgreSQL Billing acceptance | 29 | 0 | 0 |
| New immutable financial receipt cases | 15 | 0 | 0 |
| New refund/renewal races and transaction rollback | 3 | 0 | 0 |
| New AI security SQL assertions | 14 | 0 | 0 |
| New AI independent-session races | 5 | 0 | 0 |
| Full actual PostgreSQL AI/WhatsApp/inbox regression | 134 | 0 | 0; all 69 source migrations applied locally |
| Actual SQL-backed application paths | 17 | 0 | 0: Billing 2, administrative AI 3, WhatsApp 12; provider transports mocked |
| TypeScript / scoped ESLint / diff checks / production build | PASS | 0 | — |
| Full repository ESLint | PASS | 0 errors | 3 existing warnings in unchanged setup-wizard/reconcile/return-status sources |
| PGlite / cloud catalog parity / real payment / paid AI / real Meta | — | — | NOT RUN; not included as successful evidence |

The default skipped cases include separately executed opt-in database tests; counts are separate categories, not unique end-to-end runs. The focused RED runs reproduced Billing 9 failures and AI 11 failures before the corrections. Earlier test-harness failures were resolved without weakening assertions: construct malformed receipts before immutable insert, expect ACL-denied writes, serialize PostgreSQL scalar values as JSON in the test transport, and replace the timed overlap window with an open transaction released only after observing the competing backend's actual Lock wait.

Existing populated Billing upgrade passed **18 scenarios / 20 assertions**, retaining **23 financial grants**. Proven Live history stayed Live; Test remained Test; unknown/incomplete/unattested/mixed/reversed history stayed quarantined or non-entitled. Existing manual/security suspensions were preserved. Full-chain identity preflight also rejected a deliberately inconsistent legacy row without deleting or reassigning it.

Concurrency used real independent PostgreSQL backends and observed locks. New refund-before-renewal pair `13242/13256`, renewal-before-old-refund `13348/13363` both preserved the new active paid entitlement and denied old-success replay. Five new AI races observed both contenders blocked before releasing a coordinator budget lock: global cap, duplicate execution, single start, exactly-once known settlement and reconciliation. Full AI/WhatsApp regression additionally passed its 14 independent-backend cases.

Actual database is PostgreSQL 17.6 in task-labelled `velora-c1-security-a5b8d14`, network disabled, no exposed ports, tmpfs data and no persistent mounts. Auth/Storage identities/infrastructure and provider evidence are synthetic; project RPCs, constraints, RLS/ACLs, locks and Vault encryption are real. Test-only SQL-admin helpers provision/restore synthetic fixtures; accounting calls use actual `service_role` RPCs. Cloud Auth/HTTP/PostgREST behavior and patched database-version parity remain unverified.

## Remaining owner and cloud decisions

- Approve the actual Paymob merchant/account/environment/order-ID namespace and Oman amount-unit contract. Conversion factors were unchanged. [Public Create Intention docs](https://developers.paymob.com/paymob-docs/intention-apis/create-intention) specify cents and matching currency/Test-Live integration; that does not establish this merchant's OMR processing factor. [Official HMAC fields](https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac/hmac-transaction-callback) support the signed owner/identity/lifecycle checks; unsigned data is not substituted for proof.
- Adopt or revise the implemented **two-hour** payment-order expiry and authorize handling confirmed late payments. `deadline_policy_approved` remains false by default. No automatic 24-hour checkout or three-day grace policy was found/introduced.
- Approve full/partial refund, void, reconciliation/restoration and financial suspension/grace rules. An old reversal cannot revoke a newer unrelated collection. Ambiguous extent/parent events remain under durable review without invented business effects.
- Verify exact deployed migration history, function definitions, ACLs, constraints and historical classifications before cloud application. Existing report discrepancies remain unresolved; source/object counts alone are insufficient. Cloud verification: **BLOCKED / NOT RUN**.
- Verify deployment transport, worker/Meta configuration and real-account journeys separately. The official [Supabase PostgreSQL upgrade notice](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes) documents newer patched releases; this isolated 17.6 test image is not evidence of the cloud version or its upgrade prerequisites.

No customer-live AI/WhatsApp rollout, payment activation, secret configuration or commercial approval was performed. No real API/payment/WhatsApp call, cloud SQL, deployment, push, merge to original branches or backup occurred. Changed-file credential-pattern scanning returned zero matches; no real keys/tokens were copied or printed.
