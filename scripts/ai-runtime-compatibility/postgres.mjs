import {spawn,execFile} from "node:child_process";
import {promisify} from "node:util";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const exec=promisify(execFile);
export const lit=v=>`'${String(v).replaceAll("'","''")}'`;
export async function attachIsolate(){
 const path=process.env.AI_COMPAT_ISOLATE_RECEIPT;if(!path)throw Error("ISOLATE_RECEIPT_REQUIRED");
 const r=JSON.parse(readFileSync(path,"utf8"));
 if(!/^velora-ai-compat-[0-9a-f]{8}$/.test(r.container)||r.database!=="ai_compatibility")throw Error("UNSAFE_ISOLATE_IDENTITY");
 async function verify(){const {stdout}=await exec("docker",["inspect",r.container]);const c=JSON.parse(stdout)[0];
  if(c.Config.Labels?.["velora.task"]!=="ai-compatibility"||c.Config.Image!=="supabase/postgres:17.6.1.136"||c.HostConfig.NetworkMode!=="none"||c.HostConfig.LogConfig.Type!=="none"||Object.keys(c.HostConfig.PortBindings??{}).length||!c.HostConfig.Tmpfs?.["/var/lib/postgresql/data"]||c.Mounts.some(m=>m.Type!=="tmpfs"))throw Error("UNSAFE_ISOLATE_TARGET");
 }
 await verify();
 function session(query,name="ai_compat_test",{keepOpen=false}={}){
  const child=spawn("docker",["exec","-i","-u","postgres",r.container,"psql","-X","-U","supabase_admin","-d",r.database,"-Atq","-v","ON_ERROR_STOP=1"],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
  let stdout="",stderr="";child.stdout.on("data",x=>stdout+=x);child.stderr.on("data",x=>stderr+=x);
  const done=new Promise((ok,fail)=>{child.on("error",fail);child.on("close",code=>code===0?ok(stdout.trim()):fail(Error(stderr||`psql ${code}`)));});
  const input=`SET application_name=${lit(name)};SET statement_timeout='30s';SET lock_timeout='5s';${query}\n`;
  if(keepOpen)child.stdin.write(input);else child.stdin.end(input);return {child,done};
 }
 async function sql(query){await verify();return session(query).done;}
 return {sql,session,file:p=>sql(readFileSync(resolve(p),"utf8").replace(/^\uFEFF/,"")),close:async()=>{},verify};
}
