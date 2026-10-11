# Isolated staff invitation PostgreSQL verification

These tests use native PostgreSQL 17.6 in a disposable Docker container. They refuse a container with a different image/task label, networking, ports, logs, or host mounts. Each script creates a randomly named database and drops it in `finally`. No environment credentials, Supabase targets, real Auth users, providers, or customer data are used.

Start the dedicated container once:

```sh
docker run -d --name velora-staff-invitations-local --label velora.task=staff-invitations --network none --log-driver none --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=256m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17.6-alpine
```

After PostgreSQL is ready, run from the repository root:

```sh
node scripts/staff-invitations/baseline.mjs
node scripts/staff-invitations/cases.mjs
```

`baseline.mjs` installs the original session/invitation migrations and asserts the known defect: two simultaneously valid links for one recipient/company. It does not assert that the new migration is defective.

`cases.mjs` installs that same baseline, creates explicit duplicate and accepted legacy records, exercises a transactional install rollback, and applies the recovery migration. It verifies containment and explicit legacy repair, canonical operation replay, truthful lost-token response, authorization and tenant boundaries, accepted history/grant preservation, and audit failure rollback. Race tests use separate PostgreSQL sessions, retain the first RPC's transaction locks, and confirm the competing backend has a real lock wait before releasing the first transaction. It checks that new accepted membership advances the production G03 input epoch exactly once, an audit failure restores that epoch, and retries leave it unchanged. A transaction temporarily revokes mutation/acceptance/preview execution, proves calls fail, and rolls back to the original grants and unchanged history; replay still works afterward.

The fixtures define only the relevant synthetic `auth.users`, `auth.sessions`, company, grant and audit dependencies. Membership columns, checks, foreign-key behavior and indexes match `20261004070000_vel005a_companies.sql`. `private.write_admin_audit` copies the exact production migration body. The harness extracts and executes the exact `private.g03_company_inputs` table, `private.g03_bump_inputs()` function and `g03_owner_input_epoch` membership trigger from `supabase/migrations/20261009215520_g03_verified_review.sql` using unique fixed source markers, failing closed if those markers change. It does not install unrelated G03 setup-review features. Native Auth/session helpers come from the existing session migration; JWT claims are synthetic test settings. This verifies the SQL contract and locking behavior, not a running PostgREST/Supabase Auth deployment, full production schema drift, real delivery, seat policy, or browser behavior.

Remove only this verified local task container after verification:

```sh
docker rm -f velora-staff-invitations-local
```
