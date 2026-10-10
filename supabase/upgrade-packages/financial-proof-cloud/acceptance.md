# Stage 1 financial-proof compatibility â€” blocked review package

Base: `f6119797055563e74396bdc0251f966fb33d72eb`, main only. This package is outside canonical migrations, has `auto_apply: false`, and is not authorized for production execution, push or deployment.

## Reproduction and root cause

Production metadata has no attempt provider/account/environment columns, no entitlement receipt status, no canonical private collection/proven-grant views, and no six financial receipt immutability triggers. A disposable database replayed the seven actual financial tables (column definitions/defaults, constraints/indexes, RLS/policies, triggers and ACLs), the four actual writer contracts and twenty source-matched private dependencies. The seven full table and four full writer catalog fingerprints match the captured metadata before fixture data or package installation. Private schema ownership/ACL was separately read and reproduced. No customer rows or secrets were exported.

The actual installed `billing_settle_paymob_hmac_verified` writer settled a synthetic Test receipt. Changing its provider raw evidence then succeeded: the initial receipt mutation regression was RED. This proves the missing guard, not successful production payment or activation.

The exact canonical function from `20261008161000_vel_billing_receipt_immutability.sql` has a second defect relevant to nullable legacy evidence. SQL three-valued logic makes this expression NULL for `active â†’ NULL` and `NULL â†’ revoked`:

```sql
not (old.status='active' and new.status='revoked')
```

A PL/pgSQL `IF` with NULL does not reject the update. Both focused assertions reproduce this defect with the exact function. Those two regressions established the RED evidence. The parent then explicitly authorized the one-expression NULL-safe local correction; the historical canonical migration remains unchanged.

The approved minimal correction is:

```sql
(old.status='active' and new.status='revoked') is not true
```

No other function body change was made. Canonical body MD5 is `968854ccf1b251404062386ea9f2fe2f`; this package body MD5 is `7b28f06702c177c5b65e3d9b23a7e1d4`. Both are pinned separately in the manifest; no unrelated or historical fingerprints were changed. It rejects unknown transitions while preserving exact no-op updates and the one documented active-to-revoked lifecycle. Production is untouched.

## Bounded proposed package

Four nullable text columns without defaults; two canonical private proof views; one canonical function with the documented NULL-safe correction and six guards. No historical UPDATE, evidence backfill, subscription classification/date/plan change, existing table ACL alteration, writer replacement or activation. New objects deny PUBLIC/anon/authenticated/service_role access. Existing legacy writer receipts remain NULL and unproved. Only newly inserted complete synthetic evidence is used for positive proof checks.

Preflight uses the exact read-only metadata fingerprints, postgres installer, private schema owner/ACL, no existing/partial proof objects, and a bounded two-second financial-table lock. A final writer fingerprint check detects changes during installation. Any failure rolls back the transaction.

## Verification commands

```powershell
$env:VELORA_STAGE1_METADATA='C:\Users\DELL\Documents\Codex\2026-10-10\task\stage1-financial-metadata.json'
node node_modules/vitest/vitest.mjs run --config scripts/financial-proof-cloud/stage1.optin.config.mjs
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
node node_modules/next/dist/bin/next build
git diff --check
```

The external metadata must stay outside Git and match manifest SHA256. SQL preflight is catalog-only and can collect a fresh authorized read-only snapshot. Test databases use local Docker, no network, no published ports, no persistent volumes; verification checks the task labels before interaction and cleanup. Existing runtime containers are not restarted.

Ordinary offline suite: 1437 passed, 42 opt-in skips. Typecheck passed. Build passed. Lint has no errors; one pre-existing unused `_result` warning remains in Paymob reconcile. Before correction, the final canonical isolated suite had 15 passes and 2 failures in 87.80 seconds, precisely the two NULL transitions. Its log is `artifacts/internal-ui/stage1-complete-canonical-final.log`. Corrected isolated suite: 19 passed, 0 failed, 0 skipped in 130.98 seconds. This includes all sixteen old/new pairs of NULL, active, revoked and unknown status through service_role, unchanged historical NULL evidence, canonical-versus-package hashes, actual installed writers, concurrent settlement replay, interrupted installation rollback, drift/lock rejection, unchanged budgets and existing table ACLs. See `artifacts/internal-ui/stage1-approved.log`. Earlier RED and canonical reproductions are in ignored `artifacts/internal-ui/stage1-*.log`.

## Remaining release blockers

The one-expression NULL-safe deviation has been approved for local implementation and tests. The corrected suite passed; this package is ready for independent local review. No production SQL or deployment approval is implied. Stage 1 alone cannot support deploying main: G03 reader approval, later forward financial binding/service and worker contracts, serving production SHA and rollback/PITR prerequisites remain outstanding.

The exported discounted-order Server Action calls missing `billing_create_offer_order`; direct POST reachability makes this a launch blocker even without current UI imports. It remains outside Stage 1. Do not alias a discount to a full-price order: future implementation needs eligibility, atomic/idempotent claim, pinned discount/provider snapshot and proven no-collection release semantics.

Peripheral Auth/company fixtures use existing synthetic dependency bootstrap rather than a full production clone. Positive Live-shaped evidence is inserted locally, not collected by a provider; it proves view predicates only. No paid models, payments, external messages, production rows, ACL changes, SQL writes, push or deploy were used.

## Final verification

- Corrected isolated PostgreSQL: 19/19 passed, zero skips.
- Offline repository suite rerun: 1437 passed, 42 opt-in skips (`stage1-approved-unit.log`).
- Typecheck rerun: passed (`stage1-approved-typecheck.log`).
- Lint rerun: zero errors; one existing `_result` warning (`stage1-approved-lint.log`).
- Application build passed before the SQL-only NULL correction; app source is unchanged (`stage1-build.log`).
- All four new JavaScript modules pass Node syntax checks; all eight deliverables are UTF-8/LF with no trailing whitespace; staged diff check passes.
- No paid provider calls or production mutations. Only the pre-existing `velora-c2-runtime-13861eb` container remains.

The slice implements the bounded database review package and synthetic proofs, not a deployed release. Production SQL, ACL changes, push/deploy, provider activation and customer processing remain separately unauthorized.

Package SHA256 is `303b1ffa8c736a1faf5ebc2a9dafc69c3b1c247e00604b1bbd34ffa6b9941168` with UTF-8/no-BOM/CRLF-to-LF normalization, so Windows checkout line endings do not change the reviewed identity.
