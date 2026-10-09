# C1 isolated verification

All helpers target only `velora-c1-security-a5b8d14`, label `velora.task=c1-security-foundation`, network `none`, data tmpfs `/var/lib/postgresql/data`, no published ports or persistent mounts. Create that disposable local Supabase PostgreSQL container with a generated local password; never supply cloud/customer secrets. Never point these fixtures at a production database. The `supabase_admin` SQL role supplies synthetic setup; application accounting runs as `service_role`.

The existing Billing runner rebuilds only its own `billing_acceptance` database. The existing WhatsApp runner rebuilds only its own `whatsapp_integration` database. Do not run another suite against a database while its bootstrap or singleton-budget concurrency fixtures are running. The two different databases can be verified independently.

From this worktree:

```powershell
node scripts/billing-acceptance/run-postgres.mjs
node scripts/security-foundation/billing-immutability-cases.mjs
node scripts/security-foundation/billing-races.mjs
node scripts/whatsapp-integration/run.mjs --legacy-preflight
node scripts/security-foundation/ai-security.mjs
node scripts/security-foundation/ai-concurrency.mjs
```

Then run opt-in application cases with all real provider keys absent:

```powershell
$env:BILLING_ACCEPTANCE_POSTGRES_TESTS='1'
npx vitest run src/lib/billing/wiring/acceptance-postgres-app.test.ts
$env:C1_SECURITY_POSTGRES_TESTS='1'
npx vitest run src/lib/answers/runtime/security-postgres-app.test.ts
$env:WHATSAPP_INTEGRATION_POSTGRES_TESTS='1'
npx vitest run src/lib/whatsapp/integration-postgres-app.test.ts
```

Admin concurrency uses privileged test-only setup and restores the synthetic singleton in `finally`; it never runs models. Its assertions require actual PostgreSQL locks before release. New Billing races hold one real transaction open until the second backend is observed waiting, and preserve paid history for both refund/renewal orderings. Provider transports and Auth/session lookup boundaries are labelled mocks; project SQL/RLS/Vault are real. Historical migration files and cloud state are never modified by these scripts.
