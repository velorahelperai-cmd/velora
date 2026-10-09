# Local PostgreSQL security acceptance

This harness executes actual checked-in Billing migrations and functions on
PostgreSQL 17 in the **task-only** `velora-p1p2-acceptance-485d21e` container.
It refuses any container without the matching task label, network isolation and
tmpfs data directory. It uses no cloud URL, secret, provider call or backup.

Minimal Auth, company and membership dependencies are synthetic test stubs in
`supabase-dependency-stubs.sql`. They do **not** prove production Supabase Auth,
session policies, cloud migration parity, or external Paymob compatibility.
Billing SQL, permissions, constraints, triggers and RPC implementations come
directly from source migrations, without rewritten settlement substitutes.

Run these commands from this review worktree, **serially**:

```powershell
node scripts/billing-acceptance/run-postgres.mjs --baseline
node scripts/billing-acceptance/run-postgres.mjs
```

After the corrected runner finishes, execute the application integration tests
against that same isolated database. Do not reset it concurrently:

```powershell
$env:BILLING_ACCEPTANCE_POSTGRES_TESTS='1'
npx vitest run src/lib/billing/wiring/acceptance-postgres-app.test.ts --reporter=verbose
Remove-Item Env:BILLING_ACCEPTANCE_POSTGRES_TESTS
```

These tests invoke the real Next.js webhook POST, HMAC verifier, persistence,
settlement RPC and owner subscription reader. A bounded test adapter executes
SQL under `service_role`; Supabase HTTP transport and access context are stubs.
Synthetic Live approval tests a code branch without approving a real policy.

For a later rerun after this task's container has been removed, create only the
following dedicated ephemeral instance (never reuse an existing project DB):

```powershell
docker run -d --name velora-p1p2-acceptance-485d21e --label velora.task=p1-p2-security-acceptance --network none --tmpfs /var/lib/postgresql/data:rw --env POSTGRES_HOST_AUTH_METHOD=trust --env PGDATA=/var/lib/postgresql/data supabase/postgres:17.6.1.136 postgres -D /var/lib/postgresql/data
docker exec -u postgres velora-p1p2-acceptance-485d21e pg_isready
```

Wait for local readiness before invoking the runner. No port is published and no
persistent volume is mounted. Trust authentication is confined to this network-
disabled synthetic database; it is never production configuration.

The baseline intentionally proves legacy subscriptions are incorrectly labelled
Live and unsigned reversal evidence is accepted. The corrected run inserts
existing records before the historical P1 migration, applies forward corrections,
and checks the financial history remains intact.

The post-P1 fixture executes the actual historical reversal helper before the
forward corrections. It verifies newer paid entitlement survives the old helper's
recorded truncation while manual, past-due and company-security suspensions remain
in force. Source-only refund flags would not exercise this migration behavior.

Concurrency tests run independent `psql` processes and PostgreSQL backend PIDs.
They require an actual `pg_stat_activity` lock wait before releasing the competing
transaction. A JavaScript promise alone is never accepted as concurrency proof.
All waits have finite bounds and statement timeouts.

If a PostgreSQL daemon or multiple sessions are unavailable, mark these tests
**NOT RUN**. Never substitute PGlite for the concurrency evidence.

The runner resets only `billing_acceptance` in the task's verified ephemeral
container. Do not run another suite against that database while bootstrap is
active. Use no existing project container or database. Container cleanup must
target this exact name after checking its label; no unrelated resources are
stopped, removed, or modified.
