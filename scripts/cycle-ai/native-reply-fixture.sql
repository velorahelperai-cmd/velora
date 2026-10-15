-- Explicit synthetic historical model/provider facts in the isolated database.
-- All capacity and receipt accounting execute actual native functions.
create function private.fixture_cycle_reply(n integer,happened timestamptz,finalize boolean) returns void language plpgsql security definer set search_path='' as $$
declare cid uuid:='ac000000-0000-4000-8000-000000000001';j uuid;c uuid;m uuid;claim uuid;i uuid;a uuid;r jsonb;begin
 j:=('ac000000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid;c:=('ac000000-0000-4000-8000-'||lpad((200+n)::text,12,'0'))::uuid;
 m:=('ac000000-0000-4000-8000-'||lpad((300+n)::text,12,'0'))::uuid;claim:=('ac000000-0000-4000-8000-'||lpad((400+n)::text,12,'0'))::uuid;
 i:=('ac000000-0000-4000-8000-'||lpad((500+n)::text,12,'0'))::uuid;a:=('ac000000-0000-4000-8000-'||lpad((600+n)::text,12,'0'))::uuid;
 if not exists(select 1 from public.whatsapp_inbound_jobs where id=j) then
 insert into public.whatsapp_conversations values(c,cid,'open',true,1);
 insert into public.whatsapp_messages values(m,cid,c,'inbound','customer','in-'||n,null,null,happened);
 insert into public.whatsapp_inbound_jobs(id,company_id,message_id,wa_message_id,status,claim_token,claim_expires_at,expected_automation_generation,created_at) values(j,cid,m,'in-'||n,'claimed',claim,clock_timestamp()+interval '5 minutes',1,happened);
 r:=public.whatsapp_reserve_job_usage(j,claim);if r->>'ok' is distinct from 'true' then raise exception 'FIXTURE_RESERVE_FAILED:%',r;end if;end if;
 if not exists(select 1 from public.ai_usage_ledger where id=a) then
 insert into public.ai_usage_ledger values(a,cid,j,'reserved',null,'[]',1,'company_live',null,'offline-model',null,happened);
 update public.ai_usage_ledger set status='success',response_text='offline reply',request_id='OFFLINE-SYNTHETIC-'||n,cost_baisa=1 where id=a;
 insert into public.whatsapp_send_intents(id,company_id,conversation_id,original_job_id,sender_kind,outcome,body,wa_message_id,expected_automation_generation,created_at) values(i,cid,c,j,'assistant','accepted','offline reply','OFFLINE-RECEIPT-'||n,1,happened);
 update public.whatsapp_inbound_jobs set staged_reply='offline reply',staged_citations='[]',staged_ai_attempt_id=a,send_intent_id=i,completed_at=happened where id=j;end if;
 if finalize then r:=public.billing_finalize_automated_usage(cid,i);if r->>'ok' is distinct from 'true' then raise exception 'FIXTURE_FINALIZE_FAILED:%',r;end if;end if;
end;$$;
revoke all on function private.fixture_cycle_reply(integer,timestamptz,boolean) from public,anon,authenticated;
grant usage on schema private to service_role;grant execute on function private.fixture_cycle_reply(integer,timestamptz,boolean) to service_role;
