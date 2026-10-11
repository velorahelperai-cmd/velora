# Staff invitation recovery: opt-in release preparation

These are reviewed deployment source artifacts, not an installed migration or
permission to execute production SQL. Nothing imports or automatically executes
them. They are outside `supabase/migrations`, seed discovery and application code.
No credentials, customer rows, token values or private recovery files are included.

Target project: `vmpifljyozsbtssxhoxd`. Independently verify the project through the
existing TLS-verified connection before execution; database/operator names and
function fingerprints alone do not identify the project.

Exact SHA256 values:

| Artifact | SHA256 |
| --- | --- |
| `build-invitation-installer.py` | `e4d0780e551887fb4695f76fd4d7b4e3997351ed11439e64eb88629f3ba3f8d5` |
| `installer-transaction.psql.sql` (38,810 bytes) | `1444494ebbfd9458e18bfc9ce7759eed280a1f7550290a9e7309dcfabd79e516` |
| Original reviewed SQL (18,223 bytes) | `2374838776ea6055c32807dbddcca22ee2459563e8946f592e345176de921d83` |

The builder only verifies existing source bytes and writes the deterministic
wrapper. It makes no network/database connection, normalizes no source bytes and
refuses to overwrite a differing output. It runs only when explicitly invoked:

```text
python scripts/release/staff-invitation-recovery/build-invitation-installer.py VERIFIED_SQL_PATH OUTPUT_WRAPPER_PATH
```

Before installation, require exact local hash verification, completed approved
invitation recovery/export and restore-rehearsal evidence, fresh catalog/ACL
review, an exclusive invitation-writer window and separate exact SQL approval.
The existing recovery for other tables does not establish invitation recovery.

The wrapper embeds two unchanged copies of the reviewed SQL: execution and
same-transaction migration-history registration. It requires trusted `postgres`
installation, baseline function pins and absent target objects/version. Its
local limits are 5s lock, 60s per statement and 30s idle in transaction. Only after
the gates above, use the existing verified connection with this invocation:

```text
psql -X --no-password --set=ON_ERROR_STOP=1 --set=ON_ERROR_ROLLBACK=off --single-transaction --file=scripts/release/staff-invitation-recovery/installer-transaction.psql.sql
```

Do not use default/local connection settings, execute statements separately,
force locks or apply a second migration-history entry. A lost final commit
response requires read-only catalog/history reconciliation before any retry.

Installation marks every unaccepted invitation in a duplicate company/email
group as `legacy_duplicate`, including expired invitations. It preserves original
rows, columns and token hashes; it deletes nothing and selects no winning row.
The new mutation retains inherited `service_role` EXECUTE and enforces native
actor/session and current company-owner checks; it is not authenticated-role-only.
The legacy creator becomes `UPGRADE_REQUIRED` during the SQL-first release window.
These data and ACL effects remain part of the separate installation approval.

Failure before commit rolls back schema, classification, ACLs and history
together. After commit, preserve rows/history and obtain separate containment or
forward-repair approval; do not reopen the legacy creator. This packet is not a
verified disaster-recovery mechanism. Verify installed catalog/ACL/history before
publishing invitation product changes, then perform separately approved live
acceptance. This source-only commit changes no product flags or billing rules.
