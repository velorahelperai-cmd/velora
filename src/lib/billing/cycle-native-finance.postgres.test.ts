import {afterAll,beforeAll,expect,it} from "vitest";
import {readFileSync,readdirSync} from "node:fs";
import {randomBytes} from "node:crypto";
// @ts-expect-error guarded disposable local Docker PostgreSQL only
import {verify,session} from "../../../scripts/instagram-connection/postgres.mjs";
const db=`cycle_finance_fixture_${randomBytes(6).toString("hex")}`;
const sql=async(q:string)=>{await verify();return session(q,{db}).done;};
const file=(path:string)=>sql(readFileSync(path,"utf8"));
const company="11111111-1111-4111-8111-111111111111",user="22222222-2222-4222-8222-222222222222",basic="44444444-4444-4444-8444-444444444444",premium="55555555-5555-4555-8555-555555555555";
const server=`set role service_role;set request.jwt.claims='{"role":"service_role"}';`;
async function native(source:string,name:string){const body=readFileSync(source,"utf8");const start=new RegExp("create(?: or replace)? function "+name.replaceAll(".","\\.")+"\\(").exec(body)?.index;if(start===undefined)throw Error("NATIVE_MISSING "+name);await sql(body.slice(start,body.indexOf("$$;",start)+3));}
beforeAll(async()=>{
 await verify();await session(`create database ${db}`,{db:"postgres"}).done;
 await file("scripts/instagram-connection/bootstrap.sql");await file("supabase/migrations/20261008010000_vel_session_idle_policy.sql");await file("scripts/master-checkout/dependencies.sql");
 await sql(readdirSync("supabase/migrations").filter(n=>n>="20261006180000"&&n<="20261008080000_vel_billing_p1_dependencies_d1_to_d5.sql"&&(/billing|paymob|subscription/.test(n)||n<"20261007010001")).sort().map(n=>readFileSync("supabase/migrations/"+n,"utf8")).join("\n"));
 await file("scripts/master-checkout/live-dependencies.sql");await sql("drop function public.master_apply_cycle_upgrade(uuid,uuid)");
 for(const name of ["private.billing_live_owner","public.billing_create_live_checkout_order","public.billing_claim_live_checkout","public.billing_complete_live_checkout"])await native("supabase/upgrade-packages/paymob-live-checkout/20-production-compatibility.review.sql",name);
 const history=readFileSync("supabase/migrations/20261008100000_vel_billing_legacy_evidence_upgrade_acceptance.sql","utf8");
 for(const name of ["private.billing_verified_collection_history","private.billing_proven_entitlement_grants"]){const start=history.indexOf("create view "+name+" as");await sql(history.slice(start,history.indexOf("\nrevoke",start)));}
 await native("supabase/migrations/20261010053446_service_entitlement_read_contract.sql","private.billing_service_receipt_eligible");
 const source="supabase/migrations/20261014033001_master_subscription_activation.sql",activation=readFileSync(source,"utf8");
 await sql(activation.slice(activation.indexOf("begin;"),activation.indexOf("create function private.master_activation_setup_destroyed"))+"commit;");
 await sql("drop function private.master_activation_company_end(uuid);drop function private.master_activation_waiting(uuid);create function private.master_activation_ready(uuid,uuid) returns boolean language sql as $$select false$$;"); // Offline channel readiness port only.
 for(const name of ["private.master_activation_receipt_current","private.master_activation_receipt_state","private.master_activation_effective_end","private.master_reconcile_activation_locked","public.master_capture_subscription_activation","private.master_activation_company_end","private.master_activation_waiting"])await native(source,name);
 await sql(`do $$declare f record;begin for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('private','public') and p.proname like 'master_%activation%' loop execute format('alter function %s set jit=off',f.oid::regprocedure);end loop;end;$$;`);
 // Minimal native worker table shapes, no replacement finance projection.
 const deps=readFileSync("scripts/cycle-ai/dependencies.sql","utf8");await sql(deps.slice(deps.indexOf("create table public.whatsapp_conversations"),deps.indexOf("create function public.billing_read_company_operational_entitlement")));
 await sql("alter table auth.users add column deleted_at timestamptz,add column banned_until timestamptz;alter table public.companies add column timezone text;create table private.company_selected_channels(company_id uuid primary key,plan_version_id uuid,channels text[]);create table private.plan_channel_entitlements(plan_version_id uuid primary key,channel_count integer,approval_reference text,approved_at timestamptz);");
 for(const fn of ["private.wa_worker_month","private.wa_worker_lock","public.whatsapp_reserve_job_usage","public.whatsapp_stage_job_reply","public.whatsapp_claim_assistant_job_send"])await native("supabase/migrations/20261008132000_vel_wa_worker_atomic_integration.sql",fn);
 await native("supabase/migrations/20261008133000_vel_ai_whatsapp_reservation_integration.sql","private.ai_lock_authorized_whatsapp_job");await native("supabase/migrations/20261010084102_noura_claimed_job_authority.sql","private.wa_noura_authority");
 await file("supabase/migrations/20261014033003_master_checkout_contract.sql");await file("supabase/migrations/20261014033004_master_cycle_ai_credits.sql");await file("supabase/migrations/20261014033006_master_native_upgrade.sql");
 await sql(`insert into auth.users(id,email,email_confirmed_at) values('${user}','offline@example.invalid',clock_timestamp());insert into auth.sessions(id,user_id) values('${user}','${user}');insert into private.app_session_activity(session_id,user_id,last_activity_at) values('${user}','${user}',clock_timestamp());insert into public.companies(id,display_name,status) values('${company}','Offline','active');insert into public.company_members(company_id,user_id,role,status) values('${company}','${user}','owner','active');
 insert into public.billing_plans(id,code,name,status) values('${basic}','noor_basic','Offline basic','active'),('${premium}','noor_premium','Offline premium','active');
 insert into public.billing_plan_versions(id,plan_id,version,amount_baisa,currency,period_days,period_unit,period_count,status,limits) values('${basic}','${basic}',1,45000,'OMR',30,'month',1,'draft','{"automated_outbound_per_month":500}'),('${premium}','${premium}',1,90000,'OMR',30,'month',1,'draft','{"automated_outbound_per_month":1500}');update public.billing_plan_versions set status='published';
 insert into private.billing_service_offers values('${basic}','noura','basic',array['noura.knowledge.read']),('${premium}','noura','premium',array['noura.knowledge.read']);insert into private.ai_plan_budget_policies values('${basic}',5000),('${premium}',10000);insert into private.billing_live_merchant_contracts values('${basic}',71610,'1001',1000,'OMR',true,clock_timestamp());
 insert into private.master_checkout_terms(plan_version_id,terms_version,terms_text,features_version,features,disclosed_charges,approval_reference) values('${basic}','OFFLINE','Offline fixture terms','OFFLINE','[]','[]','OFFLINE-ONLY'),('${premium}','OFFLINE','Offline fixture terms','OFFLINE','[]','[]','OFFLINE-ONLY');`);
},90000);
afterAll(async()=>{await verify();await session(`drop database if exists ${db} with(force)`,{db:"postgres"}).done;});
it("native verified settlement grants fresh1500 once, forfeits unused500, and preserves original37day activation/financial evidence (offline provider attestation)",async()=>{
 const create=async(upgrade:boolean)=>sql(server+`select public.${upgrade?"billing_create_live_upgrade_order":"billing_create_live_checkout_order"}('${company}','${user}','${user}','${upgrade?premium:basic}','${upgrade?"upgrade":"initial"}',1,71610,'1001',1000)`).then(JSON.parse);
 async function collect(upgrade:boolean){
  const o=await create(upgrade);expect(o.ok).toBe(true);
  expect(await sql(server+`select public.master_accept_checkout_consent('${company}','${o.order_id}','${user}','${user}','OFFLINE',true)`).then(JSON.parse)).toMatchObject({ok:true});
  expect(await sql(server+`select public.billing_claim_live_checkout('${company}','${o.order_id}','${o.payment_attempt_id}','${user}','${user}')`).then(JSON.parse)).toMatchObject({kind:"claimed"});
  const providerOrder=upgrade?"98002":"98001";
  expect(await sql(server+`select public.billing_complete_live_checkout('${company}','${o.order_id}','${o.payment_attempt_id}','${user}','${user}','${providerOrder}','https://om.checkout.paymob.com/?publicKey=pk_live_offline&clientSecret=offline','OFFLINE')`)).toBe("t");
  // Explicit offline provider attestation at the real native server boundary.
  // Does not execute HMAC ingress, Paymob, a provider payment or a charge.
  const e=JSON.stringify({company_id:company,order_id:o.order_id,payment_attempt_id:o.payment_attempt_id,provider:"paymob",provider_account_ref:"71610",provider_environment:"live",provider_transaction_id:upgrade?"OFFLINE-UPGRADE":"OFFLINE-INITIAL",special_reference:o.special_reference,currency_expected:"OMR",event_status:"success",amount_baisa:45000,evidence_marker:"VEL_PAYMOB_SERVER_HMAC_VERIFIED",hmac_verified:true,signed_owner:"1001",integration_id:71610,amount_cents:45000,provider_order_id:providerOrder,currency:"OMR",pending:false,success:true,error_occured:false,is_auth:false,is_capture:false,is_refunded:false,is_voided:false,has_parent_transaction:false,is_standalone_payment:true});
  const r=await sql(server+`select public.billing_settle_paymob_hmac_verified('${e}')`).then(JSON.parse);expect(r.outcome).toBe("granted");return {r,e};
 }
 const initial=await collect(false),rid=initial.r.entitlement_application_id;
 await sql(`insert into private.master_subscription_activation(receipt_id,company_id,subscription_id,plan_version_id,payment_confirmed_at,entitlement_created_at,activation_deadline,subscription_started_at,expires_at,receipt_paid_through,bonus_days,start_reason) select id,company_id,subscription_id,'${basic}',applied_at,applied_at,applied_at+interval '14 days',applied_at,applied_at+interval '37 days',applied_paid_through,7,'ready' from public.billing_entitlement_applications where id='${rid}';update private.master_activation_policy set enabled=true,enabled_at=clock_timestamp(),approval_reference='OFFLINE-ACTIVATION';`);
 const originalEnd=await sql(`select expires_at from private.master_subscription_activation where receipt_id='${rid}'`),financeBefore=await sql("select to_jsonb(g) from public.billing_entitlement_applications g"),through=await sql("select paid_through from public.billing_subscriptions");
 expect(await sql(server+`select public.master_capture_ai_cycle('${company}','${rid}')`).then(JSON.parse)).toMatchObject({ok:true});
 const upgrade=await collect(true);expect(await sql(server+`select public.billing_settle_paymob_hmac_verified('${upgrade.e}')`).then(JSON.parse)).toMatchObject({outcome:"idempotent_replay"});
 expect(await sql("select count(*) from private.master_ai_cycles")).toBe("1");expect(await sql("select base_cap from private.master_ai_cycles")).toBe("1500");
 expect(await sql(`select forfeited from private.master_ai_credit_grants where source_key='base:${rid}'`)).toBe("500");expect(await sql("select count(*) from private.master_ai_credit_grants where source_key like 'upgrade:%'")).toBe("1");
 expect(await sql("select expires_at from private.master_ai_cycles")).toBe(originalEnd);expect(await sql("select paid_through from public.billing_subscriptions")).toBe(through);expect(await sql(`select to_jsonb(g) from public.billing_entitlement_applications g where id='${rid}'`)).toBe(financeBefore);
 expect(await sql("select count(*) from private.master_subscription_activation")).toBe("1");expect(await sql("select bonus_days from private.master_subscription_activation")).toBe("7");
},90000);
