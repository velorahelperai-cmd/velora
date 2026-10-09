// TEST ONLY. The service transport is replaced; project RPC SQL/accounting is real.
import {sql,lit} from "../whatsapp-integration/postgres.mjs";
const allowed=new Set(["ai_reserve_attempt","ai_start_attempt","ai_settle_admin_attempt","ai_admin_snapshot"]);
const ident=x=>{if(!/^[a-z_][a-z0-9_]*$/.test(x))throw Error("INVALID_TEST_IDENTIFIER");return `"${x}"`;};
const value=x=>x===null?"NULL":typeof x==="object"?`${lit(JSON.stringify(x))}::jsonb`:typeof x==="number"?(Number.isFinite(x)?String(x):(()=>{throw Error("NONFINITE_TEST_VALUE");})()):typeof x==="boolean"?String(x):lit(x);
export function appAdapter(){return {async rpc(name,args={}){
 if(!allowed.has(name))throw Error("RPC_OUTSIDE_C1_TEST_SCOPE");
 try{const query=`SET ROLE service_role;SELECT to_jsonb(public.${ident(name)}(${Object.entries(args).map(([k,v])=>`${ident(k)} => ${value(v)}`).join(",")}));`;
  const output=await sql(query,"c1_admin_app_rpc");return {data:JSON.parse(output.split("\n").at(-1)),error:null};
 }catch{return {data:null,error:{code:"C1_LOCAL_RPC_FAILED"}};}
}};}
