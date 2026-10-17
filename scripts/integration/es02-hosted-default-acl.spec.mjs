/**
 * RELEASE-HOSTED-ACL-C4 — real-PG acceptance probe for owned RPC EXECUTE boundary.
 * Reads the package fragment and the exact unchanged C3 DO guard from the repo.
 * Caller supplies { sql } as the owned real executor (no startup/env/Git/provider/mocks).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fragmentPath = join(
  root,
  "supabase/upgrade-packages/es02-hosted-compat/fragments/03-owned-rpc-execute-boundary.sql",
);
const c3Path = join(root, "supabase/migrations/20261017150000_es02_c3_exact_client_op_unique.sql");

const CREATE_SIG = "public.es02_create_account_order(uuid,uuid,text,jsonb,boolean)";
const OWNED = Object.freeze([
  {
    name: "es02_create_account_order",
    sig: CREATE_SIG,
    stub: `create function public.es02_create_account_order(p_expected_account_id uuid, p_client_op_id uuid, p_persona text, p_offer jsonb, p_confirm_terms boolean) returns jsonb language sql security definer set search_path = '' as $$ select '{}'::jsonb $$;`,
  },
  {
    name: "es02_read_owned_purchase",
    sig: "public.es02_read_owned_purchase(uuid)",
    stub: `create function public.es02_read_owned_purchase(p_expected_account_id uuid) returns jsonb language sql security definer set search_path = '' as $$ select '{}'::jsonb $$;`,
  },
  {
    name: "es02_provision_owned_purchase",
    sig: "public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)",
    stub: `create function public.es02_provision_owned_purchase(p_expected_account_id uuid, p_order_group_id uuid, p_company_id uuid, p_branches jsonb, p_offer jsonb) returns jsonb language sql security definer set search_path = '' as $$ select '{}'::jsonb $$;`,
  },
  {
    name: "es02_read_activation_foundation",
    sig: "public.es02_read_activation_foundation(uuid,uuid)",
    stub: `create function public.es02_read_activation_foundation(p_expected_account_id uuid, p_company_id uuid) returns jsonb language sql security definer set search_path = '' as $$ select '{}'::jsonb $$;`,
  },
  {
    name: "es02_reconcile_activation_readiness",
    sig: "public.es02_reconcile_activation_readiness(uuid,uuid)",
    stub: `create function public.es02_reconcile_activation_readiness(p_expected_account_id uuid, p_company_id uuid) returns jsonb language sql security definer set search_path = '' as $$ select '{}'::jsonb $$;`,
  },
]);

const HOSTED_DEFAULTS =
  "alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;";

function loadUnchangedC3Guard() {
  const source = readFileSync(c3Path, "utf8");
  const marker = source.indexOf("-- Signature drift guard:");
  const start = source.indexOf("do $$", marker);
  const end = source.indexOf("$$;", start);
  if (marker < 0 || start < 0 || end <= start) {
    throw new Error("ES02_ACL_PROBE: unchanged C3 signature drift guard not found");
  }
  return source.slice(start, end + 3);
}

function createAllStubs() {
  return OWNED.map((row) => row.stub).join("\n");
}

function oldAclAll() {
  return OWNED.map(
    (row) =>
      `revoke all on function ${row.sig} from public, anon; grant execute on function ${row.sig} to authenticated;`,
  ).join("\n");
}

function privilegesSql(sig) {
  return `select jsonb_build_object(
    'sig', ${literal(sig)},
    'typed_oid_found', p.oid is not null,
    'result', pg_get_function_result(p.oid),
    'owner', pg_get_userbyid(p.proowner),
    'definer', p.prosecdef,
    'config', p.proconfig,
    'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
    'service', has_function_privilege('service_role', p.oid, 'EXECUTE'),
    'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    'public_exec', exists (
      select 1
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE'
    )
  )
  from (select to_regprocedure(${literal(sig)}) as oid) t
  left join pg_proc p on p.oid = t.oid;`;
}

function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function parseJsonRow(raw) {
  const text = String(raw ?? "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`ES02_ACL_PROBE: expected JSON row, got ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1));
}

function redact(message) {
  return String(message ?? "")
    .replace(/postgresql:\/\/[^\s]+/gi, "postgresql://[REDACTED]")
    .replace(/ghp_[A-Za-z0-9]+/g, "[REDACTED]");
}

async function txn(sql, body) {
  return sql(`begin;\nset local role postgres;\n${body}\nrollback;`);
}

/**
 * @param {{ sql: (text: string) => Promise<unknown> }} input
 * @returns {Promise<{ ok: boolean, results: Array<Record<string, unknown>> }>}
 */
export async function verifyHostedOwnedRpcAcl({ sql }) {
  if (!sql || typeof sql !== "function") {
    throw new Error("ES02_ACL_PROBE: owned real sql executor required");
  }
  const fragment = readFileSync(fragmentPath, "utf8");
  const guard = loadUnchangedC3Guard();
  const results = [];

  async function expectGuard(name, ddl, reject) {
    let error = null;
    try {
      await txn(sql, `${ddl}\n${guard}`);
    } catch (e) {
      error = redact(e?.message ?? e);
    }
    const rejected = Boolean(error);
    const footprint = error ? /ES02_C3_FOOTPRINT:\s*es02_create_account_order signature drift/.test(error) : false;
    const pass = rejected === reject && (!rejected || footprint);
    results.push({
      name,
      pass,
      rejected,
      expectedReject: reject,
      footprintMatch: rejected ? footprint : null,
      error,
    });
    return { rejected, error, pass };
  }

  async function observePrivileges(name, ddl) {
    const rows = [];
    for (const row of OWNED) {
      const raw = await txn(sql, `${ddl}\n${privilegesSql(row.sig)}`);
      rows.push(parseJsonRow(raw));
    }
    results.push({ name, pass: true, data: rows });
    return rows;
  }

  const hostedOld = `${HOSTED_DEFAULTS}\n${createAllStubs()}\n${oldAclAll()}`;
  const hostedFixed = `${HOSTED_DEFAULTS}\n${createAllStubs()}\n${fragment}`;

  const oldPrivs = await observePrivileges("hosted_default_old_acl_privilege_matrix", hostedOld);
  const createOld = oldPrivs.find((r) => r.sig === CREATE_SIG);
  results.push({
    name: "hosted_default_old_acl_leaves_service_true",
    pass: Boolean(createOld?.typed_oid_found && createOld.authenticated === true && createOld.service === true && createOld.anon === false),
    data: createOld ?? null,
  });

  await expectGuard("hosted_default_old_acl_guard_rejects", hostedOld, true);

  const fixedPrivs = await observePrivileges("actual_fragment_privilege_matrix", hostedFixed);
  const allAuthOnly = fixedPrivs.every(
    (r) =>
      r.typed_oid_found === true &&
      r.authenticated === true &&
      r.anon === false &&
      r.service === false &&
      r.public_exec === false &&
      r.result === "jsonb" &&
      r.owner === "postgres" &&
      r.definer === true &&
      Array.isArray(r.config) &&
      r.config.includes('search_path=""'),
  );
  results.push({
    name: "actual_fragment_all5_auth_only",
    pass: allAuthOnly && fixedPrivs.length === OWNED.length,
    data: fixedPrivs,
  });

  await expectGuard("actual_fragment_unchanged_c3_guard_passes", hostedFixed, false);

  const base = hostedFixed;
  await expectGuard("negative_missing_signature", `${base}\ndrop function ${CREATE_SIG};`, true);
  await expectGuard(
    "negative_wrong_owner",
    `${base}
reset role;
alter function ${CREATE_SIG} owner to supabase_admin;
set local role postgres;`,
    true,
  );
  await expectGuard("negative_wrong_definer", `${base}\nalter function ${CREATE_SIG} security invoker;`, true);
  await expectGuard("negative_wrong_search_path", `${base}\nalter function ${CREATE_SIG} set search_path = public;`, true);
  await expectGuard("negative_anon_grant", `${base}\ngrant execute on function ${CREATE_SIG} to anon;`, true);
  await expectGuard("negative_service_grant", `${base}\ngrant execute on function ${CREATE_SIG} to service_role;`, true);
  await expectGuard(
    "negative_authenticated_revocation",
    `${base}\nrevoke all on function ${CREATE_SIG} from authenticated;`,
    true,
  );

  const createTextStub = OWNED[0].stub
    .replace("returns jsonb", "returns text")
    .replace("'{}'::jsonb", "'fixture'::text");
  await expectGuard(
    "negative_wrong_result",
    `${HOSTED_DEFAULTS}\n${createTextStub}\n${OWNED.slice(1)
      .map((r) => r.stub)
      .join("\n")}\n${fragment}`,
    true,
  );

  // Wrong arg type: correct typed OID is absent so unchanged C3 guard rejects (fragment not applied).
  const wrongArgSig = "public.es02_create_account_order(uuid,uuid,text,json,boolean)";
  const wrongArgStub = `create function public.es02_create_account_order(p_expected_account_id uuid, p_client_op_id uuid, p_persona text, p_offer json, p_confirm_terms boolean) returns jsonb language sql security definer set search_path = '' as $$ select '{}'::jsonb $$;
revoke all on function ${wrongArgSig} from public, anon, service_role;
grant execute on function ${wrongArgSig} to authenticated;`;
  await expectGuard(
    "negative_wrong_argument_type",
    `${HOSTED_DEFAULTS}\n${wrongArgStub}\n${OWNED.slice(1)
      .map((r) => r.stub)
      .join("\n")}\n${OWNED.slice(1)
      .map(
        (r) =>
          `revoke all on function ${r.sig} from public, anon, service_role; grant execute on function ${r.sig} to authenticated;`,
      )
      .join("\n")}`,
    true,
  );

  const ok = results.every((row) => row.pass === true);
  return {
    ok,
    fragmentPath: fragmentPath.replaceAll("\\", "/"),
    c3GuardPath: c3Path.replaceAll("\\", "/"),
    ownedCount: OWNED.length,
    results,
  };
}
