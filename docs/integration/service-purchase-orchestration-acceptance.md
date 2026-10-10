# Service purchase and settlement orchestration

Base: clean main at `5704e3ade14e8c107150fabda3597ce5ed2aab41`. Local implementation only; production installation, push, deployment and provider execution remain paused.

## Behavior and authorization

- `billing_bind_noura_basic_draft(version, revision)` and `bindNouraBasicDraftAction` provide an explicit platform-owner opt-in for a draft version whose actual stored plan code is `noor_basic`, currency is OMR, and period is one month. The catalog revision and plan version are locked first. A nonlocking initial denial preserves the caller boundary; it never authorizes writes. After both business locks, the direct app-session lease, verified identity and trusted platform-owner record are checked under locks retained through commit. The RPC accepts no actor, tier, capabilities, price or quota. The server binds only `noura / basic / noura.knowledge.read`. Binding neither publishes the draft nor changes price or targets.
- The existing service-role purchase RPC visibly calls a private helper immediately before each fresh/reused payment-attempt resolution. The helper verifies the current active owner against the order tenant and the explicit Basic offer, then calls the existing guarded snapshot RPC. Unbound legacy versions follow the original path. Failures throw so incomplete service purchases roll back.
- The same public HMAC settlement RPC remains used by the webhook, owner replay and durable reconciliation. Its exact existing implementation becomes a private backing function with all external execution revoked. The public wrapper returns existing outcomes unchanged. For a bound proven grant it calls the existing service-grant RPC in the same transaction; a failure rolls back subscription, application, settlement outcome and lifecycle updates while keeping the previously received event. Grants retain the default `activated=false`.
- Replay does not repair a historical missing service grant. Such a bound replay requires review and preserves original financial receipts. Signed refund/void review, pending reversal denial, cancellation at the paid period and Test/Live separation retain the existing policies. Unsupported bound tiers/products cannot purchase or acquire new service grants through this orchestration. No activation, Premium/Lina/Dana publication, Live checkout, prices, quotas or runtime gates are added.

## Installation prerequisites

Canonical local SQL: `supabase/migrations/20261010073549_service_purchase_settlement_orchestration.sql`. CLI generated this filename using installed Supabase CLI 2.54.11. It is a one-time forward migration with 2-second lock and 30-second statement limits and one transaction. Reapplication fails its pinned baseline checks.

The earlier `20261010053446_service_entitlement_read_contract.sql` must already be installed in the approved target before this SQL. Its reviewed source is the dependency; no installation is assumed from this local run. G03's separate Storage migration is not included here. Never reapply previously approved cloud packages to satisfy this dependency by guesswork.

`supabase/upgrade-packages/service-purchase-orchestration/preflight.readonly.sql` inspects system metadata only. Before any separately approved production installation, compare all 12 function bodies, definer attributes and search paths with the migration, both receipt-proof view hashes, all six financial and six service immutable triggers, private service table RLS/ACLs and existing public RPC ACLs (anonymous/authenticated execution denied, service-role execution required for the five mutation RPCs). Stop on missing or mismatched evidence. Baseline view hashes use PostgreSQL's pretty-printed view definition; a formatting/version difference needs review, not bypassing the guard. No actual cloud prerequisite state was inspected in this slice.

The function correction inserts exactly two named helper calls into the pinned purchase body. It avoids a broad DML trigger and avoids duplicating the existing financial implementation. Original locks and return contracts remain intact. The service entitlement remains a projection of proven existing billing truth, with no second subscription or merchant sales ledger.

## Verification and limits

An initial actual PostgreSQL test reproduced checkout success with zero service snapshots. The expanded pre-implementation suite had 11 failures and two passes. The first implementation run exposed SQL variable name collisions and a fixture retiring the version under test; these were corrected before the passing run. Adding search-path pinning then exposed a CASE-expression parsing error in the prerequisite block; it was corrected and the complete SQL suite passed. Concurrency promises are awaited together so errors cannot be lost.

Commands:

- `node node_modules/vitest/vitest.mjs run --config scripts/service-entitlement/orchestration.optin.config.mjs`
- `node node_modules/vitest/vitest.mjs run src/lib/billing/catalog-backend/actions.test.ts src/lib/billing/wiring/p2-store-readiness.test.ts src/lib/billing/wiring/test-checkout-actions.test.ts src/lib/billing/wiring/p1-p2-recovery.test.ts src/lib/billing/wiring/p2-stored-evidence.test.ts src/lib/billing/wiring/journey.test.ts src/lib/services/access.test.ts src/lib/services/decision.test.ts`
- `node node_modules/vitest/vitest.mjs run`
- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/eslint/bin/eslint.js .`
- `node node_modules/next/dist/bin/next build`
- `git diff --check`

SQL acceptance uses a labeled, ownership-verified, network-none temporary PostgreSQL container with no published ports, volumes, cloud URLs or credentials. Historical migrations through `20261008170000_vel_owner_review_scope_read.sql` are replayed with synthetic auth schema/session fixtures, then the service contract and this migration. Test-only altered prerequisites and failure triggers exist solely inside this isolated schema. Fixtures use synthetic identities, companies and insert-only financial records; synthetic stored HMAC attestations are not proof of an actual processor payment. Live-environment financial fixtures do not enable or exercise Live checkout. No grant activation is called. Existing containers are retained.

Ignored logs under `artifacts/internal-ui/service-orchestration-*.log` retain negative and passing local results, including observed PostgreSQL blocker/waiter PIDs. Live acceptance is unavailable without existing authorized access and remains separate from local proof.

Final results: 17 actual PostgreSQL cases plus four negative prerequisite checks passed; 118 focused tests and 1,428 aggregate tests passed, with 42 opt-in tests skipped. Final TypeScript, lint (zero errors; existing `billing/paymob/reconcile.ts:344` warning), production build (34 generated pages), script syntax and diff checks passed. Cleanup retained only the pre-existing `velora-c2-runtime-13861eb` container.

Canonical SQL SHA-256 (UTF-8, no BOM, LF): `d3abfc75d937c81bff7bdd8666a25799af63a27922e2a8bba90bd22c55f8e303`.

## Independent review correction

Base: `7e666493209c36cfbb31590671d24b6c0a1aab26`. Review found a P1 authorization race in the local, uninstalled owner binding SQL. An isolated two-session regression reproduced it: hold the plan-version lock, start owner binding, commit owner disablement while binding waits, release the plan lock. The original RPC returned `ok:true` and inserted an offer. Its last owner check ran before the plan-version wait, so an extra unlocked check alone would leave the read-to-write gap open. Its early `check_app_session(false)` also took an activity lock before business waits.

The bounded correction changes only the binding guard and its lock placement. A nonlocking initial full owner/verified-session denial retains the prior caller boundary. Binding obtains catalog revision then plan-version locks before obtaining the authorization read set: user SHARE, session SHARE, activity UPDATE, and platform-admin SHARE. All authorization locks use NOWAIT and stay held through transaction commit; conflict returns `forbidden` without an offer/revision mutation. Session-before-activity matches cascading session deletion. NOWAIT fails closed rather than creating a cycle with reverse-order profile/revocation transactions. Existing direct `check_app_session(false)` and `billing_ui_owner()` checks remain after all lock acquisitions, including when the rollout setting is disabled. Missing activity fails closed rather than creating a lease. Wall-clock expiry is evaluated after the waits. No caller-controlled grants or scopes substitute for active platform ownership; delegated company scopes remain insufficient.

Race regressions cover both catalog and plan waits followed by owner disablement, owner demotion, session deletion/cascading activity revocation, explicit activity expiry, identity verification removal, and natural idle expiry. Natural-expiry cases first prove the lease is still valid while the binding is blocked, then let it expire before releasing the business lock. Four mutation-boundary probes prove each authorization row blocks a concurrent revoker until the binding commits; four reverse-order contention cases prove NOWAIT denial releases the business locks and persists no partial binding. The delegated-scope case proves company capabilities cannot replace platform ownership. Each denied race verifies zero offers and an unchanged catalog revision.

Correction verification: final exact-source SQL run passed all 39 actual PostgreSQL cases (original 17 plus 22 race/authority regressions) and the four prerequisite-denial checks. The earlier correction run also passed its then-current 38 cases. Both final natural-expiry cases proved a valid lease while blocked before waiting through expiry. The final-source focused suite passed 118 tests; aggregate passed 1,428 tests with 42 opt-in skips; TypeScript, lint (same existing warning), build (34 generated pages), syntax and diff checks passed. Ignored evidence uses `artifacts/internal-ui/service-orchestration-race-red.log`, `service-orchestration-race-green.log`, and `service-orchestration-correction-*.log`. Synthetic local database proof only; grants remain inactive. No production migration, push, deployment, provider execution or external message was performed.
