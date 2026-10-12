import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {setup as sendSetup,reset as sendReset,id,sql,lit,conv,prefix,claim,settle,project} from './fixture.mjs';
import {file} from '../instagram-connection/postgres.mjs';
import {billingMigrations} from '../billing-acceptance/postgres.mjs';
import {manualOrder,storedEvent,settle as billingSettle} from '../financial-proof-cloud/stage2a-fixtures.mjs';
export {id,sql,lit,conv,prefix,claim,settle,project};
export const migration='supabase/migrations/20261011212721_vel_instagram_manual_reply_producers.sql';
export const fingerprint=createHash('sha256').update('synthetic-parent-secret').digest('hex');
// All payment evidence here is synthetic stored server-attestation, never provider
// verification. Actual checked-in billing views/triggers/settlement are exercised.
const ownerProvision={sql:q=>sql(q.replaceAll('SET LOCAL ROLE service_role','RESET ROLE').replaceAll('SET ROLE service_role','RESET ROLE'))};
export async function setup(){
 await sendSetup();
 await sql("create function public.is_platform_owner() returns boolean language sql stable as $$select false$$;");
 for(const name of billingMigrations())await file('supabase/migrations/'+name);
 const source=readFileSync('supabase/migrations/20261010053446_service_entitlement_read_contract.sql','utf8');
 const start=source.indexOf('create function private.billing_service_receipt_eligible('),end=source.indexOf(';',source.indexOf('revoke all on function private.billing_service_receipt_eligible',start))+1;
 if(start<0||end<start)throw Error('MISSING_ACTUAL_LIFECYCLE_SOURCE');
 await sql(source.slice(start,end));
 await file(migration);
}
export async function reset(){
 await sql("do $$declare t record;begin for t in select tablename from pg_tables where schemaname='public' and tablename like 'billing_%' loop execute format('alter table public.%I disable trigger all',t.tablename);end loop;end;$$;");
 try{
 await sql('truncate public.billing_settlement_outcomes,public.billing_provider_events,public.billing_entitlement_applications,public.billing_subscriptions,public.billing_payment_attempts,public.billing_orders,public.billing_plan_versions,public.billing_plans,private.instagram_inbound_signatures,private.instagram_manual_contracts cascade');
 await sendReset();
 // Old fixture proof rows stay as negative evidence. New producer must ignore them.
 await sql('truncate private.instagram_send_windows');
 }finally{await sql("do $$declare t record;begin for t in select tablename from pg_tables where schemaname='public' and tablename like 'billing_%' loop execute format('alter table public.%I enable trigger all',t.tablename);end loop;end;$$;");}
}
export async function paid(environment='live'){
 const f={company:id(1),user:id(11),plan:randomUUID(),version:randomUUID(),account:'74001'};
 await sql(`insert into public.billing_plans(id,code,name,status) values('${f.plan}','synthetic-${f.plan}','Synthetic manual paid','active');
 insert into public.billing_plan_versions(id,plan_id,version,amount_baisa,currency,period_days,period_unit,period_count,status)
 values('${f.version}','${f.plan}',1,5000,'OMR',30,'day',30,'published');`);
 const order=await manualOrder(ownerProvision,f,{environment,approval:true});
 const event=await storedEvent(ownerProvision,f,order);
 const result=await billingSettle({sql},event.evidence);
 if(!result.ok||!result.entitlement_application_id)throw Error('ACTUAL_SYNTHETIC_BILLING_SETTLEMENT_FAILED');
 return {...f,...order,...event,proof:result.entitlement_application_id};
}
export async function installed(unit='unix_ms'){
 await sql(`insert into private.instagram_manual_contracts(id,parent_app_id,secret_fingerprint,installation_proof_ref,provider_fixture_proof_ref,timestamp_unit,timestamp_proof_ref,verified_at)
 values('manual_text','1000','${fingerprint}','synthetic-installation','synthetic-provider-fixture',${unit===null?'null':lit(unit)},${unit===null?'null':"'synthetic-timestamp'"},clock_timestamp());`);
}
export function batch(mid='mid.signed',timestamp=Date.now()-60000,extra={}){
 return {rawBodySha256:'b'.repeat(64),localReceivedAt:new Date().toISOString(),events:[{kind:'message',professionalAccountId:'100',senderId:'200',recipientId:'100',messageId:mid,direction:'inbound',isEcho:null,content:{kind:'text',text:'synthetic signed inbound'},rawTimestamp:timestamp,...extra}]};
}
export const signed=(b=batch(),fp=fingerprint)=>sql(`set role service_role;set request.jwt.claims='{"role":"service_role"}';select public.instagram_ingest_signed_webhook(${lit(JSON.stringify(b))}::jsonb,'1000',${lit(fp)})`).then(JSON.parse);
export const save=async(user=11,sid=21,intent=401,text=' exact saved reply ',conversation)=>sql(`${prefix(user,sid)}select public.instagram_save_reply('${id(1)}','${conversation??await conv()}','${id(intent)}',${lit(text)})`).then(JSON.parse);
export const get=async(user=11,sid=21,intent=401)=>sql(`${prefix(user,sid)}select public.instagram_get_reply('${id(1)}','${await conv()}','${id(intent)}')`).then(JSON.parse);
export const ready=async(user=11,sid=21)=>sql(`${prefix(user,sid)}select public.instagram_send_readiness('${id(1)}','${await conv()}')`).then(JSON.parse);
