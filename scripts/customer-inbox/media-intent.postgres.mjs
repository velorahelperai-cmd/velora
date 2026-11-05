import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
if(!process.argv[2])throw Error('Pass absolute PGlite entry path');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
const company='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',thread='33333333-3333-4333-8333-333333333333',file='44444444-4444-4444-8444-444444444444',intent='55555555-5555-4555-8555-555555555555',attempt='66666666-6666-4666-8666-666666666666',session='77777777-7777-4777-8777-777777777777';
const fixture=readFileSync(new URL('./extensions.postgres.mjs',import.meta.url),'utf8');
const setup=fixture.match(/await db\.exec\(`([\s\S]*?)`\);/)[1]
  .replaceAll('${actor}',actor).replaceAll('${staff}',session).replaceAll('${company}',company).replaceAll('${thread}',thread).replaceAll('${otherThread}','88888888-8888-4888-8888-888888888888');
await db.exec(setup);
await db.exec(`
create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('session_id',current_setting('request.session',true))$$;
create table public.whatsapp_send_intents(id uuid primary key,company_id uuid,conversation_id uuid,actor_user_id uuid,sender_kind text,client_op_id text,body text,outcome text,staff_actor_session_id uuid,attempt_token uuid,attempt_expires_at timestamptz,message_id uuid default null);
create function private.whatsapp_intent_link_current(public.whatsapp_send_intents) returns boolean language sql as $$select true$$;
create function public.create_whatsapp_send_intent(op text,conv uuid,body text,phone text,sender text,generation integer,link uuid,link_generation bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.whatsapp_send_intents;begin
 select * into i from public.whatsapp_send_intents where client_op_id=op;
 if found then if i.body<>body then return jsonb_build_object('ok',false,'code','content_mismatch');end if;return jsonb_build_object('ok',true,'created',false,'intent',jsonb_build_object('id',i.id));end if;
 insert into public.whatsapp_send_intents values ('${intent}','${company}',conv,auth.uid(),'staff',op,body,'ready','${session}',null,null) returning * into i;
 return jsonb_build_object('ok',true,'created',true,'intent',jsonb_build_object('id',i.id));end;$$;
create function public.claim_whatsapp_send_attempt(i uuid,a uuid,lease integer) returns jsonb language plpgsql security definer set search_path='' as $$begin
 update public.whatsapp_send_intents set outcome='attempting',attempt_token='${attempt}',attempt_expires_at=clock_timestamp()+interval '90 seconds' where id=i and actor_user_id=a and outcome='ready';
 return jsonb_build_object('ok',found);end;$$;
grant execute on function public.claim_whatsapp_send_attempt(uuid,uuid,integer) to service_role;
`);
await db.exec(readFileSync(new URL('../../supabase/migrations/20261104092239_customer_inbox_extensions.sql',import.meta.url),'utf8'));
await db.exec(readFileSync(new URL('../../supabase/migrations/20261105182449_customer_whatsapp_media_intent.sql',import.meta.url),'utf8'));
await db.exec(`insert into public.whatsapp_send_intents values ('${intent}','${company}','${thread}','${actor}','staff','text-existing','hello','ready','${session}',null,null)`);
await db.exec(`set role authenticated; set request.actor='${actor}'; set request.session='${session}'`);
const query=async(sql,args=[]) => (await db.query(sql,args)).rows[0].result;
const ext=(action,id,body,mime,bytes)=>query("select public.customer_inbox_extension($1,'whatsapp',$2,$3,$4,$5,$6,$7) result",[company,thread,action,id,body,mime,bytes]);
const create=(fileId,caption='hello',op='operation-1')=>query('select public.create_whatsapp_media_send_intent($1,$2,$3,$4,$5,$6,null,null) result',[company,thread,fileId,op,caption,'current']);
const metadata=(ids,conv=thread)=>query('select public.whatsapp_media_message_metadata($1,$2,$3::uuid[]) result',[company,conv,ids]);
const removeFile=id=>query('select public.customer_inbox_remove_unbound_file($1,$2,$3) result',[company,thread,id]);
assert.equal((await ext('file',file,'proof.pdf','application/pdf','JVBERi0xLjQK')).ok,true);
assert.equal((await ext('file',attempt,'draft.pdf','application/pdf','JVBERi0xLjQK')).ok,true);
assert.equal((await removeFile(attempt)).ok,true);
assert.equal((await removeFile(attempt)).ok,true);
assert.equal((await create(file,'hello','text-existing')).code,'content_mismatch');
await db.exec(`reset role; delete from public.whatsapp_send_intents where id='${intent}'; set role authenticated`);
assert.equal((await create(file)).ok,true);
assert.equal((await removeFile(file)).code,'in_use');
assert.equal((await ext('list')).data.find(row=>row.id===file&&row.kind==='file').removable,false);
await db.exec('reset role');
assert.equal((await db.query("select private.customer_inbox_file_is_bound($1,'whatsapp',$2,jsonb_build_array('current',null),$3) value",[company,thread,file])).rows[0].value,false);
await db.exec('set role authenticated');
assert.deepEqual((await metadata([file])).data,[]);
assert.equal((await metadata([])).code,'invalid_input');
assert.equal((await metadata(Array(41).fill(file))).code,'invalid_input');
assert.equal((await metadata([file],'88888888-8888-4888-8888-888888888888')).code,'forbidden');
assert.equal((await create(file)).ok,true);
assert.equal((await create(file,'changed')).code,'content_mismatch');
assert.equal((await create('99999999-9999-4999-8999-999999999999')).code,'forbidden');
assert.equal((await query('select public.whatsapp_media_claimed_attachment($1,$2) result',[intent,attempt])).code,'forbidden');
await db.exec('reset role; set role service_role');
await assert.rejects(query('select public.claim_whatsapp_send_attempt($1,$2,90) result',[intent,actor]),/MEDIA_CLAIM_REQUIRED/);
assert.equal((await query('select public.claim_whatsapp_media_send_attempt($1,$2,90) result',[intent,actor])).ok,true);
await db.exec('reset role');
assert.equal((await db.query("select private.customer_inbox_file_is_bound($1,'whatsapp',$2,jsonb_build_array('current',null),$3) value",[company,thread,file])).rows[0].value,true);
await db.exec('set role service_role');
await db.exec(`reset role; insert into public.whatsapp_send_intents values ('99999999-9999-4999-8999-999999999999','${company}','${thread}','${actor}','staff','plain-text','hello','ready','${session}',null,null); set role service_role`);
assert.equal((await query('select public.claim_whatsapp_send_attempt($1,$2,90) result',['99999999-9999-4999-8999-999999999999',actor])).ok,true);
await db.exec(`reset role; set role authenticated; set request.actor='${actor}'; set request.session='${session}'`);
assert.equal((await query('select public.whatsapp_media_claimed_attachment($1,$2) result',[intent,attempt])).base64,'JVBERi0xLjQK');
assert.equal((await query('select public.whatsapp_media_claimed_attachment($1,$2) result',[intent,file])).code,'forbidden');
await db.exec(`reset role; update public.whatsapp_conversations set assigned_to='${session}' where id='${thread}'; set role authenticated`);
assert.equal((await query('select public.whatsapp_media_claimed_attachment($1,$2) result',[intent,attempt])).code,'forbidden');
await db.exec(`reset role; update public.whatsapp_conversations set assigned_to='${actor}' where id='${thread}'; update public.company_members set es02_branch_only=true where user_id='${actor}'; set role authenticated`);
assert.equal((await query('select public.whatsapp_media_claimed_attachment($1,$2) result',[intent,attempt])).code,'forbidden');
assert.equal((await metadata([file])).code,'forbidden');
await db.exec(`reset role; update public.company_members set es02_branch_only=false where user_id='${actor}'; set role authenticated`);
await db.exec(`set request.session='${file}'`);
assert.equal((await query('select public.whatsapp_media_claimed_attachment($1,$2) result',[intent,attempt])).code,'forbidden');
await db.exec('reset role');
await assert.rejects(db.query('update private.customer_whatsapp_media_intents set caption=$1 where intent_id=$2',['changed',intent]),/MEDIA_BINDING_IMMUTABLE/);
await db.exec(`update public.whatsapp_send_intents set outcome='accepted',message_id='${file}' where id='${intent}'; set role authenticated; set request.actor='${actor}'; set request.session='${session}'`);
assert.deepEqual((await metadata([file])).data,[{messageId:file,attachmentId:file,filename:'proof.pdf',mime:'application/pdf',caption:'hello'}]);
assert.deepEqual((await metadata([session])).data,[]);
await db.exec('reset role');
await db.exec(`update private.customer_inbox_extensions set bytes=decode('255044462d32','hex') where item_id='${file}' and channel='whatsapp'`);
await db.exec(`set role authenticated; set request.actor='${actor}'; set request.session='${session}'`);
assert.equal((await query('select public.whatsapp_media_claimed_attachment($1,$2) result',[intent,attempt])).code,'forbidden');
await db.exec('reset role; set role anon');
await assert.rejects(query('select public.whatsapp_media_claimed_attachment($1,$2) result',[intent,attempt]),/permission denied/);
await assert.rejects(metadata([file]),/permission denied/);
await assert.rejects(removeFile(file),/permission denied/);
await db.exec(`reset role; do $$declare k integer; fid uuid; iid uuid; b jsonb:=jsonb_build_array('current',null);begin
 for k in 1..11 loop
  fid:=gen_random_uuid();iid:=gen_random_uuid();
  insert into private.customer_inbox_extensions(company_id,channel,conversation_id,binding,kind,item_id,actor_id,body,mime,bytes)
   values ('${company}','whatsapp','${thread}',b,'file',fid,'${actor}','history.pdf','application/pdf',decode('255044462d','hex'));
  insert into public.whatsapp_send_intents(id,company_id,conversation_id,actor_user_id,sender_kind,client_op_id,body,outcome)
   values(iid,'${company}','${thread}','${actor}','staff','history-'||k,'history','accepted');
  insert into private.customer_whatsapp_media_intents(intent_id,company_id,conversation_id,binding,file_id,filename,mime,file_digest,caption)
   values(iid,'${company}','${thread}',b,fid,'history.pdf','application/pdf',sha256(decode('255044462d','hex')),'history');
 end loop;end$$; set role authenticated;`);
const drafts=[];
for(let n=0;n<10;n++){
  const id=randomUUID();drafts.push(id);
  assert.equal((await ext('file',id,'draft.pdf','application/pdf','JVBERi0=')).ok,true);
}
assert.equal((await ext('file',randomUUID(),'extra.pdf','application/pdf','JVBERi0=')).code,'LIMIT');
assert.equal((await ext('tag',randomUUID(),'Existing tag')).ok,true);
assert.equal((await ext('quick',randomUUID(),'Existing reply')).ok,true);
const visible=(await ext('list')).data;
assert.equal(drafts.every(id=>visible.some(row=>row.kind==='file'&&row.id===id)),true);
assert.equal(drafts.every(id=>visible.some(row=>row.kind==='file'&&row.id===id&&row.removable===true)),true);
assert.equal(visible.some(row=>row.kind==='tag'&&row.body==='Existing tag'),true);
assert.equal(visible.some(row=>row.kind==='quick'&&row.body==='Existing reply'),true);
await db.close();
console.log('50 media intent PostgreSQL assertions passed with synthetic authority fixtures');
