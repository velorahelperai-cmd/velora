-- Forward-only catalog snapshot correction. CLI generated the file; timestamp
-- advanced after the reviewed historical future-dated P1 migration.
-- Preserve the existing catalog/company lock order and API contract.
begin;
do $$
declare definition text; body_hash text; is_definer boolean; old_guard text; new_guard text;
begin
 select md5(replace(p.prosrc,chr(13),'')),p.prosecdef into body_hash,is_definer
 from pg_proc p where p.oid='public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)'::regprocedure;
 if body_hash is distinct from '2b7ed26a52b06bbf3a3815a20b839400' or is_definer is distinct from true then
  raise exception 'PURCHASE_RPC_VERSION_REQUIRES_REVIEW' using errcode='55000';
 end if;
 definition:=replace(pg_get_functiondef('public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)'::regprocedure),chr(13),'');
 old_guard:=E'or p_period_days is distinct from v_pv.period_days then';
 new_guard:=E'or p_period_days is distinct from v_pv.period_days\n     or p_period_unit is distinct from v_pv.period_unit\n     or p_period_count is distinct from v_pv.period_count then';
 if position(old_guard in definition)=0 then
  raise exception 'PURCHASE_RPC_SNAPSHOT_GUARD_REQUIRES_REVIEW' using errcode='55000';
 end if;
 execute replace(definition,old_guard,new_guard);
end; $$;
commit;
