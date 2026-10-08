# P2 Billing Readiness Implementation Plan

> Agentic workers: execute the user-authorized scoped review in this isolated worktree; use test-driven fixes and verification before completion.

**Goal:** Harden existing Paymob checkout and payment settlement without changing database, authentication, RLS, or UI contracts.
**Architecture:** Keep server-priced orders, durable provider events, and existing atomic settlement RPCs. Validate evidence at provider boundaries; report server transactional gaps as dependencies on P1.
**Stack:** Next.js 16.3.8, TypeScript, Supabase RPC, Paymob Oman.
**Spec:** User's VELORA P2 BILLING READINESS request, 2026-10-08.

## Constraints

- Branch `codex/p2-billing-readiness`, base `afe2e298bfb4ef16414b83fb7077a2ca2f1e5c62`; independent worktree only.
- Change Billing/Paymob code, tests, and documentation only; never migrations, Auth, RLS, UI, AI, or WhatsApp.
- No provider execution, real financial transactions, cloud SQL, deployment, push, merge, secrets, or backups.
- Preserve current verified OMR conversion setting unless the actual processor contract proves a different factor.

## Tasks

1. Audit HMAC field coverage and transaction lifecycle; reproduce false success in `paymob/protocol-readiness.test.ts`; minimally harden `callback.ts`/`reconcile.ts` and verify official response contracts.
2. Audit Intention request/response binding and network uncertainty; add `paymob/p2-checkout-readiness.test.ts`; harden `intention.ts` and exact monetary conversion in `money.ts` without inventing a factor.
3. Reproduce malformed settlement RPC responses, tenant-mismatched stored events, and lost webhook retry in `wiring/p2-store-readiness.test.ts` and webhook route tests. Harden `store.ts` and existing route response handling; use exact conversion in checkout actions.
4. Read existing local SQL and map all 12 requested scenarios to real application tests. Record atomic transaction/RLS/expiry/refund/live-mode dependencies in Billing documentation without implementing them.
5. Run scoped Billing/API suite and TypeScript in the isolated worktree, review diff and scope, and deliver findings plus explicit unverified database/processor guarantees. No merge or push.

## Review focus

- Unsigned callback fields cannot choose tenant, paid amount, or grant eligibility.
- Unknown network/RPC outcomes never authorize a fresh collection or claim a grant.
- Pending and failed events cannot overwrite a paid entitlement.
- Concurrency tests using RPC doubles establish application retry behavior, not Postgres atomicity.
- Expired or unpublished plans and test/live activation need authoritative server checks.
