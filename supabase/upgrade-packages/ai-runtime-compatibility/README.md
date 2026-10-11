# Additive AI runtime compatibility — review package

Status: local and isolated PostgreSQL only. No production application, provider call, payment, or customer activation is part of this package. Customer runtime and provider switches remain closed in application code.

## Exact scope and installation order

1. `10-accounting.review.sql`: adds canonical nullable worker/evidence columns and constraints to `ai_usage_ledger`, immutable execution binding, validated usage/cost helpers, missing `ai_settle_admin_attempt`, and replaces the five existing admin accounting RPCs. Service-role ledger DML stays revoked. Worker reconciliation takes company → job → budget → ledger locks; unknown cost keeps its original hold. Existing admin lifetime limit and accounting rows are retained.
2. `20-budget-binding.review.sql`: adds a private RLS-protected immutable plan-version budget policy table, a Muscat monthly-period helper, nullable subscription/version bindings on budget accounts, and binding constraints/triggers. Replaces the company/month uniqueness index with separate historical-unbound and bound-version indexes. Historical unbound rows remain; they fail closed for new customer reservations. No commercial prices or budget policies are seeded.
3. `30-customer-runtime.review.sql`: installs the exact missing customer dependencies from the canonical worker, Meta policy, profile, capacity/cost, settlement and Noura claimed-job authority contracts. Reuses installed worker locks, service windows, fixed-ack guards, receipt views and service grants. Adds nullable immutable persona/plan fields on usage records and Noura receipt/period/allowance fields on inbound jobs. Replaces the existing inbound-job claim RPC, excluding fixed responses, and installs service-only customer frame/retrieval/reserve/start/settle/stage/send/retry/heartbeat/recovery RPCs. Customer retry and heartbeat reject fixed-response claims before mutation. Monthly budget checks sum every spent/held account for that company/month across subscription versions; an upgrade cannot reset consumption.

`00-baseline-metadata.readonly.sql` inventories the original targeted contracts. `05-package-footprint.readonly.sql` inventories the package functions/relations, bodies, owners, search paths, ACLs, columns, indexes, constraints and triggers. `07-policy-column-acl.readonly.sql` additionally freezes RLS policy commands, permissiveness, roles, USING/WITH CHECK predicates and column grants; every phase checks its permission fingerprint before and after mutation. Every write phase has exact preflight and postflight fingerprints inside its transaction, bounded lock/statement timeouts and a transactional PostgREST schema reload. Replay, unexpected ownership/ACL/body drift or partial installs fail closed. Fully qualified receipt-view fingerprints were verified read-only against production under the explicit empty search path; no receipt guards were relaxed.

## Permission delta requiring action-time review

The only new browser-callable capability is `public.billing_bind_ai_budget_draft(uuid,numeric,bigint)`, EXECUTE granted to `authenticated`, denied to PUBLIC/anon/service_role. It requires a confirmed active platform owner and current app session after catalog/version lock waits, a draft unpurchased version, exact catalog revision, and a finite positive whole-baisa cap. The cap is immutable; an identical request is idempotent. Configuration is not tenant activation. There is no client/table access to private budget policies.

All new customer runtime RPCs are service-only and retain tenant/job/lease/generation, exact paid financial receipt, active Noura grant, approved knowledge, and allowance guards. Private implementations are not browser callable. No new roles, credentials, provider secrets, merchant payment configuration, production data seeds, RLS bypass access, or blanket grants are requested.

## Recovery and preservation

A failure before COMMIT rolls back the entire phase, including renames, columns and ACL changes; this was exercised with deliberately mismatched postflight fingerprints for phases 20 and 30. If an earlier phase committed, stop at that checkpoint. Its postflight must equal the next phase preflight before continuing. Never replay a completed phase or apply the full historical migration directory.

After a committed compatibility install, keep customer/provider activation closed and prefer a reviewed forward repair. Do not drop columns, tables, policies, receipt history or budget accounts, and do not reset counters. If access must be withdrawn, a separate narrowly reviewed recovery can revoke only the new owner configuration and new customer RPC EXECUTE grants; baseline admin accounting and fixed-ack functions stay intact. No destructive down migration is included. Unknown costs continue to require evidence-bound reconciliation against their original budget, including after revocation/expiry.

Existing unbound customer budget history requires case-by-case review; there is no bulk rebinding or re-preparation. The installer does not configure any budget amounts, publish catalog variants, activate a tenant or dispatch a message.

## Reproducible verification

Use a schema-only disposable `supabase/postgres:17.6.1.136` isolate with database `ai_compatibility`, container name `velora-ai-compat-<8 hex>`, label `velora.task=ai-compatibility`, network `none`, no ports, logging `none`, and tmpfs-only mounts. Import role definitions without passwords and set database ownership to postgres. Do not copy customer data or attach to existing application containers. Apply only the three guarded phase files in order. Synthetic fixture helpers are test-only and never included in cloud SQL.

Provide `AI_COMPAT_ISOLATE_RECEIPT` with a JSON path containing the validated container/database identity. The harness verifies all isolation properties and has no automatic migration/bootstrap or production connection fallback.

```powershell
node scripts/ai-runtime-compatibility/verify-installed.mjs
node node_modules/vitest/vitest.mjs run --config scripts/ai-runtime-compatibility/vitest.optin.config.mjs
```

The administrative tests need a synthetic confirmed active platform owner and an admin_test account in the disposable database. The customer fixtures create only synthetic tenants, signed Meta fixture evidence and synthetic receipts. No provider is contacted. PostgreSQL tests establish authorization/accounting behavior, not live customer response acceptance.

## Next production path

Review this frozen package and the new owner configuration permission at action time; apply exact phases only after approval and fresh metadata match. Then explicitly configure approved draft plan budgets and service catalog, prove actual live payment collection/tenant entitlement, adopt a scoped provider execution path, and activate an authorized tenant. Existing Live payment adapter restrictions and customer/provider hard-off switches still need separate implementation/rollout. An independently approved one-request Gemini Free-tier synthetic smoke test additionally requires confirmed Free-tier project/model eligibility and secure credential access; it must have zero paid fallback and cannot authorize all-company answering.
