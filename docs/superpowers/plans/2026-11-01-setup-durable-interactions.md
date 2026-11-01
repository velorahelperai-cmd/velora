# Setup durable interactions implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. Owner approved implementation and publication; no repeated planning approval.

**Goal:** Recover a single authorized /setup generation by provider ID, preserving accounting and counting a saved successful reply exactly once.
**Architecture:** Keep existing reserve/start/checkpoint/recover contracts. Add private provider-handle persistence and authenticated server-side retrieval. Gemini background creation occurs only inside the existing newly-reserved execution fence; subsequent requests only retrieve that ID.
**Tech Stack:** Next.js, existing Google GenAI SDK, Supabase/PostgreSQL.
**Spec:** C:/Users/DELL/Documents/ChatGPT/Velora/assistant-reliability-research-20261101.md (approved).

## Global constraints
- No automatic generation retries, provider probes, financial release, worker SQL changes, paid tier or channel activation.
- Preserve all old unknown reservations; use owner/session/branch scope for every recovery.
- Background storage at Google is part of the approved design. No new credential or service.
- Existing SDK supports Interactions; no dependency change. SDK maxRetries=0 explicitly.
- Live acceptance remains separate and needs fresh explicit question authority.

## Review focus
- Create response lost before ID persistence: unknown, never regenerate.
- GET fails: preserve handle and hold, never turn a retrieval error into a rejected generation.
- Duplicate pollers: immutable checkpoint and unique receipt must prevent duplicate accounting.
- Logout/relogin or changed branch/context: recovery must not expose another scope; stale result accounted but not accepted.
- Provider usage shapes: thoughts counted once, invalid totals fail closed.

## Task 1 — Provider contract
Files: new adapters/gemini-interactions.ts and test; answers/types.ts; adapters/gemini.ts.
- [x] RED: create once/background/store, retrieve only, malformed identity/usage, transient GET, terminal failure, no retry options.
- [x] Implement startTrial(input) -> pending handle or AnswerFailure; retrieveTrial(handle) -> pending/AnswerResult. Normalize response independently from legacy SDK.
- [x] GREEN: affected provider tests, real SDK serialization with an offline fetch fixture.

## Task 2 — Durable state and actions
Files: new migration es02_trial_provider_handles; tenancy/paid-assistant-trial-actions.ts and tests; isolated PostgreSQL regression.
- [x] RED: binding and ACL, immutable handle, fresh-session recovery, no duplicate create, running retrieval failure preserves hold, successful checkpoint/recovery and stale-context behavior.
- [x] Add private handle/question metadata and service-role-only attach/load RPCs; owner-checked recovery projection exposes pollability, never provider ID.
- [x] Ask starts background once and saves handle; recover retrieves and normalizes result then uses existing checkpoint and receipt settlement. Legacy rows retain old path.
- [x] GREEN: actual RPC body regression and action tests; record unchanged original holds.

## Task 3 — UI and delivery
Files: paid-assistant-trial.tsx, paid-setup-step-host.tsx and tests.
- [x] RED: remount retrieves known request, bounded polling never asks; stale branch result ignored; terminal failure distinct from accounting review.
- [x] Implement 5s bounded polling for known provider IDs and refresh/recover continuation using existing controls. Preserve current setup step and confirmed cached data.
- [x] GREEN: affected tests/types/lint/security. Independent review and fixes before publication.
- [ ] Apply additive migration, scoped commit/push, CI and Vercel same SHA; verify authenticated UI without generation.
- [ ] Report live answer/cost/counter separately; never close C15 on deployment alone.

## Verification and review dispositions — 2026-11-01
179 affected tests passed; TypeScript and scoped lint passed. Actual PostgreSQL RPC regression passed, including concurrent handle/checkpoint saves against expiry. Auth/session dependencies in that regression are fixtures, not hosted acceptance. Independent reviewer findings (terminal states, optional pending model, ID bounds, ambiguous persistence and expiry race) fixed. Provider SDK offline fetch proves one POST and retrieval GET; no live call performed.
Hosted additive migration applied; original three unknown holds remain 4.494810, 1.538527 and 1.538873 baisa, cost null. Expiry classification applies only to new prepared operations; five-minute missing-ID and 24-hour retrieval limits preserve holds. No worker changes. C15 remains open pending live answer, verified usage/settlement and counter.
