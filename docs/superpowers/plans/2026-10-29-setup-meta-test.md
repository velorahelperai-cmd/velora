# Scoped Meta Setup Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Allow the explicitly configured paid owner/branch to save real Setup settings and run the existing real Gemini setup trial while inspecting Meta's test-number connection, without fabricating commercial readiness.

**Architecture:** Reuse existing paid branch RPCs, settings components, trial allowance and cost ledger. A default-off, expiring server configuration pins one account/company/branch and the Meta test assets. A separate clearly labelled `/setup/test` workspace opens authorized preparation controls; canonical `/setup`, B3 links, launch and subscription clocks retain their existing proof requirements. Provider inspection uses the existing GET-only Meta adapter; unavailable credentials remain UNKNOWN.

**Tech Stack:** Existing Next.js Server Actions, React, Vitest, Supabase authority RPCs and Meta Graph adapter. No dependency or schema changes.

**Spec:** Owner confirmation in this chat: full Setup and AI testing inside Velora with Meta's test number, preserving TAG CITY assets and subscription. This plan records execution scope in the existing Brain I02.2; it creates no second product authority.

## Global constraints

- Exact server-pinned account, company and branch; owner/native session/paid authority checked before and after async reads.
- Default off, expires within seven days. No client-provided setting can enable access.
- Existing real settings and Gemini setup-trial budget/idempotence remain authoritative; no fake paid/connected/active state.
- Launch and subscription unchanged; no invitations or external messages dispatched by this package.
- No Meta signup, account deletion, asset cleanup, OAuth exchange or registration. Provider inspection is GET-only and never logs secrets.
- Preserve unrelated WIP; no retired delivery guards or full local suite.

## Review focus

- Wrong account/branch, expired flag or changed session must deny the test workspace.
- The usual commercial checklist must never acquire verified channel proof from test access.
- Real provider failures must be shown as UNKNOWN/unavailable, without exposing credentials.
- Existing settings CAS and actual trial ledger remain in use on reload.
- AI trial is inside Velora; this package does not claim automatic WhatsApp AI reception/dispatch acceptance.

## Task 1 — Server authority and provider read

Files: `src/lib/tenancy/setup-meta-test.ts`, `.test.ts`, `setup-meta-test-actions.ts`, `.test.ts`.

- [ ] Write and run failing scoped configuration and async authority regressions.
- [ ] Implement pinned expiring configuration and owner/paid/session read action; use current canonical RPC-backed readers.
- [ ] Add GET-only inspection through `onboardMetaSignup` with no token in serialized results.
- [ ] Run only new targeted policy/action tests and affected lint/types.

## Task 2 — Real settings workspace and entry

Files: `src/app/setup/test/page.tsx`, `src/components/app/setup-meta-test.tsx`, `.test.tsx`, `paid-assistant-checklist.tsx`, `src/lib/tenancy/paid-setup-workspace-actions.ts`.

- [ ] Render existing hours/knowledge/language/trial/team components with the actual authorized scope and read model.
- [ ] Display test scope/expiry, real saved settings and explicit separate commercial readiness. Do not render a launch mutation.
- [ ] Add a conditional entry in ordinary Setup only for the server-configured scope.
- [ ] Verify unrelated branch denied, real host actions reused, launch absent, provider UNKNOWN shown accurately.

## Task 3 — Scoped delivery and hosted acceptance

- [ ] Review exact diff, secrets and mandatory CI; normal commit/push only authorized files.
- [ ] Enable the expiring test workspace only for the approved owner/TAG CITY branch and existing Meta test assets. No change to webhook routing in this package, because WhatsApp dispatch is not claimed by an in-app trial.
- [ ] Verify exact SHA/CI/Vercel, authenticated test workspace and real settings reload/provider trial where the authorized session permits it.
- [ ] Record actual results in Brain and PROJECT_STATE. Token validity, automatic WhatsApp AI and commercial activation remain unverified until separately demonstrated.

## Execution ledger

- Implemented scoped policy and server actions; 9 configuration + 7 action tests PASS. Actual session replacement is rejected both across native reads and across provider inspection. No commercial proof or credentials are returned.
- Implemented real-settings host reuse and conditional Setup entry. Existing workspace 18 checks PASS; new UI 6 checks PASS. Reviewer identified loss of one-time invitation URL on parent remount: regression RED before fix, then stable host key GREEN. Added existing unsaved-navigation confirmation (RED/GREEN).
- TypeScript noEmit/incremental=false and final scoped ESLint PASS after resolving the explicit test-step union and AccessGate error mapping. No local full suite, native SQL migration, payment, provider mutation or customer data edit.
- Ruling: this package is an in-app real Gemini/setup test workspace with read-only Meta asset verification, not a new automated WhatsApp dispatch engine. Existing webhook test routing points to a deleted company; changing it is intentionally excluded until transport-specific routing and recipient isolation are verified. This prevents implying that an in-app trial has established external WhatsApp AI acceptance.
- Fresh independent read-only review and follow-up verification completed; one P2 invitation-state finding fixed with regression and confirmed resolved. Production feature remains off until required CI succeeds.
- Production enablement uses only six non-secret `VELORA_SETUP_META_TEST_*` Config values: ENABLED, ACCOUNT_ID, COMPANY_ID, BRANCH_ID, EXPIRES_AT; account/company/branch are the owner-approved TAG CITY scope. Existing Meta app/test asset credentials remain server-only and unchanged. Rollback sets ENABLED=false and redeploys the same tested SHA; saved native settings and trial ledgers are retained. The preparation workspace does not mint a channel-review grant or modify RLS.
