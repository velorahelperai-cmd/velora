// TEST ONLY. Synthetic authenticated transport, actual session/RLS/RPC SQL.
import {sql,lit} from "../whatsapp-integration/postgres.mjs";
const allowed=new Set(["has_company_capability","company_conversation_scope","whatsapp_inbox_page","whatsapp_thread_page","whatsapp_mark_thread_read","whatsapp_inbox_connection_status","control_whatsapp_conversation","billing_read_company_operational_entitlement"]);
const tables=new Set(["companies","company_members","whatsapp_conversations","knowledge_sources"]);
const ident=x=>{if(!/^[a-z_][a-z0-9_]*$/.test(x))throw Error("INVALID_FIXTURE_IDENTIFIER");return `"${x}"`;};
const value=x=>x===null?"NULL":typeof x==="object"?`${lit(JSON.stringify(x))}::jsonb`:typeof x==="number"||typeof x==="boolean"?String(x):lit(x);
export function sessionAdapter({actorId,sessionId}){
 const claims=JSON.stringify({sub:actorId,session_id:sessionId,role:"authenticated"});
 const prefix=`SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub',${lit(actorId)},false);SELECT set_config('request.jwt.claim.role','authenticated',false);SELECT set_config('request.jwt.claims',${lit(claims)},false);`;
 const query=async q=>{const output=await sql(prefix+q,"c2_synthetic_owner_session");return JSON.parse(output.split("\n").at(-1));};
 return {rpc:async(name,args={})=>{if(!allowed.has(name))throw Error("RPC_OUTSIDE_FIXTURE_SCOPE");try{return {data:await query(`SELECT to_jsonb(public.${ident(name)}(${Object.entries(args).map(([k,v])=>`${ident(k)}=>${value(v)}`).join(",")}));`),error:null};}catch{return {data:null,error:{code:"FIXTURE_RPC_FAILED"}};}},
  from:table=>{if(!tables.has(table))throw Error("TABLE_OUTSIDE_FIXTURE_SCOPE");let fields="*",order="",limit="";const filters=[];
   const run=async single=>{try{const data=await query(`SELECT coalesce(jsonb_agg(r),'[]'::jsonb) FROM (SELECT ${fields} FROM public.${ident(table)} ${filters.length?`WHERE ${filters.join(" AND ")}`:""}${order}${limit}) r;`);return {data:single?data[0]??null:data,error:null};}catch{return {data:null,error:{code:"FIXTURE_READ_FAILED"}};}};
   const chain={select:cols=>{fields=cols==="*"?"*":cols.split(",").map(x=>ident(x.trim())).join(",");return chain;},eq:(k,v)=>{filters.push(`${ident(k)}=${value(v)}`);return chain;},in:(k,vs)=>{filters.push(`${ident(k)} IN (${vs.map(value).join(",")})`);return chain;},order:(k,o)=>{order=` ORDER BY ${ident(k)} ${o?.ascending===false?"DESC":"ASC"}`;return chain;},limit:n=>{if(!Number.isSafeInteger(n)||n<1)throw Error("INVALID_FIXTURE_LIMIT");limit=` LIMIT ${n}`;return chain;},maybeSingle:()=>run(true),single:()=>run(true),then:(ok,fail)=>run(false).then(ok,fail)};return chain;
  },
 };
}
