# P3 Multi-Model AI readiness plan

**Goal:** Prepare the existing three-model AI engine and owner-only connection test for the first later authorized request, without executing a provider API now.

**Isolation:** `codex/p3-ai-readiness`, base `657e4bafeff62f37137238a9afc61d2562629a7d`. P2/P4 commits verified by Git object identity; their worktrees and Antigravity files remain untouched.

**Constraints:** AI source/tests/docs only. No Billing, WhatsApp, Auth, migration/schema, UI or dependency edits. No paid or metadata provider calls, real client data, live enablement, push/merge, deployment or backups. Obsidian access remains prohibited.

## Tasks

1. Adapter agent: inspect installed OpenAI7.30.0/GenAI2.28.0 and fetched official API specifications. Reproduce incompatible request/thinking/usage, hidden SDK retry, timeout, model substitution and secret-error failures; minimally fix `adapters/`, `config/env.ts`, and availability diagnostics.
2. Economics agent: replace the legacy simulation-only prices with sourced Standard schedule, validate cached/cache-write/reasoning subsets, preserve micro-cost precision, and audit tenant ledger/concurrency limitations. Keep atomic reservation source authoritative and document P1 gaps.
3. Routing agent: validate routine Luna/advanced Gemini/complex Sol selection, independent financial-sensitive guards, pinned forced models, safe fallback eligibility, and per-attempt trace. Isolate the offline simulator from real spend.
4. Root: harden the existing durable owner runtime and its reserve/start/settle boundaries; prepare a synthetic capped connection test through that same owner authorization and ledger path. Keep the first-live invocation explicitly blocked by default. No duplicate temporary billing/AI engine.
5. Root: run offline AI tests, TypeScript, scoped lint and whole-project regression checks; review source scope and secrets; save a local commit and report first-test blockers/required owner approval.

## Necessary additive shared-contract changes

`types.ts` adds optional output/time limits, cache-write/latency/pricing/model provenance, safe-retry/dispatch state and per-attempt telemetry. Existing required request/result fields and model IDs are unchanged. These fields are necessary to prevent hidden paid retries and distinguish missing usage from zero cost. Persisting every field atomically still requires compatible P1 SQL.

## Review focus

- Timeout/5xx/empty/incomplete/missing-usage results can be billed; never blindly fallback.
- Sol-sensitive work must not downgrade or bypass verification through a model override.
- Mock/dry-run token estimates must not enter real budgets or imply actual provider accounting.
- Tenant reservations and settlement acknowledgement must be explicit; truthy malformed RPCs cannot authorize dispatch.
- Model availability docs do not prove this owner's account access; mocks do not establish installed DB concurrency or provider billing.
