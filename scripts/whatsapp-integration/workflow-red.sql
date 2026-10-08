-- Targeted regression: different inbound jobs in one conversation must not run together.
begin;set local role service_role;
do $$ declare f jsonb:=test_fixture.company(false);a uuid;b uuid;x jsonb;y jsonb;begin
 a:=test_fixture.job(f);b:=test_fixture.job(f);
 x:=public.claim_whatsapp_inbound_job(a,120);y:=public.claim_whatsapp_inbound_job(b,120);
 if x->>'ok'='true' and y->>'ok'='true' then raise exception 'D2 unsafe parallel same-conversation claims';end if;
end;$$;
rollback;
