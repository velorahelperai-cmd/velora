// Opt-in actual isolated PostgreSQL. No cloud URLs, environment files or providers.
import { beforeAll,afterAll,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isolatedPostgres,lit } from '../g03-review-acceptance/postgres.mjs';
let db,admin;
const migration='supabase/migrations/20261010092530_staff_final_dispatch_authority.sql';
const parse=s=>JSON.parse(s.split('\n').find(x=>x.startsWith('{')));
const srv=q=>db.sql(`BEGIN;SET LOCAL ROLE service_role;${q}COMMIT;`);
const authSql=(f,q)=>`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub=${lit(f.user)};SET LOCAL request.jwt.claims=${lit(JSON.stringify({sub:f.user,session_id:f.session,role:'authenticated',exp:f.jwtExp??Math.floor(Date.now()/1000)+3600}))};${q}COMMIT;`;
const auth=(f,q)=>db.sql(authSql(f,q));
const suspend=f=>authSql(admin,`SELECT public.admin_set_company_status(${lit(f.company)},'suspended');`).replace(/^BEGIN;/,'').replace(/COMMIT;$/,'');
const gateSql=f=>`SELECT public.whatsapp_authorize_staff_dispatch(${lit(f.intent)},${lit(f.token)});`;
const gate=f=>auth(f,gateSql(f)).then(parse);
async function fixture({period='1 day',staff=false,create=true}={}){
 const f=parse(await srv(`SELECT test_fixture.dispatch_receipt('live',interval ${lit(period)});`));
 const binding=parse(await db.sql(`SELECT json_build_object('session',authorization_session_id,'phone',provider_phone_number_id,'generation',generation) FROM whatsapp_company_links WHERE id=${lit(f.link)};`));f.session=binding.session;f.phone=binding.phone;f.generation=binding.generation;
 await db.sql(`INSERT INTO private.app_session_activity(session_id,user_id,last_activity_at) VALUES(${lit(f.session)},${lit(f.user)},clock_timestamp());`);
 if(staff)await db.sql(`UPDATE company_members SET role='staff' WHERE company_id=${lit(f.company)} AND user_id=${lit(f.user)};INSERT INTO company_member_grants(company_id,user_id,capabilities,conversation_scope,status) VALUES(${lit(f.company)},${lit(f.user)},ARRAY['wa.conversations.read','wa.conversations.reply'],'all_company','active');`);
 f.legacy=f.intent;
 if(create){
  const r=parse(await auth(f,`SELECT public.create_whatsapp_send_intent(${lit('dispatch-'+randomUUID())},${lit(f.conversation)},'Synthetic staff reply',${lit(f.phone)},'staff',null,${lit(f.link)},${f.generation});`));
  expect(r).toMatchObject({ok:true,created:true});f.intent=r.intent.id;
 }
 const c=parse(await srv(`SELECT public.claim_whatsapp_send_attempt(${lit(f.intent)},${lit(f.user)},90);`));expect(c).toMatchObject({ok:true,claimed:true});f.token=c.attempt_token;
 return f;
}
beforeAll(async()=>{
 db=await isolatedPostgres();await db.bootstrap({throughMigration:'20261008173000_vel_staff_paid_send_entitlement.sql'});
 await db.file('supabase/migrations/20261010053446_service_entitlement_read_contract.sql');
 await db.file('supabase/migrations/20261010073549_service_purchase_settlement_orchestration.sql');
 await db.file('supabase/migrations/20261010084102_noura_claimed_job_authority.sql');
 await db.sql('CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;ALTER TABLE auth.sessions ADD COLUMN not_after timestamptz;ALTER TABLE auth.users ADD COLUMN banned_until timestamptz;');await db.file('scripts/whatsapp-integration/fixtures.sql');
 const a=parse(await srv('SELECT test_fixture.ai_admin(true);'));admin={user:a.actor,session:a.session};
 const source=readFileSync('scripts/whatsapp-integration/staff-paid-entitlement.sql','utf8'),start=source.indexOf('create function pg_temp.staff_paid_fixture('),end=source.indexOf('\nset local role service_role;',start);
 expect(start).toBeGreaterThan(0);await db.sql(source.slice(start,end).replace('create function pg_temp.staff_paid_fixture(','create function test_fixture.dispatch_receipt('));
 console.log('STAFF_DISPATCH_DEPENDENCIES',await db.sql("SELECT n.nspname||'.'||p.proname||'|'||md5(replace(p.prosrc,chr(13),'')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid IN ('public.claim_whatsapp_send_attempt(uuid,uuid,integer)'::regprocedure,'public.create_whatsapp_send_intent(text,uuid,text,text,text,integer,uuid,bigint)'::regprocedure,'private.whatsapp_service_window(uuid,uuid,text,text)'::regprocedure,'public.check_app_session(boolean)'::regprocedure,'private.user_has_company_capability(uuid,uuid,text)'::regprocedure,'private.user_conversation_readable(uuid,uuid,uuid)'::regprocedure,'private.manager_delegation_covers(uuid,uuid,text)'::regprocedure,'private.billing_service_receipt_eligible(uuid)'::regprocedure) ORDER BY 1;"));
 const signature='public.create_whatsapp_send_intent(text,uuid,text,text,text,integer,uuid,bigint)',original=await db.sql(`SELECT pg_get_functiondef(${lit(signature)}::regprocedure);`);
 await db.sql(original.replace('uid uuid := auth.uid();','uid uuid  := auth.uid();'));await expect(db.file(migration)).rejects.toThrow(/STAFF_DISPATCH_PREREQUISITE_MISMATCH/);await db.sql(original);
 await db.sql('ALTER TABLE billing_entitlement_applications DISABLE TRIGGER billing_entitlement_receipt_immutability;');await expect(db.file(migration)).rejects.toThrow(/STAFF_DISPATCH_RECEIPT_GUARD_MISMATCH/);await db.sql('ALTER TABLE billing_entitlement_applications ENABLE TRIGGER billing_entitlement_receipt_immutability;');
 expect(await db.file('supabase/upgrade-packages/staff-dispatch-authority/preflight.readonly.sql')).toContain('e28d52bfcd28f27b2c66f9716f6d3b6e');
 await db.sql('GRANT EXECUTE ON FUNCTION public.claim_whatsapp_send_attempt(uuid,uuid,integer) TO authenticated;');await expect(db.file(migration)).rejects.toThrow(/STAFF_DISPATCH_CLAIM_ACL_MISMATCH/);await db.sql('REVOKE EXECUTE ON FUNCTION public.claim_whatsapp_send_attempt(uuid,uuid,integer) FROM authenticated;');await db.file(migration);
});
afterAll(async()=>{if(db)await db.close();});
it('binds the authenticated actor session and exact claim receipt then consumes one authorization',async()=>{
 const f=await fixture();expect(await db.sql(`SELECT staff_actor_session_id=${lit(f.session)}::uuid AND staff_claim_plan_version_id=${lit(f.plan_version)}::uuid AND staff_claim_paid_through=${lit(f.deadline)}::timestamptz FROM whatsapp_send_intents WHERE id=${lit(f.intent)}`)).toBe('t');
 expect(await gate(f)).toMatchObject({ok:true,authorized:true,intent_id:f.intent});expect(await gate(f)).toMatchObject({ok:false,code:'dispatch_already_authorized'});
 expect(await db.sql(`SELECT staff_dispatch_token=${lit(f.token)}::uuid AND staff_dispatch_authorized_at IS NOT NULL FROM whatsapp_send_intents WHERE id=${lit(f.intent)}`)).toBe('t');
});
it('denies historical unbound intents without backfilling actor session or dispatch evidence',async()=>{const f=await fixture({create:false});expect(await gate(f)).toMatchObject({ok:false,code:'dispatch_binding_mismatch'});expect(await db.sql(`SELECT staff_actor_session_id IS NULL AND staff_claim_plan_version_id IS NULL AND staff_dispatch_token IS NULL FROM whatsapp_send_intents WHERE id=${lit(f.intent)}`)).toBe('t');});
async function noDispatch(f){expect(await db.sql(`SELECT staff_dispatch_token IS NULL AND staff_dispatch_authorized_at IS NULL AND outcome='attempting' AND attempt_token=${lit(f.token)}::uuid FROM whatsapp_send_intents WHERE id=${lit(f.intent)}`)).toBe('t');}
for(const [name,mutate] of [
 ['reply capability',f=>`UPDATE company_member_grants SET capabilities=ARRAY['wa.conversations.read'] WHERE company_id=${lit(f.company)} AND user_id=${lit(f.user)};`],
 ['read capability',f=>`UPDATE company_member_grants SET capabilities=ARRAY['wa.conversations.reply'] WHERE company_id=${lit(f.company)} AND user_id=${lit(f.user)};`],
 ['membership',f=>`UPDATE company_members SET status='disabled' WHERE company_id=${lit(f.company)} AND user_id=${lit(f.user)};`],
 ['company suspension',suspend],
 ['identity verification',f=>`UPDATE auth.users SET email_confirmed_at=null,phone_confirmed_at=null WHERE id=${lit(f.user)};`],
 ['deleted session',f=>`DELETE FROM auth.sessions WHERE id=${lit(f.session)};`],
 ['expired activity',f=>`UPDATE private.app_session_activity SET expired_at=clock_timestamp() WHERE session_id=${lit(f.session)};`],
 ['session deadline',f=>`UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id=${lit(f.session)};`],
 ['banned actor',f=>`UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 day' WHERE id=${lit(f.user)};`],
 ['missing activity',f=>`DELETE FROM private.app_session_activity WHERE session_id=${lit(f.session)};`],
 ['idle lease',f=>`UPDATE private.app_session_activity SET last_activity_at=clock_timestamp()-interval '2 hours' WHERE session_id=${lit(f.session)};`],
 ['conversation assignment',f=>`UPDATE company_member_grants SET conversation_scope='assigned_only' WHERE company_id=${lit(f.company)} AND user_id=${lit(f.user)};UPDATE whatsapp_conversations SET assigned_to=null WHERE id=${lit(f.conversation)};`],
 ['claim expiry',f=>`UPDATE whatsapp_send_intents SET attempt_expires_at=clock_timestamp()-interval '1 second' WHERE id=${lit(f.intent)};`],
 ['receipt revocation',f=>`SET ROLE service_role;UPDATE billing_entitlement_applications SET status='revoked' WHERE id=${lit(f.grant)};`],
 ['paid proof drift',f=>`UPDATE billing_subscriptions SET paid_through=paid_through+interval '1 second' WHERE id=${lit(f.subscription)};`],
 ['link generation',f=>`UPDATE whatsapp_company_links SET access_secret_id=vault.create_secret('synthetic-rotated-credential') WHERE id=${lit(f.link)};`],
 ['Meta expiry',f=>`UPDATE whatsapp_company_links SET authorization_expires_at=clock_timestamp()-interval '1 second' WHERE id=${lit(f.link)};`],
])it(`denies final dispatch after ${name} changes`,async()=>{const f=await fixture({staff:true});await db.sql(`BEGIN;${mutate(f)}COMMIT;`);expect(await gate(f)).toMatchObject({ok:false});await noDispatch(f);});
it('permits verified phone identity and denies substituted actor session claim or tenant',async()=>{
 const f=await fixture({staff:true}),other=await fixture();await db.sql(`UPDATE auth.users SET email_confirmed_at=null,phone_confirmed_at=clock_timestamp() WHERE id=${lit(f.user)};`);
 for(const substituted of [{...f,user:other.user},{...f,session:other.session},{...f,token:other.token},{...f,intent:other.intent}])expect(await gate(substituted)).toMatchObject({ok:false});await noDispatch(f);expect(await gate(f)).toMatchObject({ok:true});
});
it('prevents direct service writes from forging session payment or consumed dispatch provenance even with matching GUC',async()=>{
 const f=await fixture();await expect(srv(`SELECT set_config('velora.staff_dispatch_binding','1',true);UPDATE whatsapp_send_intents SET staff_dispatch_token=attempt_token,staff_dispatch_authorized_at=clock_timestamp() WHERE id=${lit(f.intent)};`)).rejects.toThrow(/STAFF_DISPATCH_BINDING_IMMUTABLE/);
 await expect(srv(`UPDATE whatsapp_send_intents SET staff_actor_session_id=${lit(randomUUID())} WHERE id=${lit(f.intent)};`)).rejects.toThrow(/STAFF_PROVENANCE_IMMUTABLE/);
 await expect(srv(`UPDATE whatsapp_send_intents SET staff_claim_paid_through=staff_claim_paid_through+interval '1 second' WHERE id=${lit(f.intent)};`)).rejects.toThrow(/STAFF_PAYMENT_BINDING_IMMUTABLE/);await noDispatch(f);
});
it('requires an authenticated JWT session for final authorization and never exposes attempt tokens through the table',async()=>{
 const f=await fixture();await expect(srv(gateSql(f))).rejects.toThrow(/permission denied/);expect(await db.sql("SELECT has_column_privilege('authenticated','public.whatsapp_send_intents','attempt_token','SELECT') OR has_column_privilege('authenticated','public.whatsapp_send_intents','staff_dispatch_token','SELECT');")).toBe('f');
});
it('allows exactly one concurrent final authorization',async()=>{const f=await fixture();const results=await Promise.all([gate(f),gate(f)]);expect(results.filter(r=>r.ok)).toHaveLength(1);expect(results.find(r=>!r.ok)).toMatchObject({code:'dispatch_already_authorized'});});

async function manager(f){const id=randomUUID();await db.sql(`INSERT INTO auth.users(id,email) VALUES(${lit(id)},${lit('synthetic-manager-'+id+'@example.invalid')});INSERT INTO platform_admins(user_id,role,status) VALUES(${lit(id)},'delegated','active');INSERT INTO platform_admin_scopes(admin_user_id,company_id,usable_capabilities,delegable_capabilities) VALUES(${lit(id)},${lit(f.company)},ARRAY['wa.conversations.read','wa.conversations.reply'],ARRAY['wa.conversations.read','wa.conversations.reply']);UPDATE company_member_grants SET manager_user_id=${lit(id)} WHERE company_id=${lit(f.company)} AND user_id=${lit(f.user)};`);return id;}
it('revalidates delegated manager status and both read and reply scope',async()=>{
 for(const change of ['status','scope']){const f=await fixture({staff:true}),m=await manager(f);expect(await db.sql(`SELECT private.user_has_company_capability(${lit(f.user)},${lit(f.company)},'wa.conversations.reply') AND private.user_conversation_readable(${lit(f.user)},${lit(f.company)},null);`)).toBe('t');
 await db.sql(change==='status'?`UPDATE platform_admins SET status='disabled' WHERE user_id=${lit(m)};`:`UPDATE platform_admin_scopes SET delegable_capabilities=ARRAY['wa.conversations.read'] WHERE admin_user_id=${lit(m)} AND company_id=${lit(f.company)};`);expect(await gate(f)).toMatchObject({ok:false});await noDispatch(f);}
});
it('denies a known refund event awaiting settlement',async()=>{const f=await fixture();await db.sql(`INSERT INTO billing_provider_events(id,payment_attempt_id,company_id,provider_account_ref,provider_environment,provider_transaction_id,event_status,observation_key,amount_baisa_expected,currency_expected,raw_summary) SELECT gen_random_uuid(),payment_attempt_id,company_id,provider_account_ref,provider_environment,provider_transaction_id,'refunded',${lit('synthetic-refund-'+randomUUID())},amount_baisa_expected,currency_expected,raw_summary||'{"is_refunded":true}'::jsonb FROM billing_provider_events WHERE id=(SELECT provider_event_id FROM billing_entitlement_applications WHERE id=${lit(f.grant)});`);expect(await gate(f)).toMatchObject({ok:false,code:'paid_entitlement_unconfirmed'});await noDispatch(f);});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function observe(name,predicate){const until=Date.now()+12000;while(Date.now()<until){const state=parse(await db.sql(`SELECT row_to_json(x) FROM (SELECT pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE application_name=${lit(name)}) x;`).then(s=>s||'{}'));if(predicate(state))return state;await delay(40);}throw Error('STAFF_DISPATCH_LOCK_NOT_OBSERVED');}
async function blockedGate(f,change,{expire}={}){
 const tag=randomUUID(),holderName='staff-holder-'+tag,waiterName='staff-waiter-'+tag;
 const holder=db.session(`BEGIN;SET LOCAL idle_in_transaction_session_timeout='45s';SELECT id FROM companies WHERE id=${lit(f.company)} FOR NO KEY UPDATE;`,holderName,{keepOpen:true});holder.done.catch(()=>{});let waiter;
 try{const h=await observe(holderName,x=>x.state==='idle in transaction');
 waiter=db.session(`SET lock_timeout='35s';SET statement_timeout='40s';${authSql(f,gateSql(f))}`,waiterName);waiter.done.catch(()=>{});
 const w=await observe(waiterName,x=>x.wait_event_type==='Lock'&&x.blockers?.includes(h.pid));expect(w.pid).not.toBe(h.pid);
 if(expire){expect(await db.sql(`SELECT clock_timestamp()<${lit(expire)}::timestamptz;`)).toBe('t');await db.sql(`SET statement_timeout='30s';SELECT pg_sleep(greatest(0,extract(epoch FROM (${lit(expire)}::timestamptz-clock_timestamp())))+0.1);`);expect(await db.sql(`SELECT clock_timestamp()>${lit(expire)}::timestamptz;`)).toBe('t');}
 holder.child.stdin.end(`SET LOCAL ROLE service_role;${change}COMMIT;\n`);const [,result]=await Promise.all([holder.done,waiter.done]);console.log('STAFF_FINAL_LOCK',JSON.stringify({holder:h.pid,waiter:w.pid,changedBeforeRelease:true,expired:!!expire}));expect(parse(result)).toMatchObject({ok:false});await noDispatch(f);
 }finally{if(!holder.child.stdin.destroyed)holder.child.stdin.end('ROLLBACK;\n');await Promise.allSettled([holder.done,...(waiter?[waiter.done]:[])]);}
}
for(const [name,change] of [
 ['staff grant revocation',f=>`UPDATE company_member_grants SET status='disabled' WHERE company_id=${lit(f.company)} AND user_id=${lit(f.user)};`],
 ['session deletion',f=>`DELETE FROM auth.sessions WHERE id=${lit(f.session)};`],
 ['company suspension',suspend],
 ['receipt revocation',f=>`UPDATE billing_entitlement_applications SET status='revoked' WHERE id=${lit(f.grant)};`],
])it(`observes a company lock wait then denies committed ${name}`,async()=>{const f=await fixture({staff:true});await blockedGate(f,change(f));});
it('checks actual paid expiry after an observed company lock wait',async()=>{const f=await fixture({period:'20 seconds'});await blockedGate(f,'',{expire:f.deadline});});
it('checks actual idle expiry after an observed company lock wait',async()=>{const f=await fixture();const until=await db.sql(`UPDATE private.app_session_activity SET last_activity_at=clock_timestamp()-interval '2 hours'+interval '15 seconds' WHERE session_id=${lit(f.session)} RETURNING last_activity_at+interval '2 hours';`);await blockedGate(f,'',{expire:until});});
it('retains actor session grant and receipt locks through authorization commit and denies reverse contention',async()=>{
 const f=await fixture({staff:true}),tag=randomUUID();const holder=db.session(authSql(f,gateSql(f)).replace(/COMMIT;$/,''),'staff-retained-'+tag,{keepOpen:true});holder.done.catch(()=>{});
 try{await observe('staff-retained-'+tag,x=>x.state==='idle in transaction');for(const query of [`SELECT id FROM auth.sessions WHERE id=${lit(f.session)} FOR UPDATE NOWAIT;`,`SELECT session_id FROM private.app_session_activity WHERE session_id=${lit(f.session)} FOR UPDATE NOWAIT;`,`SELECT user_id FROM company_member_grants WHERE user_id=${lit(f.user)} AND company_id=${lit(f.company)} FOR UPDATE NOWAIT;`,`SELECT id FROM billing_entitlement_applications WHERE id=${lit(f.grant)} FOR UPDATE NOWAIT;`])await expect(db.sql(`BEGIN;${query}ROLLBACK;`)).rejects.toThrow(/could not obtain lock/);
 }finally{holder.child.stdin.end('COMMIT;\n');await holder.done;}
 const other=await fixture({staff:true}),name='staff-reverse-'+randomUUID(),blocker=db.session(`BEGIN;SELECT user_id FROM company_member_grants WHERE company_id=${lit(other.company)} AND user_id=${lit(other.user)} FOR UPDATE;`,name,{keepOpen:true});blocker.done.catch(()=>{});try{await observe(name,x=>x.state==='idle in transaction');expect(await gate(other)).toMatchObject({ok:false,code:'staff_authority_revoked'});await noDispatch(other);}finally{blocker.child.stdin.end('ROLLBACK;\n');await blocker.done;}
});
it('preserves accepted unknown and rejected receipt recovery after authorization and later access revocation',async()=>{
 for(const outcome of ['accepted','unknown','rejected']){const f=await fixture({staff:true});expect(await gate(f)).toMatchObject({ok:true});await db.sql(`UPDATE company_member_grants SET status='disabled' WHERE company_id=${lit(f.company)} AND user_id=${lit(f.user)};`);
 const provider=outcome==='accepted'?lit('wamid.synthetic-final-'+randomUUID()):'null';const final=parse(await srv(`SELECT finalize_whatsapp_send_attempt(${lit(f.intent)},${lit(f.token)},${lit(outcome)},${provider},${outcome==='accepted'?'null':lit('synthetic-'+outcome)},${lit(f.user)});`));expect(final).toMatchObject({ok:true});expect(await db.sql(`SELECT outcome FROM whatsapp_send_intents WHERE id=${lit(f.intent)}`)).toBe(outcome);
 const before=await db.sql(`SELECT to_jsonb(i) FROM whatsapp_send_intents i WHERE id=${lit(f.intent)};`);expect(await gate(f)).toMatchObject({ok:false});expect(await db.sql(`SELECT to_jsonb(i) FROM whatsapp_send_intents i WHERE id=${lit(f.intent)};`)).toBe(before);
 const retry=parse(await srv(`SELECT claim_whatsapp_send_attempt(${lit(f.intent)},${lit(f.user)},90);`));expect(retry.claimed).not.toBe(true);expect(await db.sql(`SELECT staff_dispatch_token=${lit(f.token)}::uuid FROM whatsapp_send_intents WHERE id=${lit(f.intent)}`)).toBe('t');}
});

it('denies expired JWT claims without consuming the authorization',async()=>{const f=await fixture();f.jwtExp=Math.floor(Date.now()/1000)-1;expect(await gate(f)).toMatchObject({ok:false});await noDispatch(f);});
it('does not create new bound intents with deleted sessions or missing idle provenance',async()=>{
 for(const kind of ['session','activity']){const f=await fixture({create:false});await db.sql(kind==='session'?`DELETE FROM auth.sessions WHERE id=${lit(f.session)};`:`DELETE FROM private.app_session_activity WHERE session_id=${lit(f.session)};`);
 const before=await db.sql(`SELECT count(*) FROM whatsapp_send_intents WHERE company_id=${lit(f.company)};`);
 await expect(auth(f,`SELECT create_whatsapp_send_intent(${lit('dispatch-'+randomUUID())},${lit(f.conversation)},'Synthetic staff reply',${lit(f.phone)},'staff',null,${lit(f.link)},${f.generation});`)).rejects.toThrow(/STAFF_ACTOR_UNAUTHORIZED/);
 expect(await db.sql(`SELECT count(*) FROM whatsapp_send_intents WHERE company_id=${lit(f.company)};`)).toBe(before);}
});

it('retains the existing five staff paid claim and outcome regressions',async()=>{const result=await db.file('scripts/whatsapp-integration/staff-paid-entitlement.sql');expect(result.split('\n').filter(x=>x.startsWith('PASS|'))).toHaveLength(5);});
