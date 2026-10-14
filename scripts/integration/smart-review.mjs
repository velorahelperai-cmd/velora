// Isolated native G03/Auth/proof/CAS checks. The channel projection is a fixture;
// its financial producer has separate native acceptance tests. No provider/env access.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {startStack,lit} from './local-http-stack.mjs';
const enterprise=await readFile(process.argv[2]??'supabase/migrations/20261014025849_enterprise_branch_authority.sql','utf8');
const stack=await startStack({gatewayPort:3530,authPort:3540,restPort:3541,throughMigration:'20261009215520_g03_verified_review.sql',progress:console.log});
let passed=0;const eq=(a,b,label)=>{assert.deepEqual(a,b,label);passed++;};
try{
 await stack.sql('begin;'+await readFile('supabase/migrations/20261011160000_vel_staff_invitation_recovery.sql','utf8')+'commit;');
 await stack.sql(enterprise);await stack.sql(await readFile('supabase/migrations/20261014031209_smart_progressive_onboarding.sql','utf8'));
 const guardSql="select p.oid::regprocedure::text as name,md5(p.prosrc) as digest from pg_proc p where p.oid in ('private.g03_lock_actor(uuid,text,uuid)'::regprocedure,'public.g03_complete_review_check(uuid,jsonb)'::regprocedure,'public.g03_publish_prepared_file(uuid,uuid,uuid,uuid,integer,text,text,text,bigint,uuid,timestamp with time zone)'::regprocedure,'private.g03_prepared_file_guard()'::regprocedure) order by name";
 const guards=await stack.rows(guardSql);
 // This checkpoint predates channel billing. Never replace a real projection.
 eq((await stack.rows("select to_regprocedure('private.company_channel_contract(uuid)')::text as name"))[0].name,null,'explicit channel fixture prerequisite');
 await stack.sql("create table private.smart_review_contract_fixture(company_id uuid primary key,payload jsonb not null);create function private.company_channel_contract(cid uuid) returns jsonb language sql as $$select payload from private.smart_review_contract_fixture where company_id=cid$$;revoke all on private.smart_review_contract_fixture from public,anon,authenticated,service_role;");
 eq((await stack.rows("select to_regclass('private.smart_review_policy')::text as name"))[0].name,null,'RED: native smart review rollout absent');
 await stack.sql(await readFile('supabase/migrations/20261014040120_smart_channel_independent_review.sql','utf8'));
 eq(await stack.rows(guardSql),guards,'file/actor/proof completion guards unchanged');
 await stack.sql("notify pgrst,'reload schema';");
 const owner=await stack.adminCreateUser(),stranger=await stack.adminCreateUser(),company=randomUUID(),source=randomUUID(),plan=randomUUID();
 await stack.sql(`insert into public.companies(id,display_name,business_type,country,hours,status,created_by) values('${company}','Review fixture','retail','OM','','setup','${owner.id}');insert into public.company_members(company_id,user_id,role,status) values('${company}','${owner.id}','owner','active');insert into public.knowledge_sources(id,company_id,kind,title,content,status,created_by) values('${source}','${company}','text','Fixture knowledge','Synthetic approved facts','ready','${owner.id}');begin;set local velora.knowledge_approval='1';update public.knowledge_sources set approved_for_answers=true,approved_version=content_version where id='${source}';commit;`);
 const tokens=new Map();
 async function rpc(user,name,args={},service=false){const response=await fetch(`${stack.url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:service?stack.serviceRoleKey:stack.anonKey,Authorization:`Bearer ${service?stack.serviceRoleKey:tokens.get(user.id)}`,'Content-Type':'application/json'},body:JSON.stringify(args)});const data=await response.json();return {status:response.status,data};}
 for(const user of [owner,stranger]){const response=await fetch(`${stack.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:stack.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:user.password})});assert.equal(response.status,200);tokens.set(user.id,(await response.json()).access_token);eq((await rpc(user,'check_app_session',{p_touch:true})).data.ok,true,'native session');}
 eq((await rpc(owner,'save_smart_branch_setup',{p_company_id:company,p_expected_revision:0,p_mode:'single',p_primary_name:'Main',p_expected_primary_name:'Review fixture'})).data.ok,true,'confirmed branch scope');
 const contract={companyId:company,planVersionId:plan,plan_entitlements:{status:'approved',channelCount:1},selected_channels:{planVersionId:plan,revision:1,channels:['instagram']},subscription:{state:'active',expiresAt:'2030-01-01T00:00:00Z'}};
 await stack.sql(`insert into private.smart_review_contract_fixture values('${company}',${lit(JSON.stringify(contract))}::jsonb);`);
 const intent={p_action:'submit',p_company_id:company,p_number_ownership:'not_applicable',p_whatsapp_number:'',p_readiness_confirmed:true};
 eq((await rpc(owner,'g03_begin_review_check',intent)).data.code,'PROFILE_INCOMPLETE','policy off preserves legacy required hours');
 await stack.sql("update private.smart_review_policy set enabled=true,approval_reference='LOCAL-TEST-ONLY';");
 eq((await rpc(stranger,'g03_begin_review_check',intent)).status,403,'cross tenant review denied');
 eq((await rpc(owner,'g03_begin_review_check',{...intent,p_number_ownership:'new'})).status,400,'Instagram-only cannot request a WhatsApp number');
 eq((await rpc(owner,'transition_company_review',intent)).data.code,'PROOF_REQUIRED','browser readiness alone is not proof');
 const begun=await rpc(owner,'g03_begin_review_check',intent);eq(begun.data.ok,true,'blank-hours Instagram-only native review');eq(begun.data.files,[],'text proof needs no provider');
 eq((await rpc(owner,'g03_complete_review_check',{p_check_id:begun.data.check_id,p_observations:[]})).status,403,'customer cannot complete server proof');
 eq((await rpc(owner,'g03_complete_review_check',{p_check_id:begun.data.check_id,p_observations:[]},true)).data.ok,true,'service completes native proof');
 const submitted=await rpc(owner,'transition_company_review',intent);eq(submitted.data.ok,true,'native review committed');eq(submitted.data.request.number_ownership,'not_applicable','honest channel-independent receipt');eq(submitted.data.request.whatsapp_number,'','no copied channel number');
 eq((await stack.rows(`select private.g03_proof_current('${company}') as current`))[0].current,true,'current native manifest');
 const changed={...contract,selected_channels:{...contract.selected_channels,revision:2,channels:['whatsapp']}};
 await stack.sql(`update private.smart_review_contract_fixture set payload=${lit(JSON.stringify(changed))}::jsonb where company_id='${company}';`);
 eq((await stack.rows(`select private.g03_proof_current('${company}') as current`))[0].current,false,'channel change invalidates review');
 eq((await rpc(owner,'g03_begin_review_check',{...intent,p_action:'resubmit',p_expected_revision:1})).status,400,'WhatsApp selection cannot use not-applicable ownership');
 await stack.sql(`update public.knowledge_sources set content='Changed unapproved facts' where id='${source}';`);
 eq((await rpc(owner,'g03_begin_review_check',{...intent,p_action:'resubmit',p_expected_revision:1,p_number_ownership:'own',p_whatsapp_number:'+96890000000'})).data.code,'KNOWLEDGE_INCOMPLETE','knowledge approval remains mandatory');
 eq((await stack.rows("select has_function_privilege('anon','public.smart_review_configuration(uuid)','execute') as allowed"))[0].allowed,false,'anonymous policy read denied');
 console.log(`SMART_REVIEW_NATIVE_PASS:${passed}; CHANNEL_PROJECTION_FIXTURE_ONLY`);
}finally{await stack.close();}
