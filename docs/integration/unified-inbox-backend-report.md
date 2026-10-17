# Unified Inbox backend acceptance

**Local backend acceptance: PASS. Ready for Integrated Staging: NO. Production readiness is not claimed.**

Branch: `codex/unified-inbox-backend`. Base: `7c7c17d2e9dfa59f15c3a57a411bd9770d6a8bce`. Final commit is the independent local commit carrying this report; its SHA is supplied in the delivery message. The base includes saved P1/P2 security acceptance `61163a6`, P3/P4 integration and the verified-tenant Meta implementation. Other worktrees and original branches were preserved.

## Reused and completed

- Reused server-verified Embedded Signup, exact WABA/phone-to-company registry identifier, Vault-stored connection material, expiry/revocation handling and raw-body HMAC reception. Manual number entry does not prove ownership.
- Reused the existing durable inbound jobs, per-conversation FIFO/leases/backoff/dead-letter handling, existing AI router/approved company knowledge, cost ledger, saved responses, outbound intents and monotonic delivery evidence. No parallel queue or usage ledger.
- Added bounded company inbox/thread/audit/connection read actions, actual per-user unread markers and durable intervention summaries. Owner/staff/assigned-only authorization and active sessions are checked in SQL as well as server actions.
- Added immutable server arrival/event ordering; provider timestamps cannot advance the read cursor. Reading only acknowledges the latest-page boundary issued for that user, preserving later inbound messages.
- Added an atomic existing-message-capacity plus existing-AI-cost reservation before fresh model execution. Denials roll back newly acquired holds; known/uncertain prior costs survive. Saved-success recovery does not regenerate.
- Preserved human reply/control/lead contracts while binding mutations to the selected company and rejecting unknown capabilities or malformed/oversized replies.

## Security findings and fixes

| Finding | Fix / source evidence | Verification |
|---|---|---|
| Missing durable unread/pagination contracts; legacy RPC row limits could masquerade as complete data | `inbox-contracts.ts`; forward `150000` readers/read markers; `inbox.ts` complete bounded adapter | 18 focused read-contract tests; 8 actual PostgreSQL assertion groups; two independent-session arrival/read races |
| Multi-request full snapshot could omit changed authorized membership | `150000:140` one materialized membership statement; `inbox.ts:192` collected ID/count/hash validation | RED mismatch test reproduced false success, then GREEN; independent review closed |
| Separate message quota and AI cost reservations could leave a new slot on denial | `151000:5` nested subtransaction around existing guards; `whatsapp-store.ts`; `integration-store.ts:43` fresh/recovery split | 13 SQL groups; last-slot, last-budget and replay races on separate PostgreSQL backends |
| Accepted-receipt repair took locks in the opposite order to worker processing | `152000:17` company → conversation → original job → retained intent operation | Actual deadlock RED at backend pair `6874/6888`; final GREEN at `10564/10585`, one saved message and idempotent usage |
| A stale tab could control/update another company the owner also belongs to | `actions.ts:737` control binding; `actions.ts:897` lead binding; authoritative capability decisions | Three selected-company mutation tests reproduced failures then passed; SQL still rechecks assigned scope/capabilities |
| Worker HTTP endpoint ignored unsuccessful repair envelopes or threw raw transport failures | `worker/route.ts:16` validated bounded repair result and safe failure response | Three RED → GREEN consumer tests; no new work claimed after failed repair |

Independent source/SQL/shared-contract review: **PASS**, all three Important review findings closed; no Critical/Important finding remains open in this local scope. Financial/cloud acceptance dependencies inherited from P1/P2 remain external blockers.

## Verification

| Category | PASS | FAIL | Skipped / Not Run |
|---|---:|---:|---|
| Offline application suite | 1044 | 0 | 32 skipped; 97 test files passed, 7 skipped |
| Actual isolated PostgreSQL assertions/concurrency | 134 | 0 | 0 |
| SQL-backed application journey | 12 | 0 | 0; actual project RPCs/constraints/Vault, model and Graph transports mocked |
| TypeScript / scoped ESLint / diff check | PASS | 0 | — |
| Next.js 16.3.8 production build | PASS | 0 | — |
| PGlite | — | — | NOT RUN; not used as concurrency evidence |
| Cloud schema, actual Meta onboarding/send and paid provider test | — | — | NOT RUN by instruction |

All **67** migration source files executed locally. PostgreSQL 17.6 used a task-labelled container with no network, exposed ports or persistent volume. Auth/Storage infrastructure and identities were synthetic; project SQL/RLS/transactions and Vault encryption were real. Populated inconsistent legacy identity preflight aborted without deleting/reassigning history. Final concurrency coverage used **14** independent-backend lock cases, not Promise.all as a concurrency claim.

Final pairs: duplicate `9261/9275`, FIFO `9346/9360`, message quota `9438/9459`, AI budget `9557/9592`, takeover `9676/9690`, signup `9746/9760`, credential renewal `9802/9816`, token finalizer `9907/9920`, atomic last slot `10006/10041`, atomic last budget `10133/10168`, atomic replay `10261/10295`, arrival ordering `10366/10380`, read acknowledgement `10452/10466`, accepted repair `10564/10585`. Every pair observed a real lock wait.

The SQL-backed journey covers new inbound completion; model failure/timeout; inactive subscription/quota; expiry during generation; takeover during generation; revoked grant; Meta accepted/rejected/unknown; saved-response recovery after expired process lease; and two companies concurrently with isolated sources, credentials and costs. Duplicate/FIFO/signature/tenant/permission scenarios are additionally covered by the SQL and webhook application tests. The 12 opt-in SQL-backed cases are reported separately from the default suite's 32 skips.

Changed-file credential-pattern scan: zero matches. No environment secrets were copied or printed, no real customer identity was used, and no paid API, real WhatsApp/payment, cloud SQL, push, merge, deployment or backup occurred. Live answering/external sending remain disabled.

## Dependencies and remaining acceptance gates

Forward migrations: `20261008150000_vel_unified_inbox_contracts.sql`, `20261008151000_vel_wa_atomic_capacity_cost.sql`, `20261008152000_vel_wa_recovery_lock_order.sql`. Apply only after separately approved verification of the full prerequisite chain, deployed function definitions/ACLs and Vault. Historical migrations were unchanged. Preserve ordering/read/evidence data during later rollback decisions; this work performs no rollback or cloud migration.

UI integration notes: [unified-inbox-contracts.md](unified-inbox-contracts.md). Antigravity should adopt partial-page actions without treating them as full snapshots, and acknowledge the returned displayed boundary after rendering. Design was not changed. Legacy full readers remain compatible, fail closed beyond explicit ceilings and have complete-history N+1 cost; new page readers are the scalable path.

Before staging: verify cloud schema/Vault and production worker scheduling/monitoring; complete Meta Tech Provider/app review, business scopes, Embedded Signup configuration, HTTPS allowed domains, webhook subscriptions and customer authorization/payment method; resolve existing Paymob financial-contract/policy acceptance; and obtain separate approval for the full real-account journey. Standard Cloud API onboarding is supported; Business App coexistence/history sync remains `NEEDS_SETUP` if required. Outside the 24-hour customer window, unapproved free-form sends remain blocked.

**No production or integrated-staging approval is inferred from mocked provider transports or local SQL success.**
