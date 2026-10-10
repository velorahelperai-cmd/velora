// Builds review artifacts only. No DB connection, environment file or cloud client.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const dir='supabase/upgrade-packages/g03-cloud-compatibility';
const read=p=>readFileSync(resolve(p),'utf8').replaceAll('\r\n','\n').replace(/^\uFEFF/,'');
export const hash=s=>createHash('sha256').update(s).digest('hex');
const signature='public.transition_company_review(text,uuid,integer,text,text,boolean,text)';
const containmentBody=`
begin
 if p_company_id is null or p_action is null or p_action not in ('submit','resubmit','approve','request_changes') then raise exception 'invalid_input' using errcode='22023';end if;
 if p_action in ('submit','resubmit') then perform private.require_active_owner(p_company_id);
 elsif auth.uid() is null or not private.actor_may_review_company(p_company_id) then raise exception 'forbidden' using errcode='42501';end if;
 return jsonb_build_object('ok',false,'code','UPGRADE_PENDING');
end; `;
const containmentMD5=createHash('md5').update(containmentBody).digest('hex');
const helperHashes=[
 ['private.require_active_owner(uuid)','96e68ff99b5fd87e59414f5c88f87da0'],
 ['private.can_admin_company(uuid,text)','6466db347ab180863a61c3b68e2b8086'],
 ['private.actor_may_review_company(uuid)','74036fc233447a32a6ebb6836588ee13'],
 ['private.user_has_company_capability(uuid,uuid,text)','c00ce918a543315f1d241472028dd93f'],
 ['private.write_admin_audit(uuid,uuid,text,jsonb,jsonb)','2f58d7407a5a169c0cb4d87a66661af4'],
 ['private.company_review_request_json(uuid)','df67c8ce776c012e1687ef38e47b03a9'],
 ['public.app_session_is_valid()','b42c28f54d05778fcc994156c6ce4086'],
];
const validateHelpers=helperHashes.map(([sig,h])=>`if (select md5(prosrc) from pg_proc where oid=to_regprocedure('${sig}')) is distinct from '${h}' then raise exception 'BASELINE_FUNCTION_MISMATCH: ${sig}';end if;`).join('\n');
const drain=`if exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and backend_type='client backend' and (xact_start is not null or query='<insufficient privilege>')) then raise exception 'REVIEW_WINDOW_NOT_DRAINED_OR_NOT_VISIBLE';end if;`;
const noPartial=`if exists(select 1 from information_schema.columns where table_schema='public' and table_name='knowledge_sources' and column_name in ('usage_role','prepared_file_sha256','prepared_text_sha256','prepared_content_version')) or to_regclass('private.g03_company_inputs') is not null or to_regprocedure('public.g03_read_review_request(uuid)') is not null then raise exception 'ALREADY_UPGRADED_OR_PARTIAL_BASELINE';end if;`;
const header=`-- REVIEW ONLY: target vmpifljyozsbtssxhoxd, published c36f2286. No live execution authorized.
begin;
set local role postgres;
set local search_path='';
set local lock_timeout='2s';
set local statement_timeout='30s';
`;
const acl=`revoke all on function ${signature} from public,anon,authenticated,service_role;
grant execute on function ${signature} to authenticated;
revoke all on function private.company_review_request_json_pre_g03(uuid) from public,anon,authenticated,service_role;`;
function approved(path,expected) {
 const s=read(path);if(hash(s)!==expected)throw Error(`APPROVED_SQL_CHANGED: ${path}`);
 // Strip ONLY the known top-level transaction wrapper. All PL/pgSQL blocks stay intact.
 if(!/\nbegin;\n/.test(s)||!s.trimEnd().endsWith('commit;'))throw Error('TRANSACTION_WRAPPER_CHANGED');
 return s.replace(/\nbegin;\n/,'\n').replace(/commit;\s*$/,'');
}
export function assemble() {
 const securityQuery=read(`${dir}/baseline-security-query.sql`).trim().replace(/;$/,'');
 const guard=`do $$ declare fingerprint text; begin
 ${securityQuery} into fingerprint;
 if fingerprint is distinct from 'cdb8ae52ae909fb63751029c782a2eabd967bf15f3cafd37e87cccfcad113952' then raise exception 'BASELINE_SECURITY_MISMATCH';end if;
 end $$;\n`;
 const containment=header+guard+`do $$ begin ${noPartial}
 if coalesce((select md5(prosrc) from pg_proc where oid=to_regprocedure('${signature}')),'') not in ('59ad4b24f323db4a7233f4661de0c7bc','${containmentMD5}') then raise exception 'LEGACY_WRITER_MISMATCH';end if;
 end $$;
create or replace function public.transition_company_review(p_action text,p_company_id uuid,p_expected_revision integer default null,p_number_ownership text default null,p_whatsapp_number text default null,p_readiness_confirmed boolean default null,p_owner_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$${containmentBody}$$;
revoke all on function ${signature} from public,anon,authenticated,service_role;
grant execute on function ${signature} to authenticated;
notify pgrst,'reload schema';
commit;\n`;
 const preflight=`do $$ begin ${noPartial}
 ${drain}
 ${validateHelpers}
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('${signature}')) is distinct from '${containmentMD5}' then raise exception 'CONTAINMENT_REQUIRED';end if;
 if to_regprocedure('public.list_owner_company_review_events_for_company(uuid)') is not null then raise exception 'HISTORY_CONTRACT_ALREADY_EXISTS';end if;
 if to_regprocedure('extensions.digest(bytea,text)') is null then raise exception 'PGCRYPTO_REQUIRED';end if;
end $$;
-- Fail quickly if current knowledge/permission writers overlap installation.
lock table public.companies,public.knowledge_sources,public.company_review_requests,public.company_members,
 public.platform_admins,public.platform_admin_scopes,public.company_member_grants in share row exclusive mode nowait;
`;
 const source='supabase/migrations/20261009215520_g03_verified_review.sql';
 const history='supabase/migrations/20261008170000_vel_owner_review_scope_read.sql';
 const bundle=header+preflight+guard+read(`${dir}/20261010003237_g03_cloud_knowledge_prerequisites.sql`)
  +approved(source,'62196103d37cd39310f469ab44de4f215327258308e8c422be86ed025ddfc83a')
  +approved(history,'5618c7f9b098792959634c0fbc2804034329678aa3c8722ac7c8ed2f66119a63')
  +acl+'\n'+read(`${dir}/postflight.sql`)+"\nnotify pgrst,'reload schema';\ncommit;\n";
 return { containment,bundle };
}
if(resolve(process.argv[1]??'')===fileURLToPath(import.meta.url)) {
 const {containment,bundle}=assemble();
 writeFileSync(resolve(dir,'00-containment.review.sql'),containment);
 writeFileSync(resolve(dir,'10-upgrade.review.sql'),bundle);
 writeFileSync(resolve(dir,'manifest.json'),JSON.stringify({target:'vmpifljyozsbtssxhoxd',base:'c36f2286b70ee870a1dc7df9f60e1d50d1b0d1b0',containment_sha256:hash(containment),upgrade_sha256:hash(bundle),review_only:true,auto_apply:false},null,2)+'\n');
 console.log('Review-only SQL built; no connection made.');
}
