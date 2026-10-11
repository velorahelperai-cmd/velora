import {execFile,spawn} from "node:child_process";
import {promisify} from "node:util";
import {readFileSync} from "node:fs";
import {randomBytes} from "node:crypto";
const exec=promisify(execFile);
const container="velora-platform-teams-local",database="platform_teams_fixture_"+randomBytes(4).toString("hex");
let verifiedContainerId;
export const lit=value=>`'${String(value).replaceAll("'","''")}'`;
export async function verify(){
 if(verifiedContainerId)return;
 const {stdout}=await exec("docker",["inspect",container]);const c=JSON.parse(stdout)[0];
 if(c.Config.Image!=="postgres:17.6-alpine"||c.Config.Labels?.["velora.task"]!=="platform-teams"||c.HostConfig.NetworkMode!=="none"||c.HostConfig.LogConfig.Type!=="none"||Object.keys(c.HostConfig.PortBindings??{}).length||!c.HostConfig.Tmpfs?.["/var/lib/postgresql/data"]||c.Mounts.some(m=>m.Type!=="tmpfs"))throw Error("UNSAFE_TEAM_TEST_TARGET");
 verifiedContainerId=c.Id;
}
export function session(query,{keepOpen=false,db=database}={}){
 if(!verifiedContainerId)throw Error("TEAM_TEST_TARGET_NOT_VERIFIED");
 const child=spawn("docker",["exec","-i","-u","postgres",verifiedContainerId,"psql","-X","-U","postgres","-d",db,"-Atq","-v","ON_ERROR_STOP=1"],{stdio:["pipe","pipe","pipe"]});
 let stdout="",stderr="";child.stdout.on("data",s=>stdout+=s);child.stderr.on("data",s=>stderr+=s);
 const done=new Promise((ok,fail)=>{child.on("error",fail);child.on("close",code=>code===0?ok(stdout.trim()):fail(Error(stderr||`psql ${code}`)));});
 const input=`set statement_timeout='15s';set lock_timeout='10s';${query}\n`;
 if(keepOpen)child.stdin.write(input);else child.stdin.end(input);
 return {child,done,output:()=>stdout};
}
export async function sql(query){await verify();return session(query).done;}
export async function file(path){return sql(readFileSync(path,"utf8"));}
export async function bootstrap(){
 await verify();const found=await session(`select 1 from pg_database where datname=${lit(database)}`,{db:"postgres"}).done;
 if(found!=="1")await session(`create database ${database}`,{db:"postgres"}).done;
 await file("scripts/platform-teams/bootstrap.sql");
 // Reuse the exact checked-in existing audit writer and owner definition.
 for(const [path,name] of [["supabase/migrations/20261004090000_vel005d_platform_admin.sql","private.write_admin_audit"],["supabase/migrations/20261007230212_vel_platform_owner_identity.sql","public.is_platform_owner"],["supabase/migrations/20261008010000_vel_session_idle_policy.sql","public.app_session_is_valid"]]){
  const source=readFileSync(path,"utf8");const start=source.indexOf(`create or replace function ${name}(`);const end=source.indexOf("$$;",start)+3;
  if(start<0||end<3)throw Error("DEPENDENCY_SOURCE_NOT_FOUND");await sql(source.slice(start,end));
 }
}
