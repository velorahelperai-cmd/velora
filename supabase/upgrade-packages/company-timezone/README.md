# Company timezone compatibility prerequisite

Local review candidate; production installation waits for independent review and cumulative restore/recovery gates.

The captured production schema lacks `companies.timezone`, while Stage2B's exact guard and the inbox reader require it. Apply this narrow package before Stage2B. It adds only the nullable text column, the canonical format CHECK and its comment from `20261006140000_vel_leads_journey_01.sql`; it does not replay that migration's lead changes. Existing and new companies retain NULL until deliberate configuration. No timezone is inferred from country. The reader validates IANA names with Intl and announces UTC for absent or invalid values.

The package pins original company columns, constraints, indexes, triggers, RLS, policies, owner and ACL before and after the addition. It has bounded transaction/lock timeouts and refuses an already or partially installed target; stop and inspect such a state. It contains no backfill or access change. Stage2B and every existing frozen package remain unchanged.

Opt-in material acceptance: set `VELORA_TIMEZONE_RESTORE_RECEIPT` to the explicitly selected verified isolated restore receipt outside Git and `VELORA_TIMEZONE_APPLY=1`, then run `node scripts/company-timezone/acceptance.mjs`. The test permits only the labelled, portless, network-none, tmpfs restore container; it verifies all original synthetic company fields, NULL defaults, canonical shape rejection, deliberate configuration and reapply refusal. No cloud or provider call occurs.
