-- Synthetic fixtures only. Run with psql ON_ERROR_STOP=1 against the isolated
-- PostgreSQL harness after the historical migrations. Everything rolls back.
-- The real service_role writes and RPCs below catch missing database boundaries.
begin;
create temporary table identity_delivery_results (label text, passed boolean, detail text);
grant all on table identity_delivery_results to service_role, authenticated;
create function pg_temp.identity_assert(p_label text, p_passed boolean, p_detail text default null)
returns void language sql as $$
  insert into pg_temp.identity_delivery_results values (p_label, coalesce(p_passed, false), p_detail);
$$;
create function pg_temp.identity_expect_rejection(p_label text, p_sql text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    -- Roll an unsafe success back too, keeping subsequent cases independent.
    raise exception 'unsafe write succeeded' using errcode='P0001';
  exception when others then
    perform pg_temp.identity_assert(p_label, sqlstate in ('23503', '23514', '22023'), sqlstate || ':' || sqlerrm);
  end;
end;
$$;

insert into auth.users(id,email) values
 ('d1000000-0000-0000-0000-000000000001','identity-a@example.invalid'),
 ('d1000000-0000-0000-0000-000000000002','identity-b@example.invalid');
insert into public.companies(id,display_name,status,created_by) values
 ('d1000000-0000-0000-0000-000000000011','Synthetic identity A','active','d1000000-0000-0000-0000-000000000001'),
 ('d1000000-0000-0000-0000-000000000012','Synthetic identity B','active','d1000000-0000-0000-0000-000000000002');
insert into public.whatsapp_company_links(id,company_id,status,provider_phone_number_id) values
 ('d1000000-0000-0000-0000-000000000021','d1000000-0000-0000-0000-000000000011','verified','synthetic-phone-a'),
 ('d1000000-0000-0000-0000-000000000022','d1000000-0000-0000-0000-000000000012','verified','synthetic-phone-b');
insert into public.whatsapp_conversations(id,company_id,phone_number_id,customer_wa_id) values
 ('d1000000-0000-0000-0000-000000000031','d1000000-0000-0000-0000-000000000011','synthetic-phone-a','synthetic-recipient-a'),
 ('d1000000-0000-0000-0000-000000000032','d1000000-0000-0000-0000-000000000012','synthetic-phone-b','synthetic-recipient-b');
insert into public.whatsapp_messages(id,company_id,conversation_id,wa_message_id,body,direction,sender,received_at,delivery_state,delivery_rank) values
 ('d1000000-0000-0000-0000-000000000041','d1000000-0000-0000-0000-000000000011','d1000000-0000-0000-0000-000000000031','synthetic-inbound-a','Original customer text','inbound','customer','2026-10-08 10:00Z',null,0),
 ('d1000000-0000-0000-0000-000000000042','d1000000-0000-0000-0000-000000000011','d1000000-0000-0000-0000-000000000031','synthetic-outbound-a','Original outbound text','outbound','staff','2026-10-08 10:00Z','accepted',1);
insert into public.whatsapp_inbound_jobs(id,company_id,message_id,wa_message_id) values
 ('d1000000-0000-0000-0000-000000000051','d1000000-0000-0000-0000-000000000011','d1000000-0000-0000-0000-000000000041','synthetic-inbound-a');
insert into public.whatsapp_send_intents(id,client_op_id,company_id,conversation_id,phone_number_id,recipient_wa_id,body,sender_kind,link_id,link_generation) values
 ('d1000000-0000-0000-0000-000000000061','synthetic-intent-a','d1000000-0000-0000-0000-000000000011','d1000000-0000-0000-0000-000000000031','synthetic-phone-a','synthetic-recipient-a','Original outbound text','staff','d1000000-0000-0000-0000-000000000021',1);

set local role authenticated;
do $$ begin
 begin
  perform claim_token from public.whatsapp_inbound_jobs where id='d1000000-0000-0000-0000-000000000051';
  perform pg_temp.identity_assert('D1 authenticated cannot read job tokens',not found);
 exception when insufficient_privilege then
  perform pg_temp.identity_assert('D1 authenticated cannot read job tokens',true);
 end;
 begin
  perform public.claim_whatsapp_inbound_job('d1000000-0000-0000-0000-000000000051',120);
  perform pg_temp.identity_assert('D1 authenticated cannot invoke service-only claim',false);
 exception when insufficient_privilege then
  perform pg_temp.identity_assert('D1 authenticated cannot invoke service-only claim',true);
 end;
end; $$;

reset role;
set local role service_role;
do $$ declare r jsonb; begin
 r:=public.apply_whatsapp_delivery_status('d1000000-0000-0000-0000-000000000011','synthetic-phone-a','synthetic-early-wrong-recipient','read','synthetic-forged','2026-10-08 10:35Z');
 insert into public.whatsapp_messages(company_id,conversation_id,wa_message_id,body,direction,sender,received_at,delivery_state,delivery_rank)
 values('d1000000-0000-0000-0000-000000000011','d1000000-0000-0000-0000-000000000031','synthetic-early-wrong-recipient','Another outbound','outbound','staff','2026-10-08 10:35Z','accepted',1);
 r:=public.rebind_whatsapp_delivery_statuses('d1000000-0000-0000-0000-000000000011','synthetic-phone-a','synthetic-early-wrong-recipient');
 perform pg_temp.identity_assert('D6 early wrong recipient cannot bind',(select delivery_state='accepted' from public.whatsapp_messages where wa_message_id='synthetic-early-wrong-recipient'));
 perform pg_temp.identity_assert('D6 early wrong recipient remains unlinked for review',exists(select 1 from public.whatsapp_delivery_statuses where wa_message_id='synthetic-early-wrong-recipient' and message_id is null and link_state='conflict_review'));
 r:=public.apply_whatsapp_delivery_status('d1000000-0000-0000-0000-000000000011','synthetic-phone-a','synthetic-early-wrong-recipient','read','synthetic-forged','2026-10-08 10:35Z');
 perform pg_temp.identity_assert('D6 rejected early identity cannot become a legitimate duplicate',r->>'ok'='false',r::text);
 insert into public.whatsapp_messages(company_id,conversation_id,wa_message_id,body,direction,sender,received_at,delivery_state,delivery_rank,delivery_updated_at)
 values('d1000000-0000-0000-0000-000000000011','d1000000-0000-0000-0000-000000000031','synthetic-failure-then-proof','Another outbound','outbound','staff',now(),'accepted',1,now());
 r:=public.apply_whatsapp_delivery_status('d1000000-0000-0000-0000-000000000011','synthetic-phone-a','synthetic-failure-then-proof','failed','synthetic-recipient-a','2026-10-08 10:40Z');
 perform pg_temp.identity_assert('D6 provider failure applies before delivery',(select delivery_state='failed' from public.whatsapp_messages where wa_message_id='synthetic-failure-then-proof'));
 r:=public.apply_whatsapp_delivery_status('d1000000-0000-0000-0000-000000000011','synthetic-phone-a','synthetic-failure-then-proof','delivered','synthetic-recipient-a','2026-10-08 10:39Z');
 perform pg_temp.identity_assert('D6 proven delivery supersedes contradictory failure',(select delivery_state='delivered' from public.whatsapp_messages where wa_message_id='synthetic-failure-then-proof'));
end; $$;
reset role;

set local role service_role;
select pg_temp.identity_expect_rejection('D1 service-role wrong-company message', $q$
 insert into public.whatsapp_messages(company_id,conversation_id,wa_message_id,body,received_at)
 values('d1000000-0000-0000-0000-000000000012','d1000000-0000-0000-0000-000000000031','synthetic-bad-message','Wrong company',now())$q$);
select pg_temp.identity_expect_rejection('D1 service-role wrong-company job', $q$
 insert into public.whatsapp_inbound_jobs(company_id,message_id,wa_message_id)
 values('d1000000-0000-0000-0000-000000000012','d1000000-0000-0000-0000-000000000042','synthetic-outbound-a')$q$);
select pg_temp.identity_expect_rejection('D1 job requires original provider ID', $q$
 update public.whatsapp_inbound_jobs set wa_message_id='synthetic-forged' where id='d1000000-0000-0000-0000-000000000051'$q$);
select pg_temp.identity_expect_rejection('D1 outbound cannot become an inbound job', $q$
 insert into public.whatsapp_inbound_jobs(company_id,message_id,wa_message_id)
 values('d1000000-0000-0000-0000-000000000011','d1000000-0000-0000-0000-000000000042','synthetic-outbound-a')$q$);
select pg_temp.identity_expect_rejection('D1 message company is immutable', $q$
 update public.whatsapp_messages set company_id='d1000000-0000-0000-0000-000000000012' where id='d1000000-0000-0000-0000-000000000042'$q$);
select pg_temp.identity_expect_rejection('D1 conversation recipient is immutable', $q$
 update public.whatsapp_conversations set customer_wa_id='synthetic-forged' where id='d1000000-0000-0000-0000-000000000031'$q$);
select pg_temp.identity_expect_rejection('D1 job ordering timestamp is immutable', $q$
 update public.whatsapp_inbound_jobs set created_at=created_at-interval '1 day' where id='d1000000-0000-0000-0000-000000000051'$q$);
select pg_temp.identity_expect_rejection('D1 service-role wrong-company intent conversation', $q$
 insert into public.whatsapp_send_intents(client_op_id,company_id,conversation_id,phone_number_id,recipient_wa_id,body,sender_kind)
 values('synthetic-wrong-conv','d1000000-0000-0000-0000-000000000012','d1000000-0000-0000-0000-000000000031','synthetic-phone-a','synthetic-recipient-a','Wrong company','staff')$q$);
select pg_temp.identity_expect_rejection('D1 intent recipient must match conversation', $q$
 insert into public.whatsapp_send_intents(client_op_id,company_id,conversation_id,phone_number_id,recipient_wa_id,body,sender_kind)
 values('synthetic-wrong-recipient','d1000000-0000-0000-0000-000000000011','d1000000-0000-0000-0000-000000000031','synthetic-phone-a','synthetic-forged','Wrong recipient','staff')$q$);
select pg_temp.identity_expect_rejection('D1 intent link must belong to company', $q$
 insert into public.whatsapp_send_intents(client_op_id,company_id,conversation_id,phone_number_id,recipient_wa_id,body,sender_kind,link_id,link_generation)
 values('synthetic-wrong-link','d1000000-0000-0000-0000-000000000011','d1000000-0000-0000-0000-000000000031','synthetic-phone-a','synthetic-recipient-a','Wrong link','staff','d1000000-0000-0000-0000-000000000022',1)$q$);
select pg_temp.identity_expect_rejection('D1 intent linked message must be outbound', $q$
 update public.whatsapp_send_intents set message_id='d1000000-0000-0000-0000-000000000041',wa_message_id='synthetic-inbound-a' where id='d1000000-0000-0000-0000-000000000061'$q$);
select pg_temp.identity_expect_rejection('D1 link tenant is immutable', $q$
 update public.whatsapp_company_links set company_id='d1000000-0000-0000-0000-000000000012' where id='d1000000-0000-0000-0000-000000000021'$q$);
select pg_temp.identity_expect_rejection('D6 direct unproven snapshot write is rejected', $q$
 update public.whatsapp_messages set delivery_state='read',delivery_rank=4,delivery_updated_at='2026-10-08 09:59Z' where id='d1000000-0000-0000-0000-000000000042'$q$);
select pg_temp.identity_expect_rejection('D6 direct wrong-company event link is rejected', $q$
 insert into public.whatsapp_delivery_statuses(company_id,phone_number_id,wa_message_id,status,recipient_wa_id,occurred_at,message_id,link_state)
 values('d1000000-0000-0000-0000-000000000012','synthetic-phone-b','synthetic-outbound-a','sent','synthetic-recipient-b','2026-10-08 09:58Z','d1000000-0000-0000-0000-000000000042','applied')$q$);

do $$ declare r jsonb; begin
 r:=public.apply_whatsapp_delivery_status('d1000000-0000-0000-0000-000000000011','synthetic-phone-a','synthetic-outbound-a','read','synthetic-forged','2026-10-08 10:01Z');
 perform pg_temp.identity_assert('D6 wrong recipient is rejected',r->>'ok'='false',r::text);
 perform pg_temp.identity_assert('D6 wrong recipient leaves message accepted',(select delivery_state='accepted' from public.whatsapp_messages where wa_message_id='synthetic-outbound-a'));
 r:=public.apply_whatsapp_delivery_status('d1000000-0000-0000-0000-000000000011','synthetic-phone-a','synthetic-inbound-a','read','synthetic-recipient-a','2026-10-08 10:02Z');
 perform pg_temp.identity_assert('D6 inbound cannot receive outbound delivery evidence',r->>'ok'='false',r::text);
 perform pg_temp.identity_assert('D6 inbound delivery remains null',(select delivery_state is null from public.whatsapp_messages where wa_message_id='synthetic-inbound-a'));
 r:=public.apply_whatsapp_delivery_status('d1000000-0000-0000-0000-000000000011','synthetic-phone-a','synthetic-outbound-a','read','synthetic-recipient-a','2026-10-08 10:10Z');
 perform pg_temp.identity_assert('D6 valid read is applied',r->>'ok'='true' and (select delivery_state='read' from public.whatsapp_messages where wa_message_id='synthetic-outbound-a'),r::text);
 r:=public.apply_whatsapp_delivery_status('d1000000-0000-0000-0000-000000000011','synthetic-phone-a','synthetic-outbound-a','failed','synthetic-recipient-a','2026-10-08 10:00Z');
 perform pg_temp.identity_assert('D6 older failure cannot erase read',(select delivery_state='read' from public.whatsapp_messages where wa_message_id='synthetic-outbound-a'),r::text);
 r:=public.apply_whatsapp_delivery_status('d1000000-0000-0000-0000-000000000011','synthetic-phone-a','synthetic-outbound-a','failed','synthetic-recipient-a','2026-10-08 10:20Z');
 perform pg_temp.identity_assert('D6 later contradictory failure cannot erase read',(select delivery_state='read' from public.whatsapp_messages where wa_message_id='synthetic-outbound-a'),r::text);
 perform pg_temp.identity_assert('D6 contradictory failure retained for review',(select count(*)=2 from public.whatsapp_delivery_statuses where wa_message_id='synthetic-outbound-a' and status='failed' and link_state='conflict_review'));
 r:=public.apply_whatsapp_delivery_status('d1000000-0000-0000-0000-000000000011','synthetic-phone-a','synthetic-outbound-a','sent','synthetic-recipient-a','2026-10-08 10:05Z');
 perform pg_temp.identity_assert('D6 stale sent cannot erase read',(select delivery_state='read' from public.whatsapp_messages where wa_message_id='synthetic-outbound-a'),r::text);
 r:=public.apply_whatsapp_delivery_status('d1000000-0000-0000-0000-000000000011','synthetic-phone-a','synthetic-outbound-a','read','synthetic-recipient-a','2026-10-08 10:10Z');
 perform pg_temp.identity_assert('D6 same-scope duplicate remains harmless',r->>'ok'='true' and r->>'duplicate'='true',r::text);
 r:=public.apply_whatsapp_delivery_status('d1000000-0000-0000-0000-000000000012','synthetic-phone-b','synthetic-outbound-a','read','synthetic-recipient-b','2026-10-08 10:10Z');
 perform pg_temp.identity_assert('D6 global dedupe cannot acknowledge another tenant',r->>'ok'='false',r::text);
 r:=public.apply_whatsapp_delivery_status('d1000000-0000-0000-0000-000000000011','synthetic-phone-a','synthetic-outbound-a','read','synthetic-forged','2026-10-08 10:10Z');
 perform pg_temp.identity_assert('D6 global dedupe cannot acknowledge another recipient',r->>'ok'='false',r::text);
end; $$;

-- Evidence arriving before accepted display persistence must bind only when the
-- immutable recipient/conversation/outbound identity is available.
do $$ declare r jsonb; token uuid:=gen_random_uuid(); begin
 r:=public.apply_whatsapp_delivery_status('d1000000-0000-0000-0000-000000000011','synthetic-phone-a','synthetic-before-finalize','delivered','synthetic-recipient-a','2026-10-08 10:30Z');
 perform pg_temp.identity_assert('D6 early evidence retained unmatched',r->>'ok'='true' and exists(select 1 from public.whatsapp_delivery_statuses where wa_message_id='synthetic-before-finalize' and message_id is null and link_state='unmatched'),r::text);
 update public.whatsapp_send_intents set outcome='attempting',attempt_token=token where id='d1000000-0000-0000-0000-000000000061';
 r:=public.finalize_whatsapp_send_attempt('d1000000-0000-0000-0000-000000000061',token,'accepted','synthetic-before-finalize',null,null);
 perform pg_temp.identity_assert('D6 finalizer remains compatible',r->>'ok'='true',r::text);
 perform pg_temp.identity_assert('D6 early delivery safely rebound',(select delivery_state='delivered' from public.whatsapp_messages where wa_message_id='synthetic-before-finalize'));
 perform pg_temp.identity_assert('D6 early evidence linked to outbound',exists(select 1 from public.whatsapp_delivery_statuses s join public.whatsapp_messages m on m.id=s.message_id where s.wa_message_id='synthetic-before-finalize' and s.link_state='applied' and m.direction='outbound'));
end; $$;
reset role;

-- Existing intent generation snapshots must survive a deliberate link change.
update public.whatsapp_company_links set status='disconnected' where id='d1000000-0000-0000-0000-000000000021';
select pg_temp.identity_assert('D1 historical link snapshot retained',exists(select 1 from public.whatsapp_send_intents i join public.whatsapp_company_links l on l.id=i.link_id where i.id='d1000000-0000-0000-0000-000000000061' and i.link_generation=1 and l.generation=2));
select case when passed then 'PASS|' else 'FAIL|' end || label || coalesce('|'||detail,'') from identity_delivery_results order by label;
do $$ declare failures text; begin
 select string_agg(label, '; ' order by label) into failures from identity_delivery_results where not passed;
 if failures is not null then raise exception 'D1/D6 acceptance failures: %',failures; end if;
end; $$;
rollback;
