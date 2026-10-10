# Service capability data and read contract

This slice adds a normalized projection of existing verified billing receipts. It does not create a second subscription or financial ledger, infer service from plan/persona names, change prices/quotas, or modify original financial history. Production installation is not authorized by this implementation.

## Authority and write boundaries

`private.billing_service_offers` binds one explicit service, Basic/Premium tier and capability set to an existing plan version. `billing_define_service_offer` is service-role-only and requires a draft version with no orders. The record is immutable from creation, including deletion and truncation. Editing an offer requires a new draft version; old published versions cannot be annotated retrospectively. The existing immutable plan-version financial snapshot remains authoritative. There is no migration backfill.

`private.billing_service_order_offers` pins that offer to a server-created order and its environment. The future purchase transaction must call service-role-only `billing_snapshot_service_order` after locked order creation and before any payment attempt is created. Late snapshots are rejected. Its order primary key is the idempotency key; retries return the original immutable snapshot without changing it.

`private.billing_service_grants` links one existing entitlement application to that order snapshot. The future verified settlement transaction must call `billing_apply_service_grant` after the existing settlement creates a proven application and before commit. It accepts only the application ID; company, environment, plan, service, tier, capabilities and paid period derive from immutable records. Unproven payments or missing snapshots cannot mint grants. Application primary key and unique order enforce idempotency under the existing company row lock. Grant replay never reactivates a grant or extends a period. The endpoint is implemented and tested here, but the production settlement/purchase orchestration is deliberately not changed in this slice.

Activation is separate: grants default to inactive. Service-role-only `billing_activate_service_grant` can activate a currently proven, unexpired receipt with matching current subscription and active company, or deactivate an existing grant. Authenticated customers and staff cannot define offers, snapshot orders, grant, activate, or directly write these private tables. Even service-role direct table writes are revoked. Known refund/void/cancellation evidence denies eligibility before delayed lifecycle processing changes original receipt status. Revocation history remains append-only; revoked receipts cannot be restored by grant replay.

The allowlist currently authorizes only `noura.knowledge.read`, backed by the existing `knowledge.read` API/RBAC surface. Lina, Dana, merchant reports and POS remain unsupported by this contract and cannot be defined as purchasable offers through it. Catalog `target`/`not_verified` flags are not grants. No customer automation or paid provider capability is added.

## Authenticated read

`billing_read_service_access(company, capability)` is authenticated-session-only, with no service-role or anonymous execution grant. It directly calls `check_app_session(false)` independently of pre-request hook or rollout settings, checks verified email **or** verified phone identity, active tenant membership/company, and the existing RBAC capability. The shared TypeScript `emailConfirmed` name also means either verified identity. Unauthorized tenant reads return only a denial code, with no plan, tier, grant or existence metadata.

Successful reads require live environment at order, payment and subscription; the exact current subscription plan/version and paid-through; original proven collection evidence; no known reversal; activation; and future expiry. They return only the selected company's service capability/tier/expiry/version. Unsupported capabilities, inactive grants, authorization and unavailable reads remain distinct.

`readSessionServiceAccess` uses the authenticated Supabase client and validates the RPC response company, capability, service, tier, environment, version and expiry. Missing RPC or malformed/unknown evidence denies access without a fallback. `/api/company/service-access` calls this adapter and always uses `private, no-store`; caller company/persona parameters do not choose a tenant. It returns no knowledge, reports, financial rows or provider output.

## Compatibility, installation and recovery

This data/read layer still deliberately matches the existing single company+environment subscription. It does not solve independent multi-service purchases, renewals, downgrades, bundles, settlement integration, claim-bound worker enforcement or atomic per-service usage reservation. Those require the next reviewed slice. Current human inbox and Noura worker paths remain intact, and this capability grant is not yet a gate for existing automation or knowledge CRUD.

Install prerequisites and this additive SQL before shipping the new RPC reader. Migration `20261010053446_service_entitlement_read_contract.sql` requires the actual verified collection/proven-grant views, existing session/RBAC contracts and receipt immutability correction. It pins the normalized immutable receipt guard body MD5 `968854ccf1b251404062386ea9f2fe2f` and requires all six enabled receipt row/truncate triggers. A mismatch aborts the transaction. Inspect the actual target read-only and review any missing prerequisite separately; do not blindly replay historical migrations or assume the cloud has the full local chain. This is a one-time migration, not replay-safe.

Before any approved production install, record data-free schema/function/ACL fingerprints and approved recovery evidence. On install failure the transaction rolls back. On application rollback, leave the private additive tables and immutable evidence intact; revert the reader if necessary, without widening access. No production rows are automatically added, existing subscriptions are unchanged, and old paid customers receive no guessed grants. Future purchase/settlement wiring must be deployed with its explicit transaction order before new offers can be advertised or sold. Do not activate customer runtime from this readiness endpoint.

## Verification

The opt-in suite uses a fresh UUID-labelled, network-none, tmpfs PostgreSQL container with no ports and the cached image. It replays actual local migrations through `20261008170000_vel_owner_review_scope_read.sql` with Auth/Storage infrastructure stubs, then installs only this new migration. It is not a claim that the current cloud matches the local historical chain. Existing containers are untouched and the harness removes only its own verified container.

Tests use synthetic provider evidence shaped like the existing server-attested HMAC contract and execute the actual verified settlement function. No real provider signature, payment, model call, message or cloud SQL is executed. An expiry fixture inserts original synthetic past receipt records, preserving financial immutability guards; its historical activation is seeded by the test database owner. This distinguishes database contract proof from live payment acceptance.

Tests exercise direct RPC tenant forgery, writer ACLs, known payment-linked grants, activation, unsupported services, Test versus Live, immutable snapshots, original receipt expiry, revoked receipt replay, pending refund evidence, deleted/expired sessions with rollout disabled, verified phone/staff RBAC, and concurrent duplicate grants in distinct backends with observed lock waits. The real TypeScript adapter and HTTP GET handler read the same PostgreSQL RPC in opt-in tests.

Verified command results (PowerShell, `login:false`, intended main worktree):

- `node node_modules/vitest/vitest.mjs run --config scripts/service-entitlement/vitest.optin.config.mjs`: 16 actual PostgreSQL/adapter/HTTP cases passed, exit 0. Before suite setup, disabling the receipt guard made installation fail with `SERVICE_IMMUTABLE_RECEIPT_TRIGGERS_MISSING` and left no new offer table; restoring it allowed installation. Concurrent sessions had distinct PIDs 2500 and 2514, with the waiter observed on a transaction row lock; exactly one grant remained. Harness cleanup completed.
- `node node_modules/vitest/vitest.mjs run src/lib/services src/lib/billing/wiring/subscription-read.test.ts src/lib/whatsapp/integration-store.test.ts`: 58 passed, exit 0.
- `node node_modules/vitest/vitest.mjs run`: 1406 passed / 42 existing opt-in tests skipped; 122 files passed / 11 suites skipped; exit 0.
- `node node_modules/typescript/bin/tsc --noEmit`: exit 0.
- `node node_modules/eslint/bin/eslint.js .`: exit 0, only the existing `_result` warning at `src/lib/billing/paymob/reconcile.ts:344`.
- `node node_modules/next/dist/bin/next build`: exit 0, Next 16.3.8, dynamic authenticated service-access route built successfully.

Normalized UTF-8/LF migration SHA-256: `3fffaf686ae6be411ada8dcd476f39a6b8a3012bb226efbefe4f5becfbc33b06`. Git stores the canonical LF version; normalize CRLF copies before comparing. No provider/cloud SQL, credentials, payments or external messages were used. The initial baseline assertion failed because the RPC was absent, and a first implementation run found two failures; both were fixed and all final cases above ran successfully. These results establish local data/read contract behavior, not production billing or launch acceptance.
