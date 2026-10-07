import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import type {OperationResult} from "./contracts";
export async function operationRpc<T>(name:string,args:Record<string,unknown>,internal=false):Promise<OperationResult<T>>{
 try{
  const client=(internal?createAdminClient():await createClient()) as unknown as SupabaseClient|null;
  if(!client)return {ok:false,code:"unavailable"};
  const {data,error}=await client.rpc(name,args);
  if(error)return {ok:false,code:error.code==="42501"?"forbidden":["PGRST202","42P01","42883"].includes(error.code)?"schema_unavailable":"unavailable"};
  if(!data||typeof data!=="object"||Array.isArray(data))return {ok:false,code:"invalid_payload"};
  if(data.ok!==true)return {ok:false,code:typeof data.code==="string"?data.code:"unavailable"};
  return {ok:true,data:data.data as T};
 }catch{return {ok:false,code:"unavailable"};}
}
