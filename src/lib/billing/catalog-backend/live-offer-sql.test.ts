import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
// Opt-in isolated PostgreSQL only. No network, copied customer data, or external services.
describe.skipIf(process.env.VELORA_LIVE_OFFER_SQL!=="1")("Live offer native SQL contract",()=>{
 it("qualifies exact merchant/budget/quota; rejects malformed quota and public execution",async()=>{
  const name="velora-live-offer-"+randomBytes(4).toString("hex");
  const docker=(args:string[],input?:string)=>execFileSync("docker",args,{input,encoding:"utf8",windowsHide:true,timeout:60000,maxBuffer:2*1024*1024});
  const sql=(query:string)=>docker(["exec","-i","-u","postgres",name,"psql","-X","-Atq","-U","supabase_admin","-d","postgres","-v","ON_ERROR_STOP=1"],query).trim();
  docker(["run","-d","--name",name,"--label","velora.task=live-offer-sql","--network","none","--log-driver","none","--tmpfs","/var/lib/postgresql/data:rw","--tmpfs","/var/run/postgresql:rw","-e","POSTGRES_PASSWORD=synthetic-isolated-only","supabase/postgres:17.6.1.136"]);
  try{
   for(let i=0;i<45;i++){if(spawnSync("docker",["exec",name,"pg_isready","-h","127.0.0.1","-U","supabase_admin"],{windowsHide:true}).status===0)break;await new Promise(r=>setTimeout(r,1000));}
   sql(`create schema if not exists private;
    create table public.billing_plans(id uuid primary key,code text,status text);
    create table public.billing_plan_versions(id uuid primary key,plan_id uuid,status text,currency text,amount_baisa bigint,period_unit text,period_count int,limits jsonb);
    create table public.billing_catalog_revision(singleton boolean,revision bigint);
    create table private.billing_service_offers(plan_version_id uuid,service_code text,tier text,capabilities text[]);
    create table private.ai_plan_budget_policies(plan_version_id uuid,monthly_limit_baisa numeric);
    create table private.billing_live_merchant_contracts(integration_id bigint,merchant_owner_id text,units_per_omr int,currency text,deadline_policy_approved boolean,verified_at timestamptz);
    insert into public.billing_plans values('22222222-2222-4222-8222-222222222222','noor_premium','active');
    insert into public.billing_plan_versions values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','published','OMR',90000,'month',1,'{"automated_outbound_per_month":1500}');
    insert into public.billing_catalog_revision values(true,7);
    insert into private.billing_service_offers values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','noura','premium',array['noura.knowledge.read']);
    insert into private.ai_plan_budget_policies values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',15000);
    insert into private.billing_live_merchant_contracts values(98765,'1001',1000,'OMR',true,now()-interval '1 minute');`);
   sql(readFileSync("supabase/migrations/20261013065804_live_offer_readiness.sql","utf8"));
   const call="select public.billing_read_public_live_offer('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',98765,'1001',1000);";
   const read=(query=call)=>JSON.parse(sql("set role service_role;"+query).split("\n").at(-1)!);
   expect(read()).toMatchObject({ok:true,data:{amount_baisa:90000,allowance_cap:1500,tier:"premium",catalog_revision:7}});
   expect(read(call.replace("98765","98766"))).toEqual({ok:false,code:"LIVE_OFFER_NOT_READY"});
   for(const quota of ['"invalid"','"999999999999999999999999999999"','null','0']){
    sql("update public.billing_plan_versions set limits=jsonb_build_object('automated_outbound_per_month',"+"'"+quota+"'::jsonb);");expect(read().ok).toBe(false);
   }
   sql("update public.billing_plan_versions set limits='{\"automated_outbound_per_month\":1500}';delete from private.ai_plan_budget_policies;");expect(read().ok).toBe(false);
   expect(sql("select has_function_privilege('anon','public.billing_read_public_live_offer(uuid,bigint,text,integer)','execute'),has_function_privilege('authenticated','public.billing_read_public_live_offer(uuid,bigint,text,integer)','execute'),has_function_privilege('service_role','public.billing_read_public_live_offer(uuid,bigint,text,integer)','execute');")).toBe("f|f|t");
   expect(()=>sql("set role anon;"+call)).toThrow();
  }finally{
   const c=JSON.parse(docker(["inspect",name]))[0];if(c.Config.Labels?.["velora.task"]!=="live-offer-sql"||c.HostConfig.NetworkMode!=="none"||c.Mounts.some((m:{Type:string})=>m.Type!=="tmpfs"))throw Error("UNSAFE_ISOLATE_CLEANUP");
   docker(["rm","-f",name]);
  }
 },90000);
});
