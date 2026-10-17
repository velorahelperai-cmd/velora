/**
 * RELEASE-CAPABILITY-ACL-SEMANTIC-C5 — real-PG acceptance probe for semantic ACL contract.
 * Caller installs the full exact package in isolated PG, then supplies { sql }.
 * Reads the actual final private.vel_broker_capability_contract_matches() (no mocks/stubs/skip).
 * Every scenario: own BEGIN + set local role postgres + work + ROLLBACK in the same sql string.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fragmentPath = join(
  root,
  "supabase/upgrade-packages/es02-hosted-compat/fragments/04-capability-acl-semantic.sql",
);

const REVOKE_SIG = "public.vel_broker_revoke_sessions_at(uuid,text,timestamp with time zone)";
const TABLE_SESSIONS = "public.vel_broker_sessions";
const TABLE_ADMISSION = "public.vel_broker_admission";

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
    throw new Error(`ES02_CAP_ACL_PROBE: expected JSON row, got ${text.slice(0, 200)}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

async function txn(sql, body) {
  return sql(`begin;\nset local role postgres;\n${body}\nrollback;`);
}

/**
 * @param {{ sql: (text: string) => Promise<unknown> }} input
 * @returns {Promise<{ ok: boolean, results: Array<Record<string, unknown>> }>}
 */
export async function verifyCapabilityAclSemantics({ sql }) {
  if (!sql || typeof sql !== "function") {
    throw new Error("ES02_CAP_ACL_PROBE: owned real sql executor required");
  }
  // Fragment path pin for Codex; contract under test is the installed DB function.
  readFileSync(fragmentPath, "utf8");

  const results = [];

  async function readContract(ddl = "") {
    let error = null;
    let matched = null;
    try {
      const raw = await txn(
        sql,
        `${ddl}
select jsonb_build_object(
  'ok', private.vel_broker_capability_contract_matches(),
  'probe_ok', coalesce((public.vel_broker_capability_probe()->>'ok')::boolean, false)
) as v;`,
      );
      matched = parseJsonRow(raw);
    } catch (e) {
      error = redact(e?.message ?? e);
      try {
        await sql("rollback;");
      } catch {
        /* aborted txn cleanup best-effort */
      }
    }
    return { matched, error };
  }

  async function expectPass(name, ddl = "") {
    const { matched, error } = await readContract(ddl);
    results.push({
      name,
      pass: !error && matched?.ok === true && matched?.probe_ok === true,
      contractOk: matched?.ok ?? null,
      probeOk: matched?.probe_ok ?? null,
      error,
    });
  }

  async function expectReject(name, ddl) {
    const { matched, error } = await readContract(ddl);
    // Negatives must demonstrate contract false, not count unrelated SQL errors.
    results.push({
      name,
      pass: !error && matched?.ok === false,
      contractOk: matched?.ok ?? null,
      probeOk: matched?.probe_ok ?? null,
      error,
      note: !error && matched?.ok === false
        ? "contract_false"
        : error
          ? "sql_error_not_contract_false"
          : "contract_still_true",
    });
  }

  await expectPass("baseline_full_contract_passes");

  await expectPass(
    "fn_acl_order_service_then_auth_passes",
    `revoke all on function ${REVOKE_SIG} from authenticated, service_role;
grant execute on function ${REVOKE_SIG} to service_role;
grant execute on function ${REVOKE_SIG} to authenticated;`,
  );
  await expectPass(
    "fn_acl_order_auth_then_service_passes",
    `revoke all on function ${REVOKE_SIG} from authenticated, service_role;
grant execute on function ${REVOKE_SIG} to authenticated;
grant execute on function ${REVOKE_SIG} to service_role;`,
  );

  await expectPass(
    "table_acl_entry_and_privilege_order_passes",
    `revoke all on table ${TABLE_SESSIONS} from postgres, service_role;
grant delete, update, insert, select on table ${TABLE_SESSIONS} to service_role;
grant all on table ${TABLE_SESSIONS} to postgres;`,
  );

  await expectReject(
    "negative_fn_extra_anon_execute_rejects",
    `grant execute on function ${REVOKE_SIG} to anon;`,
  );
  await expectReject(
    "negative_fn_missing_auth_execute_rejects",
    `revoke all on function ${REVOKE_SIG} from authenticated;`,
  );
  await expectReject(
    "negative_fn_auth_with_grant_option_rejects",
    `grant execute on function ${REVOKE_SIG} to authenticated with grant option;`,
  );

  await expectReject(
    "negative_table_extra_anon_select_rejects",
    `grant select on table ${TABLE_SESSIONS} to anon;`,
  );
  await expectReject(
    "negative_table_missing_service_select_rejects",
    `revoke select on table ${TABLE_ADMISSION} from service_role;`,
  );
  await expectReject(
    "negative_table_service_with_grant_option_rejects",
    `grant select on table ${TABLE_SESSIONS} to service_role with grant option;`,
  );

  // Grantor mismatch via typed literal ACL (cannot assign a foreign grantor without extra authority).
  {
    let error = null;
    let data = null;
    try {
      const raw = await txn(
        sql,
        `select jsonb_build_object(
  'grantor_mismatch_detected', exists (
    select 1 from (
      select a.grantee, a.grantor, a.privilege_type, a.is_grantable
      from aclexplode('{postgres=X/postgres}'::aclitem[]) a
      except
      select e.grantee, e.grantor, e.privilege_type, e.is_grantable
      from aclexplode('{postgres=X/authenticated}'::aclitem[]) e
    ) d
  ),
  'same_members_reordered_equivalent', (
    not exists (
      select 1 from (
        select a.grantee, a.grantor, a.privilege_type, a.is_grantable
        from aclexplode('{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]) a
        except
        select e.grantee, e.grantor, e.privilege_type, e.is_grantable
        from aclexplode('{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}'::aclitem[]) e
      ) d
    )
    and not exists (
      select 1 from (
        select e.grantee, e.grantor, e.privilege_type, e.is_grantable
        from aclexplode('{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}'::aclitem[]) e
        except
        select a.grantee, a.grantor, a.privilege_type, a.is_grantable
        from aclexplode('{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]) a
      ) d2
    )
  ),
  'mode', 'typed_literal_acl_not_live_grantor_assign'
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
      name: "grantor_mismatch_typed_literal_rejects_equivalence",
      pass:
        !error &&
        data?.grantor_mismatch_detected === true &&
        data?.same_members_reordered_equivalent === true,
      data,
      error,
      note: "typed_literal_acl_semantic_expression",
    });
  }

  // Inherited extra authority: temporary membership; RESET ROLE then fixture admin postgres.
  await expectReject(
    "negative_inherited_service_membership_rejects",
    `reset role;
grant service_role to authenticated;
set local role postgres;`,
  );

  await expectReject(
    "negative_body_hash_mutation_rejects",
    `create or replace function public.vel_broker_revoke_sessions_at(p_expected_user_id uuid,p_operation_key text,p_cutoff timestamptz)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $mut$ select false $mut$;
alter function ${REVOKE_SIG} owner to postgres;
revoke all on function ${REVOKE_SIG} from public, anon;
grant execute on function ${REVOKE_SIG} to authenticated, service_role;`,
  );

  const ok = results.every((row) => row.pass === true);
  return {
    ok,
    fragmentPath: fragmentPath.replaceAll("\\", "/"),
    results,
  };
}
