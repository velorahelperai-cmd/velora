import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createClient} from '@supabase/supabase-js';
import {basename,resolve} from 'node:path';
import {readFileSync} from 'node:fs';
export async function inspectBrokerContractDrift(stack,lit){
 const source=readFileSync('supabase/migrations/20261016170000_wp01a_session_broker_correction_c5_r4.sql','utf8');
 const start=source.indexOf('create or replace function private.vel_broker_capability_contract_matches()'),end=source.indexOf('alter function private.vel_broker_capability_contract_matches()',start);
 if(start<0||end<0)return {inspection:'SOURCE_NOT_FOUND'};
 const definition=source.slice(start,end),expected=tag=>{const marker=`$${tag}$`,a=definition.indexOf(marker),b=definition.indexOf(marker,a+marker.length);if(a<0||b<0)throw Error('CAPABILITY_SPEC_NOT_FOUND');return JSON.parse(definition.slice(a+marker.length,b));};
 const functions=expected('functions'),columns=expected('columns'),tables=expected('tables');
 const mismatches=await stack.rows(`
  with expected as (select * from jsonb_to_recordset(${lit(JSON.stringify(functions))}::jsonb) e(sig text,body text,result text,owner text,acl text,config jsonb,security boolean,volatility text)),
  actual as (select p.oid,p.prosrc,md5(replace(p.prosrc,chr(13),'')) body,pg_get_function_result(p.oid) result,pg_get_userbyid(p.proowner) owner,p.proacl::text acl,to_jsonb(p.proconfig) config,p.prosecdef security,p.provolatile::text volatility from pg_proc p)
  select 'function' kind,e.sig identity,jsonb_strip_nulls(jsonb_build_object('missing',case when a.oid is null then true end,'body',case when a.body is distinct from e.body then true end,'result',case when a.result is distinct from e.result then true end,'owner',case when a.owner is distinct from e.owner then true end,'acl',case when a.acl is distinct from e.acl then true end,'config',case when a.config is distinct from e.config then true end,'security',case when a.security is distinct from e.security then true end,'volatility',case when a.volatility is distinct from e.volatility then true end)) fields from expected e left join actual a on a.oid=to_regprocedure(e.sig) where a.oid is null or a.body is distinct from e.body or a.result is distinct from e.result or a.owner is distinct from e.owner or a.acl is distinct from e.acl or a.config is distinct from e.config or a.security is distinct from e.security or a.volatility is distinct from e.volatility
  union all
  select 'column',e.relation||'.'||e.name,jsonb_strip_nulls(jsonb_build_object('type',case when format_type(a.atttypid,a.atttypmod) is distinct from e.type then true end,'required',case when a.attnotnull is distinct from e.required then true end)) from jsonb_to_recordset(${lit(JSON.stringify(columns))}::jsonb) e(relation text,name text,type text,required boolean) left join pg_attribute a on a.attrelid=to_regclass(e.relation) and a.attname=e.name and a.attnum>0 and not a.attisdropped where a.attrelid is null or format_type(a.atttypid,a.atttypmod) is distinct from e.type or a.attnotnull is distinct from e.required
  union all
  select 'table',e.relation,jsonb_strip_nulls(jsonb_build_object('owner',case when pg_get_userbyid(c.relowner) is distinct from e.owner then true end,'acl',case when c.relacl::text is distinct from e.acl then true end,'rls',case when c.relrowsecurity is distinct from e.rls then true end)) from jsonb_to_recordset(${lit(JSON.stringify(tables))}::jsonb) e(relation text,owner text,acl text,rls boolean) left join pg_class c on c.oid=to_regclass(e.relation) where c.oid is null or pg_get_userbyid(c.relowner) is distinct from e.owner or c.relacl::text is distinct from e.acl or c.relrowsecurity is distinct from e.rls
  limit 25`);
 return {mismatches};
}
export async function run(ctx){
 const {stack,lit}=ctx;
 await ctx.case('W05R_SUPPORTED_TEST_ORDER_CANNOT_AUTHORIZE_LIVE_WORKER',async()=>{
  let safeStage='create_test_actor';
  try{
  const user=await stack.adminCreateUser('native-test-order-'+randomUUID()+'@example.invalid');await ctx.command('classify',{target:user.id,isTest:true});
  safeStage='bundle_broker_helpers';
  let bundle;try{bundle=await build({entryPoints:['scripts/account-deletion/broker-session-fixture.ts'],bundle:true,write:false,format:'cjs',platform:'node',tsconfig:'tsconfig.json',alias:{'@':resolve(process.cwd(),'src')},plugins:[{name:'test-server-only',setup(p){p.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'empty'}));p.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:''}));}}]});}catch(error){if(Array.isArray(error.errors))error.safeBuildErrors=error.errors.map(item=>({file:item.location?.file?basename(item.location.file):undefined,text:String(item.text).replace(/[^a-zA-Z0-9_@./:-]/g,' ').slice(0,120)}));throw error;}
  const mod={exports:{}},priorNodeEnv=process.env.NODE_ENV;process.env.NODE_ENV='production';safeStage='load_broker_helpers';try{new Function('module','exports','require',bundle.outputFiles[0].text)(mod,mod.exports,createRequire(import.meta.url));}finally{if(priorNodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=priorNodeEnv;}
  safeStage='broker_capability_preflight';const capability=await createClient(stack.url,stack.serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}}).rpc('vel_broker_capability_probe');
  if(capability.error)throw new Error(`BROKER_CAPABILITY_RPC_${capability.error.code}`);
  if(capability.data?.ok!==true){const codes=Array.isArray(capability.data?.codes)?capability.data.codes.filter(code=>/^[A-Z0-9_]+$/.test(code)).join('_'):'UNAVAILABLE';const failure=Error(`BROKER_CAPABILITY_${codes}`);try{failure.safeCapabilityDrift=await inspectBrokerContractDrift(stack,lit);}catch(error){const message=String(error?.message??'');failure.safeStage='broker_contract_diagnostics';failure.safeCause=error?.name==='SyntaxError'?'BROKER_CONTRACT_SPEC_JSON_INVALID':/syntax error/i.test(message)?'BROKER_CONTRACT_SQL_SYNTAX_ERROR':/operator does not exist/i.test(message)?'BROKER_CONTRACT_SQL_OPERATOR_MISMATCH':/column "([a-z0-9_]+)" does not exist/i.test(message)?`BROKER_CONTRACT_COLUMN_${message.match(/column "([a-z0-9_]+)"/i)?.[1]?.toUpperCase()}`:/permission denied/i.test(message)?'BROKER_CONTRACT_CATALOG_ACCESS_DENIED':'BROKER_CONTRACT_DIAGNOSTICS_UNAVAILABLE';}throw failure;}
  safeStage='broker_session';
  const session=await mod.exports.createBrokeredLocalSession(stack,user);const claims=session.tokenClaims;
  const actorSql=async sql=>stack.sql(`begin;set local role authenticated;set local request.jwt.claims=${lit(JSON.stringify(claims))};${sql};commit;`);
  safeStage='broker_session_validation';
  const sessionCheck=JSON.parse(await actorSql('select public.check_app_session(true)'));assert.equal(sessionCheck.ok,true,'BROKERED_NATIVE_SESSION_VALID');
  safeStage='native_order_creation';
  const created=JSON.parse(await actorSql(`select public.es02_create_account_order('${user.id}','${randomUUID()}','monthly','[{"persona":"level_1","package":"basic"}]'::jsonb,true)`));assert.equal(created?.ok,true,`NATIVE_TEST_ORDER_CREATE_${created?.code??'MALFORMED'}`);
  const [o]=await stack.rows(`select id,payment_attempt_id,special_reference,amount_baisa,currency,original_order_group_id from private.es02_account_orders where account_id='${user.id}'`);assert(o,'NATIVE_TEST_ORDER_REQUIRED');
  const input={evidence_marker:'VEL_ES02_SYNTHETIC_LOCAL_ONLY',authenticity:{source:'es02_synthetic_local',verified:true,method:'synthetic_local_only'},account_id:user.id,order_id:o.id,payment_attempt_id:o.payment_attempt_id,special_reference:o.special_reference,amount_baisa:o.amount_baisa,currency:o.currency,provider_transaction_id:'offline-'+randomUUID(),event_status:'success'};
  safeStage='synthetic_local_settlement';const settled=JSON.parse(await stack.sql(`begin;set local role service_role;set local request.jwt.claims='{"role":"service_role"}';set local velora.es02_fixture='on';select public.es02_settle_account_order_synthetic(${lit(JSON.stringify(input))}::jsonb);commit;`));if(settled.ok!==true)throw Error(`NATIVE_TEST_SETTLEMENT_${/^[A-Z_]+$/.test(settled?.code??'')?settled.code:'MALFORMED'}`);
  const company={name:'Offline native Test fixture',type:'restaurant',country:'OM',city:'Muscat',phone:'+96800000001'};
  safeStage='local_paid_provisioning';
  const provisioned=JSON.parse(await actorSql(`select public.es02_provision_owned_purchase('${user.id}','${o.id}','${randomUUID()}',${lit(JSON.stringify(company))}::jsonb,'[{"name":"Primary","city":"Muscat"}]'::jsonb)`));if(provisioned.ok!==true)throw Error(`NATIVE_TEST_PROVISIONING_${/^[A-Z_]+$/.test(provisioned?.code??'')?provisioned.code:'MALFORMED'}`);
  const [r]=await stack.rows(`select o.environment,o.settlement_authority,o.provisioned_company_id company,b.id branch from private.es02_account_orders o join company_branches b on b.company_id=o.provisioned_company_id where o.id='${o.id}'`);assert(r);
  const gate=JSON.parse(await stack.sql(`set role postgres;select private.es02_paid_branch_readiness('${r.company}','${r.branch}')`));assert.equal(gate.code,'VERIFIED_LIVE_ES02_PAYMENT_REQUIRED');
  return {nativeTestOrder:true,nativeSyntheticSettlement:true,nativeProvisioning:true,environment:r.environment,settlementAuthority:r.settlement_authority,workerGate:gate.code,noLiveHmacFabrication:true,noProviderRequests:true};
  }catch(error){error.safeStage=safeStage;throw error;}
 });
}
