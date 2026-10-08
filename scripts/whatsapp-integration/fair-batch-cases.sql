begin;set local role service_role;
-- Isolate other synthetic suites' work in this rollback transaction only.
update whatsapp_inbound_jobs set status='completed';
do $$ declare f jsonb:=test_fixture.company(false);free jsonb:=test_fixture.company(false);head uuid;j uuid;count int;r jsonb;begin
 head:=test_fixture.job(f);update whatsapp_inbound_jobs set status='retry_wait',next_attempt_at=clock_timestamp()+interval '1 hour' where id=head;
 for count in 1..101 loop j:=test_fixture.job(f);end loop;
 j:=test_fixture.job(free);r:=whatsapp_claim_inbound_batch(1);
 if jsonb_array_length(r->'jobs')<>1 or r->'jobs'->0->>'job_id'<>j::text then raise exception 'D2 batch limit starves an unrelated eligible conversation';end if;
end;$$;
select 'PASS|D2 eligible conversation heads are filtered before the batch scan limit';
rollback;
