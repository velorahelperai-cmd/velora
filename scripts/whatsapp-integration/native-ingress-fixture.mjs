// Test-only local PostgreSQL fixture for the original signed webhook route.
import pg from 'pg';
import {normalize,resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

export async function findSyntheticTemplate(control,base){
 const candidates=(await control.query("select datname from pg_database where datname ~ '^velora_runtime_[a-f0-9]{32}$' order by datname")).rows;
 for(const {datname} of candidates){
  const check=new pg.Client({...base,database:datname});
  try{
   await check.connect();
   const result=await check.query("select count(*)::int n from supabase_migrations.schema_migrations");
   if(result.rows[0].n===118)return datname;
  }catch{/* A shorter failed replay is not a suitable fixture. */}
  finally{await check.end();}
 }
 throw Error('SYNTHETIC_REPLAY_TEMPLATE_MISSING: run bootstrap-native-isolated.mjs and inspect its reported blocker');
}

export async function nativeIngressFixture(){
 const base={host:'127.0.0.1',port:55439,user:'postgres',database:'postgres',connectionTimeoutMillis:3000};
 const expected=normalize(resolve('.git/velora-isolated-pg/data')).toLowerCase();
 const control=new pg.Client(base);
 await control.connect();
 if(normalize((await control.query('show data_directory')).rows[0].data_directory).toLowerCase()!==expected)throw Error('REFUSE_NON_ISOLATED_DATABASE');
 const template=await findSyntheticTemplate(control,base);
 assert.match(template,/^velora_runtime_[a-f0-9]{32}$/);
 const database=`velora_ingress_${randomUUID().replaceAll('-','')}`;
 await control.query(`create database ${database} template ${template}`);
 const db=new pg.Client({...base,database});await db.connect();
 await db.query("alter table public.whatsapp_inbound_jobs add column response_kind text check(response_kind is null or response_kind='fixed_ack_v1'); alter table public.whatsapp_send_intents add column response_kind text check(response_kind is null or response_kind='fixed_ack_v1')");
 await db.query("create or replace function public.whatsapp_worker_live_active() returns boolean language sql stable security definer set search_path='' as $$select true;$$; revoke all on function public.whatsapp_worker_live_active() from public,anon,authenticated; grant execute on function public.whatsapp_worker_live_active() to service_role;");
 await db.query((await readFile('scripts/whatsapp-integration/fixtures.sql','utf8')).replace(/\r\n/g,'\n'));
 const tenant=(await db.query('select test_fixture.company(false,10) f')).rows[0].f;
 const asset=(await db.query('select l.provider_phone_number_id phone,l.provider_waba_id waba,c.customer_wa_id recipient from public.whatsapp_company_links l join public.whatsapp_conversations c on c.company_id=l.company_id where l.id=$1 and c.id=$2',[tenant.link,tenant.conversation])).rows[0];
 const allowed=new Set(['resolve_whatsapp_company_by_meta_asset','whatsapp_store_meta_inbound',
  'whatsapp_redeem_worker_tick','whatsapp_repair_accepted_jobs','whatsapp_claim_inbound_batch','whatsapp_check_service_window',
  'es02_classify_claimed_reply','billing_load_worker_frame','whatsapp_reserve_job_usage','whatsapp_read_answer_profile',
  'whatsapp_retrieve_approved_knowledge','whatsapp_read_link_access_secret','ai_reserve_whatsapp_capacity_cost_attempt',
  'ai_reserve_whatsapp_profile_attempt','ai_start_whatsapp_attempt','ai_settle_whatsapp_attempt',
  'whatsapp_stage_job_reply','whatsapp_claim_assistant_job_send','finalize_whatsapp_send_attempt',
  'billing_finalize_automated_usage','retry_whatsapp_send_persist','whatsapp_retry_inbound_job','whatsapp_heartbeat_inbound_job',
  'whatsapp_worker_live_active','es02_verify_claimed_reply_citations']);
 const adapter={rpc:async(name,args)=>{
  if(!allowed.has(name))throw Error(`RPC_OUTSIDE_TEST_SCOPE:${name}`);
  const keys=Object.keys(args);if(keys.some(key=>!/^[a-z_][a-z0-9_]*$/.test(key)))throw Error('BAD_ARGUMENT');
  const client=new pg.Client({...base,database});
  try{
   await client.connect();await client.query('set role service_role');
   const result=await client.query(`select public."${name}"(${keys.map((key,i)=>`"${key}"=>$${i+1}`).join(',')}) value`,keys.map(key=>Array.isArray(args[key])&&key!=='p_test_recipients'?JSON.stringify(args[key]):args[key]));
   if(process.env.WA_NATIVE_VERBOSE==='1'&&result.rows[0].value?.ok===false)console.error('SYNTHETIC_RPC_REJECTED',name,result.rows[0].value.code);
   return {data:result.rows[0].value,error:null};
  }catch(error){if(process.env.WA_NATIVE_VERBOSE==='1')console.error('SYNTHETIC_RPC_ERROR',name,error.message);return {data:null,error:{message:error.message}};}
  finally{await client.end();}
 },from:table=>{
  if(table!=='knowledge_sources'&&table!=='whatsapp_send_intents')throw Error('TABLE_OUTSIDE_TEST_SCOPE');
  let fields='*',isUpdate=false;
  const updateCols=[],conditions=[],values=[];
  const ident=x=>{if(!/^[a-z_][a-z0-9_]*$/.test(x))throw Error('INVALID_IDENTIFIER');return `"${x}"`;};
  const run=async()=>{const client=new pg.Client({...base,database});try{
   await client.connect();await client.query('set role service_role');
   let sqlQuery;
   if(isUpdate){
    const setClause=updateCols.map((col,i)=>`${ident(col)}=$${i+1}`).join(',');
    const whereClause=conditions.length?` where ${conditions.join(' and ')}`:'';
    sqlQuery=`update public."${table}" set ${setClause}${whereClause} returning ${fields}`;
   }else{
    const whereClause=conditions.length?` where ${conditions.join(' and ')}`:'';
    sqlQuery=`select ${fields} from public."${table}"${whereClause}`;
   }
   const result=await client.query(sqlQuery,values);
   return {data:result.rows,error:null};
  }catch(error){return {data:null,error:{message:error.message}};}finally{await client.end();}};
  const query={
   update:patch=>{
    isUpdate=true;
    for(const [col,val] of Object.entries(patch)){
     updateCols.push(col);
     values.push(val);
    }
    return query;
   },
   select:columns=>{fields=columns.split(',').map(x=>ident(x.trim())).join(',');return query;},
   eq:(key,value)=>{values.push(value);conditions.push(`${ident(key)}=$${values.length}`);return query;},
   in:(key,items)=>{values.push(items);conditions.push(`${ident(key)}=any($${values.length})`);return query;},
   then:(ok,fail)=>run().then(ok,fail)
  };
  return query;
 }};
 async function legacyPaidTenant(){
  // Empty ES02 tables represent a legacy tenant; classifier is the exact
  // product function, not a substitute for ES02 authorization testing.
  await db.query(`create table private.es02_activation_foundation(company_id uuid primary key);
   create table private.es02_operational_recipient_proofs(job_id uuid,company_id uuid,branch_id uuid,recipient_class text,inbound_binding text);
   create function pg_temp.synthetic_terms() returns trigger language plpgsql as $$begin
    insert into private.master_checkout_terms(plan_version_id,terms_version,terms_text,features_version,features,disclosed_charges,approval_reference)
    values(new.id,'synthetic','synthetic','synthetic','[]','[]','synthetic fixture');return new;end$$;
   create trigger synthetic_terms after insert on public.billing_plan_versions for each row execute function pg_temp.synthetic_terms();
   alter function test_fixture.company(boolean,integer) security definer;`);
  const source=await readFile('supabase/migrations/20261022040333_es02_operational_credit_acceptance.sql','utf8');
  const classifier=source.match(/create function public\.es02_classify_claimed_reply\([\s\S]*?end;\$\$;/i);
  assert.ok(classifier,'ES02 classifier source changed');await db.query(classifier[0]);
  await db.query('revoke all on function public.es02_classify_claimed_reply(uuid,uuid,text,text,text[]) from public,anon,authenticated,service_role; grant execute on function public.es02_classify_claimed_reply(uuid,uuid,text,text,text[]) to service_role');
  // Reuse the established service-entitlement fixture transformations, so an
  // authentic synthetic paid receipt and active service authorize this job.
  let entitlementFixture=(await readFile('scripts/whatsapp-integration/fixtures.sql','utf8')).replaceAll("30,'day',30","30,'month',1");
  const anchor="values(v,p,pv,5000,'OMR',30,'month',1,'published',jsonb_build_object('automated_outbound_per_month',p_cap));";
  assert.ok(entitlementFixture.includes(anchor),'service fixture plan anchor changed');
  entitlementFixture=entitlementFixture.replace(anchor,"values(v,p,pv,5000,'OMR',30,'month',1,'draft',jsonb_build_object('automated_outbound_per_month',p_cap));\n perform public.billing_define_service_offer(v,'noura','basic',array['noura.knowledge.read']);\n update public.billing_plan_versions set status='published' where id=v;");
  entitlementFixture=entitlementFixture.replace('status,product_code,purchase_purpose,created_by,deadline_policy_approved)', 'status,product_code,purchase_purpose,created_by,deadline_policy_approved,created_at)').replace("'locked','velora_ai_staff','initial',u,true);","'locked','velora_ai_staff','initial',u,true,clock_timestamp());");
  const attemptAnchor=' insert into billing_payment_attempts(id,order_id,company_id,status,provider_order_id)';
  assert.ok(entitlementFixture.includes(attemptAnchor),'service fixture order anchor changed');
  entitlementFixture=entitlementFixture.replace(attemptAnchor," r:=public.billing_snapshot_service_order(o);if r->>'ok' is distinct from 'true' then raise exception 'Synthetic snapshot denied: %',r;end if;\n"+attemptAnchor);
  await db.query(entitlementFixture.replace(/\r\n/g,'\n'));
  await db.query('alter function test_fixture.company(boolean,integer) security definer');
  await db.query('set role service_role');
  const paid=(await db.query('select test_fixture.company(true,10) f')).rows[0].f;
  await db.query('reset role');
  const grant=(await db.query('select g.entitlement_application_id id from private.billing_service_grants g join public.billing_orders o on o.id=g.order_id where o.company_id=$1',[paid.company])).rows[0];
  assert.ok(grant?.id,'synthetic accepted receipt did not create a service grant');
  await db.query('set role service_role');
  const activation=(await db.query('select public.billing_activate_service_grant($1,true) r',[grant.id])).rows[0].r;
  assert.equal(activation.ok,true,'synthetic service grant activation failed');
  await db.query('select test_fixture.ai_budget($1::uuid,10)',[paid.company]);await db.query('reset role');
  const paidAsset=(await db.query('select l.provider_phone_number_id phone,l.provider_waba_id waba,c.customer_wa_id recipient from public.whatsapp_company_links l join public.whatsapp_conversations c on c.company_id=l.company_id where l.id=$1 and c.id=$2',[paid.link,paid.conversation])).rows[0];
  return {tenant:paid,asset:paidAsset};
 }
 return {db,tenant,asset,adapter,legacyPaidTenant,close:async()=>{await db.end();await control.end();}};
}
