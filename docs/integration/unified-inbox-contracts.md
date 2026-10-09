# Unified Inbox integration contracts

Base `7c7c17d`, branch `codex/unified-inbox-backend`. Backend only; preserve Antigravity's UI design. This document accompanies the local reviewed commit; it does not authorize cloud migrations or customer activation.

## Customer read and acknowledgement actions

Import from `src/lib/whatsapp/inbox-actions.ts`. Results are `{ok:true,data:...}` or `{ok:false,code:...}`. Pass the active workspace's `companyId`; the server compares it to the authenticated selected company, and SQL independently enforces capabilities, session validity and assigned scope.

| Action | Input | Returned data |
|---|---|---|
| `refreshWhatsappInboxPage` | `companyId`, optional `limit` 1–100 / `before` | `kind:'partial'`, scoped conversations, `nextCursor`, `hasMore`, actual `total`, `unreadTotal`, `interventionTotal`, scope and membership fingerprint |
| `refreshWhatsappThreadPage` | Same + `conversationId` | One bounded message page, current conversation state, unread count and latest-page `displayedInboundMessageId` |
| `markWhatsappThreadSeen` | `companyId`, `conversationId`, `displayedInboundMessageId` | Persisted read sequence and remaining unread count |
| `refreshWhatsappControlAuditPage` | Same thread page input | Actor/action/revision/generation/time; bounded audit pagination, no internal detail payload |
| `refreshWhatsappConnectionStatus` | `companyId` | Connection and authorization status, company display number, actual tested timestamps and binding readiness |

Inbox order is explicitly **newest created**, using immutable server `inboxSequence`, rather than a mutable last-activity cursor. Message pages are returned ascending by immutable `arrivalSequence`; request older pages using the returned `nextCursor`. Audit order uses `eventSequence`. All sequence/cursor values are decimal strings: compare with `BigInt`, not JavaScript floating-point conversion or provider timestamps.

Merge partial pages by ID; never use a partial page to prune all other conversations. Deduplicate older thread pages by message ID. Clear state on a workspace or scope change. Discard stale asynchronous responses using the existing request/scope guards. A refresh of visible conversation state may legitimately remove access; show the failure and stop mutations.

Call `markWhatsappThreadSeen` only after actually rendering the latest thread page and only when its returned `displayedInboundMessageId` is non-null. Historical pages issue no boundary. The acknowledgement reads through that issued boundary, including older history; it never consumes subsequently arrived messages. Another newer displayed boundary can make an older tab's acknowledgement return `CONFLICT`; refresh instead of substituting an arbitrary message ID. Opening/listing a thread does not itself mark it read.

`unreadTotal` and `interventionTotal` are server counts for the entire authorized scope, not estimates from the current page. Intervention reasons come from durable control/jobs/intents/delivery state: `human_control`, `worker_review`, `worker_failed`, `send_unknown`, `send_rejected`, `delivery_failed`. Unknown external or paid results remain review work and capacity holds; a UI acknowledgement cannot reconcile them or authorize resend.

Connection `sendReady` means the verified company credential binding is available. It does not certify a test send, customer-service window, paid subscription, quota, automation generation or model readiness; those are independently enforced at runtime. `inboundTestedAt` / `outboundTestedAt` remain nullable until actual permitted verification.

## Preserved mutations and full readers

Keep existing `replyWhatsappConversation`, `controlWhatsappConversation` and lead mutation signatures in `src/lib/whatsapp/actions.ts`. Human replies require a stable `clientOpId` per deliberate send. Retry the same operation ID to read its existing outcome; do not issue a new ID for an unknown result. Control actions require current `expectedRevision`; refresh on conflict. Capability decisions must be authoritative, and conversation identity is bound to the selected company before mutation.

The existing `refreshWhatsappInboxSnapshot` retains its `kind:'full'` contract. Its compatibility adapter obtains complete pages and thread history, checks the collected unique ID set/count/hash against final membership, and fails closed if the scope changes or explicit ceilings are reached: 2,000 conversations and 10,000 messages per thread. It never relabels a truncated page as full. Complete-history traversal has N+1 cost; use the new page actions for the production scalable inbox.

## SQL and runtime dependencies

Forward migrations, following all base prerequisites:

1. `20261008150000_vel_unified_inbox_contracts.sql`: immutable ordering, a private per-user read marker, authenticated bounded readers, assigned-scope audit RLS.
2. `20261008151000_vel_wa_atomic_capacity_cost.sql`: service-only joint reservation using existing message usage and AI ledger; a denied new cost/profile rolls back the newly acquired message slot.
3. `20261008152000_vel_wa_recovery_lock_order.sql`: company → conversation → original job → intent lock ordering for existing accepted-receipt recovery.

Fresh worker AI calls use `ai_reserve_whatsapp_capacity_cost_attempt`; saved-success recovery revalidates the prior quota without another paid call. Existing router/model IDs, billing prices, send intents, queue, ledger, human takeover and delivery status contracts remain authoritative. No cloud SQL or external execution was performed. The SQL/shared contracts received independent review locally before commit; any later integration must apply the exact full prerequisite chain and verify deployed definitions/ACLs.

## Operational rollout

The existing authenticated `POST /api/internal/whatsapp/worker` handles one claimed job per invocation and bounded accepted-receipt repair. Use a server scheduler/runner with the configured bearer secret, monitor non-success HTTP responses, pending repairs, dead-letter/review work and claim leases. Repeated invocations may overlap; database claims and company locks enforce serialization. Never treat HTTP success as customer delivery. The customer AI/send rollout remains disabled.

Before integrated staging: adopt page contracts in the separate UI branch; verify cloud migration parity/Vault/worker invocation; complete Meta app review, approved login configuration, HTTPS domains, business scopes and webhook subscriptions; and separately approve real-account tests. Existing P1/P2 financial acceptance dependencies remain. Standard Cloud API onboarding is implemented; Business App coexistence/history sync remains `NEEDS_SETUP` if that onboarding mode is required.
