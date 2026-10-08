# P4 WhatsApp persistence and launch dependencies

Audited repository base: `657e4bafeff62f37137238a9afc61d2562629a7d`, branch `codex/p4-whatsapp-readiness`. This is a source audit, not evidence that the referenced migrations are installed on any server. No database, provider, customer account, or phone was contacted. Local application checks are reported separately by the P4 owner; mocked results do not verify PostgreSQL concurrency or Meta delivery.

## Existing reusable implementation

| Area | Source implementation | Limit of the evidence |
| --- | --- | --- |
| Durable reception | `save_whatsapp_inbound` atomically writes a conversation, immutable original inbound message and one processing job. Same provider message ID is advisory-locked before conversation creation; conflicting company/phone/customer is rejected. | SQL source: `20261005103000_vel_wa_handoff_01_conversation_control.sql:372`, lock at 414, conflict at 443, job at 537. Installation and concurrent behavior need P1 verification. |
| Inbound leases | `claim_whatsapp_inbound_job` gives a new claim token and expiry; active claims cannot be reclaimed. Completion rejects expired/stale tokens. Jobs/tokens are service-only. | `20261005101500_vel_wa_inbound_01_atomic_reception.sql:231`, completion at 286, grants at 334. A durable processing ledger exists; a deployed consumer is not established. |
| Tenant routing | Verified provider phone ID maps to exactly one active link/company; verified phone uniqueness is defined in SQL. Link generation invalidates old send bindings. No registry-error fallback to a different env company. | `20261005140000_vel_wa_tenant_connection_01_link_registry.sql:64`; latest resolver `20261006010000_vel_wa_intent_link_generation.sql:423`; application `tenant-resolve.ts`. |
| Human control | Take-over disables automation and increments generation/revision; close also invalidates staged answers. Resume/assign are separate capabilities. Actions use expected revision and emit an audit event. | Latest implementation `20261006120000_vel_access_management_01.sql:932`. A new message in a resolved conversation reopens it for human follow-up with automation still off. |
| Outbound intent | Durable operation identity `(company_id, client_op_id)`, field-match on replay, single `ready → attempting` claim, accepted/unknown/rejected states, persistence repair without resending. Expired attempting/unknown attempts are deliberately not automatically resent. | `20261005120000_vel_wa_outbound_01_safe_send.sql:62`; latest claim `20261006120000_vel_access_management_01.sql:1273`; service-only assistant-intent helper at 2336. |
| Delivery evidence | Graph acceptance and delivery are separate. Status events are durable, unmatched events retained, and later rebind uses company/phone/message ID. | `20261005120000_vel_wa_outbound_01_safe_send.sql:964`. Recipient/failed-event transition weaknesses are D6 below. |
| Approved knowledge | Existing channel adapter derives company/message/conversation identity from persisted relations, verifies live claim and automation generation, reads only approved current knowledge, rechecks source integrity and citations after provider work. | `../answers/channel-adapter.ts:225`, `../answers/context.ts:126`. No WhatsApp completion or send occurs in the adapter. |

Migration filenames above are under `supabase/migrations/`. They were read only; P4 does not create or modify SQL, Auth, RLS, Billing, or AI Core.

## P1 database dependencies and acceptance criteria

### D1 — Installed schema and enforced tenant relations

P1 must reconcile the installed migration versions with the latest source contracts, grants, column-level token protections, capability checks and RLS. Base message/job/send-intent tables have individual foreign keys; these alone do not prove every referenced message/conversation/link belongs to the same company. Application guards and RPCs are useful but service-role table writes bypass RLS.

Acceptance: inspect installed definitions; enforce or otherwise prove immutable company/message/conversation/link identity at database boundaries. Real local PostgreSQL tests must cover wrong-tenant writes, duplicate inbound concurrent requests, unauthorized job-token reads, old claim completion and revoked staff capabilities. Existing `inbound-acceptance.ts` descriptors explicitly have status `deferred`; they are not executed tests.

### D2 — Retry scheduling and conversation ordering

Current job claim takes one job ID, with no conversation exclusion or earliest-message predicate. Different jobs from the same conversation can be claimed together. Jobs have no retry schedule, bounded attempts, dead-letter/escalation state, or heartbeat extension. `complete(..., p_ok=false)` writes terminal `failed`; the claimant only accepts pending or expired claimed jobs. Lease expiry alone provides reclaim, not a safe bounded retry policy.

Acceptance: define an internal batch-claim/reschedule contract with stable ordering (including equal timestamps), one active logical answer per conversation, bounded attempts/backoff, token fencing, and durable escalation. Persist retries before acknowledging worker execution. A stale worker must be unable to stage/dispatch after another claim. Confirm whether long provider work renews a lease or is cancelled before expiry. Process unrelated conversations independently. Sorting an application array cannot supply the concurrency guarantee.

### D3 — Atomic inbound-job to assistant-reply linkage

`create_whatsapp_assistant_send_intent` exists and is service-only, but it accepts conversation/text/generation, not original job/message/claim token. Current unique operation ID does not establish one logical assistant reply per inbound message, nor durable retention of the staged answer. Worker retries must not regenerate a different body under the same logical operation or invent a new operation after ambiguous Graph acceptance.

Acceptance: retain a durable staged answer/citations/model usage and a unique trusted original job-to-intent binding. In one transaction validate current claim, tenant/message identity, approved knowledge version, current link/generation, handoff generation and capacity before authorizing dispatch. Resume uses the same persisted intent. Finalization/completion and quota settlement must be replay-safe. Unknown outcome retains reservation and requires reconciliation or human review; repair accepted persistence only, never blind resend. Do not claim exactly-once external delivery: an HTTP timeout may occur after Meta acceptance.

### D4 — Authoritative paid entitlement and usage reservation

`../billing/entitlement.ts:29` is still a hard fail-closed `not_configured` reader. `../billing/operations/usage.ts` references `billing_reserve_automated_outbound`, `billing_finalize_automated_usage`, `billing_reserve_ai_cost` and `billing_record_ai_cost`; definitions for these names are absent from all local migration source at the audited base. Existing usage display SQL counts intents; a dashboard count is not an atomic quota guard. P4 must not implement a replacement Billing contract or allow an absent quota to mean unlimited.

Acceptance: P1/Billing owners expose current tenant-scoped paid-period/capability reads and atomic reservation/settlement contracts. Validate subscription/company state before paid AI work and again before dispatch. Reserve company AI spend separately from outbound capacity. Count one confirmed accepted automated intent plus matching persisted outbound row; duplicates do not count twice, rejected releases capacity, unknown retains it. Define month boundary/reset and subscription expiry during execution. Administrative AI's separate lifetime 1 OMR allowance must never substitute for a customer allowance.

### D5 — Human takeover and durable failure escalation

Read/re-read automation gates and generation checks already exist. The gate is explicitly a permission snapshot, not atomic dispatch authorization. A takeover between last read and outbound claim needs fencing. New conversations default to `automation_allowed=false`; P1/product must supply a deliberate eligible-customer activation policy. Do not automatically resume AI on inbound redelivery or error recovery.

Acceptance: assistant stage/intent/claim all require the captured generation and an active automation state. Simulate takeover during AI work, immediately before dispatch and after Meta acceptance; only the last case may already have an externally accepted message. Failed/no-knowledge/quota-blocked processing must create durable, idempotent human escalation with actor/reason and preserve the customer's original message. Completion after takeover must not reopen automation. Keep assign distinct from take-over.

### D6 — Delivery status identity and contradictory events

Source `rebind_whatsapp_delivery_statuses` checks company/message/phone, but does not compare `recipient_wa_id` to the conversation recipient or require an outbound message. `private.whatsapp_delivery_rank` assigns failed rank 5 above read rank 4, and the update accepts any larger rank regardless of older timestamp. Consequently an older failed event can overwrite stronger later read evidence. These are database transition dependencies, not an invitation for P4 to rewrite migrations.

Acceptance: define authoritative sent/delivered/read/failed transitions and conflict-review behavior; verify recipient and outbound binding. Wrong recipient cannot mutate a message. Older sent/failed events cannot erase later proven delivered/read state. Status-before-finalization safely rebinds after accepted persistence; duplicate status remains harmless. Review global status dedupe `(wa_message_id, status, occurred_at)` against immutable original tenant/phone/recipient before acknowledging a conflict as a duplicate.

## Shared and operational blockers outside P4's allowed edits

1. **AI contract:** `../answers/provider.ts:9` always returns null and `../answers/guards.ts:19` disables customer answering. `channel-adapter.ts` stages only and returns character-based context usage, not actual provider tokens/cost. Adopt the existing AnswerProvider/runtime under a reviewed shared contract with actual tokens and bounded customer spend; P4 does not change the router. Its stored isolation key and approval checks must survive integration. The requested Noura identity also needs coordination with the shared prompt, which currently says Leila.
2. **Action claims:** a plain generated text response does not prove booking, billing or other external execution. Shared AI/product contract must distinguish an answer from an executed action and require persisted action success before claiming completion. Never infer business action success from provider HTTP success.
3. **Tenant credentials and Meta ownership:** `access-secrets.ts:23` always reports `unconfigured` and returns `NEEDS_SETUP`. Connect a server-only per-company/per-phone/per-link-generation vault and verified Meta ownership before dispatch. Embedded Signup helpers are contracts, not a completed token exchange. Do not reuse the global token for another tenant or treat client window events as verification.
4. **Consumer runtime:** repository searches found no production route, package script, cron configuration or worker deployment invoking the WhatsApp claim/answer path at the audited base. Callable helpers/step lists are not an operational consumer. Select and deploy a bounded authenticated consumer only in a separately authorized rollout, with durable retry/dead-letter monitoring and recovery after host termination.
5. **Live rollout:** live answering, WhatsApp live-ops readiness and external-send defaults remain disabled. P4 makes no claim about secret env values in a deployed host. Meta subscription/permissions, Graph version policy and real authorized acceptance/status checks remain a separate rollout; mocks cannot establish these.

## Scenario verification split for integration

| Requested scenario | What local mocks can establish | What still needs installed DB/runtime verification |
| --- | --- | --- |
| Incoming message | Parsing, signature, routing and persistence-call contract | Atomic message/conversation/job commit |
| Duplicate message | Stable identity and duplicate-return handling | Advisory lock, uniqueness and no side conversation under concurrency |
| Wrong tenant | Reject incorrect resolver/message/conversation bindings | Composite identity enforcement and installed capability/RLS rules |
| Invalid signature | No persistence call for invalid/tampered body | Configured Meta app-secret/subscription ownership |
| Webhook retry | Retry on persistence outage, idempotent replay calls | Commit-then-response-loss recovery with original message/job preserved |
| Provider timeout | Fail without pretending send/delivery/completion | Bounded retry, reservation retention and no duplicate paid generation/send |
| Outbound failure | Definite reject versus ambiguous classification | Durable intent finalization/repair and unknown reconciliation |
| AI failure | Gate/adapter failure propagation | Durable escalation and separately enforced customer AI budget |
| Human handoff | Pause/generation checks | Atomic takeover/dispatch fencing and authorized action audit |
| Subscription inactive | No work when entitlement denies/unconfigured | Live source of truth, expiry races and dispatch recheck |
| Usage limit reached | Refusal to proceed without capacity approval | Actual reservation RPC, concurrent cap and idempotent settlement |
| Multiple messages together | In-process sequencing and isolation checks | Per-conversation distributed ordering and old-worker fencing |

## Integration notes for Antigravity

Reuse the existing inbound ledger, outbound intents, service-only assistant-intent helper and generation controls; do not introduce a disposable parallel queue or mock quota implementation. P4 changes are isolated to its worktree and WhatsApp scope. Resolve D1–D6/shared contract versions before selecting runtime and enabling customers. Confirm the installed migration chain rather than assuming local comments or successful mocked tests imply cloud readiness.

**Launch readiness remains BLOCKED** until the dependencies above are implemented and verified. This document does not assign PASS/FAIL to the P4 owner's final local test run.
