# Knowledge file worker — SQL chain acceptance (2026-10-31)

## Runner diagnosis (staff LOCK TABLE)

| Question | Finding |
|---|---|
| Does `20261011160000` require a transaction? | **Yes** — header: “Apply transactionally”; body starts with `LOCK TABLE` (no inner `BEGIN`) |
| Approved applicator | `scripts/staff-invitations/cases.mjs`: `begin;` + body + `commit;`; production installer: `psql --single-transaction` |
| Local kfw defect | `postgres-lf.mjs` previously applied files in **autocommit** → `LOCK TABLE can only be used in transaction blocks` |
| Migration changed? | **No** |
| Fix | Local runner only: transactional apply + `SET LOCAL ROLE postgres`, `supabase_migrations` history, `supabase_vault` (+ pgsodium key + postgres ownership), `cron.database_name=c1_ui_integration`, Auth/DB ownership parity |

## Paymob predecessor (disposable only)

| Field | Value |
|---|---|
| Stop that required it | `20261014033008_master_autorenew_wallet.sql` / `RECURRING_NATIVE_OWNER_DEPENDENCY_REQUIRED` |
| Artifact | Exact `supabase/upgrade-packages/paymob-live-checkout/20-production-compatibility.review.sql` (SHA `82d353e4…`) |
| Also required | Empty `private.ai_plan_budget_policies` slice from `ai-runtime-compatibility/20-budget-binding.review.sql` (FK) |
| Payment / prod secrets | **None** — function + empty relation DDL only |
| Stubs / historical edits | **None** |

## Composition hooks (same as account-deletion full-baseline)

- `20261014080108` → `branchCompatibility()` (enterprise `company_branches` already present)
- `20261014080217` → composition skip after review-family equivalence
- `20261022093000` → `embeddedTrialHistory()` guard only
- ES02 credit LOCAL_ONLY gate → DB name **`c1_ui_integration`** + unix socket (`inet_client_addr` null)

## Packages 10 / 11

Installed and adversarially tested on the real chain through `20261028171327_es02_branch_knowledge_mutations.sql` (real `private.es02_branch_knowledge_sources`). Evidence: `supabase/upgrade-packages/knowledge-file-worker/native-acceptance.evidence.json`.
