import {readFileSync,writeFileSync} from "node:fs";
import {attachIsolate} from "../live-checkout/postgres.mjs";
if(process.env.OUTBOUND_USAGE_DISPLAY_POSTGRES_TESTS!=="1")throw Error("OPT_IN_REQUIRED");
const db=await attachIsolate();
const upgrade=readFileSync("supabase/upgrade-packages/outbound-usage-display/10-display-compatibility.review.sql","utf8");
const protectedQuery=`SELECT md5(string_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),replace(p.prosrc,chr(13),''),p.proacl::text,p.proconfig,p.prosecdef,pg_get_userbyid(p.proowner))::text,E'\\n' ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.oid<>'public.billing_read_company_display_evidence(uuid)'::regprocedure;`;
const historyQuery="SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.billing_orders t),(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.billing_payment_attempts t),(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.billing_provider_events t),(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.billing_entitlement_applications t),(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.ai_usage_ledger t),(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.whatsapp_send_intents t),(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.whatsapp_inbound_jobs t))::text);";
const before=await db.sql(protectedQuery);
const historyBefore=await db.sql(historyQuery);
const old=await db.sql("SELECT pg_get_functiondef('public.billing_read_company_display_evidence(uuid)'::regprocedure);");
const oldAcl=await db.sql("SELECT proacl::text FROM pg_proc WHERE oid='public.billing_read_company_display_evidence(uuid)'::regprocedure;");
const cases=[];
const setup=`DO $setup$ DECLARE f jsonb;l uuid:=gen_random_uuid();v uuid:=gen_random_uuid();BEGIN
 f:=test_fixture.live_context();
 PERFORM set_config('velora.test_company',f->>'company',true);
 PERFORM set_config('velora.test_actor',f->>'actor',true);
 PERFORM set_config('velora.test_session',f->>'session',true);
 PERFORM set_config('velora.test_version',f->>'version',true);
 PERFORM set_config('velora.test_conversation',v::text,true);
 PERFORM set_config('velora.test_link',l::text,true);
 INSERT INTO public.whatsapp_company_links(id,company_id,status,provider_phone_number_id) VALUES(l,(f->>'company')::uuid,'verified','synthetic-usage-phone-'||v);
 INSERT INTO public.whatsapp_conversations(id,company_id,phone_number_id,customer_wa_id) VALUES(v,(f->>'company')::uuid,'synthetic-usage-phone-'||v,'synthetic-usage-recipient-'||v);
 PERFORM set_config('request.jwt.claim.sub',f->>'actor',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',f->>'actor','session_id',f->>'session','role','authenticated')::text,true);
 END;$setup$;`;
const period="date_trunc('month',statement_timestamp() at time zone 'Asia/Muscat') at time zone 'Asia/Muscat'";
const company="current_setting('velora.test_company')::uuid";
const read=`public.billing_read_company_display_evidence(${company})`;
function intent(outcome,receipt,created="statement_timestamp()-interval '1 second'",observed){
 return `INSERT INTO public.whatsapp_send_intents(client_op_id,company_id,conversation_id,phone_number_id,recipient_wa_id,body,sender_kind,outcome,wa_message_id,link_id,link_generation,created_at${observed===undefined?"":",acceptance_observed_at"}) SELECT gen_random_uuid()::text,${company},c.id,c.phone_number_id,c.customer_wa_id,'Synthetic isolated usage','assistant','${outcome}',${receipt?"'synthetic-usage-'||gen_random_uuid()":"null"},current_setting('velora.test_link')::uuid,1,${created}${observed===undefined?"":","+observed} FROM public.whatsapp_conversations c WHERE c.id=current_setting('velora.test_conversation')::uuid;`;
}
async function check(name,fixtures,assertion,{observation=false}={}){
 await db.sql(`BEGIN;GRANT EXECUTE ON FUNCTION test_fixture.live_context(text,integer,bigint,boolean,boolean) TO postgres;SET LOCAL ROLE postgres;${observation?"ALTER TABLE public.whatsapp_send_intents ADD COLUMN acceptance_observed_at timestamptz;":""}${setup}${fixtures}SET LOCAL ROLE authenticated;DO $assert$ DECLARE r jsonb;first jsonb;BEGIN r:=${read};IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'DISPLAY_NOT_AUTHORIZED';END IF;${assertion}END;$assert$;ROLLBACK;`);
 cases.push({name,passed:true});console.log("PASS "+name);
}
try{
 await check("baseline-empty-company-reproduces-usage-null","",`IF r->'data'->'usage' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'BASELINE_RED_NOT_REPRODUCED';END IF;`);
 await db.sql("SET ROLE postgres;"+upgrade);
 await check("deployed-schema-empty-is-verified-zero","",`IF r#>>'{data,usage,successful_automated_outbound}' IS DISTINCT FROM '0' OR r#>>'{data,usage,held_outbound_capacity}' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'EMPTY_NOT_ZERO';END IF;`);
 await check("legacy-accepted-receipt-period-stays-unknown",intent("accepted",true),`IF r->'data'->'usage' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'LEGACY_ACCEPTANCE_TIME_INVENTED';END IF;`);
 await check("accepted-without-receipt-stays-unknown",intent("accepted",false),`IF r->'data'->'usage' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'MISSING_RECEIPT_FALSE_ZERO';END IF;`);
 await check("current-and-prior-held-periods",intent("ready",false)+intent("unknown",false)+intent("attempting",false,`(${period})-interval '1 second'`)+intent("ready",false,"statement_timestamp()+interval '1 day'"),`IF r#>>'{data,usage,held_outbound_capacity}' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'HELD_PERIOD_MISMATCH';END IF;`);
 await check("trusted-receipt-month-boundary",intent("accepted",true,`(${period})-interval '1 day'`,`${period}`)+intent("accepted",true,`(${period})-interval '2 days'`,`(${period})-interval '1 microsecond'`),`IF r#>>'{data,usage,successful_automated_outbound}' IS DISTINCT FROM '1' OR r#>>'{data,usage,month_start}' IS DISTINCT FROM to_char((${period}) at time zone 'Asia/Muscat','YYYY-MM-DD') THEN RAISE EXCEPTION 'ACCEPTED_PERIOD_MISMATCH';END IF;`,{observation:true});
 await check("future-observation-does-not-become-zero",intent("accepted",true,"statement_timestamp()-interval '1 second'","statement_timestamp()+interval '1 day'"),`IF r->'data'->'usage' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'FUTURE_RECEIPT_FALSE_ZERO';END IF;`,{observation:true});
 await check("observation-before-intent-stays-unknown",intent("accepted",true,"statement_timestamp()-interval '1 second'","statement_timestamp()-interval '1 day'"),`IF r->'data'->'usage' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'IMPOSSIBLE_RECEIPT_FALSE_ZERO';END IF;`,{observation:true});
 await check("repeated-read-is-idempotent",intent("accepted",true,"statement_timestamp()-interval '1 second'","statement_timestamp()"),`first:=r;r:=${read};IF r IS DISTINCT FROM first OR r#>>'{data,usage,successful_automated_outbound}' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'READ_NOT_IDEMPOTENT';END IF;`,{observation:true});
 await check("cross-tenant-read-denied","",`r:=public.billing_read_company_display_evidence(gen_random_uuid());IF r->>'ok' IS DISTINCT FROM 'false' OR r->>'code' IS DISTINCT FROM 'forbidden' THEN RAISE EXCEPTION 'FOREIGN_TENANT_VISIBLE';END IF;`);
 await check("session-switch-denied","",`PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('velora.test_actor'),'session_id',gen_random_uuid(),'role','authenticated')::text,true);r:=${read};IF r->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'FOREIGN_SESSION_VISIBLE';END IF;`);
 try{await db.sql("SET ROLE postgres;"+upgrade);throw Error("REPLAY_WAS_ACCEPTED");}catch(e){if(!e.message.includes("OUTBOUND_USAGE_DISPLAY_PREREQUISITE_DRIFT"))throw e;cases.push({name:"upgrade-replay-rejected",passed:true});}
 const after=await db.sql(protectedQuery);const historyAfter=await db.sql(historyQuery);if(historyBefore!==historyAfter)throw Error("SYNTHETIC_HISTORY_CHANGED");cases.push({name:"existing-synthetic-financial-AI-WhatsApp-history-preserved",passed:true});const acl=await db.sql("SELECT proacl::text FROM pg_proc WHERE oid='public.billing_read_company_display_evidence(uuid)'::regprocedure;");
 if(before!==after||oldAcl!==acl)throw Error("PROTECTED_SOURCE_OR_ACL_CHANGED");cases.push({name:"all-other-functions-and-ACL-preserved",passed:true});
 const digest=await db.sql("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.billing_read_company_display_evidence(uuid)'::regprocedure;");
 const result={cases,body_md5:digest,acl,protectedSourceBefore:before,protectedSourceAfter:after,historyBefore,historyAfter,providerCalls:0,productionCalls:0,fixturesRolledBack:true};
 if(process.env.OUTBOUND_USAGE_DISPLAY_PROOF)writeFileSync(process.env.OUTBOUND_USAGE_DISPLAY_PROOF,JSON.stringify(result,null,2));
 console.log(JSON.stringify({passed:cases.length,body_md5:digest,acl}));
} catch(e){await db.sql("SET ROLE postgres;"+old+";");throw e;}
