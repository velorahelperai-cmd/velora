# Stage 2B cumulative service compatibility

Local review package only. No production application, deployment, provider call, historical classification, catalog seed or customer activation is authorized by these artifacts.

## Source and scope

Base main is `8126717ca13504fcaf7ce0857f99270b57547c93`, the independently accepted Stage 2A INSERT correction. The new CLI scaffold was `20261010132824_service_cloud_compatibility_stage2b.sql`; it was moved outside canonical migrations into this review package. Historical migrations remain unchanged.

The package combines reviewed `20261010053446_service_entitlement_read_contract.sql` and `20261010073549_service_purchase_settlement_orchestration.sql` in one bounded transaction. All twelve new service function bodies are identical to those sources. Changes are prerequisite adaptation, complete cumulative fingerprint guards, exact two-site purchase injection, the already reviewed public settlement wrapper/private backing arrangement, and post-install hash/no-seed assertions.

Three new private tables hold explicit offers, order snapshots and payment-linked grants. They have RLS, closed application-role table ACLs and six immutability triggers. The reviewed server RPCs define/snapshot/apply/activate; session-only read and platform-owner draft binding retain their existing actor checks. Every minted grant defaults to inactive. No offer, snapshot or grant is inserted during installation. Nothing classifies historical NULL receipts as paid, and historical payment replay cannot supply an originally missing service grant.

The projection contract supports only implemented `noura.knowledge.read` intersected with `knowledge.read` RBAC. Component projection coverage includes explicit Basic/Premium offers. The actual reviewed public purchase orchestration remains limited to explicitly bound `noor_basic`, OMR, Basic, monthly/one-period versions. This package does not promise public Premium checkout, Lina/Dana tools, reports, offers/discounts, usage capacity or WhatsApp activation.

## Cumulative proof and pins

The disposable database replays the seven exact observed financial tables and original writer/helper contracts, then installs Stage 1 and corrected Stage 2A before Stage 2B. Forty-two full function fingerprints pin owner, security mode, configuration, volatility, body and ACL. Financial table fingerprints include constraints, indexes, triggers, column privileges and policies; Stage 1 proof-view definitions, owners and ACL remain pinned under an empty search path. Installer/database/public namespace authority is unchanged from Stage 2A.

Read-only metadata captured twelve session/RBAC/catalog/cancellation/Auth function contracts, eleven supporting relations and the Auth namespace ACL. Application helper bodies resolve by exact observed MD5 from local source; only the two managed Auth SQL function definitions were fetched. No Auth/customer rows, credentials or token values were read. The external SHA-pinned input is `stage2b-service-metadata.json`; derived `stage2b-after-stage2a-metadata.json` is local metadata output, not production row export.

Peripheral infrastructure is not a complete managed Auth clone. Only Auth fields used by the guards are aligned; supporting public/private relation columns, owners, RLS and table ACL are aligned while retaining bootstrap constraints/indexes/policies. Those supporting constraints/policies are not claimed as full production fingerprint proof. The service APIs enforce the exact observed session/RBAC/owner implementations and new private-table boundaries independently. The fixture also replays the observed Auth namespace grants needed for foreign-key checks; no production permission was changed.

Corrected financial guard: `7b28f06702c177c5b65e3d9b23a7e1d4`. Corrected INSERT guard: `56d96321d7e2ed74fbf27e707aed1ded`. Purchase before injection: `a70719d80e0058b08b820f7a1494798a`; after exactly two injections: `4963a4ebcf0f9dbde12a0db77467ff04`. Private settlement backing remains `a1ce90ae693324f11db6d3026969bf47`; new public wrapper remains reviewed `a7460653ef5328f319644d08fc3fff7f`. Other underlying financial/helper bodies and existing ACLs remain unchanged.

## Verification commands

```powershell
$env:VELORA_STAGE1_METADATA='C:\Users\DELL\Documents\Codex\2026-10-10\task\stage1-financial-metadata.json'
$env:VELORA_STAGE2B_METADATA='C:\Users\DELL\Documents\Codex\2026-10-10\task\stage2b-service-metadata.json'
$env:VELORA_STAGE2B_BASELINE='C:\Users\DELL\Documents\Codex\2026-10-10\task\stage2b-after-stage2a-metadata.json'
node scripts/financial-proof-cloud/stage2b-baseline-probe.mjs
node node_modules/vitest/vitest.mjs run --config scripts/financial-proof-cloud/stage2b.optin.config.mjs
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
git diff --cached --check
```

The probe reproduces canonical service installation refusing the corrected Stage 1 guard before producing the cumulative metadata. The SQL compatibility package adjusts that stale prerequisite without reinstating the unsafe historical guard. Focused acceptance passed 3 selected cases with 53 intentional skips and whole-package prerequisite/rollback/lock checks in setup. Final verification has passing evidence for all 80 cases across the combined run and one affected-case rerun. The latest combined run passed 79/80 in 808.71 seconds; one sleep-based concurrency waiter reached the local harness lock timeout. The package SQL was unchanged. That test now holds the company lock until an actual waiting transaction is observed, then releases the holder into settlement, with explicit bounded local session deadlines (25s lock/45s statement); package installation retains its 2s lock and 30s statement bounds. The corrected concurrency rerun passed in 78.34 seconds, with one selected case and 79 intentional skips. This is not claimed as a single clean combined 80-case run. Logs are `stage2b-final.log` and `stage2b-concurrency.log`.

Earlier component/orchestration proof passed all 56 cases; all 24 financial cases passed after removing an unnecessary copied metadata-output write that required an unset legacy environment variable. The delivered single-result read-only preflight matches its pinned baseline. Whole-package owner/configuration/Auth namespace drift, body/ACL/view/trigger drift, interruption and lock refusal were checked in orchestration setup and passed in the targeted rerun. Offline unit suite: 1437 passed, 42 opt-in skips. Typecheck, all new JS syntax/encoding/body-hash checks and staged diff checks passed. Final lint: no errors and only the pre-existing `reconcile.ts:344` warning. App source is unchanged from the previously passing Stage 1 build, so no redundant app build was run.

The complete suite consists of 24 accepted financial cases replayed after full Stage 2B, 16 component-only projection cases and 40 public orchestration cases. Component-only installation is a test-derived prefix of the same package; it is not a separately authorized production path. Full orchestration tests cover actual snapshot-before-attempt timing, atomic payment/grant rollback, no missing-grant backfill, direct session/tenant/RBAC denial, known refunds, Test isolation, concurrent purchase/settlement and owner revocation at catalog/version waits and across commit. The final finance cases retain INSERT/UPDATE legacy ambiguity and fresh identifier concurrency, NULL history, deadline policies, strict provenance, financial immutability and ACLs.

All positive provider-shaped events are synthetic local persisted evidence, not live provider HMAC execution or payment collection. Mocked TypeScript adapter transports call the real disposable PostgreSQL RPCs; they do not establish live HTTP/provider acceptance. Docker is local/network-none/tmpfs-only/no published ports, and helpers verify per-run labels before operations/cleanup. The pre-existing runtime is untouched.

## Remaining release work

Independent review and full-bundle production approval remain separate. No SQL has been applied to production. G03 approval, worker contracts, the discounted-order RPC, actual serving deployment SHA, backup/PITR/rollback and live acceptance remain blockers. The observed cancellation RPC retains its installed company-only subscription lookup (`93932821e812986394f555b26250da5b`); mixed-environment/legacy-NULL selection needs a separate bounded compatibility review. This package preserves it and checks existing Test-only denial and single-Live cancellation.

Release consolidation and the supplied Paymob checkout visual references remain queued after compatibility. Do not push main or replay old financial evidence/backfill migrations to bypass pending compatibility.

Reviewed package SHA256: `4e9f03cae14dccac5d7ce280b842988b3a5d43a97372797d82e27d3dec6cd229` (UTF-8/no-BOM/CRLF-to-LF normalization). External metadata input SHA256: `e13e8f68799268d04822b4bc702d5f88adfeeacf1b3e8b46f6118a11a502d393`.
