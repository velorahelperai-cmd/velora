# P3/P4 safe integration implementation plan

**Goal:** integrate existing AI and WhatsApp on corrected local billing, preserving
durable tenant identity, ordered execution, reservations and human control.
**Spec:** the user's P3/P4 SAFE INTEGRATION request; D1–D6 are binding acceptance criteria.
**Architecture:** extend existing inbound jobs/send intents/conversation events
and AI budget/usage tables. One paid loop and one persisted operation per original
job. No parallel queue or accounting ledger; no cloud apply or external execution.
**Execution:** implement local fixes directly as authorized, with material RED→GREEN
checks and a fresh final review. No further design approval is needed for the
specified safeguards; business payment policies remain blocked as documented in P1/P2.

## Tasks and interfaces

- [x] Integrate P3 `23bbec8` and P4 `b24064f` on security base `61163a6`.
  Local merge commits: `55fbf8d`, `da0bcc8`. Original branches unchanged.
  Baseline: 891 application tests passed / 20 skipped, TypeScript passed.
- [x] D1/D6: forward `20261008130000_vel_wa_identity_delivery_integration.sql`.
  Preserve original RPCs; enforce tenant composite relations/immutable identity,
  recipient/outbound-bound statuses and conflict review. Real PG cases:
  `scripts/whatsapp-integration/identity-delivery-cases.sql`.
- [x] D2/D3/D5 and message quota: forward
  `20261008132000_vel_wa_worker_atomic_integration.sql`.
  Reuse `claim_whatsapp_inbound_job`; expose service-only batch claims, bounded
  retry/heartbeat/escalation, frame loading, quota reservation, atomic reply/intent
  staging, assistant-job send claim and replay-safe finalization.
  New job fields retain generation, next retry, staged reply/citations/attempt,
  linked intent and message-capacity status/period/subscription.
  Tests must reject same-conversation parallel claims, stale capabilities,
  unpublished/expired entitlements, unknown-result retries and takeover sends.
- [x] D4 AI cost: forward `20261008133000_vel_ai_whatsapp_reservation_integration.sql`.
  `ai_reserve_whatsapp_attempt`, `ai_start_whatsapp_attempt`,
  `ai_settle_whatsapp_attempt` reuse `ai_budget_accounts` and `ai_usage_ledger`.
  Canonical paid proof and original job/claim authorize service work, with no
  fabricated owner/session. Successful draft/usage/cost persist together;
  unknown keeps held funds. The shared lifetime admin cap stays at most 1000 baisa.
  `createClaimedWhatsappAnswerExecutor()` retains the existing disabled live gate.
- [x] Worker integration: use the new SQL contracts and P3 executor through typed
  ports, existing Approved Knowledge/file-integrity checks and existing send/finalize
  machinery. Authenticated bounded POST consumer defaults disabled. Per-link Vault
  read defaults NEEDS_SETUP until separately configured; no global tenant token fallback.
  Change only displayed prompt identity to Noura / نورا; model/internal IDs stay intact.
- [x] Run focused and full application checks, actual multi-session PostgreSQL
  atomicity/ordering/quota/takeover cases, TypeScript, lint and secret/scope checks.
  Record executed/failed/skipped counts separately; commit local implementation.

Final evidence: 907 application PASS / 22 skipped; 72 actual PostgreSQL PASS /
0 FAIL / 1 Vault prerequisite NOT RUN; two SQL-backed worker application tests
PASS with provider/REST/Vault transport seams. TypeScript and scoped lint PASS.
Final review: zero Critical and three Important findings; all three were fixed
with RED→GREEN regression checks. Cloud/provider/deployment judgments remain blocked.

## Decisions and review focus

- Start at corrected `61163a6`, because referenced integration tip `485d21e`
  still contains locally fixed critical defects. Cloud and payment policy remain unapproved.
- Retain existing quota month boundary Asia/Muscat; AI budget accounts retain their
  configured DB-month semantics. No existing spend/holds or allowance is reset.
- Technical retry policy: at most five claims, exponential delay 5–300 seconds;
  unknown paid generation/send goes to review without another dispatch.
- Locks: company NO KEY UPDATE → Live subscription → conversation → original job →
  AI budget → AI attempt / send intent. NO KEY UPDATE permits control-event FK reads.
- Explicitly test crash after provider work, lease expiry, equal-order timestamps,
  takeover during generation and wrong-recipient/stale failure evidence.
- Local full-source migration harness has external Auth/Storage dependency stubs
  and a synthetic source-locked admin precondition. This does not verify cloud Auth,
  Supabase HTTP transport, Vault encryption or provider account/model availability.
