import {beforeAll,beforeEach,describe,expect,it} from 'vitest';
// @ts-expect-error Guarded synthetic fixture; no production TypeScript declaration.
import {setup,reset,id,sql,lit,claim,settle,project,paid,installed,signed,batch,save,get,ready} from '../../../scripts/instagram-send/manual-fixture.mjs';
describe.skipIf(process.env.VELORA_IG_MANUAL_POSTGRES!=='1')('actual SQL manual reply producers',()=>{
 beforeAll(setup,120000);beforeEach(reset,30000);
 // Retain the owned random DB for inspection. Never touch another runtime DB.
 it('registers reply without granting existing employees or altering defaults',async()=>{
  expect(JSON.parse(await sql('select to_json(private.access_company_capabilities())'))).toContain('ig.conversations.reply');
  await sql(`update public.company_member_grants set capabilities=array['ig.conversations.read'] where user_id='${id(13)}'`);
  expect(await save(13,23)).toEqual({ok:false,code:'FORBIDDEN'});
 });
 it('persists exact text with closed rollout and absent paid/window proof; replay and reload retain it',async()=>{
  await sql('truncate private.instagram_send_policy');const r=await save();expect(r).toMatchObject({ok:true,text:' exact saved reply ',state:'ready'});
  expect(await get()).toEqual(r);expect(await save()).toEqual(r);expect(await save(11,21,401,'changed')).toEqual({ok:false,code:'CONFLICT'});
  expect(await claim(r.binding)).toEqual({ok:false,code:'SEND_DISABLED'});
 });
 it('second native session and cross-tenant owner cannot borrow saved intent',async()=>{
  await save();await sql(`insert into auth.sessions(id,user_id) values('${id(28)}','${id(11)}');insert into private.app_session_activity(session_id,user_id,last_activity_at) values('${id(28)}','${id(11)}',clock_timestamp())`);
  expect(await get(11,28)).toEqual({ok:false,code:'FORBIDDEN'});expect(await get(12,22)).toEqual({ok:false,code:'FORBIDDEN'});
 });
 it('revocation prevents reads/writes from an existing second employee session',async()=>{
  expect(await save(13,24)).toMatchObject({ok:true});await sql(`update public.company_member_grants set status='disabled' where user_id='${id(13)}'`);
  expect(await get(13,24)).toEqual({ok:false,code:'FORBIDDEN'});expect(await save(13,24,402)).toEqual({ok:false,code:'FORBIDDEN'});
 });
 it('reports installed secret and actual unpaid blockers without fake empty success',async()=>{
  expect(await ready()).toMatchObject({ok:true,blockers:expect.arrayContaining(['ENTITLEMENT_DENIED','INSTALLED_SECRET_UNVERIFIED'])});
  const r=await save();expect(await claim(r.binding)).toEqual({ok:false,code:'ENTITLEMENT_DENIED'});
 });
 it('synthetic entitlement projection cannot replace actual Live proven receipt',async()=>{
  await installed();await signed();const r=await save();expect(await claim(r.binding)).toEqual({ok:false,code:'ENTITLEMENT_DENIED'});
 });
 it('actual Live paid receipt permits manual claim without AI service grants or knowledge',async()=>{
  const p=await paid();expect(await sql('select count(*) from private.billing_proven_entitlement_grants')).toBe('1');
  await installed();await signed();const r=await save();const c=await claim(r.binding);expect(c).toMatchObject({kind:'fresh',committed:true,text:' exact saved reply '});
  expect(await sql(`select entitlement_proof from private.instagram_send_intents where id='${id(401)}'`)).toBe(p.proof);
 });
 it('Test payment and raw subscription dates cannot authorize Live dispatch',async()=>{
  await paid('test');await installed();await signed();expect(await claim((await save()).binding)).toEqual({ok:false,code:'ENTITLEMENT_DENIED'});
 });
 it('pending reversal invalidates actual paid receipt before settlement',async()=>{
  const p=await paid();await installed();await signed();const r=await save();
  await sql(`insert into public.billing_provider_events(payment_attempt_id,company_id,provider,provider_account_ref,provider_environment,provider_transaction_id,event_status,observation_key,amount_baisa_expected,currency_expected,raw_summary)
   values('${p.payment_attempt_id}','${id(1)}','paymob','74001','live',${lit(p.evidence.provider_transaction_id)},'refunded','synthetic-reversal',5000,'OMR','{"is_refunded":true}'::jsonb)`);
  expect(await claim(r.binding)).toEqual({ok:false,code:'ENTITLEMENT_DENIED'});
 });
 it('unverified secret or missing installed contract cannot stamp provenance/open window',async()=>{
  expect(await signed()).toEqual({status:'retryable'});await installed();expect(await signed(batch(),'0'.repeat(64))).toEqual({status:'retryable'});
  expect(await sql('select count(*) from private.instagram_inbound_signatures')).toBe('0');
 });
 it('missing timestamp contract persists signing proof but opens no guessed window',async()=>{
  await installed(null);expect(await signed()).toEqual({status:'committed'});
  expect(await sql('select count(*) from private.instagram_inbound_signatures')).toBe('1');expect(await sql('select count(*) from private.instagram_send_windows')).toBe('0');
  expect(await ready()).toMatchObject({blockers:expect.arrayContaining(['TIMESTAMP_CONTRACT_UNVERIFIED'])});
 });
 it.each(['future','expired','string','entry-only'])('%s provider timestamp never uses local receipt as authority',async kind=>{
  await installed();const b=batch('mid.bad',kind==='future'?Date.now()+600000:kind==='expired'?Date.now()-25*3600000:kind==='string'?String(Date.now()):null);
  if(kind==='entry-only')b.events[0].rawEntryTimestamp=Date.now();expect(await signed(b)).toEqual({status:'committed'});
  expect(await sql('select count(*) from private.instagram_send_windows')).toBe('0');
 });
 it('documented seconds and milliseconds normalize exactly; duplicate cannot extend deadline',async()=>{
  await installed('unix_seconds');const t=Math.floor(Date.now()/1000)-60,b=batch('mid.seconds',t);await signed(b);
  expect(await sql('select extract(epoch from provider_event_at)::bigint from private.instagram_send_windows')).toBe(String(t));
  const expiry=await sql('select closes_at from private.instagram_send_windows');await signed({...b,localReceivedAt:new Date(Date.now()+60000).toISOString()});
  expect(await sql('select count(*) from private.instagram_send_windows')).toBe('1');expect(await sql('select closes_at from private.instagram_send_windows')).toBe(expiry);
 });
 it('same MID with a different signed body/timestamp cannot attest the original row',async()=>{
  await installed();const b=batch('mid.same',null);await signed(b);expect(await sql('select count(*) from private.instagram_send_windows')).toBe('0');
  await signed({...batch('mid.same'),rawBodySha256:'c'.repeat(64)});expect(await sql('select count(*) from private.instagram_send_windows')).toBe('0');
 });
 it('acceptance history survives later paid expiry and does not create retry authority',async()=>{
  await paid();await installed();await signed();const r=await save(),c=await claim(r.binding);expect(c.kind).toBe('fresh');
  await settle(r.binding,c.claimReceipt,{status:'accepted',recipientId:'200',messageId:'mid.accepted.actual'});
  await sql("update public.billing_subscriptions set status='past_due'");expect(await get()).toMatchObject({ok:true,state:'accepted',delivery:'unconfirmed'});
  expect(await project(r.binding)).toMatchObject({ok:true,state:'accepted'});expect(await claim(r.binding)).toMatchObject({kind:'existing',progress:{state:'accepted'}});
 });
 it('expiry after save denies claim while retaining authorized saved history',async()=>{
  await paid();await installed();await signed();const r=await save();
  await sql("update public.billing_subscriptions set paid_through=clock_timestamp()-interval '1 second'");
  expect(await claim(r.binding)).toEqual({ok:false,code:'ENTITLEMENT_DENIED'});expect(await get()).toMatchObject({ok:true,text:' exact saved reply '});
 });
 it('installed signing rotation invalidates the old window without guessing renewal',async()=>{
  await paid();await installed();await signed();const r=await save();
  await sql("update private.instagram_manual_contracts set secret_fingerprint=repeat('c',64)");
  expect(await claim(r.binding)).toEqual({ok:false,code:'WINDOW_CLOSED'});
 });
 it('unresolved claim blocks a replacement UUID and never becomes another fresh claim',async()=>{
  await paid();await installed();await signed();const r=await save();expect(await claim(r.binding)).toMatchObject({kind:'fresh'});
  expect(await claim(r.binding)).toMatchObject({kind:'existing',progress:{state:'claimed'}});expect(await save(11,21,402)).toEqual({ok:false,code:'RECONCILIATION_REQUIRED'});
 });
 it('assignment change revokes an assigned-only employee saved intent',async()=>{
  await paid();await installed();await signed();await sql(`update public.company_member_grants set conversation_scope='assigned_only' where user_id='${id(13)}';update private.instagram_conversations set assigned_to='${id(13)}' where counterparty_id='200'`);
  const r=await save(13,24);expect(r.ok).toBe(true);await sql('update private.instagram_conversations set assigned_to=null');
  expect(await get(13,24)).toEqual({ok:false,code:'FORBIDDEN'});expect(await claim(r.binding)).toEqual({ok:false,code:'FORBIDDEN'});
 });
});
