import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import WebSocket from 'ws';
import {RealtimeClient} from '@supabase/realtime-js';
import {branchInboxEventStream} from '../../src/lib/tenancy/branch-inbox-events.ts';
import {startRealtimeStack,delay} from './branch-realtime-stack.mjs';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fixture=n=>readFile(`scripts/ci/fixtures/${n}.sql`,'utf8');
const stack=await startRealtimeStack();const sockets=[];let sdk;
async function subscribe(user,session){
 const token=stack.sign({sub:id(user),session_id:id(session)}),events=[];
 const ws=new WebSocket(stack.url+'?vsn=1.0.0&apikey='+token,{headers:{Host:'realtime-dev.localhost'}});sockets.push(ws);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('SOCKET_OPEN_TIMEOUT')),15000);ws.once('open',()=>{clearTimeout(timer);resolve();});ws.once('error',reject);});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('SUBSCRIBE_TIMEOUT')),20000);ws.on('message',data=>{const msg=JSON.parse(String(data));if(msg.event==='postgres_changes')events.push(msg.payload.data);if(msg.event==='system'&&msg.payload.extension==='postgres_changes'&&msg.payload.status==='ok'){clearTimeout(timer);resolve();}if(msg.event==='phx_reply'&&msg.ref==='1'&&msg.payload.status!=='ok'){clearTimeout(timer);reject(Error('SUBSCRIBE_REJECTED'));}});ws.send(JSON.stringify({topic:'realtime:qa',event:'phx_join',payload:{config:{broadcast:{self:false},presence:{key:''},postgres_changes:[{event:'*',schema:'public',table:'branch_inbox_invalidations'}]},access_token:token},ref:'1'}));});
 return events;
}
try{
 console.log('isolated native database ready');
 let identities=(await fixture('branch-chat-identities')).replace(/\$\{id\((\d+)\)\}/g,(_,n)=>id(n)).replace(/create role (authenticated|anon|service_role);/g,'').replace(/create schema (auth|private);/g,'create schema if not exists $1;');
 await stack.sql(identities);await stack.sql(await fixture('branch-chat-data'));
 for(const name of ['branch-isolation-catalog','branch-chat-catalog','branch-chat-rls-catalog','branch-chat-qa-live-scope','branch-chat-qa-rls'])await stack.sql('set check_function_bodies=off;'+(await fixture(name)).replace(/grant execute on function public.control_whatsapp_conversation[\s\S]*?to authenticated;/,''));
 await stack.sql(`alter table private.instagram_messages add account_id text;update private.instagram_messages set account_id=case when company_id='${id(21)}' then 'ig21' else 'ig22' end;alter table public.whatsapp_conversations add automation_allowed boolean default true,add control_revision integer default 0;create publication supabase_realtime;`);
 await stack.sql(await readFile('supabase/migrations/20261029024411_branch_inbox_realtime.sql','utf8'));
 await stack.sql('grant usage on schema public,auth to authenticated;');
 await delay(5000);
 const own=await subscribe(1,11),foreign=await subscribe(2,12);await delay(1500);
 async function change(sql,channel){const count=own.length;await stack.sql(sql);for(let i=0;i<50&&own.length===count;i++)await delay(100);assert.ok(own.length>count,'native event missing '+channel);const event=own.at(-1);assert.equal(event.record.company_id,id(21));assert.equal(event.record.branch_id,id(31));assert.equal(event.record.channel,channel);assert.deepEqual(Object.keys(event.record).sort(),['branch_id','channel','company_id','revision']);assert.equal(foreign.length,0);}
 await change(`update public.whatsapp_conversations set inbox_sequence=inbox_sequence+1 where id='${id(41)}';`,'whatsapp');
 await change(`insert into public.whatsapp_messages values('${id(61)}','${id(21)}','${id(41)}',2);`,'whatsapp');
 await change(`update public.whatsapp_messages set arrival_sequence=3 where id='${id(61)}';`,'whatsapp');
 await change(`delete from public.whatsapp_messages where id='${id(61)}';`,'whatsapp');
 await change(`update private.instagram_conversations set inbox_sequence=inbox_sequence+1 where id='${id(41)}';`,'instagram');
 await change(`insert into private.instagram_messages values('${id(61)}','${id(21)}','${id(41)}',2,'ig21');`,'instagram');
 await change(`update private.instagram_messages set arrival_sequence=3 where id='${id(61)}';`,'instagram');
 await change(`delete from private.instagram_messages where id='${id(61)}';`,'instagram');
 await change(`insert into public.whatsapp_conversations(id,company_id,phone_number_id,inbox_sequence) values('${id(71)}','${id(21)}','wa21',5);`,'whatsapp');
 await change(`update public.whatsapp_conversations set automation_allowed=false,control_revision=control_revision+1 where id='${id(71)}';`,'whatsapp');
 await change(`delete from public.whatsapp_conversations where id='${id(71)}';`,'whatsapp');
 await change(`insert into private.instagram_conversations(id,company_id,account_id,inbox_sequence) values('${id(71)}','${id(21)}','ig21',5);`,'instagram');
 await change(`delete from private.instagram_conversations where id='${id(71)}';`,'instagram');
 // A positive event for the second identity proves it has a live subscription.
 const ownBeforeForeign=own.length;
 await stack.sql(`update public.whatsapp_conversations set inbox_sequence=inbox_sequence+1 where id='${id(42)}';`);
 for(let i=0;i<50&&!foreign.length;i++)await delay(100);
 assert.equal(foreign.at(-1)?.record.company_id,id(22));assert.equal(own.length,ownBeforeForeign);
 const before=own.length;await stack.sql(`insert into public.branch_inbox_invalidations values('${id(21)}','${id(33)}','whatsapp',gen_random_uuid());`);await delay(1500);assert.equal(own.length,before);
 await stack.sql(`update private.es02_branch_member_grants set status='revoked' where user_id='${id(1)}';update public.whatsapp_conversations set inbox_sequence=inbox_sequence+1 where id='${id(41)}';`);await delay(1500);assert.equal(own.length,before);
 await stack.sql(`update private.es02_branch_member_grants set status='active' where user_id='${id(1)}';insert into private.master_account_session_revocations values('${id(1)}',now());update private.instagram_conversations set inbox_sequence=inbox_sequence+1 where id='${id(41)}';`);await delay(1500);assert.equal(own.length,before);
 const foreignBefore=foreign.length;await stack.sql(`update private.instagram_conversations set inbox_sequence=inbox_sequence+1 where id='${id(42)}';`);for(let i=0;i<50&&foreign.length===foreignBefore;i++)await delay(100);assert.ok(foreign.length>foreignBefore);assert.equal(own.length,before);
 await stack.sql('delete from private.master_account_session_revocations;');
 class LocalTransport extends WebSocket{constructor(url,protocols){super(url,protocols,{headers:{Host:'realtime-dev.localhost'}});}}
 const token=stack.sign({sub:id(1),session_id:id(11)});
 sdk=new RealtimeClient(stack.url.replace(/\/websocket$/,''),{transport:LocalTransport,params:{apikey:token},accessToken:async()=>token});
 let removed=0;
 const response=branchInboxEventStream({client:{channel:(...args)=>sdk.channel(...args),removeChannel:async c=>{removed++;return sdk.removeChannel(c);}},scope:{companyId:id(21),branchId:id(31),channel:'whatsapp'},signal:new AbortController().signal,heartbeatMs:100,lifetimeMs:10000,
  authorize:async()=>await stack.sql(`set role authenticated;set request.jwt.claims='${JSON.stringify({sub:id(1),session_id:id(11),role:'authenticated'})}';select public.es02_can_watch_branch_inbox('${id(21)}','${id(31)}','whatsapp');`)==='t'});
 const reader=response.body.getReader(),decoder=new TextDecoder();
 const readEvent=async target=>{for(let i=0;i<100;i++){const {value,done}=await reader.read();assert.equal(done,false,'SSE closed before '+target);const text=decoder.decode(value);assert.ok(text==='retry: 5000\n\n'||/^event: (ready|change|ping|revoked)\ndata: \{\}\n\n$/.test(text),'unexpected SSE payload');if(text===target)return;}throw Error('SSE_EVENT_MISSING');};
 await readEvent('retry: 5000\n\n');await readEvent('event: ready\ndata: {}\n\n');
 await stack.sql(`update public.whatsapp_conversations set control_revision=control_revision+1 where id='${id(41)}';`);
 await readEvent('event: change\ndata: {}\n\n');
 await stack.sql(`update private.es02_branch_member_grants set status='revoked' where user_id='${id(1)}';`);
 await readEvent('event: revoked\ndata: {}\n\n');assert.equal((await reader.read()).done,true);assert.equal(removed,1);
 const seq=Number(await stack.sql(`select inbox_sequence from public.whatsapp_conversations where id='${id(41)}';`));
 await stack.sql(`alter table public.branch_inbox_invalidations rename revision to revision_unavailable;update public.whatsapp_conversations set inbox_sequence=inbox_sequence+1 where id='${id(41)}';alter table public.branch_inbox_invalidations rename revision_unavailable to revision;`);
 assert.equal(Number(await stack.sql(`select inbox_sequence from public.whatsapp_conversations where id='${id(41)}';`)),seq+1);
 console.log('PASS native WebSocket: WA/IG triggers, metadata-only payload, company/branch isolation, grant/session revocation');
 console.log('PASS real SDK + SSE helper: ready/change empty payload, idle revocation/removal; notification error preserves source write');
}catch(e){throw Error(e instanceof assert.AssertionError?'REALTIME_QA_ASSERTION_FAILED':String(e.message).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g,'[test-jwt]'));}finally{await sdk?.disconnect();for(const ws of sockets)ws.terminate();await stack.close();}
