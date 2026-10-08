# P4 WhatsApp readiness plan

**Goal:** Harden existing WhatsApp reception, persistence, processing boundaries and outbound recovery while keeping live AI/external send disabled.

**Isolation:** `codex/p4-whatsapp-readiness`, base `657e4bafeff62f37137238a9afc61d2562629a7d`, independent managed worktree. P2 was preserved separately in local commit `3f2ed0fc0a9872e47a89f6ea90d2c1ebd6db64a2` after staged secret-pattern scan and Billing tests/TypeScript.

**Constraints:** WhatsApp source/tests/documentation only. No migration, Auth/RLS, Billing or AI-core edits. No provider/paid requests, real accounts/numbers, cloud SQL, deployment, push, merge or backups. Do not access Obsidian.

## Tasks

1. Reception agent: inspect `webhook.ts`, webhook route and `tenant-resolve.ts`. Reproduce signed wrong-envelope/unsafe-timestamp parsing, incorrectly scoped duplicate filtering and resolver uncertainty; minimally fix boundaries with local HMAC/RPC mocks.
2. Outbound agent: inspect `send.ts`, `send-attempt.ts`, `send-failure.ts`, `actions.ts`. Reproduce malformed provider success and ambiguous timeout/finalizer issues; preserve one send attempt and honest accepted-versus-delivered status.
3. Root: inspect `store.ts`, `automation-gate.ts`, `inbound-worker.ts`. Reproduce malformed RPC/claim identity and permissive handoff gating. Keep the existing AnswerProvider contract and actual entitlement lock; record unsupported engine dependencies instead of inventing a live queue or quota.
4. Read-only audit agent: trace local SQL and actual worker invocations, durable ordering/lease/retry/usage/handoff/outbox guarantees. Write explicit P1/shared-contract acceptance criteria in `P4_DEPENDENCIES.md`.
5. Root: run baseline and final local mocked WhatsApp/relevant shared-contract tests, TypeScript and scoped lint; independently review diff/safety flags and write `P4_REPORT.md` with the requested eight sections and honest PASS/BLOCKED conclusion.

## Review focus

- Unsupported events and malformed time/identity cannot poison or abort a valid signed batch.
- Duplicate identity must not silently discard a distinct tenant's event.
- Handoff/paused automation and stale generation must suppress automatic AI.
- A timeout or missing provider identifier must never authorize a fresh Graph send or claim delivery.
- RPC doubles prove application guards; they do not establish database locks, persistence, ordering, queue scheduling, or exactly-once execution.
