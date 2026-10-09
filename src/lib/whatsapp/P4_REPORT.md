# P4 WhatsApp Engine readiness

Date: 2026-10-08. Branch: `codex/p4-whatsapp-readiness`.
Base: `657e4bafeff62f37137238a9afc61d2562629a7d` from `feature/p0-production-readiness`.
Worktree: `C:/Users/DELL/.codex/worktrees/p4-whatsapp-readiness/Velora new`.

P2 was independently preserved in local commit `3f2ed0fc0a9872e47a89f6ea90d2c1ebd6db64a2` on `codex/p2-billing-readiness` after a staged credential-pattern scan, 305 Billing tests, and TypeScript. P4 does not include or modify that branch. No push/merge was performed.

## 1. Existing WhatsApp Features

- Meta challenge/signature reception; explicit single-tenant or verified phone registry routing.
- Atomic inbound conversation/message/job RPC, duplicate protection and token-based claim leases in local SQL source.
- Human takeover/resume/close, generation/revision checks, approved knowledge and tenant context checks in the existing answer adapter.
- Durable outbound intents, one provider attempt, accepted/unknown/rejected outcomes, persistence repair and delayed delivery-status rebinding.
- A callable answer-preparation entry exists. No repository production consumer/scheduler invokes it; a step list is not a deployed worker. Customer AnswerProvider and live entitlement remain unconfigured.

## 2. Bugs Found & Fixed

- Authenticate the original request bytes; malformed UTF-8/JSON is rejected, interrupted body reads stay retryable.
- Validate the Meta event envelope and identifiers/timestamps. Invalid timestamp evidence is skipped instead of fabricating server time or throwing on an extreme date. Unsupported content remains a typed inbox item and cannot enter automatic text answering through the worker.
- Scope in-batch dedupe by business phone plus message ID. Isolate resolver failure to that phone; keep unknown transport/RPC outcomes retryable instead of acknowledging lost work. Verified tenant routing requires actual retained link identity/generation.
- Reject malformed persistence/claim/completion evidence rather than coercing truthy strings or inventing pending/completed states. Preserve exact new-status SQL response compatibility, including the omitted duplicate flag.
- Bind entitlement's requested company to the stored claimed job/message before answer preparation. Reject expired/wrong-tenant claims, unsupported media and changed staged-answer identity; contain preparation failures without reporting completion/send.
- Enforce employee takeover/paused/resolved/suspended state even when a contradictory eligibility flag says true. Reject malformed automation gates and changed generations.
- Require valid Graph message-ID evidence and a confirmed attempting intent with retained tenant/conversation/recipient/body/operation/link binding. Accepted provider evidence is separate from delivery. A thrown accepted finalizer retries persistence with the same provider ID, never Graph.
- Reject blank/padded attempt tokens before dispatch. Reject malformed non-digit recipients instead of silently changing the persisted identity.

Every material fix was reproduced with a failing local test before the correction. No functional queue, AI router, or Billing system was replaced.

## 3. Files Modified

All paths in the table are relative to this P4 worktree.

| Source file | Responsibility |
| --- | --- |
| `src/app/api/whatsapp/webhook/route.ts` | Raw-byte signature/body handling |
| `src/lib/whatsapp/webhook.ts` | Envelope parsing, scoped dedupe and routing retry |
| `src/lib/whatsapp/tenant-resolve.ts` | Verified stored tenant/link response validation |
| `src/lib/whatsapp/store.ts` | Durable RPC success/identity/state boundaries |
| `src/lib/whatsapp/automation-gate.ts` | Human control and generation validation |
| `src/lib/whatsapp/inbound-worker.ts` | Existing preparation-entry identity/media/error guards |
| `src/lib/whatsapp/send.ts` | Provider acceptance evidence |
| `src/lib/whatsapp/send-attempt.ts` | Retained link binding and finalizer uncertainty |
| `src/lib/whatsapp/actions.ts` | Confirmed claim/binding and acceptance-persistence recovery |

Existing tests updated: `webhook.test.ts`, `tenant-routing.test.ts`, `send-settlement.test.ts`.
New tests: webhook `route.test.ts`, and `p4-webhook-readiness`, `p4-tenant-resolve`, `p4-store-readiness`, `p4-handoff-readiness`, `p4-worker-readiness`, `p4-send-readiness`, `p4-send-action-readiness`, `p4-claimed-binding` under `src/lib/whatsapp/` with `.test.ts` extensions.
WhatsApp documentation: [plan](P4_PLAN.md), [P1 dependencies](P4_DEPENDENCIES.md), this report.

## 4. Tests Passed / Failed

Executed after all source changes in this isolated worktree:

- `node node_modules/vitest/vitest.mjs run --reporter=dot`: **590 passed, 0 failed, 18 skipped**; 65 files passed, five opted-in SQL files skipped. The 18 skipped tests are 17 SQL checks plus one deferred storage-object integration check; none are counted as passed. The corrupt-PDF fixture emits its existing extraction warning.
- `npm run typecheck`: exit 0.
- ESLint for all changed/new TypeScript files: exit 0, no errors or warnings.
- `git diff --check`, WhatsApp-only scope check, credential-pattern scan and local report-link checks: passed.

The initial tracked WhatsApp plus channel/operational contract baseline passed 101 tests. The combined WhatsApp/API/shared-contract check passed 233 tests before the final five token/recipient regression cases; the final whole-project run includes those cases. Tests use synthetic identifiers and local HMAC hashing, with mocked database/provider transport. No real customer accounts, Graph messages, paid model calls or SQL execution occurred. External-send/provider credentials were disabled or cleared in the verification subprocess; test-only feature overrides do not enable production flags.

| Requested scenario | Local evidence | Production limit |
| --- | --- | --- |
| Incoming message | Complete signed envelope parses/routes to retained tenant and persistence boundary | Installed atomic commit unverified |
| Duplicate message | Phone-scoped dedupe; original duplicate job result retained | Real database concurrent uniqueness unverified |
| Wrong tenant | Resolver/binding/claimed-job mismatch rejected | Installed constraints/RLS require P1 |
| Invalid signature | Exact body HMAC rejects tampering before database access | Meta account subscription unverified |
| Webhook retry | Partial batch/failed store/resolver returns retry; redelivery preserves identity with doubles | Commit/response-loss database recovery unverified |
| Provider timeout | Unknown result; no second Graph/model dispatch; no false completion | Durable retry/escalation policy missing |
| Outbound failure | Reject versus ambiguous result; accepted finalization retries persistence only | Installed finalizer/recovery unverified |
| AI failure | Existing worker contains preparation exceptions and preserves job | Actual customer provider/escalation unwired |
| Human handoff | Paused/stale generation stops result eligibility | Atomic stage/dispatch/takeover fencing needs P1 |
| Subscription inactive | Entitlement denial prevents preparation | Real entitlement reader is a fail-closed stub |
| Usage limit reached | Existing operational contract's reservation denial blocks model dispatch with mocks | WhatsApp is not wired to authoritative quota RPCs |
| Multiple messages together | All distinct messages retained and tenant failures isolated in batch tests | Distributed conversation ordering absent |

These are application-boundary checks, not proof of a deployed queue, real capacity accounting, database locking or exactly-once external delivery.

## 5. Database Dependencies on P1

See [detailed source evidence and acceptance criteria](P4_DEPENDENCIES.md):

1. Installed tenant/capability/RLS constraints and immutable message/job/link identity.
2. Conversation-ordered durable claiming, rescheduling/backoff, bounded attempts, lease fencing and dead-letter handling.
3. Atomic original inbound job/message/claim to staged assistant answer and unique send-intent linkage; replay-safe completion.
4. Authoritative paid entitlement and atomic AI/outbound quota reservation/settlement. Existing wrappers reference RPC definitions absent from local migrations at this base.
5. Atomic takeover/dispatch fencing, durable idempotent failure escalation, deliberate customer automation activation.
6. Recipient/outbound-bound delivery transitions; older failed evidence must not erase later read/delivered evidence.

## 6. Remaining Launch Blockers

No production consumer/runtime invocation is established. Per-tenant credential vault is unconfigured; customer AnswerProvider returns null; billing entitlement is unconfigured; quota integration and durable assistant dispatch remain incomplete. P1 database guarantees above need real database verification. Noura persona/action-success rules require coordination with the existing shared AI prompt/contract (currently Leila), not a P4 AI-core edit. Meta ownership/permissions and an authorized live rollout remain separate.

## 7. P4 Local Readiness: BLOCKED

The implemented local safeguards can pass their offline tests while the engine remains blocked from launch by actual runtime/database/provider integration. Live answering stays false, live-ops readiness stays false, and external send remains an explicit disabled-by-default host flag. No deployment or deployed-secret inspection was performed.

## 8. Integration Notes for Antigravity

- P4 stays isolated from the original checkout and P2. No migrations, Auth/RLS, Billing, AI Core, UI or dependency manifests were edited; no backup/push/merge/cloud action occurred.
- Reuse the existing inbound ledger, outbound intents, generation controls and AnswerProvider contract. Resolve D1–D6 instead of introducing a temporary second queue or fake quota.
- Deploy compatible resolver/gate/job RPC contracts before application integration: incomplete successful rows now fail closed. New delivery-status insertion legitimately omits `duplicate`; the adapter handles that exact branch.
- Do not call `completeInboundJob(ok:false)` for a temporary outage: current SQL makes failure terminal. Unknown Meta acceptance must retain the original operation and accepted evidence; persistence repair must not resend.
- Validate actual locks, same-conversation concurrent jobs, handoff races, subscription expiry/quota concurrency and process termination in the separately authorized P1 environment before customer activation.

Provider evidence used: Meta's [official webhook payload reference](https://www.postman.com/meta/whatsapp-business-platform/folder/tduohwq/webhook-payload-reference) and its [archived SDK signature/challenge documentation](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/). No archived SDK dependency was installed or adopted.
