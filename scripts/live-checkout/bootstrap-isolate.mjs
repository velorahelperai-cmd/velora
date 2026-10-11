import {execFileSync,spawnSync} from "node:child_process";
import {writeFileSync} from "node:fs";
import {randomBytes} from "node:crypto";
const docker=(args,input)=>execFileSync("docker",args,{input,encoding:"utf8",windowsHide:true,timeout:60000,maxBuffer:32*1024*1024});
const source="velora-ai-compat-1fcf4537";
function verify(name,label){const c=JSON.parse(docker(["inspect",name]))[0];if(c.Config.Image!=="supabase/postgres:17.6.1.136"||c.Config.Labels?.["velora.task"]!==label||c.HostConfig.NetworkMode!=="none"||c.HostConfig.LogConfig.Type!=="none"||Object.keys(c.HostConfig.PortBindings??{}).length||!c.HostConfig.Tmpfs?.["/var/lib/postgresql/data"]||c.Mounts.some(m=>m.Type!=="tmpfs"))throw Error("UNSAFE_ISOLATE");}
verify(source,"ai-compatibility");
const container="velora-live-checkout-"+randomBytes(4).toString("hex"),database="live_checkout";
docker(["run","-d","--name",container,"--label","velora.task=live-checkout","--network","none","--log-driver","none","--tmpfs","/var/lib/postgresql/data:rw","--tmpfs","/var/run/postgresql:rw","-e","POSTGRES_PASSWORD=synthetic-isolated-only","supabase/postgres:17.6.1.136"]);
verify(container,"live-checkout");
for(let i=0;i<45;i++){if(spawnSync("docker",["exec",container,"pg_isready","-h","127.0.0.1","-U","supabase_admin"],{windowsHide:true}).status===0)break;await new Promise(r=>setTimeout(r,1000));}
const sql=q=>docker(["exec","-i","-u","postgres",container,"psql","-X","-q","-U","supabase_admin","-d","postgres","-v","ON_ERROR_STOP=1"],q);
const globals=docker(["exec","-u","postgres",source,"pg_dumpall","-U","supabase_admin","--roles-only","--no-role-passwords"]);
const existing=docker(["exec","-u","postgres",container,"psql","-X","-Atq","-U","supabase_admin","-d","postgres","-c","select rolname from pg_roles"]).trim().split("\n");
const creates=[...globals.matchAll(/^CREATE ROLE ([^;]+);/gm)].filter(m=>!existing.includes(m[1].replaceAll('"',""))).map(m=>"CREATE ROLE "+m[1]+";");
sql(creates.join("\n")+"\nCREATE DATABASE live_checkout OWNER postgres;");
sql([...globals.matchAll(/^(?:ALTER ROLE|GRANT) [^;]+;/gm)].map(m=>m[0]).join("\n"));
const schema=docker(["exec","-u","postgres",source,"pg_dump","-U","supabase_admin","-d","ai_compatibility","--schema-only","--no-comments"]);
docker(["exec","-i","-u","postgres",container,"psql","-X","-q","-U","supabase_admin","-d",database,"-v","ON_ERROR_STOP=1"],schema);
writeFileSync("scripts/live-checkout/isolate-receipt.json",JSON.stringify({container,database,sourceSchemaOnly:source,customerRowsCopied:0},null,2)+"\n");
console.log("SCHEMA_ONLY_ISOLATE_READY "+container);
