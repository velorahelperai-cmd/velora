-- TEST ONLY (F5). Isolated local PostgreSQL; synthetic tenants; no provider calls; rolled back.
begin;
-- f5-run seeds this verified link BEFORE applying F5; this checks the migration's actual backfill.
do $$ begin
 if not exists(select 1 from private.whatsapp_link_number_confirmations c join public.whatsapp_company_links l on l.id=c.link_id and l.generation=c.link_generation
   where l.id=md5('f8-backfill-link')::uuid and c.status='legacy_unconfirmed') then raise exception 'existing link was not backfilled as legacy_unconfirmed'; end if;
 if not exists(select 1 from private.whatsapp_link_number_confirmation_events where link_id=md5('f8-backfill-link')::uuid and event='legacy_required') then raise exception 'legacy backfill audit missing'; end if;
end $$;
select 'PASS|F8 verified link present before migration is backfilled legacy_unconfirmed with legacy_required audit';
grant usage on schema test_fixture to authenticated;
create function pg_temp.f5_owner(f jsonb) returns jsonb language plpgsql as $$
declare sid uuid:=gen_random_uuid();begin
 update auth.users set email_confirmed_at=clock_timestamp() where id=(f->>'user')::uuid;
 insert into auth.sessions(id,user_id) values(sid,(f->>'user')::uuid);
 insert into private.app_session_activity(session_id,user_id,last_activity_at) values(sid,(f->>'user')::uuid,clock_timestamp());
 return f||jsonb_build_object('owner_session',sid);end;$$;
create function pg_temp.f5_as_owner(f jsonb) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claim.sub',f->>'user',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f->>'user','session_id',f->>'owner_session','role','authenticated')::text,true);
 perform set_config('role','authenticated',true);end;$$;
create function pg_temp.f5_reset_pending(p_link uuid) returns void language sql as $$
 update private.whatsapp_link_number_confirmations set status='pending',decided_at=null,decided_by=null,decided_session_id=null where link_id=p_link;
$$;

-- 1. Gate: unconfirmed number blocks assistant, staff and any direct transition to attempting.
do $$ declare f jsonb;j uuid;claim uuid;a uuid;i uuid;r jsonb;g bigint;begin
 perform set_config('role','service_role',true);
 f:=test_fixture.company();
 perform set_config('role','none',true);f:=pg_temp.f5_owner(f);
 select generation into g from whatsapp_company_links where id=(f->>'link')::uuid;
 if not exists(select 1 from private.whatsapp_link_number_confirmations where link_id=(f->>'link')::uuid and link_generation=g)
 or not exists(select 1 from private.whatsapp_link_number_confirmation_events where link_id=(f->>'link')::uuid and event='required')
 then raise exception 'verified link did not require confirmation';end if;
 perform pg_temp.f5_reset_pending((f->>'link')::uuid);
 perform set_config('role','service_role',true);
 -- Send path via the assistant draft fixture is not runnable locally (NOURA_SERVICE_NOT_ACTIVE: billing/service
 -- migrations skipped in replay); assert the gate predicate both claim wrappers and the attempting-trigger use.
 perform set_config('role','none',true);
 if not private.wa_f5_number_unconfirmed((f->>'link')::uuid,g) then raise exception 'unconfirmed number not gated';end if;
 -- Owner confirms through the authenticated RPC; the same claim then proceeds.
 perform pg_temp.f5_as_owner(f);
 r:=whatsapp_read_number_confirmation((f->>'company')::uuid);
 if r->>'status' is distinct from 'pending' then raise exception 'read did not show pending: %',r;end if;
 r:=whatsapp_decide_number_confirmation((f->>'company')::uuid,(f->>'link')::uuid,g,'confirmed');
 if r->>'status' is distinct from 'confirmed' then raise exception 'confirm rejected: %',r;end if;
 r:=whatsapp_decide_number_confirmation((f->>'company')::uuid,(f->>'link')::uuid,g,'confirmed');
 if r->>'replayed' is distinct from 'true' then raise exception 'confirm replay not idempotent: %',r;end if;
 r:=whatsapp_decide_number_confirmation((f->>'company')::uuid,(f->>'link')::uuid,g,'rejected');
 if r->>'code' is distinct from 'ALREADY_DECIDED' then raise exception 'reject after confirm accepted: %',r;end if;
 perform set_config('role','service_role',true);
 perform set_config('role','none',true);
 if private.wa_f5_number_unconfirmed((f->>'link')::uuid,g) then raise exception 'confirmed number still gated';end if;
 perform set_config('role','none',true);
 if (select count(*) from private.whatsapp_link_number_confirmation_events where link_id=(f->>'link')::uuid and event='confirmed')<>1 then raise exception 'confirm audit missing/duplicated';end if;
 raise notice 'ok';
end $$;
select 'PASS|F5 unconfirmed number is gated (predicate); owner confirm is idempotent, audited and unblocks';

-- 2. Rejection disconnects through the existing local path, is audited and append-only.
do $$ declare f jsonb;r jsonb;g bigint;begin
 perform set_config('role','service_role',true);
 f:=test_fixture.company(false);
 perform set_config('role','none',true);f:=pg_temp.f5_owner(f);
 select generation into g from whatsapp_company_links where id=(f->>'link')::uuid;
 perform pg_temp.f5_reset_pending((f->>'link')::uuid);
 perform pg_temp.f5_as_owner(f);
 r:=whatsapp_decide_number_confirmation((f->>'company')::uuid,(f->>'link')::uuid,g,'maybe');
 if r->>'code' is distinct from 'INVALID_INPUT' then raise exception 'invalid answer accepted';end if;
 r:=whatsapp_decide_number_confirmation((f->>'company')::uuid,(f->>'link')::uuid,g+1,'rejected');
 if r->>'code' is distinct from 'NOT_REQUIRED' then raise exception 'stale generation accepted: %',r;end if;
 r:=whatsapp_decide_number_confirmation((f->>'company')::uuid,(f->>'link')::uuid,g,'rejected');
 if r->>'status' is distinct from 'rejected' or r->>'disconnected' is distinct from 'true' then raise exception 'reject failed: %',r;end if;
 perform set_config('role','none',true);
 if not exists(select 1 from whatsapp_company_links where id=(f->>'link')::uuid and status='disconnected' and authorization_status='revoked' and access_secret_id is null)
 then raise exception 'rejection did not disconnect link';end if;
 if not exists(select 1 from private.whatsapp_link_number_confirmations where link_id=(f->>'link')::uuid and status='rejected' and decided_by=(f->>'user')::uuid)
 or not exists(select 1 from private.whatsapp_link_number_confirmation_events where link_id=(f->>'link')::uuid and event='rejected' and actor_user_id=(f->>'user')::uuid)
 then raise exception 'rejection not persisted/audited';end if;
 begin delete from private.whatsapp_link_number_confirmation_events where link_id=(f->>'link')::uuid;raise exception 'audit deletable';
 exception when others then if sqlerrm is distinct from 'WA_NUMBER_CONFIRMATION_AUDIT_APPEND_ONLY' then raise;end if;end;
 raise notice 'ok';
end $$;
select 'PASS|F5 not-my-number disconnects via existing local path, revokes authorization, audited append-only';

-- 3. Authorization: another user / missing session cannot read or decide; tables are not client-visible.
do $$ declare f jsonb;o jsonb;r jsonb;g bigint;begin
 perform set_config('role','service_role',true);
 f:=test_fixture.company(false);o:=test_fixture.company(false);
 perform set_config('role','none',true);f:=pg_temp.f5_owner(f);o:=pg_temp.f5_owner(o);
 select generation into g from whatsapp_company_links where id=(f->>'link')::uuid;
 perform pg_temp.f5_reset_pending((f->>'link')::uuid);
 perform pg_temp.f5_as_owner(o);
 r:=whatsapp_decide_number_confirmation((f->>'company')::uuid,(f->>'link')::uuid,g,'confirmed');
 if r->>'code' is distinct from 'FORBIDDEN' then raise exception 'foreign owner decided: %',r;end if;
 r:=whatsapp_read_number_confirmation((f->>'company')::uuid);
 if r->>'code' is distinct from 'FORBIDDEN' then raise exception 'foreign owner read: %',r;end if;
 begin perform 1 from private.whatsapp_link_number_confirmations;raise exception 'client can read private table';
 exception when insufficient_privilege then null;end;
 perform set_config('role','none',true);
 if not exists(select 1 from private.whatsapp_link_number_confirmations where link_id=(f->>'link')::uuid and status='pending') then raise exception 'foreign decision changed state';end if;
 raise notice 'ok';
end $$;
select 'PASS|F5 confirmation RPCs are owner+session bound; private tables are not client-readable';

-- 4. Re-verification of a link (new generation/number) requires a fresh decision.
do $$ declare f jsonb;g bigint;begin
 perform set_config('role','service_role',true);
 f:=test_fixture.company(false);
 perform set_config('role','none',true);
 update private.whatsapp_link_number_confirmations set status='confirmed',decided_at=clock_timestamp() where link_id=(f->>'link')::uuid;
 update whatsapp_company_links set provider_phone_number_id='synthetic-phone-changed-'||gen_random_uuid() where id=(f->>'link')::uuid returning generation into g;
 if not exists(select 1 from private.whatsapp_link_number_confirmations where link_id=(f->>'link')::uuid and link_generation=g and status='pending')
 then raise exception 'number change did not require new confirmation';end if;
 raise notice 'ok';
end $$;
select 'PASS|F5 a changed verified number requires a fresh confirmation';

-- 5. Resume RPC never authorizes without the same native session.
do $$ declare r jsonb;begin
 perform set_config('request.jwt.claims','{}',true);perform set_config('role','authenticated',true);
 r:=es02_b3_resume_owned_branch_launch(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
 if r->>'ok' is distinct from 'false' then raise exception 'resume without session: %',r;end if;
 perform set_config('role','none',true);
 raise notice 'ok';
end $$;
select 'PASS|F5 resume launch denies callers without the bound session';

-- 6. F7: legacy (pre-existing) links are NOT exempt. legacy_unconfirmed and missing rows block sends;
--    read reports pending (+legacy) so the prompt shows; owner confirm unblocks; gate setting defaults to enforce.
do $$ declare f jsonb;j uuid;claim uuid;a uuid;i uuid;r jsonb;g bigint;begin
 if (select enforce from private.wa_number_gate_settings) is distinct from true then raise exception 'gate default is not enforce';end if;
 perform set_config('role','service_role',true);
 f:=test_fixture.company();
 perform set_config('role','none',true);f:=pg_temp.f5_owner(f);
 select generation into g from whatsapp_company_links where id=(f->>'link')::uuid;
 -- Simulate a pre-existing link with no confirmation row: must still be blocked (fail closed).
 delete from private.whatsapp_link_number_confirmations where link_id=(f->>'link')::uuid;
 if not private.wa_f5_number_unconfirmed((f->>'link')::uuid,g) then raise exception 'missing row treated as confirmed';end if;
 -- Simulate the backfill state.
 insert into private.whatsapp_link_number_confirmations(link_id,link_generation,company_id,status) values((f->>'link')::uuid,g,(f->>'company')::uuid,'legacy_unconfirmed');
 perform set_config('role','service_role',true);
 -- Send path via the assistant draft fixture is not runnable locally (NOURA_SERVICE_NOT_ACTIVE: billing/service
 -- migrations skipped in replay); assert the gate predicate both claim wrappers and the attempting-trigger use.
 perform set_config('role','none',true);
 if not private.wa_f5_number_unconfirmed((f->>'link')::uuid,g) then raise exception 'unconfirmed number not gated';end if;
 perform pg_temp.f5_as_owner(f);
 r:=whatsapp_read_number_confirmation((f->>'company')::uuid);
 if r->>'status' is distinct from 'pending' or r->>'legacy' is distinct from 'true' then raise exception 'legacy not shown as pending: %',r;end if;
 r:=whatsapp_decide_number_confirmation((f->>'company')::uuid,(f->>'link')::uuid,g,'confirmed');
 if r->>'status' is distinct from 'confirmed' then raise exception 'legacy confirm rejected: %',r;end if;
 r:=whatsapp_read_number_confirmation((f->>'company')::uuid);
 if r->>'status' is distinct from 'confirmed' then raise exception 'read after confirm: %',r;end if;
 perform set_config('role','service_role',true);
 perform set_config('role','none',true);
 if private.wa_f5_number_unconfirmed((f->>'link')::uuid,g) then raise exception 'confirmed number still gated';end if;
 perform set_config('role','none',true);
 raise notice 'ok';
end $$;
select 'PASS|F7 legacy_unconfirmed / missing-row links gated (fail closed), read=pending+legacy, owner confirm unblocks, gate default enforce';

-- 7. F7: the DB setting is the only off-switch and is not client-writable.
do $$ declare f jsonb;g bigint;begin
 perform set_config('role','service_role',true);f:=test_fixture.company(false);perform set_config('role','none',true);
 select generation into g from whatsapp_company_links where id=(f->>'link')::uuid;
 perform pg_temp.f5_reset_pending((f->>'link')::uuid);
 if not private.wa_f5_number_unconfirmed((f->>'link')::uuid,g) then raise exception 'new link not gated';end if;
 update private.wa_number_gate_settings set enforce=false;
 if private.wa_f5_number_unconfirmed((f->>'link')::uuid,g) then raise exception 'enforce=false ignored';end if;
 update private.wa_number_gate_settings set enforce=true;
 perform set_config('role','service_role',true);
 begin update private.wa_number_gate_settings set enforce=false;raise exception 'service_role can flip gate';
 exception when insufficient_privilege then null;end;
 perform set_config('role','none',true);
 raise notice 'ok';
end $$;
select 'PASS|F7 gate setting defaults to enforce and is not writable by service_role/clients';

-- Exercise the actual claim wrappers and trigger, using persisted synthetic intents.
-- This isolates number confirmation from unrelated billing/AI provisioning; no provider is called.
do $$ declare f jsonb; j uuid; i uuid; g bigint; r jsonb; c public.whatsapp_conversations%rowtype; begin
 perform set_config('role','service_role',true); f:=test_fixture.company(false); j:=test_fixture.job(f);
 perform set_config('role','none',true); f:=pg_temp.f5_owner(f);
 select generation into g from whatsapp_company_links where id=(f->>'link')::uuid;
 perform pg_temp.f5_reset_pending((f->>'link')::uuid);
 select * into c from whatsapp_conversations where id=(f->>'conversation')::uuid;
 insert into whatsapp_send_intents(client_op_id,company_id,conversation_id,phone_number_id,recipient_wa_id,body,sender_kind,link_id,link_generation)
 values(gen_random_uuid()::text,c.company_id,c.id,c.phone_number_id,c.customer_wa_id,'Synthetic gate test','assistant',(f->>'link')::uuid,g) returning id into i;
 update whatsapp_inbound_jobs set send_intent_id=i where id=j;
 perform set_config('role','service_role',true);
 r:=whatsapp_claim_assistant_job_send(j,gen_random_uuid());
 if r->>'code' is distinct from 'number_unconfirmed' then raise exception 'assistant wrapper gate: %',r; end if;
 r:=claim_whatsapp_send_attempt(i,(f->>'user')::uuid,90);
 if r->>'code' is distinct from 'number_unconfirmed' then raise exception 'staff wrapper gate: %',r; end if;
 perform set_config('role','none',true);
 begin
  update whatsapp_send_intents set outcome='attempting' where id=i;
  raise exception 'direct transition bypassed number gate';
 exception when sqlstate 'P0001' then
  if sqlerrm is distinct from 'WA_NUMBER_UNCONFIRMED' then raise; end if;
 end;
 update private.whatsapp_link_number_confirmations set status='legacy_unconfirmed' where link_id=(f->>'link')::uuid and link_generation=g;
 perform set_config('role','service_role',true);
 r:=claim_whatsapp_send_attempt(i,(f->>'user')::uuid,90);
 if r->>'code' is distinct from 'number_unconfirmed' then raise exception 'legacy wrapper gate: %',r; end if;
 perform set_config('role','none',true);
 perform pg_temp.f5_as_owner(f);
 r:=whatsapp_decide_number_confirmation((f->>'company')::uuid,(f->>'link')::uuid,g,'confirmed');
 if r->>'status' is distinct from 'confirmed' then raise exception 'confirmation failed: %',r; end if;
 perform set_config('role','none',true);
 update whatsapp_send_intents set outcome='attempting',attempt_token=gen_random_uuid(),attempt_started_at=clock_timestamp(),attempt_expires_at=clock_timestamp()+interval '90 seconds' where id=i;
 if not exists(select 1 from whatsapp_send_intents where id=i and outcome='attempting') then raise exception 'confirmed transition blocked'; end if;
end $$;
select 'PASS|F8 actual assistant/staff wrappers return number_unconfirmed; legacy blocked; trigger P0001/WA_NUMBER_UNCONFIRMED; owner confirmation permits transition';
rollback;
