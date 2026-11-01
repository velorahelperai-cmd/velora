begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $migration$
declare p record; original text; replacement text;
begin
 select prosrc,proowner,proacl,proconfig,prosecdef,provolatile into strict p
 from pg_proc where oid=to_regprocedure('private.billing_lifecycle_receipt(uuid)');
 if position('F29_EMPTY_RECEIPT_CANDIDATE' in p.prosrc)>0 then return;end if;
 original:=replace(p.prosrc,chr(13),'');
 if md5(original)<>'a4187eb255f7d55f0889bdb36e2c97f5' or not p.prosecdef or p.provolatile<>'s'
 or p.proconfig is distinct from array['search_path=""'] then raise exception 'F29_RECEIPT_PREREQUISITE_MISMATCH';end if;
 -- The original join requires this exact predicate. A negative result cannot
 -- have a receipt; avoid planning the proof view when there is no candidate.
 replacement:='begin /* F29_EMPTY_RECEIPT_CANDIDATE */
 if not exists(select 1 from public.billing_subscriptions s where s.company_id=cid and s.environment=''live'' and isfinite(s.paid_through)) then return null;end if;
 return ('||rtrim(btrim(original),';')||');
 end;';
 execute format('create or replace function private.billing_lifecycle_receipt(cid uuid) returns jsonb language plpgsql stable security definer set search_path to '''' as %L',replacement);
 if not exists(select 1 from pg_proc q where q.oid=to_regprocedure('private.billing_lifecycle_receipt(uuid)') and q.proowner=p.proowner and q.proacl is not distinct from p.proacl and q.proconfig is not distinct from p.proconfig and q.prosecdef=p.prosecdef and q.provolatile=p.provolatile) then raise exception 'F29_RECEIPT_AUTHORITY_CHANGED';end if;
end;
$migration$;
commit;
