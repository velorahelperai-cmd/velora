import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
const exec=promisify(execFile);
export async function isolatedPostgres(){
 const name='velora-delete-'+randomUUID(),run=randomUUID();
 const docker=async args=>(await exec('docker',['--host','npipe:////./pipe/docker_engine',...args],{windowsHide:true,timeout:60000,maxBuffer:8*1024*1024})).stdout.trim();
 await docker(['run','--pull=never','-d','--name',name,'--label','velora.deletion.test='+run,'--network','none','--tmpfs','/var/lib/postgresql/data:rw,size=256m','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.6-alpine']);
 const verify=async()=>{const c=JSON.parse(await docker(['inspect',name]))[0];if(c.Config.Labels['velora.deletion.test']!==run||c.HostConfig.NetworkMode!=='none'||Object.keys(c.HostConfig.PortBindings??{}).length)throw Error('UNSAFE_LOCAL_DATABASE');};
 const sql=async text=>{await verify();return new Promise((ok,fail)=>{
  const p=spawn('docker',['--host','npipe:////./pipe/docker_engine','exec','-i','-u','postgres',name,'psql','-X','-Atq','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';const timer=setTimeout(()=>{p.kill();fail(Error('LOCAL_SQL_TIMEOUT'));},60000);
  p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('error',e=>{clearTimeout(timer);fail(e);});p.on('close',code=>{clearTimeout(timer);if(code===0)ok(stdout.trim());else fail(Error(stderr||'LOCAL_SQL_FAILED'));});p.stdin.end(text);
 });};
 for(let i=0;i<50;i++){try{await sql('select 1');break;}catch{if(i===49)throw Error('LOCAL_DATABASE_NOT_READY');await new Promise(r=>setTimeout(r,200));}}
 return {sql,file:async p=>sql(readFileSync(p,'utf8')),close:async()=>{await verify();await docker(['rm','-f',name]);}};
}
