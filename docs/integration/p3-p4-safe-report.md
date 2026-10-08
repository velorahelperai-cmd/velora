# P3/P4 safe integration — local acceptance

**Ready for Staging: NO.** D1–D6 local implementation and PostgreSQL integration
are prepared; cloud parity, financial rollout and actual provider/credential
verification remain separate. No real API/WhatsApp/payment call, cloud SQL,
deployment, push, main/original-branch merge or backup was performed.

## Branch and merges

- Integration branch: `codex/p3-p4-safe-integration`.
- Corrected base: `61163a67fe7230300b333d66a04fb5202a80d355`.
  Referenced `integration/p1-p2-billing` remains `485d21e`; it did not yet contain
  the critical local corrections. Starting from that uncorrected tip was rejected.
- P3 source: `23bbec86591be63f8a2e699429eb2340e7ff8a6c`; merge `55fbf8d`.
- P4 source: `b24064f625e9b2a3a9f96ca84d35e4aa1b12ec13`; merge `da0bcc8`.
- Both merges had no textual conflicts. Their common base was `657e4ba`;
  operational contracts were separately inspected and corrected below.
- The independent worktree is
  `C:\Users\DELL\.codex\worktrees\p3-p4-safe-integration\Velora new`.
  Original P1/P2/P3/P4/Antigravity branches and files remain unchanged.
- Implementation is saved in a separate local commit reported in the delivery
  message; resolve with `git rev-parse codex/p3-p4-safe-integration`.

Only the displayed system prompt identity changed from Leila/ليلى to
Noura/نورا. Existing internal model/provider identifiers remain unchanged.

## D1–D6

SQL filenames below are in `supabase/migrations`. `I1`, `I2`, `I3` mean:

- I1: `20261008130000_vel_wa_identity_delivery_integration.sql`.
- I2: `20261008132000_vel_wa_worker_atomic_integration.sql`.
- I3: `20261008133000_vel_ai_whatsapp_reservation_integration.sql`.

| Dependency | Local status | Implementation and evidence | Remaining boundary |
| --- | --- | --- | --- |
| D1 tenant relations | PASS | I1:71: composite company/message/conversation/job/intent/link relations, immutable identities and original inbound body/time. Existing inconsistent rows block migration rather than being reassigned/deleted. Additional worker-cost/subscription bindings are in I2. Actual populated inconsistency test passed. | Installed cloud constraints/grants/owners and historical remediation need verification. |
| D2 ordering/retry | PASS | I2:57, :105, :209: stable conversation heads, fenced leases/heartbeat, five-claim limit, 5–300 second exponential backoff, dead-letter and durable human escalation. Eligible heads are filtered before batch limit. Five real independent-session races include FIFO/capacity/cost/takeover. | Deploy/monitor the bounded consumer; define operator recovery responsibilities. |
| D3 durable reply/send | PASS | I2:166, :257, :322: original job + successful persisted AI draft + immutable source versions + one stable intent bind in one transaction. Original intent is reused; attempting/unknown is never blind-resend authorization. Known accepted persistence has a bounded repair-only lane that works after handoff/expiry, without Meta/AI. | Actual network acceptance and provider-evidence reconciliation are not tested. No exactly-once external-delivery claim. |
| D4 entitlement/usage/cost | PASS | I2 quota functions and I3:172: canonical proven Live subscription, current message capacity and enabled company budget checked before reserve/start; held cost and message capacity retained for uncertainty. Actual tokens/cache-write/reasoning/total/model/IDs/latency and draft persist idempotently in the existing ledger. No budget seeded/reset/raised. Lifetime admin cap stays at most 1000 baisa, with existing owner/session gate. | Configure approved company budgets, verify actual tariff/accounts and reconcile retained unknown holds. |
| D5 human control | PASS | SQL stage/send authorization locks the conversation and checks captured generation. Worker rechecks generation/link/knowledge immediately before send. Takeover during generation and during a real lock wait suppresses dispatch; actual incurred AI cost is retained. Completion/repair never resumes automation. | A dispatch already authorized/in flight may already be accepted by Meta; takeover cannot recall it. Verify deployed control contracts and rollout policy. |
| D6 delivery integrity | PASS | I1 status/apply/rebind code: only matching company/phone/recipient/outbound identity may update state. Delivered/read dominate contradictory failed evidence; conflicts remain for review. Early statuses safely rebind. All 38 identity/status checks passed. | Real signed Meta status/ownership/Graph-version verification remains unexecuted. |

Existing `whatsapp_inbound_jobs`, `whatsapp_send_intents`, conversation events,
`ai_budget_accounts` and `ai_usage_ledger` are reused. No parallel queue/ledger was
introduced. Successful draft and original citations persist with cost settlement;
recovery cannot relabel old generated text using newly approved knowledge.

## Worker and safe credentials

`src/app/api/internal/whatsapp/worker/route.ts` is a prepared Node POST consumer:
server bearer secret of at least 32 characters, bounded repair (10) and one new job
per invocation, maximum-duration hint 300 seconds, no capability/customer-body/token
response. Host activation is explicit and defaults off. Customer answering still
uses the existing **hard-disabled** live gate and external-send default; no flags
were enabled. A deliberately activated maintenance invocation can repair retained
acceptance while customer AI/send remain disabled.

`integration-store.ts` uses real RPCs, approved knowledge/file revalidation,
the shared P3 paid execution loop and existing send/finalize/repair functions.
Old staging-only entrypoints remain backward compatible. Per-link access lookup
is service-only, validates company + verified phone + link + generation, reads
only a referenced Vault secret, and has no global token fallback. The migration
creates no secrets or encryption keys. Reference: [Supabase Vault](https://supabase.com/docs/guides/database/vault).

Quota retains the existing Asia/Muscat calendar-month convention; configured AI
budget accounts retain their DB-month convention. No allowance/spend/hold reset
was invented. Owner/operator must reconcile that configured-period distinction
before rollout. Provider acceptance plus a matching persisted outbound row counts
accepted capacity; delivery evidence remains separate. Known unsuccessful dispatch
releases capacity; uncertainty keeps it held.

## Independent review and fixes

Read-only final review found **zero Critical, three Important** issues. Each
Important issue was reproduced and fixed in the final local pass:

| Finding | Fix and regression |
| --- | --- |
| Existing P4 parser rejected duplicate jobs in new retry/dead-letter/review states | Extended the exact allowed lifecycle; three duplicate adapter tests RED→GREEN. Missing/malformed status still rejects. |
| Finalization could retain acceptance but fail display persistence, then falsely stop recovery | Repair before metering; independent bounded repair RPC, including after expiry/takeover. Application and actual SQL regressions passed; no extra Graph request. |
| First 100 blocked successors could starve an unrelated conversation | Filter eligible conversation heads before limiting, retaining claim-time recheck. Isolated 101-successor actual PostgreSQL RED→GREEN. |

During implementation, additional material checks closed stored-unknown AI quota
release, NULL claim authorization, stale source-version recovery and exhausted
job starvation. Test infrastructure initially required whitespace/boolean adapter
corrections and explicit server-only test stubs; final results below include those
corrections rather than counting earlier failures as success.

Reviewer declined cloud Auth/Storage parity, deployment-role ownership, Vault
encryption, actual provider pricing/availability/contracts and real Meta
acceptance/delivery. These are explicit remaining blockers, not discarded findings.

## Final verification

| Category | PASS | FAIL | SKIPPED / NOT RUN |
| --- | ---: | ---: | --- |
| Whole-project application regression | 907 | 0 | 22 skipped |
| Actual PostgreSQL source/atomicity suite | 72 | 0 | 1 Vault encryption/decryption check blocked by absent local server key |
| SQL-backed actual worker/P3 application path | 2 | 0 | 0; provider calls/REST transport/Vault credential seam mocked |
| PGlite | 0 | 0 | NOT RUN; not used as concurrency evidence |
| Cloud installed definitions, real API/Meta and production scheduler | 0 | 0 | NOT RUN / forbidden by scope |

PostgreSQL 17.6 executed **61 actual source migration files** with explicit
external Auth/Storage stubs. The legacy upgrade test first applied 58 base files,
inserted an inconsistent synthetic existing message, confirmed I1 aborted without
deleting/reassigning it, then rebuilt the complete isolated chain. The 72 count
includes 38 identity/status checks, 15 AI cost checks, 11 workflow checks, fairness,
accepted repair, the legacy upgrade test and five concurrency cases. Do not add
lower-level assertions or repeated runs as unique scenarios.

Final lock evidence used independent backend pairs: duplicate inbound
28919/28932; FIFO claims 28988/29002; last capacity slot 29072/29099; company
cost budget 29191/29219; takeover versus send 29302/29316. The waiting backend in
each pair reported `wait_event_type=Lock`, followed by durable-state assertions.
No Promise.all-only or in-memory locking claim is counted as PostgreSQL proof.

TypeScript/lint/whitespace and scoped secret checks are reported with the final
commit. No production build or real provider smoke-test is claimed.
The default 22 skips are 17 older opted-in SQL cases, one deferred Storage case,
two P1/P2 PostgreSQL-backed application cases and the two new WhatsApp application
cases. The last two were explicitly executed separately and passed; no default
skip is counted as a pass. Final type checking and scoped ESLint exited 0.

## Cloud dependencies and rollout gate

1. Verify exact installed source versions, function bodies/owners/grants/constraints
   and legacy classifications, including the P1/P2 security corrections. Cloud SQL
   verification/apply was not performed in this task.
2. Resolve P1/P2 merchant OMR/account-namespace proof and approved payment deadline,
   late collection/refund policy and historical reconciliation. Local critical code
   fixes do not remove those staging blockers.
3. Provision/verify encrypted per-company Meta credentials and server key/Vault
   configuration, ownership, permissions, webhook signature secret, subscriptions
   and Graph-version policy. Local encryption could not be certified without its key.
4. Configure approved published plan quotas and company AI budget accounts; preserve
   existing balances. Monitor retry/dead-letter/unknown holds and use authenticated
   provider evidence for reconciliation, never a new charge/send to discover status.
5. Select a scheduler/worker host with an adequate execution window, protected
   server-only secret, retries and monitoring. No scheduler, Vercel deployment or
   model/customer activation was created. New conversations remain automation off
   until deliberate authorized activation.
6. After separately approved cloud readiness and rollout, authorize a small real
   model/Meta acceptance test. Administrative trials remain separately limited by
   the original lifetime **1 OMR** cap; no paid call was run here.

Apply compatible application and forward migrations as one reviewed release with
affected writers fenced; retain the P1/P2 data-preserving rollback plan. Do not
ship new lifecycle states with the older duplicate parser or expose intermediate
schema defaults to traffic. Keep original branches and this local integration
commit available for review; no automatic merge/apply is authorized by this report.
