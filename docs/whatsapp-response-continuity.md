# WhatsApp response continuity

This is the service contract for keeping an inbound WhatsApp message from going silent when a handoff is unclaimed or an AI answer is late. It does not enable Production sending.

## Axes

Human ownership, response phase, and send authority are separate.

| Axis | Values | What it is not |
| --- | --- | --- |
| Human ownership | `NONE`, `REQUESTED_UNCLAIMED`, `CLAIMED_IDLE`, `CLAIMED_ACTIVE`, `RELEASED`, `RESOLVED` | `handed_over` is not a staff claim. `worker_escalation` asks for a person and leaves the thread unclaimed. |
| Response | `RECEIVED` through `PROVIDER_ACCEPTED`, `DELIVERED`, `READ`, `REJECTED`, `UNKNOWN`, `BLOCKED` | Provider acceptance is not delivery. `UNKNOWN` is reconcile-only. |
| Authority | `AUTHORIZED`, `TEMP_UNAVAILABLE`, `REVOKED`, `CHANNEL_DISABLED`, `WINDOW_CLOSED`, `BUDGET_BLOCKED` | A failed check is not permission to send. |

`human_claimed` is its own conversation event. A normal `take_over` mirrors into `claimed_active`. A coexistence automation stop that reuses `take_over` with reason `coexistence_signup_ai_disabled` stays unclaimed.

## Intent identity

`whatsapp_response_intents` allows one row per `(company_id, channel, provider_message_id, response_kind)`.

The only kinds are `answer_v1` and `ack_v1`. The legacy fixed-ack column `response_kind = fixed_ack_v1` on jobs and send intents is unchanged.

## SLA defaults

A missing `whatsapp_continuity_policies` row uses these defaults. Per-business overrides do not change the security gates.

- Ack due at 20 seconds when a reliable answer is not ready.
- Unclaimed handoff escalates at 60 seconds. Safe answers may continue during that wait.
- Claimed idle ack at 120 seconds. Safe AI after that idle stays off unless `allow_safe_ai_after_claimed_idle` is set for that company.
- One ack per inbound message. A pending ack is cancelled when staff has replied or the answer was accepted.

## Gates

`WHATSAPP_WORKER_ENABLED=false` still stops automatic AI before any model call.

`WHATSAPP_CONTINUITY_ACK_ENABLED` is the independent fallback-ack gate. It stays closed unless the value is exactly `true`. `WHATSAPP_FIXED_ACK_ENABLED` and `WHATSAPP_WORKER_ENABLED` do not open it. The legacy fixed ack in `src/lib/whatsapp/fixed-ack.ts` still requires the worker flag, an explicit recipient, and the existing send guards.

The worker calls `runContinuityAckWatchdog` only when `WHATSAPP_CONTINUITY_ACK_ENABLED=true`. The watchdog does not claim a row unless `WHATSAPP_ALLOW_EXTERNAL_SEND=true` as well.

`whatsapp_claim_continuity_watchdog` first schedules `ack_v1` / `ack_due` from persisted inbound messages that are past the SLA, using `private.whatsapp_schedule_due_continuity_acks`. That path does **not** require an AI worker claim or `whatsapp_note_continuity`. A claimed AI job may still record or cancel an ack through `whatsapp_note_continuity`. Cutover stamp `private.whatsapp_continuity_cutover.ack_schedule_from` excludes historical pending rows at migration apply time. Burst peers within `coalesce_seconds` keep a single waiting ack. Staff reply, human claim, generation fence, answer acceptance, closed 24h window, and `UNKNOWN` (reconcile-only) still cancel or block. Ack `COMPLETE` is independent of AI `WORKER_BATCH_BLOCKED`.

A closed service window is stored as `blocked` and is not converted into a template. The inbox payload includes `continuity_sla` deadlines, and the composer shows the remaining ack time.

## Webhook

The webhook returns HTTP 200 only after durable save. A failed persist stays on the existing retryable 500 path. Signature failures stay 401 and are not stored.

`runPersistedInboundJob` applies this decision when the claimed frame carries ownership, handoff reason, conversation status, a closed service window, an unknown send, or an elapsed time. `billing_load_worker_frame` now adds `human_ownership`, `handoff_reason`, and `conversation_status` after the existing authority and service-window gates. A staff claim still comes back as `claim_or_automation_rejected`.

`whatsapp_claim_inbound_batch`, the worker lock, and the assistant send-intent checks use `private.whatsapp_continuity_ai_claimable`. An open automated conversation stays eligible. A `handed_over` or `requested_unclaimed` thread without `human_claimed` / staff `take_over` can be claimed for a safe answer. `claimed_active` and `claimed_idle` cannot. The generation fence and the service-window gate stay in place, so a closed 24-hour window still produces no free-form text. `WHATSAPP_WORKER_ENABLED=false` still returns before the batch is called.

## Enable later

Do not set the continuity ack flag as part of deploying this change. After the migration is applied and ops accepts the neutral ack text, the gate can be enabled on its own:

1. Apply `supabase/migrations/20261106143000_whatsapp_response_continuity.sql`.
2. Confirm `WHATSAPP_CONTINUITY_ACK_ENABLED` is unset or not `true`.
3. Confirm outbound sends still fail closed without `WHATSAPP_ALLOW_EXTERNAL_SEND=true` and the existing intent claim.
4. Only then set `WHATSAPP_CONTINUITY_ACK_ENABLED=true` in the target environment. Leave `WHATSAPP_WORKER_ENABLED` as its own decision.

Rollback: `supabase/rollbacks/20261106143000_whatsapp_response_continuity.rollback.sql`. It drops the new cache and ledger. It does not delete conversations, messages, or control events.

## Tests

```bash
npx vitest run --config vitest.ci.config.ts \
  src/lib/whatsapp/response-continuity.test.ts \
  src/lib/whatsapp/continuity-ack.test.ts \
  src/lib/whatsapp/integration-worker.test.ts \
  src/lib/whatsapp/fixed-ack.test.ts \
  src/lib/whatsapp/inbox-ownership.test.ts
```

These tests use in-memory decisions and mocks. They do not call Meta or a paid model. Hosted SQL apply and Production flag/deploy changes stay owner-gated.
