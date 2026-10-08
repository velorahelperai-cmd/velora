# Real AI runtime verification — 2026-10-08 (Asia/Muscat)

User authorized actual administrative trials with a separately enforced lifetime total cap of 1 OMR. Customer AI and WhatsApp remain disabled.

## Implemented

- Reusable server runtime, real provider transport, per-attempt atomic reservation and durable settlement in Supabase.
- Administrative lifetime budget is 1,000 baisa. Company-live budgets use separate monthly accounts and are not enabled by this work.
- Explicit verified-owner/session/company checks before reservation and provider dispatch; browser roles cannot reserve, settle, reconcile, or raise limits.
- Each retry/fallback must reserve its own worst-case cost. SDK retries are disabled. Uncertain executions keep held funds and do not retry automatically.
- Evidence-backed reconciliation is service-only, uses budget-first locking, and accounts exactly once. It is not an automatic budget reset.
- OpenAI Responses API output limit 512 includes reasoning; Gemini Interactions uses low thinking and output limit 512, with a conservative full model output-window reservation.
- Provider IDs are retained even if usage parsing fails. Cost does not zero out micro-requests and OpenAI reasoning is not billed twice.
- Independent owner console at /admin/ai shows actual database balance, actual attempt results and stored history. No fabricated ten-company revenue figures are used in this console.
- Permanent production-delivery priority recorded in AGENTS.md.

## Live connection results

| Model | Result | USD | Baisa | Notes |
|---|---|---|---|---|
| gpt-6-luna | success | 0.000032 | 0.012304 | Actual text: تم استلامها; 280 input / 8 output tokens |
| gpt-6.1-sol | success | 0.000610 | 0.234544 | Actual text: تم; 280 input / 5 output tokens |
| gemini-3.8-flash | provider HTTP 503 | unknown | unknown | Google reported high demand; no retry; 114.596702 baisa remains held pending provider reconciliation |

Database confirmed spent 0.246848 baisa, held 114.596702 baisa, available 885.156450 baisa. Held funds are not reported as actual billed spend. Google generation availability has not been proven by this failed request.

## Verification

- Local TypeScript and affected-file ESLint passed.
- Runtime tests: 13 passed (budget/persistence denial before dispatch, per-fallback reservation, uncertain hold, incomplete usage billing, settlement before delivery, cache writes, reasoning, micro-costs, published rate change, secret redaction).
- PGlite database scenarios passed: concurrent cap, idempotency, settlement, controlled reconciliation, service-only mutation and expired-owner denial.
- Local production build passed (32 routes including /admin/ai).
- Supabase migration vel_ai_runtime_foundation applied. Both new tables have RLS and restrictive active-session policies; authenticated cannot execute accounting mutations.
- Fresh reviewer identified reconciliation and lost provider-reference issues; both corrected.
- Existing unrelated database advisors remain; no new AI table/RPC issue was reported. Existing function warnings: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

## Pricing sources

https://developers.openai.com/api/docs/models/gpt-6-luna
https://developers.openai.com/api/docs/models/gpt-6.1-sol
https://ai.google.dev/gemini-api/docs/pricing
https://cbo.gov.om/Pages/FixedPeg.aspx

Only standard text token prices are used; provider usage-derived costs are not a provider invoice. Pricing snapshots and versions are saved with each attempt. Gemini's published 2027 change is handled.

## Migration ordering

The CLI-generated foundation was moved after its already existing 2026-10-08 session/owner dependencies. The un-applied Phase 1 ledger draft is an ordering marker pointing to the real foundation. The original session migration also includes the read-only hook correction so a future migration replay does not reintroduce error 25006.

## Published

Vercel deployment dpl_2z3Ls9mQe1KpVDXoRVRniqd1VW1H reached READY and was aliased to https://www.velorahelper.com. /admin/ai requires sign-in; production anonymous redirect and login form passed without JavaScript errors. Production environment has all three required credential variable names. The production owner-console UI was not entered with a real user session by the browser smoke.

The user subsequently instructed no additional paid verification calls. No model calls have been made after the three recorded connectivity attempts.
