# AI database security and accounting review

Scope: the existing `ai_budget_accounts` and `ai_usage_ledger`, administrative RPCs, and the privilege boundary required by later WhatsApp AI wrappers. No parallel ledger, owner-policy change, commercial-price change, historical migration edit, budget seed/reset, provider call, or cloud action.

## Proved failures and repairs

All baseline failures below were reproduced on real PostgreSQL before the forward migration. `scripts/security-foundation/ai-security.sql` had 11 failing and 3 passing cases on the unchanged 67-migration chain. After applying `20261008160000_vel_ai_security_accounting_boundary.sql`, all 14 cases passed.

| Severity | Original source | Reproduction / failure | Repair |
|---|---|---|---|
| P1 | `20261008040000_vel_ai_runtime_foundation.sql:45` | A service client could reset spent/held, delete the budget singleton, or overwrite/delete ledger evidence. | Revoke service table writes; guarded, fixed-search-path definer RPCs own atomic mutations. Service retains SELECT. |
| P1 | `20261008133000_vel_ai_whatsapp_reservation_integration.sql:308` | Admin reservation accepted a pricing snapshot for another model/version. | Validate model/provider pair and snapshot model/version before holding money. |
| P1 | `20261008133000_vel_ai_whatsapp_reservation_integration.sql:322` | Attempt 2 could exist without attempt 1; a fallback could change tenant/session or follow an unknown outcome. | Bind execution to its original tenant/actor/session, enforce consecutive attempts, and allow fallback only after a whitelisted definite zero-cost rejection. |
| P1 | `20261008133000_vel_ai_whatsapp_reservation_integration.sql:369` | Known success settled a reserved attempt without consuming its start capability. | Known success/incomplete require running. Start takes budget then ledger locks before revalidating authorization. |
| P1 | `20261008133000_vel_ai_whatsapp_reservation_integration.sql:380` | Admin settlement lost response/actual-model evidence; a wrong actual model was accepted. | Add the current admin API with both provider IDs, actual-model matching and complete usage; retain the 8-argument compatibility API. |
| P1 | `20261008133000_vel_ai_whatsapp_reservation_integration.sql:371` | Unknown outcomes accepted nonnull known costs while keeping the hold; positive USD could be recorded as zero baisa. | Unknown costs must be null. Known costs must be finite/nonnegative and agree about zero; rejected costs must be exactly zero. |
| P2 | `20261008133000_vel_ai_whatsapp_reservation_integration.sql:370` | Identical settlement retries returned false. | Compare the complete persisted outcome/usage/evidence and acknowledge identical retries without another charge. Conflicts return false. |
| P2 | `20261008133000_vel_ai_whatsapp_reservation_integration.sql:405` | Identical reconciliation retries returned false. | Compare actual counters, money and provider evidence; reconcile once, acknowledge identical retries and reject conflicts. Keep the in-flight five-minute guard. |

Protections already working on the baseline: browser RPC/capability ACLs, canonical platform-owner and active-session authorization, and the globally shared 1,000-baisa admin cap. The forward migration preserves them. Budget accounts also receive a finite-number constraint so SQL-administrator provisioning cannot introduce NaN/infinite accounting values.

## Current application contract

`public.ai_settle_admin_attempt(p_id uuid, p_status text, p_cost_usd numeric, p_cost_baisa numeric, p_usage jsonb, p_request_id text, p_error_code text, p_latency_ms integer, p_response_id text, p_actual_model_id text) returns boolean`.

Current known success/incomplete calls require the actual requested model (accepted dated provider aliases are retained), a nonempty request ID or response ID, and all six counters. Unknown/rejected calls may carry empty usage. The established eight-argument `ai_settle_attempt` remains available with optional provider identity and normalized omitted cache-write/total counts; it cannot mutate worker-bound rows.

The same known/unknown monetary validation surrounds WhatsApp settlement, which now has a service-only definer wrapper. Existing service-window, original inbound/claim, knowledge, plan/persona and joint message-capacity reservation/start wrappers are retained. Original settlement capability remains usable for accounting after lease expiry or handoff. Private AI implementation helpers are not executable by browser/service roles directly.

`ai_admin_snapshot` keeps its JSON contract and adds modern token counters, provider references and reconciliation evidence to recent records.

AI costs remain calculated by the server from its immutable pricing snapshot. The SQL change validates money and usage; it does not reprice provider responses or introduce a new pricing catalog. The SQL administrator remains capable of deliberate maintenance; ordinary service clients cannot reset accounting.

## Verification commands and boundary

Run `node scripts/security-foundation/ai-security.mjs` only against the task-labelled C1 target configured by the shared harness. The SQL file uses subtransactions and rolls back all temporary fixture state. Its privileged test-only setup helpers never become production objects.

`node scripts/security-foundation/ai-concurrency.mjs` uses committed temporary fixtures and restores them in `finally`. It must run exclusively after other suites using the admin singleton finish. A coordinator holds the real budget-row lock; each race must observe both named contenders with `pg_stat_activity.wait_event_type='Lock'` before release. Assertions inspect durable state after competing reservations, duplicate execution, starts, settlements and reconciliation. This is not a JavaScript scheduling-only claim.

The C1 target is the isolated `velora-c1-security-a5b8d14` container, task label `c1-security-foundation`, no network, no published ports, and tmpfs data. No other database/container, cloud project, model provider, payment provider, WhatsApp provider, deployment or backup is touched by these tests. The CLI-generated migration initially sorted before the existing future-dated migration chain; root assigned the coordinated forward version `20261008160000`.

Final focused verification passed: 14/14 SQL cases and 5/5 real two-session races, both commands exit 0. Each race observed both contenders blocked on actual tuple/transaction-ID locks before coordinator COMMIT. The final read-only catalog check found all 11 public AI RPCs service-only, SECURITY DEFINER with empty search path; service INSERT/UPDATE/DELETE/TRUNCATE were false on both RLS-enabled accounting tables. Cleanup restored the synthetic admin singleton to limit 1000, spent 0, held 0, enabled true.

The root-owned full WhatsApp suite identified one synthetic fixture still expecting a CHECK error after writes became ACL-denied, and a timed overlap helper that missed a lock under concurrent build load. Root adjusted those test fixtures/barriers and owns the final regression rerun. These are test harness changes, not production AI failures. Broader application unit/type/build checks, independent final source audit and deployment decisions remain root-owned.

Reference security guidance checked: [Supabase database functions](https://supabase.com/docs/guides/database/functions), [API privileges](https://supabase.com/docs/guides/api/securing-your-api), and [Supabase changelog](https://supabase.com/changelog). The reviewed changelog did not require a different SQL function/grant convention for this change.
