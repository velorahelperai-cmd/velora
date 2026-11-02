// Isolated rollback-only drift tests. Does not manufacture a paid worker claim.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sql} from '../whatsapp-integration/postgres.mjs';
const source=readFileSync('supabase/migrations/20261022040333_es02_operational_credit_acceptance.sql','utf8').replaceAll('\r\n','\n');
const setup=readFileSync('supabase/migrations/20261020180000_es02_b5_b8_branch_setup_completion.sql','utf8');
const tables=setup.slice(setup.indexOf('create table if not exists private.es02_branch_knowledge_sources'),setup.indexOf('create table if not exists private.es02_branch_reply_language_confirmations'));
const hours=source.slice(source.indexOf('create table if not exists private.es02_branch_hours ('),source.indexOf('create table if not exists private.es02_branch_hours_receipts'));
const signatures=['private.es02_whatsapp_citations_current(uuid,uuid,jsonb)','public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text)'];
const baseline=tables+'\n'+hours+'\n'+signatures.map(signature=>{
 const name=signature.split('(')[0],start=source.indexOf('create function '+name+'('),end=source.indexOf('end;$$;',start);
 assert(start>=0&&end>start,'Original native definition missing');
 return source.slice(start,end+7).replace('create function','create or replace function')+
 `alter function ${signature} owner to postgres;revoke all on function ${signature} from public,anon,authenticated,service_role;`+
 (name.startsWith('public.')?`grant execute on function ${signature} to service_role;`:'');
}).join('\n');
const guard=readFileSync('scripts/performance/knowledge-passages-prerequisite.candidate.sql','utf8');
await sql(`begin;${baseline}${guard}rollback;`,'perf_passage_guard');
console.log('PASS original source matches reviewed hosted fingerprints');
for(const [name,tamper,code] of [
 ['body',`create or replace function private.es02_whatsapp_citations_current(p_company_id uuid,p_branch_id uuid,p_citations jsonb) returns boolean language plpgsql security definer set search_path='' as $$begin return false;end;$$;`,'PASSAGE_PREREQUISITE_DRIFT'],
 ['acl',`grant execute on function ${signatures[0]} to authenticated;`,'PASSAGE_PREREQUISITE_DRIFT'],
 ['definer',`alter function ${signatures[0]} security invoker;`,'PASSAGE_PREREQUISITE_DRIFT'],
 ['search_path',`alter function ${signatures[0]} set search_path=public;`,'PASSAGE_PREREQUISITE_DRIFT'],
 ['existing_index','create table private.knowledge_source_passages(id integer);','PASSAGE_INDEX_ALREADY_EXISTS'],
 ['existing_helper',`create function private.knowledge_context_chars(text) returns integer language sql as $$select 0$$;`,'PASSAGE_HELPER_ALREADY_EXISTS'],
]){
 await assert.rejects(sql(`begin;${baseline}${tamper}${guard}rollback;`,'perf_passage_guard'),new RegExp(code));
 console.log('PASS rejects '+name+' drift');
}
if(process.argv.includes('--release')){
 const body=path=>readFileSync(path,'utf8').replace(/^\s*(begin|commit);\s*$/gmi,'');
 const ids=signatures.map(s=>`'${s}'::regprocedure`).join(',');
 const catalog=`select oid,md5(prosrc) body,proowner,proacl,prosecdef,proconfig from pg_proc where oid in (${ids})`;
 await sql(`begin;${baseline}
 create temporary table release_original as ${catalog};
 ${body('supabase/migrations/20261102121201_approved_knowledge_passages.sql')}
 ${readFileSync('scripts/performance/knowledge-passages.test.sql','utf8')}
 ${readFileSync('scripts/performance/knowledge-passages-reader.test.sql','utf8')}
 ${body('scripts/performance/knowledge-passages-rollback.sql')}
 do $$begin
 if exists(select * from release_original except ${catalog})
 or exists(${catalog} except select * from release_original) then raise exception 'ROLLBACK_FUNCTION_PARITY_FAILED';end if;
 end;$$;
 rollback;`,'perf_passage_release');
 console.log('PASS assembled release tests and exact original function/owner/ACL rollback');
}
