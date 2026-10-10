# Stage 2A forward financial provenance

Base: `23b0871603f0763d18bb040b296bad74c261ece1`, main only. Local review package; no production application, push, deployment, provider requests or customer operations. Stage 2B and worker contracts are excluded.

## Reproduced gaps

Cumulative actual financial metadata replay → accepted Stage 1 → the matching installed Test checkout RPC created a successful order/attempt with all three attempt scope fields NULL. RED evidence: `artifacts/internal-ui/stage2a-red.log` and `stage2a-baseline-confirmed.log`.

A partial scoped provider-order index alone excludes unknown legacy attempts. The added RED regression showed that a NEW bound attempt could then claim a provider-order identifier already held by two unbound legacy attempts. Evidence: `stage2a-legacy-id-red.log`. The fix refuses that claim in the same merchant/environment, retains every old row, and adds a filtered lookup index for the refusal guard. Preflight also refuses any already-complete binding that conflicts with an unknown legacy identifier, instead of repairing data.

## Bounded changes

- Three nullable, no-default columns: subscription `environment`; order `expires_at` and `deadline_policy_approved`.
- Replace only company-only subscription uniqueness with a partial `(company_id,environment)` Test/Live arbiter. All subscription IDs and `(id,company_id)` keys/FKs remain. NULL history stays outside the arbiter.
- Add prospective scoped provider-order uniqueness and a lookup index for unknown legacy identifiers. Preserve the existing product/purpose index exactly; the old plan-scoped open-purpose index was intentionally retired and is not recreated.
- New attempts bind from the locked order only on INSERT. UPDATE never fills legacy NULLs; tenant/order/provider/account/environment are immutable, and provider identifiers become immutable once bound. Unknown-deadline orders cannot acquire new attempts.
- Scope/amount-check provider event insertion; retain the canonical company→subscription→order→attempt lock family.
- Replace the public purchase writer with the existing published-catalog snapshot contract, including complete period comparison. Unknown-deadline old orders are retained and return review-required instead of cancellation/reuse; account mismatch cannot reuse another snapshot.
- Install the reviewed P1 collection core privately with the exact partial `ON CONFLICT` predicate, then the stored-receiver evidence/lifecycle acceptance gate. The gate requires persisted attestation, treats unknown Live policy or any unknown/expired deadline as review, and requires every NEW successful grant to satisfy the existing proven-receipt view before commit. Failure rolls back financial writes while the previously persisted event remains.
- Add the private lifecycle-review table and existing review-only helpers; signed refund/void flags do not revoke grants or suspend companies automatically.
- Add the existing tenant-authorized, proof-based operational entitlement reader. Preserve the installed Test checkout RPC body, owner, security settings and ACL exactly.

No package-level row UPDATE/backfill, historical paid inference, classification, date rewrite, prices/offers, service grants, service activation, worker contracts, credentials or existing table ACL changes.

## Preconditions and cumulative fidelity

Seven exact financial table fingerprints plus twenty-four full function fingerprints cover owner, security/configuration and ACL as well as body hashes. Twenty-three writer/helper contracts were captured read-only from production; the twenty-fourth is the corrected Stage 1 guard. Stage 1 proof-view owner, ACL and definition hashes are pinned under the same empty search path as installation. Database/public-schema installer authority is separately pinned from read-only metadata. No secret function bodies or customer rows were fetched.

Stage 1 guard remains `7b28f06702c177c5b65e3d9b23a7e1d4`; the historical canonical guard remains unchanged. The reviewed private collection core retains `ae4dd1a4195db97e91fa0e662ccdfff7`. Necessary forward adaptations and their body hashes are listed separately in `manifest.json`; future service orchestration must use those package hashes, not assume canonical function names imply identical contracts.

Before DDL, reject catalog/ACL/security drift, mixed legacy scope, full scope inconsistent with its order, duplicate complete provider-order scope, and complete-versus-unknown legacy identifier ambiguity. No `CASCADE`, deletion or reconciliation is used. A two-second lock timeout and single transaction bound installation; failed prerequisites and interrupted installation leave the baseline unchanged.

The isolated fixture also reproduces the observed postgres database ownership/public namespace ACL and exact Test checkout owner/ACL; its initial bootstrap defaults differed. Those changes are confined to the disposable test database. Peripheral Auth/company infrastructure uses existing synthetic stubs, not a full production clone. Positive Live-shaped events/policies are synthetic local INSERTs, not provider HMAC verification, charges, real policy approval or customer acceptance.

## Verification

```powershell
$env:VELORA_STAGE1_METADATA='C:\Users\DELL\Documents\Codex\2026-10-10\task\stage1-financial-metadata.json'
$env:VELORA_STAGE2_BASELINE='C:\Users\DELL\Documents\Codex\2026-10-10\task\stage2a-after-stage1-metadata.json'
node node_modules/vitest/vitest.mjs run --config scripts/financial-proof-cloud/stage2a.optin.config.mjs
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
git diff --cached --check
```

The first environment path is the SHA-pinned metadata-only input outside Git. The second is a metadata-only OUTPUT from the cumulative disposable fixture; no production connection occurs in the tests. Containers are verified local, network-none, tmpfs-only and without published ports; cleanup affects only their own verified task/run IDs.

Final cumulative isolated PostgreSQL suite: 24 passed, 0 failed, 0 skipped in 157.44 seconds (`artifacts/internal-ui/stage2a-insert-final.log`). Offline suite: 1437 passed, 42 opt-in skips (`stage2a-insert-unit.log`). Typecheck passed; lint has no errors and one pre-existing `_result` warning (`stage2a-insert-types.log`, `stage2a-insert-lint.log`). Application source is unchanged from the passing Stage 1 build; no redundant app build was run for this SQL/test-only slice. Earlier fixture failures were diagnosed rather than weakening guards: correct installer role/ownership, identical catalog search path, existing awaiting-payment subscription, existing day-alignment constraint and schema-qualified FK comparison.

## Remaining blockers

Stage 2A is a database compatibility slice, not deployment acceptance. Stage 2B service offer/snapshot/grant/read orchestration and worker identity/claim/authorization/capacity/cost/dispatch/recovery contracts remain. The missing discounted-order RPC is still a direct-POST-reachable Server Action blocker and cannot be aliased to full-price checkout. G03 approval, actual serving deployment SHA, backup/PITR/rollback prerequisites and live acceptance remain unresolved. Live deadline/late-payment/refund policy and service/customer activation require separate approval; this package supplies no approval API.

Validate the complete necessary ordered bundle cumulatively before one bounded production approval. Do not replay historical D1/D5 migrations or the historical evidence reclassification loop.

Reviewed package SHA256: `03ed8830c8da0684af0851ab4ef4ec16fd23bc64eef1cfbb3ee94d0793eeb267`, with UTF-8/no-BOM/CRLF-to-LF normalization. All new JS modules pass Node syntax checks; staged diff/encoding checks pass. Disposable test containers were cleaned up, leaving the pre-existing runtime untouched.

## INSERT-path review correction

Independent review found that `billing_payment_attempts_sync_order_scope` derived complete scope on INSERT but omitted the legacy provider-order identifier check enforced on UPDATE. A valid second synthetic attempt (distinct attempt sequence) with the legacy identifier succeeded against the reviewed SQL. This is a confirmed bypass, not an HTTP/status inference. The selected red run had 2 prerequisite tests pass and the new assertion fail because INSERT resolved rather than rejected (`artifacts/internal-ui/stage2a-insert-red.log`).

The minimum correction applies the identical legacy lookup after deriving trusted order scope and before returning NEW from the BEFORE INSERT trigger. It covers fully supplied, omitted and partial matching scope, including `ON CONFLICT DO NOTHING`; mismatched scope and unknown order deadlines remain rejected by existing guards. UPDATE continues to freeze historic NULL scope and bound identifiers. No historic financial row, checkout/settlement writer, ACL or canonical migration is changed.

New cumulative regressions verify all six INSERT forms, unchanged legacy row JSON, concurrent INSERT/UPDATE refusal for unknown legacy identifiers, and one-winner unique arbitration for a fresh same-scope identifier. The unchanged suite also checks cross-account/environment reuse, scope/deadline immutability, pre-DDL ambiguity refusal, rollback and authorization. One contended cumulative attempt failed at Docker inspection before fixture cleanup, causing subsequent prerequisite refusals; the fresh uncontended cumulative rerun passed all 24 tests. No production calls occur.

Corrected INSERT sync body MD5: `56d96321d7e2ed74fbf27e707aed1ded`. The UPDATE guard and other forward body hashes remain unchanged.
