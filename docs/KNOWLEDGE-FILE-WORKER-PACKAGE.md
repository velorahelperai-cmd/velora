# Knowledge file worker — local approval package

Status: **HOBBY-PUBLISHED (gates off)**. App/docs/review-SQL package may ship; production worker SQL **not** applied. Gates default **off**. Permanent provider extract and durable worker runner stay deferred until pre-launch. No Vercel Pro / paid Cron.

Base HEAD at package authoring: `fe5fed5fd01124c575ab23835865c1848584f184`.

## 1) Reusable queue / worker mechanism (ops inventory)

| Piece | Location | Role |
|---|---|---|
| WhatsApp internal worker auth + cron shape | `src/app/api/internal/whatsapp/worker/route.ts` | Bearer secret, Node runtime, observation codes (202/503), no blind retry on UNKNOWN |
| WhatsApp claim / lease / settle RPCs | DB + `createClaimedWhatsappRuntimeStore` | Atomic claim token; expired tokens cannot settle |
| Setup-file deletion worker | `src/app/api/internal/knowledge/setup-file-worker/route.ts` | Same Bearer pattern (`SETUP_FILE_WORKER_*`) |
| Knowledge file worker (this package) | `src/app/api/internal/knowledge/file-worker/route.ts` | Bearer auth; batch tick + observation (stop/backlog) |
| Local / host tick | `scripts/knowledge-file-worker/run-tick.mjs` | Primary Hobby-fit runner via Task Scheduler / OS cron |
| Vercel Cron on this project | Hobby = **once/day max** | `*/5` invalid; frequent platform cron needs Pro (paid — not enabled) |
| Attempt claim / control / publish SQL | `supabase/upgrade-packages/knowledge-file-worker/10-file-attempts.review.sql` + `11-worker-ops.review.sql` | Review-only; full-chain install **NOT_RUN** while migrations block |
| App protocol (pure) | `src/lib/knowledge/file-worker/protocol.ts` + `recovery.ts` | Expired/foreign cannot publish; pre-provider recover vs unknown review |
| Owner enqueue | `src/lib/knowledge/file-worker/enqueue.ts` + `bound-enqueue.ts` | Claim/replay/recover; returns `queued` / `REVIEW_REQUIRED` |
| Worker run / batch | `run.ts` + `batch.ts` | Fence → optional extract → publish/fail; no blind retry |

**How to run (local / Hobby-compatible):** `node scripts/knowledge-file-worker/run-tick.mjs` with secret + URL, scheduled by Task Scheduler. See `docs/KNOWLEDGE-FILE-WORKER-OPS.md`. Live `/setup` is **not** proven by packaging alone.

**How to monitor / detect stop:** Observation on every tick (`lastTickAt`, `backlog`, `stalledDueWork`, `reviewRequired`, `automaticRetry:false`). Missed success >15m ⇒ stopped **when** a frequent scheduler is actually running.

**Local acceptance:** see `docs/KNOWLEDGE-FILE-WORKER-ACCEPTANCE-20261031.md` (PARTIAL).

## 2) Attempt fence (local, unapplied)

- Atomic claim via `g03_claim_file_attempt` with stable `attemptId` (lost-response replay).
- Old / expired attempt tokens cannot publish (`canPublishWithAttempt`).
- Timeout / unknown provider evidence → leave running for explicit reconciliation; `mayDispatchPaidExtract` blocks blind second charge.
- Legacy `processing` without attempt row → `LEGACY_PROCESSING_REVIEW_REQUIRED` (manual reconcile; no age takeover).

## 3) Upload / reprocess binding (gate on)

Default `VELORA_KNOWLEDGE_FILE_WORKER_ENABLED=false` → existing in-request `prepareStoredFile` unchanged.

When enabled:

1. Upload stores bytes as `stored` (no in-request extract).
2. After `es02_bind_owned_branch_knowledge_source`, owner path calls `enqueueBoundBranchKnowledgeFilePrepare` and returns snapshot with `processing` / queued attempt.
3. Reprocess uses the same enqueue path instead of sync `retryKnowledgePrepare`.
4. Worker later extracts/publishes only if provider gate is also on; owner still reviews and approves via existing approve + content fingerprint path.

## 4) Cost & privacy policy (required before production provider)

Draft for owner approval — not activated:

| Topic | Policy |
|---|---|
| Customer files | Remain in company-scoped `company-knowledge` storage; never log body text or raw PDF bytes |
| Paid extract | Off until `VELORA_KNOWLEDGE_FILE_WORKER_PROVIDER_EXTRACT=true` **and** attempt SQL native-accepted |
| Billing | One paid dispatch per attemptId; unknown/timeout ≠ automatic second paid call |
| Retention | Extracted text follows existing knowledge_sources + approval rules; deletion/unbind supersedes attempt |
| Holds | Do not mutate trial holds (`25bb9e66…`) or re-run zero-cost settlement reviews as part of this rollout |
| Current file | Keep current TAG CITY / stored objects and trial holds unchanged while packaging |

## 5) Approval checklist (before production)

- [ ] Isolated native SQL acceptance of review package (synthetic fixtures, no paid calls)
- [ ] Explicit production migration approval (separate from native)
- [ ] Drain any tokenless in-flight prepare writers before enabling gate
- [ ] Set `VELORA_KNOWLEDGE_FILE_WORKER_SECRET` (≥32) in host env
- [ ] Enable `VELORA_KNOWLEDGE_FILE_WORKER_ENABLED=true` only after schema live
- [ ] Owner-approved cost/privacy above; then optionally `VELORA_KNOWLEDGE_FILE_WORKER_PROVIDER_EXTRACT=true`
- [ ] Frequent runner wired (Task Scheduler + run-tick on Hobby, or owner-approved Pro cron); unknown → reconciliation not blind retry
- [ ] Live `/setup` proof with gates/SQL owner-enabled; not “docs-only done”
- [ ] Owner review + approve path still required before answers (`reviewedContentFingerprint`)

## Package files

- `supabase/upgrade-packages/knowledge-file-worker/*`
- `src/lib/knowledge/file-worker/*`
- `src/app/api/internal/knowledge/file-worker/*`
- Wiring: `src/lib/knowledge/actions.ts`, `src/lib/tenancy/paid-branch-knowledge-actions.ts`
- Env stubs: `.env.example`
