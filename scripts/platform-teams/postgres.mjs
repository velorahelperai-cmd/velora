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
 // Verified isolated target only; exact current production dependency bodies, with provenance.
 await sql("set velora.fixture_dependencies='synthetic-local';"+readFileSync("scripts/platform-teams/production-dependencies.review.sql","utf8"));
}
