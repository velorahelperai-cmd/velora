# Real administrative AI runtime

> Execution: implement in this shared checkout to preserve the concurrent Antigravity work; no checkout reset or unrelated commits.

Goal: let the verified platform owner test the requested real models through a durable runtime that can also serve future company traffic.

Architecture: owner-authorized server actions call one bounded provider transport. Supabase reserves money atomically before each attempt and settles actual usage afterward. Company identity, caller/session, model/pricing version and every attempt are stored. Administrative spending has a lifetime cap of 1,000 baisa and never resets automatically. Customer answering/WhatsApp remains disabled.

- [x] Durable database ledger and separate budget accounts; reservation row lock, idempotency, service-only mutation, active-session RLS, owner-only test access. Verify concurrent cap and denial scenarios.
- [x] Server-only provider transport: Responses API and Gemini generation, exact requested model IDs, explicit output limits, timeout, zero SDK retry, secret-safe errors, current sourced USD pricing and OMR conversion. Preserve billing usage even when response is incomplete or empty.
- [x] Reusable runtime: authorized company context, per-attempt reservation/settlement, no retry after ambiguous network failure, reserved budget held for unknown billing, reject before API when persistence/authorization/budget fails.
- [ ] Replace static AI dashboard figures with stored usage; real owner test form, selected company, model/automatic routing, clear real-cost control, actual result and attempt history. UI follows existing Arabic admin design and displays empty data honestly.
- [ ] Focused SQL/runtime tests, typecheck/build, apply the reviewed corrected migration, one bounded connectivity attempt per model within the approved total cap, deploy and verify production. If provider credentials/permissions fail, report the real reason without fake success.

Ruling: test funds are separate from company subscriptions and use a lifetime cap, matching the user's explicit total-budget answer. No fabricated ten-customer revenue or success numbers.
Ruling: existing Phase 1 in-memory classes remain only for their existing unit tests; the new real server path does not use them.
Ruling: no automatic release of a reservation after uncertain network execution; this reduces available test balance until reconciliation but cannot silently finance duplicate calls.

Ruling: Antigravity is actively redesigning existing admin pages. Ship the real console independently at /admin/ai, then connect the redesigned dashboard to these stored metrics when that design stabilizes; do not overwrite concurrent design work.