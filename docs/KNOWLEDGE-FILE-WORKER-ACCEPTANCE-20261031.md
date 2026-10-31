# Knowledge file worker — acceptance receipt (2026-10-31)

## Verdict

**LOCAL_PASS — publish decision pending.**  
Disposable real-chain + packages **10/11** + local txt `/setup`-equivalent journey **PASS**.  
Hosted TAG CITY `/setup`, production SQL, Pro Cron, and provider extract remain **NOT_RUN / off**.

## Evidence

| Item | Result |
|---|---|
| Status | `PASS_ISOLATED_REAL_CHAIN` |
| Evidence file | `supabase/upgrade-packages/knowledge-file-worker/native-acceptance.evidence.json` |
| Paymob predecessor | SHA `82d353e4…` from `paymob-live-checkout/20-production-compatibility.review.sql` (no payment calls) |
| Migrations applied | **171** through `20261028171327_es02_branch_knowledge_mutations.sql` |
| Binding table | Real `private.es02_branch_knowledge_sources` |
| Packages **10 / 11** | `PASS_ON_REAL_CHAIN` (claim/replay/BUSY/branch deny/expired publish/recover/REVIEW_REQUIRED/list/anon ACL) |
| Setup journey | Upload+bind txt → enqueue → local publish → visible content → owner approve → context-eligible → approval cleared on content change |
| Gemini via worker | **false** (local `text/plain` only; not a new provider proof) |
| TAG CITY / TAJSEEM v5 / FAQ 1–8 | **untouched** |
| Hold `25bb9e66…` / 1.877307 baisa / `canAsk=false` | **untouched** |
| Separate blocker | Settlement review of `1113b1ef-…` remains OPEN; does not block this file path |

## Affected unit tests

`src/lib/knowledge/file-worker/*` + file-worker route: **22 PASS**.

## Production remaining (owner decisions)

1. Apply SQL 10→11 on the target hosted DB (after confirming paymob predecessor / chain history there).
2. Deploy app code; set worker secret; enable worker gate; keep provider extract off until approved.
3. Upgrade to **Vercel Pro ($20/mo)** and add Cron `*/5` (or chosen cadence); verify observation ticks.
4. Optional: enable provider extract after cost/privacy approval.
5. Separate: reconcile `1113b1ef-…`.
