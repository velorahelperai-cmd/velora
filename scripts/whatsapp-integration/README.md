# Isolated P3/P4 acceptance

All records, collections, phone identifiers, provider usage and keys in this harness
are synthetic. It connects only through docker exec to the task-labelled,
network-disabled tmpfs PostgreSQL container. There is no cloud connection or dump.
The harness refuses another container. Auth/Storage infrastructure is explicitly
stubbed; the actual public/private project schema and SQL functions are executed.
The historical platform-owner data migration requires a synthetic verified admin
using the address locked in source; no cloud identity or customer record is read.

```powershell
docker run -d --name velora-p3p4-integration-da0bcc8 --label velora.task=p3-p4-safe-integration --network none --tmpfs /var/lib/postgresql/data:rw --env POSTGRES_HOST_AUTH_METHOD=trust --env PGDATA=/var/lib/postgresql/data supabase/postgres:17.6.1.136 postgres -D /var/lib/postgresql/data
docker exec -u postgres velora-p3p4-integration-da0bcc8 pg_isready
node scripts/whatsapp-integration/run.mjs --legacy-preflight
$env:WHATSAPP_INTEGRATION_POSTGRES_TESTS='1'
npx vitest run src/lib/whatsapp/integration-postgres-app.test.ts --reporter=dot
Remove-Item Env:WHATSAPP_INTEGRATION_POSTGRES_TESTS
```

Wait for PostgreSQL readiness before the runner. Run commands **serially**: bootstrap
resets only the verified disposable test DB. `supabase_admin` is the local migration
operator; material tests switch to service_role or authenticated. The source's
authenticator pre-request setting needs this image's local operator privileges.
This does not establish the cloud operator's privileges or ownership parity.

Concurrency uses independent psql processes and backend PIDs, observed Lock waits
and durable row assertions. PGlite and Promise.all alone are never substituted.
Local Vault is installed for a synthetic encryption check; if its server encryption
key is unavailable that check is recorded NOT RUN. It is not counted as a pass.
The application tests use actual production worker/store/P3 execution plus SQL,
with Supabase HTTP transport, provider calls and Vault transport credentials as
explicit test seams. They do not certify Meta delivery or real model availability.

Remove only this exact container after verifying its task label. No persistent
volume, port, backup or unrelated container is created or removed.
