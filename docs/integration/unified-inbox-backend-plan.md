# Unified Inbox backend implementation plan

Base: `7c7c17d2e9dfa59f15c3a57a411bd9770d6a8bce`. Branch: `codex/unified-inbox-backend`.

The saved P1/P2 acceptance (`61163a6`) is an ancestor. Its financial/cloud rollout blockers remain; this work does not authorize a deployment. Preserve all other worktrees and the UI design.

Reuse the existing Meta verified links/Vault, raw-body HMAC ingress, inbound jobs, AI router/reservation ledger, outbound intents, delivery events and human control audit. Do not build a parallel queue or accounting system.

1. Add bounded, authenticated company inbox/thread reads, durable per-user read cursors, actual unread counts and intervention summaries. Keep current refresh/control/reply contracts; add pagination explicitly rather than claiming a partial snapshot is full. Reject unknown capability/scope and all cross-tenant or unassigned access. SQL read RPCs must not disclose secrets, claim tokens or raw provider payloads.
2. Atomically reserve both the existing message capacity and the existing AI cost before provider dispatch; reuse the existing profile/citation/subscription fences. Failure must roll back a newly acquired reservation, while preserving previously incurred or uncertain costs. Keep recovery and idempotent settlement semantics.
3. Trace reliable worker/crash/accepted/unknown repair paths. Fix demonstrated local gaps only. A stopped process must not cause a second paid call or blind external resend. Retain separate Meta acceptance and delivery.
4. Test new contracts and concrete failures with offline transport mocks and actual isolated multi-session PostgreSQL. Reuse the existing integration harness, synthetic identities, actual Vault and project RPCs. Document mocks, skips and external prerequisites separately.
5. Request independent SQL/shared-contract review before final local commit. Fix material findings, verify TypeScript/scoped lint/build as appropriate, scan changed files for secrets and commit locally. No cloud writes, push, merge, deployment, real Meta send or paid AI.

Forward SQL allocation: inbox `20261008150000`; joint reservation `20261008151000`; any independently demonstrated worker fix after those. Historical migrations are immutable. Database/contract changes require the independent review and documentation above before any later integration.

Acceptance: owner and authorized staff read/reply/take over/resume through server-enforced scope; new inbound messages and read markers remain durable; fresh inbound after read is still unread; per-company subscription/quota/cost isolation; revoked credentials and stale generations cannot dispatch; ambiguous paid/send outcomes require reconciliation. Staging readiness remains NO until cloud parity, owner-approved rollout and the full real-account journey are verified.
