-- Preserve genuine confirmed launch evidence after ordinary active-branch edits.
begin;
do $migration$
declare body text; needle text := 'and t.hours_revision=hours and t.language_code=lang and t.knowledge_revision=knowledge'; replacement text;
begin
 body:=pg_get_functiondef('private.es02_paid_branch_readiness(uuid,uuid)'::regprocedure);
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1
  or position('t.persona=v_readiness_persona' in body)=0
  or position('CHANNEL_PROOF_CHANGED' in body)=0
  or position('VERIFIED_LIVE_ES02_PAYMENT_REQUIRED' in body)=0 then
  raise exception 'POSTLAUNCH_READINESS_PREREQUISITE_MISMATCH';
 end if;
 replacement:=$sql$and exists(select 1 from private.es02_branch_launch_confirmations launch
    where launch.company_id=p_company and launch.branch_id=p_branch and launch.confirmed
      and launch.confirmed_at is not null and t.created_at<=launch.confirmed_at)$sql$;
 execute replace(body,needle,replacement);
end;
$migration$;
do $migration$
declare sig text; body text; matches integer;
 pattern text := '(delete[[:space:]]+from[[:space:]]+private\.es02_branch_launch_confirmations[[:space:]]+where[[:space:]]+company_id[[:space:]]*=[[:space:]]*p_company_id[[:space:]]+and[[:space:]]+branch_id[[:space:]]*=[[:space:]]*p_branch_id)([[:space:]]*;)';
 replacement text := E'\\1 and not exists(select 1 from public.company_branches postlaunch_branch where postlaunch_branch.company_id=p_company_id and postlaunch_branch.id=p_branch_id and postlaunch_branch.status=''active'')\\2';
begin
 foreach sig in array array[
  'public.es02_confirm_owned_branch_reply_language(uuid,uuid,uuid,bigint,text)',
  'public.es02_add_owned_branch_website(uuid,uuid,uuid,integer,text)',
  'public.es02_index_branch_website_page(uuid,uuid,uuid,uuid,text,text,text,text,integer,text)',
  'public.es02_page_action_owned_branch_knowledge(uuid,uuid,uuid,uuid,text,integer)'
 ] loop
  body:=pg_get_functiondef(sig::regprocedure);
  select count(*) into matches from regexp_matches(body,pattern,'gi');
  if matches<>1 then raise exception 'POSTLAUNCH_EDIT_PREREQUISITE_MISMATCH: %',sig; end if;
  execute regexp_replace(body,pattern,replacement,'i');
 end loop;
end;
$migration$;
commit;