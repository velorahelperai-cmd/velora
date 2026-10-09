begin;set local role service_role;
create function pg_temp.reject_display() returns trigger language plpgsql as $$begin if new.sender='assistant' and current_setting('wa.fixture_display_failure',true)='1' then raise exception 'synthetic display persistence outage';end if;return new;end;$$;
create trigger synthetic_display_outage before insert on whatsapp_messages for each row execute function pg_temp.reject_display();
-- Fixture generation has no outbound row, so only the simulated finalizer is rejected.
do $$ declare f jsonb:=test_fixture.company();j uuid:=test_fixture.job(f);r jsonb;token uuid;a uuid;cit jsonb;i uuid;begin
 r:=claim_whatsapp_inbound_job(j,120);token:=(r->>'claim_token')::uuid;perform whatsapp_reserve_job_usage(j,token);
 a:=test_fixture.draft(f,j,token);select source_citations into cit from ai_usage_ledger where id=a;r:=whatsapp_stage_job_reply(j,token,a,cit);i:=(r->>'intent_id')::uuid;
 perform set_config('wa.fixture_display_failure','1',true);
 r:=whatsapp_claim_assistant_job_send(j,token);r:=finalize_whatsapp_send_attempt(i,(r->>'attempt_token')::uuid,'accepted','synthetic-pending-'||gen_random_uuid(),null,null);
 if r->>'persist_pending'<>'true' or (select outcome from whatsapp_send_intents where id=i)<>'accepted' then raise exception 'synthetic accepted receipt not retained: %',r;end if;
 perform set_config('velora.conversation_control','1',true);
 update whatsapp_conversations set automation_allowed=false,status='handed_over',automation_generation=automation_generation+1 where id=(f->>'conversation')::uuid;
 update billing_subscriptions set paid_through=clock_timestamp()-interval '1 second',status='ended' where id=(f->>'subscription')::uuid;
 perform set_config('wa.fixture_display_failure','0',true);
 r:=whatsapp_repair_accepted_jobs(10);if (r->>'repaired')::int<1 then raise exception 'retained acceptance was not repaired: %',r;end if;
 if (select status from whatsapp_inbound_jobs where id=j)<>'completed' or (select usage_status from whatsapp_inbound_jobs where id=j)<>'accepted' then raise exception 'repair did not settle actual receipt capacity';end if;
 if (select automation_allowed from whatsapp_conversations where id=(f->>'conversation')::uuid) then raise exception 'repair resumed automation';end if;
 if (select count(*) from whatsapp_messages m join whatsapp_send_intents x on x.message_id=m.id where x.id=i)<>1 then raise exception 'repair duplicated accepted message';end if;
end;$$;
select 'PASS|D3 accepted persistence-only recovery works after takeover/expiry without another provider send';
rollback;
