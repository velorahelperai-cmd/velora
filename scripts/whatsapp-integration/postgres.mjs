import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
export const CONTAINER="velora-c2-runtime-13861eb", DB="whatsapp_integration";
const exec=promisify(execFile);
export const lit=v=>`'${String(v).replaceAll("'","''")}'`;
export async function verify(){
 const {stdout}=await exec("docker",["inspect",CONTAINER]); const c=JSON.parse(stdout)[0];
 if(c.Config.Labels?.["velora.task"]!=="c2-runtime-integration"||c.HostConfig.NetworkMode!=="none"||!c.HostConfig.Tmpfs?.["/var/lib/postgresql/data"]||c.HostConfig.PortBindings&&Object.keys(c.HostConfig.PortBindings).length||c.Mounts.some(m=>m.Type!=="tmpfs"))throw Error("UNSAFE_DATABASE_TARGET");
 return c.Config.Image;
}
export function session(query,name="wa_integration_test",{keepOpen=false}={}){
 const child=spawn("docker",["exec","-i","-u","postgres",CONTAINER,"psql","-X","-U","supabase_admin","-d",DB,"-Atq","-v","ON_ERROR_STOP=1"],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
 let stdout="",stderr="";child.stdout.on("data",x=>stdout+=x);child.stderr.on("data",x=>stderr+=x);
 const done=new Promise((ok,fail)=>{child.on("error",fail);child.on("close",code=>code===0?ok(stdout.trim()):fail(Error(stderr||`psql ${code}`)));});
 const input=`SET application_name=${lit(name)};\n${query}\n`;
 if(keepOpen)child.stdin.write(input);else child.stdin.end(input);return {child,done};
}
export async function sql(query,name){await verify();return session(query,name).done;}
export async function file(path){return sql(readFileSync(resolve(path),"utf8").replace(/^\uFEFF/,""));}
export async function rows(query){return JSON.parse(await sql(`SELECT coalesce(jsonb_agg(q),'[]'::jsonb) FROM (${query}) q;`));}
export async function bootstrap(until){
 await verify();
 for(const q of [`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`,`CREATE DATABASE ${DB}`])await exec("docker",["exec","-u","postgres",CONTAINER,"psql","-X","-U","supabase_admin","-d","postgres","-v","ON_ERROR_STOP=1","-c",q]);
 await file("scripts/whatsapp-integration/dependency-stubs.sql");let count=0;
 for(const name of readdirSync(resolve("supabase/migrations")).filter(x=>x.endsWith(".sql")).sort()){
  if(until&&name>until)break;
  if(name==="20261007230212_vel_platform_owner_identity.sql")await seedOwnerMigrationPrecondition();
  try{await file(`supabase/migrations/${name}`);}catch(error){throw Error(`MIGRATION_FAILED ${name}: ${error.message}`);}count++;
 }
 return count;
}
export async function seedOwnerMigrationPrecondition(){
 // Synthetic Auth identity only. This historical data migration requires an
 // existing verified admin at its source-locked platform address. The value is
 // read from source, never from a cloud account or customer dataset, and not logged.
 const source=readFileSync(resolve("supabase/migrations/20261007230212_vel_platform_owner_identity.sql"),"utf8");
 const address=source.match(/lower\(u.email\)='([^']+)'/)?.[1];if(!address)throw Error("OWNER_PRECONDITION_SOURCE_CHANGED");
 await sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(md5('wa-integration-synthetic-owner')::uuid,${lit(address)},now()) ON CONFLICT(id) DO NOTHING; INSERT INTO public.platform_admins(user_id,role,status) VALUES(md5('wa-integration-synthetic-owner')::uuid,'owner','active') ON CONFLICT(user_id) DO NOTHING;`);
}
