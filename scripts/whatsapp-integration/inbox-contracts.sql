-- TEST ONLY. Synthetic identities and inbound records; run via the verified isolated harness.
begin;
create temporary table inbox_fixture as select gen_random_uuid() as owner,gen_random_uuid() as staff,
 gen_random_uuid() as outsider,gen_random_uuid() as company,gen_random_uuid() as other_company,
 gen_random_uuid() as conversation,gen_random_uuid() as unassigned,gen_random_uuid() as first_message,
 gen_random_uuid() as future_message,gen_random_uuid() as fresh_message,gen_random_uuid() as owner_session,
 gen_random_uuid() as staff_session,gen_random_uuid() as outsider_session;
insert into auth.users(id,email,email_confirmed_at)
 select owner,'inbox-owner-'||owner||'@example.invalid',now() from inbox_fixture union all
 select staff,'inbox-staff-'||staff||'@example.invalid',now() from inbox_fixture union all
 select outsider,'inbox-outsider-'||outsider||'@example.invalid',now() from inbox_fixture;
insert into auth.sessions(id,user_id) select owner_session,owner from inbox_fixture union all
 select staff_session,staff from inbox_fixture union all select outsider_session,outsider from inbox_fixture;
insert into private.app_session_activity(session_id,user_id,last_activity_at)
 select owner_session,owner,clock_timestamp() from inbox_fixture union all
 select staff_session,staff,clock_timestamp() from inbox_fixture union all
 select outsider_session,outsider,clock_timestamp() from inbox_fixture;
insert into public.companies(id,display_name,status,created_by)
 select company,'Synthetic inbox tenant','active',owner from inbox_fixture union all
 select other_company,'Synthetic outsider tenant','active',outsider from inbox_fixture;
insert into public.company_members(company_id,user_id,role,status)
 select company,owner,'owner','active' from inbox_fixture union all
 select company,staff,'staff','active' from inbox_fixture union all
 select other_company,outsider,'owner','active' from inbox_fixture;
insert into public.company_member_grants(company_id,user_id,capabilities,conversation_scope,status)
 select company,staff,array['wa.conversations.read'],'assigned_only','active' from inbox_fixture;
insert into public.whatsapp_conversations(id,company_id,phone_number_id,customer_wa_id,assigned_to,automation_allowed)
 select conversation,company,'synthetic-inbox-phone','synthetic-inbox-recipient',staff,true from inbox_fixture union all
 select unassigned,company,'synthetic-inbox-phone','synthetic-inbox-unassigned',null,true from inbox_fixture;
insert into public.whatsapp_messages(id,company_id,conversation_id,wa_message_id,body,direction,sender,received_at)
 select first_message,company,conversation,'synthetic-inbox-'||first_message,'First inbound','inbound','customer',now() from inbox_fixture;
insert into public.whatsapp_messages(id,company_id,conversation_id,wa_message_id,body,direction,sender,received_at)
 select future_message,company,conversation,'synthetic-inbox-'||future_message,'Future provider time','inbound','customer','2099-01-01'::timestamptz from inbox_fixture;
grant select on inbox_fixture to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',owner::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',owner,'session_id',owner_session)::text,true) from inbox_fixture;
do $$ declare f record;r jsonb;t jsonb;begin
 select * into f from inbox_fixture;
 r:=public.whatsapp_inbox_page(f.company,1,null);
 if r->>'ok'<>'true' or jsonb_array_length(r->'conversations')<>1 or r->>'kind'<>'partial' or r->>'has_more'<>'true'
   or (r->>'total')::int<>2 or (r->>'unread_total')::int<>2 then raise exception 'bounded inbox contract %',r;end if;
 t:=public.whatsapp_thread_page(f.company,f.conversation,1,null);
 if t->>'displayed_inbound_message_id'<>f.future_message::text or t->>'has_more'<>'true'
   or (t->>'unread_count')::int<>2 then raise exception 'latest displayed boundary %',t;end if;
 r:=public.whatsapp_mark_thread_read(f.company,f.conversation,f.first_message);
 if r->>'code'<>'display_changed' then raise exception 'undisplayed arbitrary boundary accepted %',r;end if;
 r:=public.whatsapp_mark_thread_read(f.company,f.conversation,f.future_message);
 if r->>'ok'<>'true' or (r->>'unread_count')::int<>0 then raise exception 'displayed boundary rejected %',r;end if;
 t:=public.whatsapp_thread_page(f.company,f.conversation,1,(t->>'next_cursor')::bigint);
 if t->>'displayed_inbound_message_id' is not null then raise exception 'historical page issued read boundary %',t;end if;
 raise notice 'PASS|I1 bounded pages, counts, displayed-only read and historical boundaries';
end $$;
select 'PASS|I1 bounded pages, counts, displayed-only read and historical boundaries';
reset role;
insert into public.whatsapp_messages(id,company_id,conversation_id,wa_message_id,body,direction,sender,received_at)
 select fresh_message,company,conversation,'synthetic-inbox-'||fresh_message,'Fresh normal provider time','inbound','customer',now() from inbox_fixture;
set local role authenticated;
select set_config('request.jwt.claim.sub',owner::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',owner,'session_id',owner_session)::text,true) from inbox_fixture;
do $$ declare f record;r jsonb;begin select * into f from inbox_fixture;
 r:=public.whatsapp_mark_thread_read(f.company,f.conversation,f.future_message);
 if r->>'ok'<>'true' or (r->>'unread_count')::int<>1 then raise exception 'fresh inbound lost behind future provider time %',r;end if;
 r:=public.whatsapp_thread_page(f.company,f.conversation,1,null);
 if r->'messages'->0->>'id'<>f.fresh_message::text then raise exception 'arrival ordering poisoned %',r;end if;
 r:=public.whatsapp_mark_thread_read(f.company,f.conversation,f.future_message);
 if r->>'code'<>'display_changed' then raise exception 'stale tab boundary accepted %',r;end if;
 raise notice 'PASS|I2 fresh inbound and replaced display boundary remain safe';end $$;
select 'PASS|I2 fresh inbound and replaced display boundary remain safe';
select set_config('request.jwt.claim.sub',staff::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',staff,'session_id',staff_session)::text,true) from inbox_fixture;
do $$ declare f record;r jsonb;begin select * into f from inbox_fixture;
 r:=public.whatsapp_inbox_page(f.company,100,null);
 if jsonb_array_length(r->'conversations')<>1 or (r->>'unread_total')::int<>3 then raise exception 'per-user assigned scope/count %',r;end if;
 r:=public.whatsapp_thread_page(f.company,f.unassigned,100,null);
 if r->>'code'<>'not_found' then raise exception 'unassigned thread leaked %',r;end if;
 r:=public.whatsapp_control_audit_page(f.company,f.unassigned,100,null);
 if r->>'code'<>'not_found' then raise exception 'unassigned control audit leaked %',r;end if;
 r:=public.whatsapp_inbox_page(f.other_company,100,null);
 if r->>'code'<>'forbidden' then raise exception 'cross-company inbox leaked %',r;end if;
 r:=public.whatsapp_mark_thread_read(f.company,f.conversation,f.fresh_message);
 if r->>'code'<>'display_changed' then raise exception 'another user display reused %',r;end if;
 raise notice 'PASS|I3 assigned-only and per-user markers enforce independent access';end $$;
select 'PASS|I3 assigned-only and per-user markers enforce independent access';
reset role;
update public.company_member_grants set status='disabled' where user_id=(select staff from inbox_fixture);
set local role authenticated;
do $$ declare f record;r jsonb;begin select * into f from inbox_fixture;
 r:=public.whatsapp_inbox_page(f.company,100,null);
 if r->>'code'<>'forbidden' then raise exception 'revoked grant retained access %',r;end if;
 raise notice 'PASS|I4 revoked capability fails closed';end $$;
select 'PASS|I4 revoked capability fails closed';
reset role;
insert into public.whatsapp_conversation_events(company_id,conversation_id,actor_user_id,action,revision,automation_generation,detail)
 select company,conversation,owner,'take_over',1,0,'{"claim_token":"synthetic-secret","provider_payload":"synthetic-secret"}' from inbox_fixture;
set local role authenticated;
select set_config('request.jwt.claim.sub',owner::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',owner,'session_id',owner_session)::text,true) from inbox_fixture;
do $$ declare f record;r jsonb;begin select * into f from inbox_fixture;
 r:=public.whatsapp_control_audit_page(f.company,f.conversation,100,null);
 if jsonb_array_length(r->'events')<>1 or r::text like '%synthetic-secret%' then raise exception 'audit projection leaks internal detail %',r;end if;
 r:=public.whatsapp_inbox_connection_status(f.company);
 if r->'connection'->>'status'<>'not_connected' or r->'connection'->>'send_ready'<>'false' then raise exception 'invented connection readiness %',r;end if;
 begin insert into private.whatsapp_inbox_read_markers(company_id,conversation_id,user_id) values(f.company,f.conversation,f.owner);
   raise exception 'direct marker forgery allowed';exception when insufficient_privilege then null;end;
 if has_function_privilege('anon','public.whatsapp_inbox_page(uuid,integer,bigint)','EXECUTE') then raise exception 'anonymous inbox execution allowed';end if;
 begin update public.whatsapp_messages set arrival_sequence=arrival_sequence+1 where id=f.first_message;
   raise exception 'authenticated ordering forgery allowed';exception when insufficient_privilege then null;end;
 raise notice 'PASS|I5 secret-free audit/connection and direct-write/anonymous denial';end $$;
select 'PASS|I5 secret-free audit/connection and direct-write/anonymous denial';
reset role;
do $$ declare f record;begin select * into f from inbox_fixture;
 begin update public.whatsapp_messages set arrival_sequence=arrival_sequence+1 where id=f.first_message;
   raise exception 'ordering mutable';exception when check_violation then null;end;
 raise notice 'PASS|I6 arrival order immutable for trusted writers';end $$;
select 'PASS|I6 arrival order immutable for trusted writers';
insert into public.whatsapp_inbound_jobs(company_id,message_id,wa_message_id,status,claim_token,result_code)
 select company,future_message,'synthetic-inbox-'||future_message,'review_required',gen_random_uuid(),'synthetic-secret' from inbox_fixture;
insert into public.whatsapp_send_intents(company_id,conversation_id,client_op_id,phone_number_id,recipient_wa_id,body,sender_kind,outcome,attempt_token,provider_error_code)
 select company,conversation,'synthetic-unknown-'||conversation,'synthetic-inbox-phone','synthetic-inbox-recipient','Synthetic unknown send','staff','unknown',gen_random_uuid(),'synthetic-secret' from inbox_fixture;
insert into public.whatsapp_company_links(company_id,status,provider_phone_number_id,verified_display_number,authorization_status)
 select company,'verified','synthetic-inbox-phone','synthetic-display','revoked' from inbox_fixture;
set local role authenticated;
do $$ declare f record;r jsonb;t jsonb;begin select * into f from inbox_fixture;
 r:=public.whatsapp_thread_page(f.company,f.conversation,100,null);
 if not (r->'conversation'->'intervention'->'reasons' @> '["worker_review","send_unknown"]'::jsonb)
  or r::text like '%synthetic-secret%' then raise exception 'unsafe intervention projection %',r;end if;
 t:=public.whatsapp_inbox_page(f.company,100,null);
 if (t->>'intervention_total')::int<>1 then raise exception 'intervention count not authoritative %',t;end if;
 r:=public.whatsapp_inbox_connection_status(f.company);
 if r->'connection'->>'status'<>'verified' or r->'connection'->>'authorization_status'<>'revoked'
  or r->'connection'->>'send_ready'<>'false' then raise exception 'revoked credential invented readiness %',r;end if;
end $$;
select 'PASS|I7 durable intervention summaries and separate inactive connection evidence';
reset role;
update private.app_session_activity set last_activity_at=clock_timestamp()-interval '3 hours' where session_id=(select owner_session from inbox_fixture);
set local role authenticated;
do $$ declare f record;r jsonb;begin select * into f from inbox_fixture;
 r:=public.whatsapp_inbox_page(f.company,100,null);
 if r->>'code'<>'forbidden' then raise exception 'expired app session retained direct RPC access %',r;end if;
end $$;
select 'PASS|I8 expired session cannot bypass server actions through direct RPC';
reset role;
rollback;
