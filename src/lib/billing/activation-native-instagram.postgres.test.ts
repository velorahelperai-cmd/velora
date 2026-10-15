import {beforeAll,afterAll,beforeEach,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
// @ts-expect-error Existing guarded networkless fixture, no provider execution.
import {setup as sendSetup} from '../../../scripts/instagram-send/fixture.mjs';
// @ts-expect-error Existing native payment and Instagram fixtures.
import {reset,id,sql,paid,installed,signed,save,claim,settle} from '../../../scripts/instagram-send/manual-fixture.mjs';
// @ts-expect-error Existing guarded fixture.
import {file,cleanup} from '../../../scripts/instagram-connection/postgres.mjs';
// @ts-expect-error Read-only local migration enumeration.
import {billingMigrations} from '../../../scripts/billing-acceptance/postgres.mjs';
const server=`set role service_role;set request.jwt.claims='{"role":"service_role"}';`;
const rpc=(n:string,a:string)=>sql(server+`select public.${n}(${a})`).then(JSON.parse);
async function native(source:string,name:string){const s=readFileSync('supabase/'+source,'utf8');const start=new RegExp('create(?: or replace)? function '+name.replaceAll('.','\\.')+'\\(').exec(s)?.index;if(start===undefined)throw Error('NATIVE_MISSING '+name);await sql(s.slice(start,s.indexOf('$$;',start)+3));}
beforeAll(async()=>{
 await sendSetup();await sql(`create function public.is_platform_owner() returns boolean language sql stable as $$select false$$;`);
 for(const n of billingMigrations().filter((n:string)=>n<'20261009000000'))await file('supabase/migrations/'+n);
 const services=readFileSync('supabase/migrations/20261010053446_service_entitlement_read_contract.sql','utf8');const start=services.indexOf('create function private.billing_service_receipt_eligible('),end=services.indexOf(';',services.indexOf('revoke all on function private.billing_service_receipt_eligible',start))+1;await sql(services.slice(start,end));
 await file('supabase/migrations/20261011212721_vel_instagram_manual_reply_producers.sql');
 // Actual Instagram/payment schemas stay intact. Only unused WA/lifecycle
 // dependency ports are supplied, explicitly separate from readiness proof.
 const d=readFileSync('scripts/master-activation/dependencies.sql','utf8');
 await sql(d.slice(d.indexOf('create table public.whatsapp_company_links'),d.indexOf('create table private.instagram_company_links')));
 await sql(`alter table auth.users add column phone text,add column deleted_at timestamptz,add column banned_until timestamptz;alter table private.instagram_company_generations add column bound_account_id text;create table public.whatsapp_inbound_jobs(id uuid,company_id uuid);`);
 await sql(d.slice(d.indexOf('create function private.billing_lifecycle_deadline'),d.indexOf('create table private.fixture_settlement_calls')));
 for(const n of ['private.billing_lifecycle_receipt','private.billing_chat_access','private.billing_chat_send','private.billing_cancel_old_expiry','public.billing_run_expiry_company'])await native('migrations/20261013200416_subscription_lifecycle_v2.sql',n);
 for(const n of ['public.billing_read_company_operational_entitlement','public.billing_read_company_journey','public.billing_cancel_at_period_end'])await native('migrations/20261008100000_vel_billing_legacy_evidence_upgrade_acceptance.sql',n);
 for(const n of ['public.billing_activate_service_grant','public.billing_read_service_access'])await native('migrations/20261010053446_service_entitlement_read_contract.sql',n);
 await native('migrations/20261010084102_noura_claimed_job_authority.sql','private.wa_noura_authority');
 await native('migrations/20261011233156_wa_coexistence_30_projection.sql','public.whatsapp_record_coexistence_outbound_proof');
 await file('supabase/migrations/20261014033000_channel_entitlement_contract.sql');await file('supabase/migrations/20261014033001_master_subscription_activation.sql');
},120000);
afterAll(cleanup);
beforeEach(async()=>{
 await sql(`truncate public.whatsapp_company_links,public.whatsapp_send_intents,public.whatsapp_messages,public.whatsapp_delivery_statuses,private.whatsapp_coexistence_connections,public.whatsapp_inbound_jobs,private.master_activation_outages,private.master_activation_bonus_claims,private.master_subscription_activation,private.master_activation_partial_disclosures cascade;update private.master_activation_policy set enabled=false,enabled_at=null,approval_reference=null;`);await reset();
 await sql(`update auth.users set phone='+96890000000',phone_confirmed_at=clock_timestamp() where id='${id(11)}';update private.instagram_company_generations g set bound_account_id=l.account_id from private.instagram_company_links l where l.company_id=g.company_id;
 update private.instagram_company_links set permissions=array['synthetic-permission','instagram_business_basic','instagram_business_manage_messages'];update private.instagram_oauth_attempts set permissions=array['synthetic-permission','instagram_business_basic','instagram_business_manage_messages'] where status='bound';`);
},120000);
async function waiting(){const p=await paid();await sql(`analyze;insert into private.plan_channel_entitlements(plan_version_id,channel_count,approval_reference) values('${p.version}',1,'OFFLINE_TEST');insert into private.company_selected_channels(company_id,plan_version_id,channels,revision,selected_by) values('${id(1)}','${p.version}',array['instagram'],1,'${id(11)}');update private.master_activation_policy set enabled=true,enabled_at=clock_timestamp()-interval '1 hour',approval_reference='OFFLINE_TEST';`);expect(await rpc('master_capture_subscription_activation',`'${id(1)}','${p.proof}'`)).toMatchObject({ok:true,data:{state:'waiting',operationalReady:false}});await installed();await signed();return p;}
it('actual native save, claim and offline acceptance break the readiness cycle while AI remains denied beforehand',async()=>{
 await waiting();expect(await sql(`select private.master_activation_can_operate('${id(1)}')`)).toBe('f');expect(await rpc('billing_read_company_operational_entitlement',`'${id(1)}'`)).toMatchObject({active:false});
 const r=await save();expect(r).toMatchObject({ok:true,state:'ready'});const c=await claim(r.binding);expect(c).toMatchObject({kind:'fresh',committed:true});
 expect(await sql(`select private.master_activation_can_operate('${id(1)}')`)).toBe('f');expect(await settle(r.binding,c.claimReceipt,{status:'accepted',recipientId:'200',messageId:'mid.offline.accepted'})).toMatchObject({ok:true});
 expect(await rpc('master_reconcile_subscription_activation',`'${id(1)}'`)).toMatchObject({ok:true,data:{state:'active',operationalReady:true}});
 expect(JSON.parse(await sql(`select private.company_channel_contract('${id(1)}')`)).subscription).toMatchObject({operationalReady:true,operationalReadyChannels:['instagram']});
},120000);
it('native WA AI and ingress deny a wrong selected channel despite company operational readiness',async()=>{
 // Offline accepted staff/delivery ports, qualified by the actual native proof
 // producer before this company enrolls in activation and selects Instagram.
 await sql(`insert into public.whatsapp_company_links(id,company_id,status,authorization_status,authorization_expires_at,inbound_tested_at) values('${id(901)}','${id(1)}','verified','active',clock_timestamp()+interval '2 days',clock_timestamp());insert into private.whatsapp_coexistence_connections values('${id(1)}','${id(901)}',1,'active');
 insert into public.whatsapp_send_intents values('${id(1)}','${id(901)}','${id(901)}','offline.previous','${id(901)}',1,'200','96890000001','accepted','staff',clock_timestamp(),'offline staff reply');insert into public.whatsapp_messages values('${id(1)}','${id(901)}','${id(901)}','offline.previous','staff','outbound','offline staff reply','delivered');insert into public.whatsapp_delivery_statuses values('${id(1)}','${id(901)}','offline.previous','200','96890000001','delivered',clock_timestamp(),'applied');`);
 const occurred=await sql(`select occurred_at from public.whatsapp_delivery_statuses where company_id='${id(1)}'`);expect(await rpc('whatsapp_record_coexistence_outbound_proof',`'100','200','offline.previous','delivered','96890000001','${occurred}'`)).toMatchObject({verified:true});
 await waiting();const r=await save(),c=await claim(r.binding);await settle(r.binding,c.claimReceipt,{status:'accepted',recipientId:'200',messageId:'mid.offline.ready'});await rpc('master_reconcile_subscription_activation',`'${id(1)}'`);
 expect(await sql(`select private.master_activation_can_operate('${id(1)}'),private.master_native_activation_channel_ready('${id(1)}','whatsapp')`)).toBe('t|t');await sql(`insert into public.whatsapp_inbound_jobs values('${id(900)}','${id(1)}');`);
 expect(JSON.parse(await sql(server+`select private.wa_noura_authority('${id(900)}','${id(902)}')`))).toMatchObject({ok:false,code:'CHANNEL_NOT_READY'});
 expect(JSON.parse(await sql(`select private.whatsapp_meta_asset_binding('100','200')`))).toMatchObject({ok:false,code:'CHANNEL_NOT_SELECTED'});
},120000);
it('deadline still permits the native human verification send but destroyed setup denies it',async()=>{
 await waiting();await sql(`update private.master_subscription_activation set activation_deadline=clock_timestamp()-interval '1 second';`);expect(await rpc('master_reconcile_subscription_activation',`'${id(1)}'`)).toMatchObject({data:{state:'active',operationalReady:false}});
 const r=await save();expect(await claim(r.binding)).toMatchObject({kind:'fresh'});
 await sql(`alter table public.companies add column if not exists setup_file_destruction_at timestamptz;update public.companies set setup_file_destruction_at=clock_timestamp() where id='${id(1)}';`);
 expect(await save(11,21,402)).toMatchObject({ok:false,code:'FORBIDDEN'});expect(await sql(`select private.master_activation_can_operate('${id(1)}')`)).toBe('f');
},120000);
