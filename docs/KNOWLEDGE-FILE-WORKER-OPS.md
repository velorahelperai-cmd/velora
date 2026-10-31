# Knowledge file worker — ops runner & publish plan

## Project plan (verified)

| Fact | Evidence |
|---|---|
| Vercel team | `velora-9513` / `velora` |
| Plan | **hobby** (current) |
| Hobby Cron min interval | **Once per day** ([docs](https://vercel.com/docs/cron-jobs/usage-and-pricing)); `*/5` **fails deploy** |

## Local journey proof only (not production)

Use `scripts/knowledge-file-worker/run-tick.mjs` against a **local** Next URL with real worker env (`VELORA_KNOWLEDGE_FILE_WORKER_SECRET` ≥32, `VELORA_KNOWLEDGE_FILE_WORKER_ENABLED=true`, provider extract **false** for txt).  
**Do not** treat the owner workstation / Task Scheduler as a production runner.

## One production runner option (not installed)

| Field | Choice |
|---|---|
| Option | **Vercel Pro Cron** → `GET/POST /api/internal/knowledge/file-worker` with `CRON_SECRET` / worker secret |
| Where | Same Vercel project `velora` (no new vendor) |
| Schedule | e.g. `*/5 * * * *` (Pro min interval: **once per minute**; Hobby cannot) |
| Cost at decision time | **Pro $20/mo** team seat ([pricing](https://vercel.com/pricing)); Cron itself included; Function invocations bill under Pro Functions (starting **$0.60 / 1M** after included allotment; Fluid memory from **$0.0106 / GB-hr**) |
| Time to start processing | Cadence worst-case ≈ **5 minutes** after enqueue (+ cold start) |
| Stop detection | Observation JSON: `ok`, `backlog`, `stalledDueWork`, `reviewRequired`, `lastTickAt`; missed successful ticks >15m ⇒ treat stopped |
| Safe disable | Set `VELORA_KNOWLEDGE_FILE_WORKER_ENABLED=false` (and/or remove cron entry); upload falls back to in-request prepare; no backlog drain required before disable |
| Not done here | No Pro purchase, no cron entry, no gate enable, no publish, no prod SQL |

## SQL / code / gates publish order (when owner approves)

1. Install review SQL **10** then **11** on the target DB (after real chain / paymob predecessor already present in that environment’s history).
2. Deploy app code including file-worker route + batch local-txt extract.
3. Set secrets: `VELORA_KNOWLEDGE_FILE_WORKER_SECRET` (≥32) and/or `CRON_SECRET`.
4. Enable `VELORA_KNOWLEDGE_FILE_WORKER_ENABLED=true`; keep `VELORA_KNOWLEDGE_FILE_WORKER_PROVIDER_EXTRACT=false` until Gemini/PDF policy approved.
5. Add Pro Cron schedule; verify one tick observation `IDLE`/`COMPLETE`.
6. Separate: settle review of old attempt `1113b1ef-…` (does not block this file path).

## Auth / gates

Gates default **off** in repo examples. No production SQL in this package run.
