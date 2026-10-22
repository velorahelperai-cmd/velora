# ES02 Production Credit Compatibility — Local Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task after its scope decision. Local implementation and tests explicitly approved22 October2026; Production DDL NOT authorized.

**Goal:** Make B5–B8 compatible with the hosted ES02 purchase, readiness and worker accounting system without importing retired Phase-B financial rules.

**Architecture:** Preserve the live Noura → Meta → native claim and atomic AI-cost authorization chain. Add an ES02-specific reservation/settlement contract backed by proven existing ES02 balances and readiness, retaining legacy non-ES02 behavior. Do not treat a different function hash as permission to rewrite an unknown wrapper.

**Tech Stack:** PostgreSQL17, existing Supabase RPCs, existing Vitest/native fixture; no new library or paid/provider call.

**Spec:** PROJECT_STATE.md current index; docs/DIAGNOSTICS.md approved purchased-credit contract; docs/decisions/README.md approved activation and purchased-first/no-ordinary-expiry rules.

**Latest local checkpoint:** Connected implementation exists in
`supabase/upgrade-packages/es02-operational-credits` and its generated LOCAL-ONLY
migration20261022040333. Full compiled package:121 native PostgreSQL checks
PASS/ROLLBACK with unchanged balances/clock/jobs/messages/functions+ACL/columns.
Focused18 suites223 PASS; scoped ESLint PASS. Positive native live-paid acceptance
and simultaneous contention NOT_RUN, so Task2 acceptance remains incomplete.
Latest full TypeScript FAILED at externally modified admin-catalog.tsx:320
(undefined versions); source changed during verification. No release or
Production mutation. Package README contains commands, limits, SHA and separate
proposed permissions inventory. The scope decision below is historical: local
implementation is explicitly approved; only concrete Production effects remain
outside that approval.

## Latest binding owner rule

Readiness permits operation but NEVER starts the INITIAL paid term. Start only from first durable provider-accepted company_live reply to a proven real customer; exclude test recipient/Meta-test/review and setup_trial. No new credits/prices or Production modifications. Preserve legacy non-ES02 behavior.

## Confirmed evidence, 22 October 2026

- Hosted project vmpifljyozsbtssxhoxd has94 migrations after approved admin migration20261022033922.
- Hosted master_ai_credit_grants/master_ai_reply_slots/master_ai_cycles AND master_subscription_activation are absent. ES02 balances exist, currently0 rows; never invent grants to fill this gap.
- Native readonly reproduction of the initial B5–B8 guard returns ES02_B5_B8_OPERATIONAL_CREDIT_BASELINE_MISSING. No attempted partial Production installer.
- public.whatsapp_reserve_job_usage MD5 cd2a5de5c77c72a728a1acff9345051d calls private.wa_reserve_usage_pre_noura_authority (b071381f7a927cbe43f8218c7fb012dd), then private.wa_reserve_usage_pre_meta_policy (237ba699bca2c920563fc4a905c324e0). The latter enforces legacy monthly subscription limits, not ES02 purchased balances.
- public.ai_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid) MD5 74e31c07c93b44dececdfdf26ce67dd1 atomically rolls back newly reserved capacity when cost/profile reservation denies. Preserve that behavior.
- public.es02_reconcile_activation_readiness(uuid,uuid) calls missing private.master_activation_ready(uuid,uuid), supplies a.order_id as its second argument, and fail-closes AI readiness. Its channel logic accepts status strings without the newer B3 same-branch proof. A replacement needs the actual B3/assistant-proof authority, not a permissive shim.
- Existing ES02 provisioning creates billing_subscriptions as awaiting_payment without active plan-version linkage. A wallet adapter alone cannot prove operational entitlement. Resolve readiness→subscription binding in the same design; no synthetic settlement or forced-active backfill.
- Historical20261014033004_master_cycle_ai_credits.sql binds old activation receipts, hardcodes500/1500 caps and expires topups at cycle-end. It cannot be imported as compatibility boilerplate.
- Exact single-branch+B4+B5–B8 source applied inside existing local fixture transaction, then ROLLBACK:35 security/ACL/no-session checks PASS; public/private functions and ACL fingerprint unchanged. This fixture already contains the legacy master foundation, so success does not prove hosted compatibility or positive financial journeys.

## Global constraints

- Canonical original folder/existing branch/one writer; no .env.local access, new credentials, new containers or unrelated worktrees.
- Preserve purchased-first, no ordinary expiry, carry until used, separate balance ownership, renewal-only base changes and unchanged base subscription expiry.
- No invented purchase prices, bundle sizes, scope, compensation order, refunds or spending after subscription expiry. Unresolved policy remains fail-closed, not inferred.
- No direct wallet/RPC authority expansion for browsers. Any new private relation gets RLS plus explicit denied direct runtime-role access. Exact Production security effects require disclosure and approval under the existing owner rule.
- Preserve immutable old financial/history rows. Never delete historical migrations, modify membership, use CASCADE, reset a database, create credits or auto-activate existing companies.
- B5–B8 guard stays intact until a reviewed, tested compatible replacement package exists. Splitting out its final credit block does not complete approved accounting.

## Review focus

- AI cost refusal must undo new wallet/capacity holds atomically; prior unknown holds remain.
- Last-unit concurrency, retries and lease generations must conserve balances across accepted/unknown/released.
- Existing monthly quota, new ES02 quota and purchased units must not double-count or cap valid purchased capacity implicitly.
- Readiness must bind current paid order, same branch/channel generation and verified current assistant proof; no readiness/credit cycle circular dependency.
- Legacy in-flight jobs and concurrent status changes need an explicit cutover fence; current hosted open reserved/unknown count0 is a snapshot, not a guarantee.

### Task1: Freeze the compatible entitlement/readiness/credit contract

**Files:** existing B5–B8 migration;20261017140000_es02_c2_atomicity_ledger_snapshot.sql;20261017130000_es02_c1_authority_correction.sql (reconcile source); src/lib/billing/es02/reply-credit-deduction.ts; native worker reservation/settlement migrations. No historical applied-file rewrite for Production delivery.

**Consumes:** es02_branch_slot_rights, es02_activation_foundation, es02_account_orders, B3 branch proof, verified assistant execution, es02_credit_balances, billing_subscriptions.

**Produces:** exact mapping of paid order/branch/term/quota→operational entitlement and immutable reservation identity. Proposed private.es02_reply_credit_holds keyed by native job with company/balance/order-group/bound subscription and state; final DDL is NOT prepared yet.

- [ ] Confirm exact current hosted reservation, entitlement and acceptance/repair bodies, effective ACLs and lock order; pin the complete touched footprint.
- [x] Local implementation scope explicitly approved, with first-real-accepted INITIAL clock rule superseding readiness-start.
- [x] Define no-cycle readiness proof and active subscription binding from verified ES02 order facts, with no forced activation or old plan-ID guessing (implemented locally; positive native proof pending).
- [x] Specify purchased/base eligibility from approved scope only; unavailable mapping denies operation with safe diagnostic code.

### Task2: Implement and independently test the bounded correction locally

**Files:** new migration created with official `supabase migration new` after checking CLI help; scripts/integration/es02-production-credit-compatibility.test.sql (proposed); existing worker/store tests; no new public debit endpoint.

**Consumes:** existing atomic capacity+cost RPC and native settlement through billing_finalize_automated_usage(uuid,uuid), retry/reconciliation paths.

**Produces:** one durable native job→wallet hold, preserved Noura/Meta/claim guards, exactly-once accepted consumption; unknown stays held; proven rejection release once. New private helpers postgres-owned with empty search_path and no direct runtime grants; public RPC signatures/ACL preserved unless specifically approved.

- [ ] RED native tests: purchased before base/no purchased expiry; foreign company/claim/generation denials; last-unit race; cost-refusal rollback; replay/accepted/unknown/release/repair; unchanged non-ES02 behavior and history.
- [x] Implement only the frozen contract. No standalone direct debit and no duplicate shadow financial ledger (local candidate only).
- [ ] GREEN and regression checks in existing isolated database; distinguish synthetic provider double from real provider acceptance.
- [ ] Obtain a genuine authorized local paid-owner session for positive B4/B5 journey; current fixture has no valid paid-owner session. Do not fabricate Auth sessions or paid evidence.
- [ ] Review fresh cutover metadata; fail on open/unknown/unmapped holds instead of auto-converting them.

### Task3: Specific Production review and release

- [ ] Present exact generated SQL SHA, new table/RLS/grants and changed function signatures/bodies; obtain only the required specific security/financial decision, not repeat admin approval.
- [ ] Apply only compatible approved migrations via official apply_migration; record actual version and fresh counts/security fingerprints.
- [ ] Verify real owner journey and non-owner/tenant denial, diagnostics and relevant native regression. Do not label negative-only checks full acceptance.
- [ ] Run final exact-tree CI/security gates, integrate through approved GitHub identity, deploy normally and verify live source SHA/smoke. Existing merge/deploy authorization stands after gates.

## Current decision boundary

The original approved B5–B8 package changes grant priority on an already-existing legacy credit foundation. The required correction introduces ES02 wallet reservation/settlement AND readiness/subscription binding that are not present on Production. This is a new connected financial architecture, not an equivalent installer rewrite. Scope approval is required under the owner's architecture/financial controls before implementation; exact Production security approval follows only when concrete SQL is tested and reviewable. No request to reapprove backup waiver, admin package, purchased-first/no-expiry or normal post-gate publication.

**Status:** Implemented locally / Pending Codex Review and remaining acceptance.
Native negative/core-contract verification PASS; positive financial journey and
simultaneous contention NOT_RUN. Full-repository TypeScript currently FAILED
outside the owned correction. Production/deployment NOT_RUN; Stage4 OPEN.
