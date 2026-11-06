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

The watchdog function `whatsapp_claim_continuity_watchdog` only reserves an ack row. Its result always has `dispatch: false`. A later sender still has to pass the existing send-intent claim, generation fence, service window, and this gate. `UNKNOWN` never authorizes a second send. A closed 24-hour window blocks free-form text, including the neutral ack. This change does not approve a template send.

## Webhook

The webhook returns HTTP 200 only after durable save. A failed persist stays on the existing retryable 500 path. Signature failures stay 401 and are not stored.

`runPersistedInboundJob` applies this decision when the claimed frame carries `human_ownership`, `handoff_reason`, `service_window_open`, `send_unknown`, or `inbound_elapsed_ms`. `billing_load_worker_frame` is unchanged, so a frame without those fields keeps today's behavior. `whatsapp_continuity_snapshot` is the service-role read for a later opt-in. The existing inbound batch still claims only conversations that are `open` and `automation_allowed`, so unclaimed `handed_over` rows are not pulled into AI until that selector is changed in a separate reviewed change. A staff `take_over` still bumps `automation_generation`, and the existing pre-send fence rejects the stale generation.

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
  src/lib/whatsapp/integration-worker.test.ts \
  src/lib/whatsapp/fixed-ack.test.ts \
  src/lib/whatsapp/inbox-ownership.test.ts
```

These tests use in-memory decisions and mocks. They do not call Meta or a paid model.
