# Verification record — 2026-10-11

No production writes, model requests, provider activation, external messages or real payments were executed for this package.

- Fresh schema-only baseline matched current production read-only structural fingerprint `d264324249abb9fe7ede0cbbba346f7a` and policy/column-ACL fingerprint `a9f1ce104cf2e74d869ae582dbacc13a`.
- All three final phase files installed successfully with both structural and permission pre/post guards in a fresh network-disabled PostgreSQL17.6 isolate. Final structural fingerprint `65dd4e93dd82467da59476a9d4541646`, permission fingerprint `81b4093b74ade15c32463fe79f10331c`.
- Deliberately mismatched phase20 and phase30 postflights rolled back their entire schema mutation. Completed-phase replay was denied and preserved schema, permissions and history.
- Two synthetic pre-upgrade known/uncertain ledger rows and every original ledger/budget field remained unchanged across all three guarded upgrades; known costs and unknown holds were preserved.
- Canonical administrative accounting suite: 14 passed. The baseline first reproduced 12 material failures before compatibility installation.
- Customer authority suite: 28/28 passed in the complete run. Two additional focused cost-cap/reconciliation concurrency tests passed separately (30 distinct customer tests total). These are actual PostgreSQL transactions with observed lock waits, synthetic receipts and synthetic signed Meta evidence; no HTTP/provider requests.
- Fixed-ack heartbeat regression first failed with `t` instead of `f`, then passed after local control-boundary rejection. Retry/heartbeat leave fixed job and conversation rows unchanged.
- Covered tenant/claim isolation, missing/zero quota, atomic reservation rollback, real competing quota/cost reservations, unknown-cost hold/no retry, revocation/refund/paid expiry before and after downstream waits, immutable job receipt/version periods, version-spend/hold carryover, accepted/rejected/unknown recovery and exact owner budget configuration authorization/idempotency/revision conflicts/expiry.
- Muscat month boundary, immutable explicit budget policy/binding, cross-tenant binding rejection and allowed cost counter updates passed.
- RLS policy/session predicate widening and a sensitive worker-claim column grant were each deliberately introduced inside isolated transactions, rejected by permission guards, and rolled back.
- Offline runtime/accounting/persona/routing/fixed-ack regressions: 66 passed across six files.
- `npm run typecheck`, scoped `eslint scripts/ai-runtime-compatibility/*.mjs`, `npm run build`, and `git diff --check` passed.
- Independent read-only source review: initial company-lock and fixed-control findings resolved; policy/column fingerprint gap resolved. No remaining material source issues reported.

Commands:

```powershell
node scripts/ai-runtime-compatibility/verify-installed.mjs
node node_modules/vitest/vitest.mjs run --config scripts/ai-runtime-compatibility/vitest.optin.config.mjs
node node_modules/vitest/vitest.mjs run --config scripts/ai-runtime-compatibility/vitest.optin.config.mjs -t 'cost reservations|worker reconciliation'
node node_modules/vitest/vitest.mjs run src/lib/answers/runtime/security-store.test.ts src/lib/answers/runtime/whatsapp-cost.test.ts src/lib/answers/runtime/whatsapp-persona.test.ts src/lib/answers/runtime/execute.test.ts src/lib/whatsapp/fixed-ack.test.ts src/lib/whatsapp/meta-routing-policy.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js scripts/ai-runtime-compatibility/*.mjs
npm run build
git diff --check
```

The PostgreSQL harness requires the explicit validated isolate receipt described in README. Task-local evidence is under `C:/Users/DELL/Documents/Codex/2026-10-10/task/ai-compatibility/`: customer-final.log, accounting-concurrency.log, admin-final.log, owner-budget.log, final-installed-verification.log, history-preservation.json, final-guarded-install.json, offline.log, typecheck.log, build.log and final-lint.log.

Live acceptance remains unperformed: production package/access review and installation, approved catalog/budget configuration, authorized owner/QA session, actual Live payment evidence, scoped provider adoption/activation, and Gemini Free-tier project/model attestation are separate prerequisites. The explicit synthetic Gemini request is recorded but was not executed here; the separately assigned TypeScript worker owns its wiring. Customer runtime remains hard off.
