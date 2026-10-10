# Service purchase and settlement orchestration

Base: clean main at `5704e3ade14e8c107150fabda3597ce5ed2aab41`. Local implementation only; production installation, push, deployment and provider execution remain paused.

## Behavior and authorization

- `billing_bind_noura_basic_draft(version, revision)` and `bindNouraBasicDraftAction` provide an explicit platform-owner opt-in for a draft version whose actual stored plan code is `noor_basic`, currency is OMR, and period is one month. The locked catalog revision, direct app-session lease, verified identity and trusted platform-owner record are checked. The RPC accepts no actor, tier, capabilities, price or quota. The server binds only `noura / basic / noura.knowledge.read`. Binding neither publishes the draft nor changes price or targets.
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

Canonical SQL SHA-256 (UTF-8, no BOM, LF): `4503639ba8cdce375b7d79efd6dc44a5848718e5f59c9281f5e9f2c884326a2e`.
