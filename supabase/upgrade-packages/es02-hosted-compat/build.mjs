/**
 * Materialize es02-hosted-compat/upgrade.sql from pinned reviewed migration inputs.
 * Run from repo root or this directory. Does not apply SQL. Does not touch hosted.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const migrations = join(root, "supabase", "migrations");
const pkg = here;

const inputs = [
  { id: "revoke-33007", path: join(migrations, "20261014033007_master_password_session_revocation.sql") },
  {
    id: "identity-native-boundary",
    path: join(pkg, "fragments", "02-identity-native-session-boundary.sql"),
  },
  { id: "wp01a-080000", path: join(migrations, "20261016080000_wp01a_session_broker.sql") },
  { id: "wp01a-090000", path: join(migrations, "20261016090000_wp01a_session_broker_correction.sql") },
  { id: "wp01a-100000", path: join(migrations, "20261016100000_wp01a_session_broker_correction_r2.sql") },
  { id: "wp01a-110000", path: join(migrations, "20261016110000_wp01a_session_broker_correction_c3.sql") },
  { id: "wp01a-120000", path: join(migrations, "20261016120000_wp01a_session_broker_correction_c4.sql") },
  { id: "wp01a-130000", path: join(migrations, "20261016130000_wp01a_session_broker_retire_admit_overloads.sql") },
  { id: "wp01a-140000", path: join(migrations, "20261016140000_wp01a_session_broker_correction_c5.sql") },
  { id: "wp01a-150000", path: join(migrations, "20261016150000_wp01a_session_broker_correction_c5_r2.sql") },
  { id: "wp01a-160000", path: join(migrations, "20261016160000_wp01a_session_broker_correction_c5_r3.sql") },
  { id: "wp01a-170000", path: join(migrations, "20261016170000_wp01a_session_broker_correction_c5_r4.sql") },
  {
    id: "capability-acl-semantic",
    path: join(pkg, "fragments", "04-capability-acl-semantic.sql"),
  },
  { id: "recovery-minimal", path: join(pkg, "fragments", "01-recovery-review-minimal.sql") },
  { id: "wp01b-180000", path: join(migrations, "20261016180000_wp01b_recovery_session_tip_fence.sql") },
  { id: "es02-120000", path: join(migrations, "20261017120000_es02_account_bound_purchase.sql") },
  { id: "es02-130000", path: join(migrations, "20261017130000_es02_c1_authority_correction.sql") },
  { id: "es02-140000", path: join(migrations, "20261017140000_es02_c2_atomicity_ledger_snapshot.sql") },
  {
    id: "es02-owned-rpc-acl",
    path: join(pkg, "fragments", "03-owned-rpc-execute-boundary.sql"),
  },
  { id: "es02-150000", path: join(migrations, "20261017150000_es02_c3_exact_client_op_unique.sql") },
  { id: "es02-160000-primary", path: join(migrations, "20261017160000_es02_hosted_primary_compat.sql") },
  {
    id: "broker-table-sequence-acl",
    path: join(pkg, "fragments", "05-broker-table-sequence-acl.sql"),
  },
];

const PRIMARY_OLD = `  select * into primary_branch from public.company_branches
  where company_id = created.id and is_primary = true
  for update;
  if primary_branch.id is null then
    raise exception 'ES02_PRIMARY_BRANCH_MISSING' using errcode = 'P0001';
  end if;

  branch := p_branches->0;
  slot := offer->'slots'->0;
  update public.company_branches set
    name = btrim(branch->>'name'),
    city = btrim(branch->>'city'),
    status = 'setup'
  where id = primary_branch.id;`;

const PRIMARY_NEW = `  -- Hosted PhaseB: reuse trigger-created primary when present; otherwise insert
  -- the first paid, owned, validated branch as primary (no enterprise trigger resurrection).
  select * into primary_branch from public.company_branches
  where company_id = created.id and is_primary = true
  for update;
  branch := p_branches->0;
  slot := offer->'slots'->0;
  if primary_branch.id is null then
    insert into public.company_branches(company_id, name, city, is_primary, status)
    values (
      created.id,
      btrim(branch->>'name'),
      btrim(branch->>'city'),
      true,
      'setup'
    )
    returning * into primary_branch;
    if primary_branch.id is null then
      raise exception 'ES02_PRIMARY_BRANCH_MISSING' using errcode = 'P0001';
    end if;
  else
    update public.company_branches set
      name = btrim(branch->>'name'),
      city = btrim(branch->>'city'),
      status = 'setup'
    where id = primary_branch.id;
  end if;`;

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function stripTxn(sql) {
  return sql
    .replace(/^\uFEFF/, "")
    .replace(/^\s*begin\s*;\s*/im, "")
    .replace(/\s*commit\s*;\s*$/im, "")
    .trim() + "\n";
}

function materializePrimaryCompat() {
  const c2Path = join(migrations, "20261017140000_es02_c2_atomicity_ledger_snapshot.sql");
  const c2 = readFileSync(c2Path, "utf8");
  const start = c2.indexOf("create or replace function public.es02_provision_owned_purchase(");
  const endMarker = "revoke all on function public.es02_provision_owned_purchase";
  const end = c2.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error("PROVISION_FUNCTION_NOT_FOUND_IN_C2");
  let body = c2.slice(start, end);
  if (!body.includes(PRIMARY_OLD)) throw new Error("PRIMARY_BLOCK_NOT_FOUND_FOR_PATCH");
  body = body.replace(PRIMARY_OLD, PRIMARY_NEW);
  const out = `-- ES02 hosted primary compatibility (PhaseB absent enterprise_primary_branch).
-- Changes ONLY public.es02_provision_owned_purchase: reuse existing primary OR insert first paid branch.
-- Does not edit 12/13/14/15 predecessors. No enterprise trigger resurrection.
-- Generated from C2 provision body + bounded primary insert; keep in sync via build.mjs.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

${body}

revoke all on function public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)
  from public, anon;
grant execute on function public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)
  to authenticated;

notify pgrst, 'reload schema';
commit;
`;
  const dest = join(migrations, "20261017160000_es02_hosted_primary_compat.sql");
  writeFileSync(dest, out);
  return { path: dest, sha256: sha256(out) };
}

const syntheticDeny = `
-- Hosted synthetic settlement deny (mandatory final fence).
do $$
begin
  if to_regprocedure('public.es02_settle_account_order_synthetic(jsonb)') is null then
    raise exception 'RELEASE_FOOTPRINT: expected synthetic RPC after ES02 expand';
  end if;
end;
$$;
revoke all on function public.es02_settle_account_order_synthetic(jsonb)
  from public, anon, authenticated, service_role;
do $$
declare
  p oid := to_regprocedure('public.es02_settle_account_order_synthetic(jsonb)');
begin
  if has_function_privilege('anon', p, 'execute')
     or has_function_privilege('authenticated', p, 'execute')
     or has_function_privilege('service_role', p, 'execute') then
    raise exception 'RELEASE_FOOTPRINT: synthetic RPC must remain denied to runtime roles';
  end if;
end;
$$;
`;

const primaryMeta = materializePrimaryCompat();

const hashes = {};
const parts = [];
for (const input of inputs) {
  const raw = readFileSync(input.path);
  const digest = sha256(raw);
  hashes[input.id] = {
    path: relative(root, input.path).replaceAll("\\", "/"),
    sha256: digest,
    bytes: raw.length,
  };
  parts.push(`-- >>> BEGIN ${input.id} (${hashes[input.id].path}) sha256=${digest}`);
  parts.push(stripTxn(raw.toString("utf8")));
  parts.push(`-- <<< END ${input.id}`);
}

const preDdlGuard = readFileSync(join(pkg, "fragments", "00-pre-ddl-guard.sql"), "utf8").trim();
const preCommitAsserts = readFileSync(join(pkg, "fragments", "99-pre-commit-asserts.sql"), "utf8").trim();

const upgrade = `-- ES02 hosted-compat upgrade package — concrete executable expand.
-- Compatible with hosted PhaseB footprint (broker/recovery/ES02 absent).
-- ONE atomic transaction: pre-DDL kernel/partial guards + final asserts before commit.
-- Generated by build.mjs from pinned reviewed inputs. Not a historical replay script.
-- Local package only — hosted apply requires separate explicit approval + backup/PITR.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '600s';
set local search_path = '';

-- Critical preflight inside the upgrade transaction (before first DDL).
${preDdlGuard}

${parts.join("\n\n")}

${syntheticDeny}

-- Critical postflight asserts before COMMIT (half-package cannot commit).
${preCommitAsserts}

notify pgrst, 'reload schema';
commit;
`;

writeFileSync(join(pkg, "upgrade.sql"), upgrade);
hashes["upgrade.sql"] = { path: "supabase/upgrade-packages/es02-hosted-compat/upgrade.sql", sha256: sha256(upgrade), bytes: Buffer.byteLength(upgrade) };
hashes["es02-160000-primary-materialized"] = {
  path: relative(root, primaryMeta.path).replaceAll("\\", "/"),
  sha256: primaryMeta.sha256,
};

const manifest = {
  package: "es02-hosted-compat",
  status: "Implemented_NotVerified_local_package_only",
  base_commit: "f1428a9604573adf023b008b013a55109710c3a4",
  hosted_project_ref: "vmpifljyozsbtssxhoxd",
  hosted_latest_migration: "20261016220450",
  hosted_profile: "PhaseB_present_objects_cleanup_88_migrations",
  notes: [
    "Does not claim 129-source Auth fixture equals this 88-migration hosted footprint",
    "PAYMOB_EXTERNAL_VERIFICATION Deferred; synthetic settle revoked from all runtime roles",
    "Identity lost-email+phone restoration remains PrelaunchDeferred (REVIEW/STATUS only)",
    "After 33007 and before broker 080000: minimal identity native-session boundary fragment (33009:14-22,27-28,31-35 only) — boundary table empty by default; public app/check OID preserved; revoke service_role EXECUTE to match C5 authenticated-only ACL; no phone enrollment/change/attestation/apply",
    "Postflight/pre-COMMIT require private.vel_broker_capability_contract_matches() and public.vel_broker_capability_probe() ok (probe under service_role EXECUTE grant; strict C5 contract unchanged)",
    "Repeat apply: preflight/upgrade require pre-expand PhaseB footprint + hosted full-definition kernel MD5s; final installed footprint → deterministic reject (postflight only). Never treat post-upgrade kernel bodies as old pins. Never duplicate financial rows.",
  ],
  identity_native_boundary: {
    fragment: "fragments/02-identity-native-session-boundary.sql",
    source_extract: "20261014033009 lines 14-22,27-28,31-35 (phone omitted)",
    objects: [
      "private.master_identity_session_boundaries",
      "private.master_identity_session_current(uuid,uuid)",
      "private.master_identity_pre_session_is_valid()",
      "private.master_identity_pre_check_app_session(boolean)",
      "public.app_session_is_valid() wrapper",
      "public.check_app_session(boolean) wrapper",
    ],
    grants: {
      private_functions: "postgres EXECUTE only",
      private_table: "RLS on; no anon/authenticated/service_role table grants",
      public_app_check: "EXECUTE authenticated only (revoke public/anon/service_role)",
    },
    session_impact:
      "Empty boundary table is a no-op filter; native idle/expiry/password revocation remain via master_identity_pre_* snapshots of 33007 wrappers. No session generation reset or row deletion.",
  },
  pinned_native_kernel: {
    hash_kind: "pg_get_functiondef_crlf_normalized",
    "public.app_session_is_valid()": {
      definition_md5: "5f3313dbaee67b8366fef2b55150d067",
      prosrc_md5_informational_only: "b42c28f54d05778fcc994156c6ce4086",
    },
    "public.check_app_session(boolean)": {
      definition_md5: "7d7b359732de20ea37d383b579a45d38",
      prosrc_md5_informational_only: "f69c473d94466a93d1d793bbd447478e",
    },
  },
  inputs: hashes,
  files: {
    preflight: "preflight.sql",
    upgrade: "upgrade.sql",
    postflight: "postflight.sql",
    deny_rollback: "deny-rollback.sql",
    readme: "README.md",
  },
};

writeFileSync(join(pkg, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ ok: true, upgradeBytes: hashes["upgrade.sql"].bytes, upgradeSha256: hashes["upgrade.sql"].sha256, primary: primaryMeta }, null, 2));
