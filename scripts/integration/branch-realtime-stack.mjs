// Disposable native Realtime QA. No project env files or provider access.
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {createServer} from 'node:net';
export const delay=ms=>new Promise(r=>setTimeout(r,ms));
export async function startRealtimeStack(){
 const run=randomUUID(),network=`velora-rt-${run.slice(0,8)}`,pg=`${network}-pg`,rt=`${network}-rt`;
 const password=randomBytes(24).toString('hex'),secret=randomBytes(48).toString('hex');
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(path|systemroot|systemdrive|comspec|pathext|temp|tmp|userprofile|appdata|localappdata|home|docker_config)$/i.test(k)));
 const created=[];let net=false,ingress;const connections=new Set();
 const redact=s=>String(s).replaceAll(password,'[test-secret]').replaceAll(secret,'[test-secret]').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g,'[test-jwt]');
 const docker=(args,input='',extra={})=>new Promise((resolve,reject)=>{
  const p=spawn('docker',args,{env:{...env,...extra},windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
  const timer=setTimeout(()=>{p.kill();reject(Error('DOCKER_TIMEOUT'));},60000);
  p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.stdin.on('error',()=>{});
  p.on('error',e=>{clearTimeout(timer);reject(e);});p.on('close',c=>{clearTimeout(timer);if(c)reject(Error(redact(err)));else resolve((out+(args[0]==='logs'?err:'')).trim());});p.stdin.end(input);
 });
 const label=['--label','velora.task=branch-realtime-qa','--label',`velora.run=${run}`];
 const verify=async(name)=>{
  const [n]=JSON.parse(await docker(['network','inspect',network]));if(!n.Internal||n.Labels?.['velora.run']!==run)throw Error('NETWORK_SCOPE_MISMATCH');
  const [c]=JSON.parse(await docker(['inspect',name]));const ports=c.HostConfig.PortBindings??{};
  if(c.Config.Image!==(name===rt?'supabase/realtime:v2.143.3':'supabase/postgres:17.6.1.136')||c.Config.Labels?.['velora.task']!=='branch-realtime-qa'||c.Config.Labels?.['velora.run']!==run||c.HostConfig.NetworkMode!==network||Object.keys(c.NetworkSettings.Networks).some(x=>x!==network)||c.Mounts.some(m=>m.Type!=='tmpfs')||(name===pg&&!c.HostConfig.Tmpfs?.['/var/lib/postgresql/data'])||Object.entries(ports).some(([k,v])=>name!==rt||k!=='4000/tcp'||v.some(p=>p.HostIp!=='127.0.0.1')))throw Error('CONTAINER_SCOPE_MISMATCH');
 };
 const close=async()=>{if(ingress){if(ingress.address()?.address!=='127.0.0.1')throw Error('INGRESS_SCOPE_MISMATCH');for(const s of connections)s.destroy();await new Promise(r=>ingress.close(r));}for(const name of created.reverse()){await verify(name);await docker(['rm','-f',name]);}if(net){const [n]=JSON.parse(await docker(['network','inspect',network]));if(n.Labels?.['velora.run']!==run||!n.Internal)throw Error('NETWORK_SCOPE_MISMATCH');await docker(['network','rm',network]);}};
 let database='postgres';
 const sql=text=>docker(['exec','-i',pg,'psql','-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U','supabase_admin','-d',database,'-Atq'],text);
 const sign=(claims)=>{const now=Math.floor(Date.now()/1000),h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({role:'authenticated',iat:now,exp:now+1800,...claims})).toString('base64url'),s=`${h}.${p}`;return `${s}.${createHmac('sha256',secret).update(s).digest('base64url')}`;};
 try{
  const context=JSON.parse(await docker(['context','inspect']))[0];if(!/^(npipe:\/\/|unix:\/\/)/.test(context.Endpoints?.docker?.Host??''))throw Error('LOCAL_DOCKER_ENDPOINT_REQUIRED');
  await docker(['network','create','--internal',...label,network]);net=true;
  await docker(['run','-d','--name',pg,...label,'--network',network,'--tmpfs','/var/lib/postgresql/data:rw,size=1g','-e','POSTGRES_PASSWORD','-e','PGDATA=/var/lib/postgresql/data','supabase/postgres:17.6.1.136','postgres','-c','wal_level=logical','-c','listen_addresses=*'], '',{POSTGRES_PASSWORD:password});created.push(pg);
  let ready=false;for(let i=0;i<40;i++){try{await sql('select 1');ready=true;break;}catch{await delay(500);}}if(!ready)throw Error('DATABASE_NOT_READY');
  await sql(`alter role supabase_admin password '${password}';create schema if not exists _realtime;`);
  await sql('create database branch_realtime_qa owner supabase_admin;');database='branch_realtime_qa';await sql('create schema _realtime;');
  const settings={DB_HOST:pg,DB_PORT:'5432',DB_USER:'supabase_admin',DB_PASSWORD:password,DB_NAME:database,DB_AFTER_CONNECT_QUERY:'SET search_path TO _realtime',DB_ENC_KEY:'supabaserealtime',API_JWT_SECRET:secret,METRICS_JWT_SECRET:secret,SECRET_KEY_BASE:randomBytes(48).toString('hex'),SEED_SELF_HOST:'true',PORT:'4000',APP_NAME:'realtime',RLIMIT_NOFILE:'10000',ERL_AFLAGS:'-proto_dist inet_tcp',DNS_NODES:"''",ENABLE_TAILSCALE:'false'};
  await docker(['run','-d','--name',rt,...label,'--network',network,'--publish','127.0.0.1::4000',...Object.keys(settings).flatMap(k=>['-e',k]),'supabase/realtime:v2.143.3'],'',settings);created.push(rt);
  await delay(5000);
  ingress=createServer(socket=>{connections.add(socket);const child=spawn('docker',['exec','-i',pg,'nc',rt,'4000'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});child.stderr.on('data',()=>{});child.stdin.on('error',()=>socket.destroy());child.on('error',()=>socket.destroy());child.on('close',()=>socket.end());socket.on('error',()=>{});socket.on('close',()=>{connections.delete(socket);child.stdin.end();child.kill();});socket.pipe(child.stdin);child.stdout.pipe(socket);});
  await new Promise((ok,fail)=>{ingress.once('error',fail);ingress.listen(0,'127.0.0.1',ok);});
  await verify(pg);await verify(rt);
  return {sql,sign,url:`ws://127.0.0.1:${ingress.address().port}/socket/websocket`,close,logs:()=>docker(['logs','--tail','40',rt]).then(redact)};
 }catch(e){await close();throw e;}
}
