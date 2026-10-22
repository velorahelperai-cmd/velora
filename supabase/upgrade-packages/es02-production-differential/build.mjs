import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const base = JSON.parse(readFileSync(resolve(here, 'production-baseline.json'), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const pins = {
  'supabase/migrations/20261020180000_es02_b5_b8_branch_setup_completion.sql': '223901ae00e3c130c4370ebf2c655ba6a9e3eddc1a9d88959a74db9a89c615c9',
  'supabase/migrations/20261022093000_es02_trial_session_history.sql': 'd023c0adbd0efb3df2f99d7e56fde89f2ac15647a92f160532cfa35ff6538e2c',
  'wallet-core.sql': 'ba3f66816bc3cd31099a79286486d1226f71b90e9d10e2dabdd98242cb2cdae0',
  'acceptance-clock.sql': 'd8be7cfbd255e300cc6e9192fd9f595cbf6be597824d577b76569fa973efceb0',
  'authority.sql': '7d8bed659a2863d3d9cbbc5fb9f93f1a47eee36474f4ba2e2071bef414da6f48',
  'worker-cost.sql': '8a68dda25691164396a760c50042e6a353db33ad426e1487a1a1def7d926d424',
  'usage-reconciliation.sql': '51f08e0205691a1630802a0ad230ceafdee23c136eedffd0bbb9f223729fee1d',
  'worker-bridge.sql': 'b3d408ce69278eec5ae22dcf8f2106ed673ce6d5d7d42ca34da2d2ee148b410d',
  'setup-trial-settlement.sql': 'b0505f56a066cf81a194be3f8b7149dd517cd59c332ce381066570d8c7c4af4f',
};
function source(name) {
  const path = name.includes('/') ? resolve(root, name) : name === 'setup-trial-settlement.sql' ? resolve(here, name) : resolve(here, '../es02-operational-credits', name);
  const raw = readFileSync(path);
  if (hash(raw) !== pins[name]) throw Error(`REVIEWED_SOURCE_CHANGED:${name}`);
  return raw.toString('utf8').replaceAll('\r\n', '\n');
}
function removeBetween(text, first, next) {
  const start = text.indexOf(first), end = text.indexOf(next, start + first.length);
  if (start < 0 || end < start || text.indexOf(first, start + first.length) >= 0) throw Error('SOURCE_LAYOUT_CHANGED');
  return text.slice(0, start) + text.slice(end);
}
function noTransaction(text) {
  if ((text.match(/^begin;$/gm) ?? []).length !== 1 || (text.match(/^commit;$/gm) ?? []).length !== 1) throw Error('SOURCE_TRANSACTION_LAYOUT_CHANGED');
  return text.replace(/^begin;\s*$/m, '').replace(/^commit;\s*$/m, '');
}
let branch = source('supabase/migrations/20261020180000_es02_b5_b8_branch_setup_completion.sql');
branch = removeBetween(branch, '  -- Preserve the reviewed operational credit dependency', "  if to_regprocedure('private.es02_require_active_actor(uuid)')");
const priorityAt = branch.indexOf('-- Change only the grant ordering in the existing operational ledger.');
if (priorityAt < 0 || !branch.slice(priorityAt).includes('$priority$;')) throw Error('LEGACY_ADAPTER_LAYOUT_CHANGED');
branch = branch.slice(0, priorityAt) + '\ncommit;\n';
// Never install the obsolete account-only debit or its duplicate receipt table.
branch = removeBetween(branch, 'create table if not exists private.es02_branch_reply_credit_receipts (', '-- Source candidate only:');
branch = removeBetween(branch, 'create or replace function public.es02_atomic_deduct_reply_credit(', 'create or replace function public.es02_index_branch_website_page(');
const debitAcl = branch.indexOf('alter function public.es02_atomic_deduct_reply_credit(');
if (debitAcl < 0) throw Error('LEGACY_DEBIT_ACL_LAYOUT_CHANGED');
branch = branch.slice(0, debitAcl) + '\ncommit;\n';
branch = removeBetween(branch, '-- Reuse the existing immutable cost settlement and unknown-outcome holds.', 'create or replace function public.es02_read_owned_branch_assistant_trial(');
branch = noTransaction(branch);
if (/master_ai_|es02_atomic_deduct_reply_credit|es02_branch_reply_credit_receipts/.test(branch)) throw Error('RETIRED_CREDIT_LOGIC_PRESENT');

const history = source('supabase/migrations/20261022093000_es02_trial_session_history.sql');
const historyAt = history.indexOf('alter table private.es02_branch_trial_operations add column');
if (historyAt < 0) throw Error('HISTORY_LAYOUT_CHANGED');
const historyBody = history.slice(historyAt).replace(/^commit;\s*$/m, '');
const shared = ['wallet-core.sql', 'acceptance-clock.sql', 'authority.sql', 'worker-cost.sql', 'usage-reconciliation.sql', 'worker-bridge.sql'];
const sections = [{ name: 'B5-B8 branch logic without retired credit adapter/debit', text: branch }, { name: 'Explicit pinned setup-trial settlement replacement, no dynamic body rewrite', text: source('setup-trial-settlement.sql') }, { name: 'Trial history on NEW empty operation table', text: historyBody }, ...shared.map(name => ({ name, text: source(name) }))];
const body = sections.map(x => `\n-- DIFFERENTIAL SECTION: ${x.name}\n${x.text}`).join('\n');

function types(args) {
  return args.trim() ? args.split(',').map(a => a.trim().replace(/\s+default\s+[\s\S]*$/i, '').split(/\s+/).slice(1).join(' ').replace(/^int$/, 'integer').replace(/^bool$/, 'boolean')).join(',') : '';
}
const functions = new Map();
for (const m of body.matchAll(/create\s+(?:or\s+replace\s+)?function\s+((?:public|private)\.\w+)\s*\(([\s\S]*?)\)\s*returns\b([\s\S]*?)\bas\s*(\$[a-z_0-9]*\$)([\s\S]*?)\4\s*;/gi)) {
  functions.set(`${m[1]}(${types(m[2])})`, { name: m[1], securityDefiner: /security\s+definer/i.test(m[3]), bodyMd5: createHash('md5').update(m[5].replaceAll('\r', '')).digest('hex') });
}
const grants = new Map();
for (const m of body.matchAll(/grant\s+execute\s+on\s+function\s+((?:public|private)\.\w+)\s*\(([^)]*)\)\s+to\s+(authenticated|service_role)\s*;/gi)) {
  const sig = `${m[1]}(${m[2].split(',').map(x => x.trim().replace(/^int$/, 'integer')).join(',')})`;
  grants.set(sig, m[3]);
}
const existing = new Map(base.footprint.functions.map(f => [f.signature, f]));
const roles = ['anon', 'authenticated', 'service_role'];
const expected = [];
for (const [signature, details] of functions) {
  const { name } = details;
  let role = grants.get(signature) ?? null;
  if (signature === 'public.es02_reconcile_activation_readiness(uuid,uuid)') role = 'authenticated';
  if (name.startsWith('public.') && !role) throw Error(`PUBLIC_GRANT_NOT_CLASSIFIED:${signature}`);
  expected.push({ signature, ...details, operation: existing.has(signature) ? 'replace' : 'create', before: existing.get(signature) ?? null, after: Object.fromEntries(roles.map(r => [r, r === role])), role });
}
const aliases = [...body.matchAll(/alter function private\.(\w+)\(([^)]*)\) rename to (\w+);/gi)].map(m => `private.${m[3]}(${m[2]})`);
const aliasProofs = [...body.matchAll(/alter function private\.(\w+)\(([^)]*)\) rename to (\w+);/gi)].map(m => {
  const before = existing.get(`private.${m[1]}(${m[2]})`) ?? existing.get(`public.${m[1]}(${m[2]})`);
  if (!before) throw Error('NATIVE_ALIAS_BASELINE_MISSING');
  return { signature: `private.${m[3]}(${m[2]})`, before };
});
if (functions.size !== 44) throw Error('FUNCTION_SCOPE_OR_PARSER_CHANGED');
const tables = [...body.matchAll(/create table(?: if not exists)?\s+(private\.\w+)\s*\(/gi)].map(m => m[1]);
if (tables.length !== 9 || new Set(tables).size !== 9) throw Error('NEW_TABLE_SCOPE_CHANGED');
const catalog = readFileSync(resolve(here, 'catalog-footprint.sql'), 'utf8').trim();
const capture = catalog.replace(/^begin read only;\s*/i, '').replace(/^set local search_path='';\s*/i, '').replace(/\s*commit;$/i, '').replace(/ as footprint;\s*$/i, ' into actual;');
if (!capture.endsWith(' into actual;')) throw Error('CAPTURE_LAYOUT_CHANGED');

const header = `-- REVIEW FOR ONE EXPLICIT APPLICATION APPROVAL. NOT APPLIED.
-- Target: Supabase vmpifljyozsbtssxhoxd via its VELORA connection only.
-- A separate Production installer: the local installer/guard stays untouched.
-- No already-applied single-branch/B4/admin DDL. No retired credit foundation.
-- Source fragments retain their local-review provenance comments.
begin;
set local search_path='';
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_catalog.pg_advisory_xact_lock(87420401, 20261022);
lock table public.companies,public.company_branches,public.whatsapp_inbound_jobs,
 public.whatsapp_send_intents,public.ai_usage_ledger,public.ai_budget_accounts,public.billing_subscriptions,
 private.es02_account_orders,private.es02_activation_foundation,private.es02_credit_balances,
 private.es02_branch_slot_rights,private.es02_branch_channel_selections in share row exclusive mode;
do $production_preflight$
declare actual jsonb; object_name text;
begin
 if current_database()<>'postgres' or current_user<>'postgres' then raise exception 'ES02_PRODUCTION_DATABASE_OR_OWNER_MISMATCH';end if;
 if (select md5(string_agg(id::text,',' order by id)) from public.companies) is distinct from '${base.companyScopeHash}' then
  raise exception 'ES02_PRODUCTION_PROJECT_SCOPE_CHANGED';end if;
 if (select jsonb_agg(jsonb_build_object('version',version,'name',name) order by version) from supabase_migrations.schema_migrations
  where name<>'es02_remaining_production_differential_20261022')
  is distinct from $migration_pin$${JSON.stringify(base.migrations)}$migration_pin$::jsonb then raise exception 'ES02_PRODUCTION_MIGRATION_BASELINE_CHANGED';end if;
 foreach object_name in array array[${tables.map(x => `'${x}'`).join(',')}] loop
  if to_regclass(object_name) is not null then raise exception 'ES02_ALREADY_PRESENT_INSPECT_NOT_REAPPLY:%',object_name;end if;
 end loop;
 if exists(select 1 from public.whatsapp_inbound_jobs where usage_status in ('reserved','unknown') or (claim_token is not null and claim_expires_at>clock_timestamp()))
  or exists(select 1 from public.ai_usage_ledger where usage_mode='company_live' and status in ('reserved','running','uncertain'))
  or exists(select 1 from public.whatsapp_send_intents where sender_kind='assistant' and outcome in ('ready','attempting','unknown')) then
  raise exception 'ES02_CUTOVER_IN_FLIGHT_RECONCILE_WITHOUT_RESEND';end if;
 ${capture}
 if actual is distinct from $footprint_pin$${JSON.stringify(base.footprint)}$footprint_pin$::jsonb then raise exception 'ES02_PRODUCTION_CATALOG_OR_ACL_CHANGED';end if;
end;$production_preflight$;
`;
const seal = '\n-- Explicit final function ACLs; do not rely on platform defaults.\n' + expected.map(f => `alter function ${f.signature} owner to postgres;\nrevoke all on function ${f.signature} from public,anon,authenticated,service_role;${f.role ? `\ngrant execute on function ${f.signature} to ${f.role};` : ''}`).join('\n') + '\n' + aliases.map(sig => `revoke all on function ${sig} from public,anon,authenticated,service_role;`).join('\n');
const post = `
do $production_postflight$
declare v_postflight_item jsonb;v_postflight_role text;v_postflight_table text;v_postflight_proc pg_proc;v_postflight_catalog jsonb;
begin
 ${capture.replace(' into actual;', ' into v_postflight_catalog;')}
 if v_postflight_catalog->>'roleHash' is distinct from '${base.footprint.roleHash}'
  or v_postflight_catalog->>'defaultHash' is distinct from '${base.footprint.defaultHash}'
  or v_postflight_catalog->>'schemaAclHash' is distinct from '${base.footprint.schemaAclHash}'
  or v_postflight_catalog->>'securityHash' is distinct from '${base.footprint.securityHash}' then
  raise exception 'ES02_POSTFLIGHT_EXISTING_SECURITY_CHANGED';end if;
 for v_postflight_item in select value from jsonb_array_elements($unchanged_functions$${JSON.stringify(base.footprint.functions.filter(v_postflight_item => !functions.has(v_postflight_item.signature)))}$unchanged_functions$::jsonb) loop
  if not exists(select 1 from jsonb_array_elements(v_postflight_catalog->'functions') x where x.value=v_postflight_item) then
   raise exception 'ES02_POSTFLIGHT_UNRELATED_FUNCTION_CHANGED:%',v_postflight_item->>'signature';end if;
 end loop;
 for v_postflight_item in select value from jsonb_array_elements($native_aliases$${JSON.stringify(aliasProofs)}$native_aliases$::jsonb) loop
  select * into v_postflight_proc from pg_proc where oid=to_regprocedure(v_postflight_item->>'signature');
  if v_postflight_proc.oid is null or md5(replace(v_postflight_proc.prosrc,chr(13),'')) is distinct from v_postflight_item->'before'->>'hash'
   or pg_get_userbyid(v_postflight_proc.proowner) is distinct from v_postflight_item->'before'->>'owner'
   or v_postflight_proc.prosecdef is distinct from (v_postflight_item->'before'->>'definer')::boolean then
   raise exception 'ES02_POSTFLIGHT_NATIVE_ALIAS_CHANGED';end if;
  foreach v_postflight_role in array array['anon','authenticated','service_role'] loop
   if has_function_privilege(v_postflight_role,v_postflight_proc.oid,'execute') then raise exception 'ES02_POSTFLIGHT_NATIVE_ALIAS_EXPOSED';end if;
  end loop;
 end loop;
 for v_postflight_item in select value from jsonb_array_elements($expected_acl$${JSON.stringify(expected)}$expected_acl$::jsonb) loop
  select * into v_postflight_proc from pg_proc where oid=to_regprocedure(v_postflight_item->>'signature');
  if v_postflight_proc.oid is null or pg_get_userbyid(v_postflight_proc.proowner)<>'postgres' or v_postflight_proc.proconfig is null or not v_postflight_proc.proconfig @> array['search_path=""']
   or v_postflight_proc.prosecdef is distinct from (v_postflight_item->>'securityDefiner')::boolean
   or md5(replace(v_postflight_proc.prosrc,chr(13),'')) is distinct from v_postflight_item->>'bodyMd5' then raise exception 'ES02_POSTFLIGHT_FUNCTION_BODY_OWNER_OR_PATH';end if;
  foreach v_postflight_role in array array['anon','authenticated','service_role'] loop
   if has_function_privilege(v_postflight_role,v_postflight_proc.oid,'execute') is distinct from (v_postflight_item->'after'->>v_postflight_role)::boolean then raise exception 'ES02_POSTFLIGHT_EXECUTE_MISMATCH:%',v_postflight_item->>'signature';end if;
  end loop;
 end loop;
 foreach v_postflight_table in array array[${tables.map(x => `'${x}'`).join(',')}] loop
  if not exists(select 1 from pg_class where oid=to_regclass(v_postflight_table) and relrowsecurity) then raise exception 'ES02_POSTFLIGHT_RLS_REQUIRED';end if;
  foreach v_postflight_role in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(v_postflight_role,v_postflight_table,'select,insert,update,delete,truncate,references,trigger,maintain')
    or has_any_column_privilege(v_postflight_role,v_postflight_table,'select,insert,update,references') then raise exception 'ES02_POSTFLIGHT_DIRECT_TABLE_ACCESS';end if;
  end loop;
 end loop;
end;$production_postflight$;
notify pgrst,'reload schema';
commit;
`;
const sql = header + body + seal + post;
if (/create\s+(?:or replace\s+)?(?:table|function)\s+(?:private|public)\.master_ai_/i.test(sql)
 || /create(?: or replace)? function public\.es02_atomic_deduct_reply_credit/i.test(sql)) throw Error('RETIRED_CREDIT_CREATE_FORBIDDEN');
writeFileSync(resolve(here, 'production.sql'), sql);
const manifest = { status: 'REVIEW_ONLY_NOT_APPLIED', migrationName: 'es02_remaining_production_differential_20261022', projectRef: base.projectRef, sqlFile: 'production.sql', sha256: hash(sql), bytes: Buffer.byteLength(sql), alreadyAppliedExcluded: ['single_branch_scope', 'B4 branch_hours', 'admin pagination'], sourcePins: pins, baselineFunctions: base.footprint.functions.length, functions: expected, privateAliases: aliasProofs, newTables: tables.map(name => ({ name, rls: true, directRuntimeAccess: false })), tableOrColumnGrantChanges: [], existingTableDdl: ['public.ai_usage_ledger: usage-mode constraint expands admin_test/company_live to admin_test/company_live/setup_trial, with no row conversion', 'public.ai_usage_ledger: five ES02 provenance columns, complete-binding constraint and immutable binding trigger', 'public.whatsapp_inbound_jobs: native usage settlement trigger', 'private.es02_activation_foundation: initial-clock receipt guard trigger'], retiredLogicExcluded: ['master credit foundation', 'legacy priority substring adapter', 'account-only direct debit and duplicate receipt table'], independentLiabilities: ['One preexisting admin_test uncertain attempt, no worker job: preserve unchanged, no settle/retry; not an ES02 company_live cutover blocker'], localInstallerModified: false, functionalTests: 'NOT_RUN_OWNER_DEFERRED', productionWrites: 0, paymobExternal: 'PAYMOB_EXTERNAL_DEFERRED_INDEPENDENT_NOT_LOST_CONSOLIDATION_WORK' };
writeFileSync(resolve(here, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(resolve(here, 'SHA256SUMS.txt'), `${manifest.sha256}  production.sql\n`);
console.log(JSON.stringify({ sha256: manifest.sha256, bytes: manifest.bytes, functions: expected.length, newTables: tables.length, aliases: aliases.length, productionWrites: 0, functionalTests: manifest.functionalTests }));
