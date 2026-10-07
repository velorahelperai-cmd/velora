import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { projectPublicCatalog, type PublicCatalogVersion, type CatalogResult } from "./contract";
// Existing session client only. RPC performs trusted platform-owner authorization;
// no service key, metadata role, staff privilege or caller-selected actor.
export async function catalogRpc<T>(name:string,args:Record<string,unknown>={}):Promise<CatalogResult<T>> {
 try {
  const client=await createClient() as unknown as SupabaseClient;
  const {data,error}=await client.rpc(name,args);
  if(error) return {ok:false,code:error.code==="42501"?"forbidden":"unavailable"};
  if(!data||typeof data!=="object"||data.ok!==true) {
   const code=data?.code;
   return {ok:false,code:["forbidden","invalid_input","conflict","not_found","immutable"].includes(code)?code:"unavailable"};
  }
  return {ok:true,data:data.data as T};
 } catch {return {ok:false,code:"unavailable"};}
}
export async function readPublicCatalogBackend():Promise<CatalogResult<PublicCatalogVersion[]>> {
 try {
  const client=await createClient() as unknown as SupabaseClient;
  const {data,error}=await client.rpc("billing_read_public_catalog");
  if(error) return {ok:false,code:"unavailable"};
  const projected=projectPublicCatalog(data);
  if(!Array.isArray(data)||projected.length!==data.length) return {ok:false,code:"unavailable"};
  return {ok:true,data:projected};
 }catch{return {ok:false,code:"unavailable"};}
}
