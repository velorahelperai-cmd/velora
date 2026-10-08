import {sql,lit} from "./postgres.mjs";
const ident=v=>{if(!/^[a-z_][a-z0-9_]*$/.test(v))throw Error("INVALID_IDENTIFIER");return `"${v}"`;};
const rpcs=new Set(["billing_load_worker_frame","whatsapp_reserve_job_usage","ai_reserve_whatsapp_attempt","ai_start_whatsapp_attempt","ai_settle_whatsapp_attempt",
 "whatsapp_stage_job_reply","whatsapp_claim_assistant_job_send","finalize_whatsapp_send_attempt","billing_finalize_automated_usage","retry_whatsapp_send_persist",
 "whatsapp_retry_inbound_job","whatsapp_heartbeat_inbound_job","whatsapp_check_service_window",
 "whatsapp_read_answer_profile","whatsapp_retrieve_approved_knowledge","ai_reserve_whatsapp_profile_attempt","ai_reserve_whatsapp_capacity_cost_attempt","whatsapp_read_link_access_secret",
 "resolve_whatsapp_company_by_meta_asset","whatsapp_store_meta_inbound","whatsapp_apply_meta_delivery_status"]);
const val=x=>x===null?"NULL":typeof x==="object"?`${lit(JSON.stringify(x))}::jsonb`:typeof x==="number"||typeof x==="boolean"?String(x):lit(x);
export function databaseAdapter(){return {
 rpc:async(name,args)=>{if(!rpcs.has(name))throw Error("RPC_OUTSIDE_TEST_SCOPE");try{const q=Object.entries(args).map(([key,value])=>`${ident(key)}=>${val(value)}`).join(",");
 const output=await sql(`SET ROLE service_role;SELECT to_jsonb(public.${ident(name)}(${q}));`);return {data:output?JSON.parse(output):null,error:null};}catch(e){if(process.env.WHATSAPP_INTEGRATION_VERBOSE==="1")console.error("LOCAL_RPC_ERROR",name,e.message.split("\n")[0]);return {data:null,error:{message:e.message}};}},
 from:table=>{if(table!=="knowledge_sources")throw Error("TABLE_OUTSIDE_TEST_SCOPE");let fields="*",count=false;const conditions=[];
 const run=async()=>{try{const output=await sql(`SET ROLE service_role;SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT ${fields} FROM public.knowledge_sources WHERE ${conditions.join(" AND ")}) x;`);
 const data=JSON.parse(output);return {data,error:null,count:count?data.length:null};}catch(e){return {data:null,error:{message:e.message}};}};
 const query={select:(cols,options)=>{fields=cols.split(",").map(x=>ident(x.trim())).join(",");count=!!options?.count;return query;},eq:(key,value)=>{conditions.push(`${ident(key)}=${val(value)}`);return query;},
 in:(key,values)=>{conditions.push(`${ident(key)} IN (${values.map(val).join(",")})`);return query;},order:()=>query,limit:()=>query,then:(ok,fail)=>run().then(ok,fail)};return query;}
};}
