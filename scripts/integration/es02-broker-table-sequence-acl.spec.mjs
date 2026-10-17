/**
 * RELEASE-HOSTED-PRIVILEGE-PARITY-C6 — real-PG probe for broker table/sequence ACL boundary.
 * Caller installs the full exact package in isolated PG, then supplies { sql }.
 * Extracts the real final $broker_acl_boundary$ assertion from the fragment (no mocks/stubs/skip).
 * Every scenario: own BEGIN + SET LOCAL ROLE postgres + work + ROLLBACK in the same sql string.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fragmentPath = join(
  root,
  "supabase/upgrade-packages/es02-hosted-compat/fragments/05-broker-table-sequence-acl.sql",
);

const TABLE = "public.vel_broker_sessions";
const SEQ_ORDINAL = "public.vel_broker_auth_intents_ordinal_seq";
const SEQ_ISSUE = "public.vel_broker_browser_issue_seq";
const BOUNDARY_OPEN = "do $broker_acl_boundary$";
const BOUNDARY_CLOSE = "$broker_acl_boundary$;";

function redact(message) {
  return String(message ?? "")
    .replace(/postgresql:\/\/[^\s]+/gi, "postgresql://[REDACTED]")
    .replace(/ghp_[A-Za-z0-9]+/g, "[REDACTED]");
}

function parseJsonRow(raw) {
  const text = String(raw ?? "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error(`ES02_BROKER_ACL_PROBE: expected JSON row, got ${text.slice(0, 200)}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

function loadBoundaryAssert() {
  const source = readFileSync(fragmentPath, "utf8");
  const start = source.indexOf(BOUNDARY_OPEN);
  const end = source.indexOf(BOUNDARY_CLOSE, start);
  if (start < 0 || end <= start) {
    throw new Error("ES02_BROKER_ACL_PROBE: $broker_acl_boundary$ assertion not found in fragment");
  }
  return source.slice(start, end + BOUNDARY_CLOSE.length);
}

async function txn(sql, body) {
  return sql(`begin;\nset local role postgres;\n${body}\nrollback;`);
}

/**
 * @param {{ sql: (text: string) => Promise<unknown> }} input
 * @returns {Promise<{ ok: boolean, results: Array<Record<string, unknown>> }>}
 */
export async function verifyBrokerTableSequenceAcl({ sql }) {
  if (!sql || typeof sql !== "function") {
    throw new Error("ES02_BROKER_ACL_PROBE: owned real sql executor required");
  }
  const boundary = loadBoundaryAssert();
  const results = [];

  async function expectBoundary(name, ddl, reject) {
    let error = null;
    try {
      await txn(sql, `${ddl}\n${boundary}`);
    } catch (e) {
      error = redact(e?.message ?? e);
      try {
        await sql("rollback;");
      } catch {
        /* aborted txn cleanup best-effort */
      }
    }
    const rejected = Boolean(error);
    const brokerAcl = error ? /ES02_BROKER_ACL\b/.test(error) : false;
    const pass = rejected === reject && (!rejected || brokerAcl);
    results.push({
      name,
      pass,
      rejected,
      expectedReject: reject,
      brokerAclMatch: rejected ? brokerAcl : null,
      error,
    });
    return { rejected, error, pass };
  }

  // Positive: installed package boundary (all 8 objects ACL/effective/grant-option).
  await expectBoundary("baseline_eight_object_boundary_passes", "", false);

  // Capability contract + probe unchanged after package install.
  {
    let error = null;
    let data = null;
    try {
      const raw = await txn(
        sql,
        `select jsonb_build_object(
  'ok', private.vel_broker_capability_contract_matches(),
  'probe_ok', coalesce((public.vel_broker_capability_probe()->>'ok')::boolean, false)
) as v;`,
      );
      data = parseJsonRow(raw);
    } catch (e) {
      error = redact(e?.message ?? e);
      try {
        await sql("rollback;");
      } catch {
        /* noop */
      }
    }
    results.push({
      name: "unchanged_capability_contract_and_probe",
      pass: !error && data?.ok === true && data?.probe_ok === true,
      data,
      error,
    });
  }

  // Reordering identical ACL still passes the guard.
  await expectBoundary(
    "table_privilege_reorder_passes",
    `revoke all on table ${TABLE} from service_role;
grant delete, update, insert, select on table ${TABLE} to service_role;`,
    false,
  );

  // Table negatives — must raise ES02_BROKER_ACL (not unrelated SQL errors).
  await expectBoundary(
    "negative_service_truncate_rejects",
    `grant truncate on table ${TABLE} to service_role;`,
    true,
  );
  await expectBoundary(
    "negative_anon_select_rejects",
    `grant select on table ${TABLE} to anon;`,
    true,
  );
  await expectBoundary(
    "negative_missing_service_update_rejects",
    `revoke update on table ${TABLE} from service_role;`,
    true,
  );
  await expectBoundary(
    "negative_service_select_with_grant_option_rejects",
    `grant select on table ${TABLE} to service_role with grant option;`,
    true,
  );

  // C7: acldefault('s') = SEQUENCE SELECT/UPDATE/USAGE; acldefault('S') = FOREIGN SERVER USAGE only.
  {
    let error = null;
    let data = null;
    try {
      const raw = await txn(
        sql,
        `select jsonb_build_object(
  'sequence_s', acldefault('s', (select oid from pg_roles where rolname = 'postgres'))::text,
  'foreign_server_S', acldefault('S', (select oid from pg_roles where rolname = 'postgres'))::text,
  'sequence_privileges', (
    select coalesce(jsonb_agg(a.privilege_type order by a.privilege_type), '[]'::jsonb)
    from aclexplode(acldefault('s', (select oid from pg_roles where rolname = 'postgres'))) a
  ),
  'foreign_server_privileges', (
    select coalesce(jsonb_agg(a.privilege_type order by a.privilege_type), '[]'::jsonb)
    from aclexplode(acldefault('S', (select oid from pg_roles where rolname = 'postgres'))) a
  )
) as v;`,
      );
      data = parseJsonRow(raw);
    } catch (e) {
      error = redact(e?.message ?? e);
      try {
        await sql("rollback;");
      } catch {
        /* noop */
      }
    }
    const seqPrivs = Array.isArray(data?.sequence_privileges) ? [...data.sequence_privileges].sort() : [];
    const fsPrivs = Array.isArray(data?.foreign_server_privileges)
      ? [...data.foreign_server_privileges].sort()
      : [];
    results.push({
      name: "c7_sequence_acldefault_type_is_select_update_usage",
      pass:
        !error &&
        seqPrivs.join(",") === "SELECT,UPDATE,USAGE" &&
        fsPrivs.join(",") === "USAGE" &&
        data?.sequence_s !== data?.foreign_server_S,
      data,
      error,
    });
  }

  // Sequence negatives.
  await expectBoundary(
    "negative_sequence_anon_usage_rejects",
    `grant usage on sequence ${SEQ_ORDINAL} to anon;`,
    true,
  );
  await expectBoundary(
    "negative_sequence_service_update_rejects",
    `grant update on sequence ${SEQ_ISSUE} to service_role;`,
    true,
  );
  await expectBoundary(
    "negative_sequence_auth_select_rejects",
    `grant select on sequence ${SEQ_ORDINAL} to authenticated;`,
    true,
  );

  // C7: removing legitimate owner sequence SELECT or UPDATE must fail the extracted boundary.
  await expectBoundary(
    "negative_owner_sequence_select_removed_rejects",
    `revoke select on sequence ${SEQ_ORDINAL} from postgres;`,
    true,
  );
  await expectBoundary(
    "negative_owner_sequence_update_removed_rejects",
    `revoke update on sequence ${SEQ_ORDINAL} from postgres;`,
    true,
  );

  // Inherited runtime authority — RESET ROLE fixture admin, preserve preexisting memberships.
  await expectBoundary(
    "negative_inherited_service_membership_rejects",
    `reset role;
do $membership$
begin
  if not exists (
    select 1
    from pg_auth_members m
    join pg_roles r on r.oid = m.roleid and r.rolname = 'service_role'
    join pg_roles u on u.oid = m.member and u.rolname = 'authenticated'
  ) then
    execute 'grant service_role to authenticated';
  end if;
end;
$membership$;
set local role postgres;`,
    true,
  );

  const ok = results.every((row) => row.pass === true);
  return {
    ok,
    fragmentPath: fragmentPath.replaceAll("\\", "/"),
    boundaryTag: "broker_acl_boundary",
    objectCount: 8,
    results,
  };
}
