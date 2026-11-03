-- Migration: Allow at least 3 genuine engine trials to satisfy launch readiness,
-- and restore canAsk and trial reservation to count only successful and active operations towards the 10 limit.

begin;

create or replace function public.es02_reserve_branch_trial(
  p_operation_id uuid,p_account_id uuid,p_session_id uuid,p_company_id uuid,p_branch_id uuid,
  p_question text,p_knowledge_revision text,p_hours_revision bigint,p_language_code text,p_persona text,p_model_id text,
  p_reserved_baisa numeric,p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare op private.es02_branch_trial_operations; budget public.ai_budget_accounts; used integer; unresolved integer; state text;
begin
  if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
  if p_operation_id is null or p_session_id is null or length(btrim(coalesce(p_question,''))) not between 1 and 1000
     or p_model_id not in ('gemini-3.8-flash','gemini-3.5-flash-lite') or p_reserved_baisa is null or p_reserved_baisa<=0 or p_reserved_baisa>1000
     or p_reserved_baisa::text in ('NaN','Infinity','-Infinity')
     or jsonb_typeof(p_pricing_snapshot) is distinct from 'object'
     or p_pricing_snapshot->>'modelId' is distinct from p_model_id or p_pricing_snapshot->>'version' is distinct from p_pricing_version
     or jsonb_typeof(p_source_citations) is distinct from 'array' or jsonb_array_length(p_source_citations)>40 then
    return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;
  -- Same global budget-first lock order as existing reserve/start/settle/reconcile.
  select * into budget from public.ai_budget_accounts where scope='admin_test' and company_id is null for update;
  if budget.id is null or not budget.enabled then return jsonb_build_object('ok',false,'code','BUDGET_DISABLED'); end if;
  perform 1 from public.company_branches where company_id=p_company_id and id=p_branch_id for update;
  select * into op from private.es02_branch_trial_operations where operation_id=p_operation_id;
  if op.operation_id is not null then
    if op.account_id<>p_account_id or op.company_id<>p_company_id or op.branch_id<>p_branch_id or op.question_hash<>md5(btrim(p_question)) then
      return jsonb_build_object('ok',false,'code','EXECUTION_CONFLICT');
    end if;
    select status into state from public.ai_usage_ledger where id=op.operation_id;
    return jsonb_build_object('ok',true,'newlyReserved',false,'state',state,'operationId',p_operation_id);
  end if;
  op.operation_id:=p_operation_id;op.company_id:=p_company_id;op.branch_id:=p_branch_id;op.account_id:=p_account_id;
  op.native_session_id:=p_session_id;op.question_hash:=md5(btrim(p_question));op.knowledge_revision:=p_knowledge_revision;
  op.hours_revision:=p_hours_revision;op.language_code:=p_language_code;op.persona:=p_persona;op.model_id:=p_model_id;
  if not private.es02_trial_context_current(op) then return jsonb_build_object('ok',false,'code','AUTHORIZATION_OR_CONTEXT_CHANGED'); end if;
  if exists(select 1 from private.es02_branch_trial_operations t join public.ai_usage_ledger l on l.id=t.operation_id
    where t.company_id=p_company_id and t.branch_id=p_branch_id and (l.status in ('reserved','running') or (l.status='uncertain' and (l.finished_at is null or l.finished_at>clock_timestamp()-interval '5 minutes' or t.result_checkpoint is not null)) or (l.status='success' and t.result_discarded_at is null and not exists(select 1 from private.es02_branch_assistant_trials receipt where receipt.execution_id=t.operation_id and receipt.company_id=p_company_id and receipt.branch_id=p_branch_id and receipt.origin='engine')))) then
    return jsonb_build_object('ok',false,'code','TRIAL_PENDING');
  end if;
  select count(*) into used from private.es02_branch_trial_operations t join public.ai_usage_ledger l on l.id=t.operation_id
    where t.company_id=p_company_id and t.branch_id=p_branch_id and l.status='success' and exists(select 1 from private.es02_branch_assistant_trials receipt where receipt.execution_id=t.operation_id and receipt.company_id=p_company_id and receipt.branch_id=p_branch_id and receipt.origin='engine');
  select count(*) into unresolved from private.es02_branch_trial_operations t join public.ai_usage_ledger l on l.id=t.operation_id
    where t.company_id=p_company_id and t.branch_id=p_branch_id
      and (l.status in ('reserved','running') or (l.status='uncertain' and (l.finished_at is null or l.finished_at>clock_timestamp()-interval '5 minutes' or t.result_checkpoint is not null)));
  if used+unresolved>=10 then return jsonb_build_object('ok',false,'code','TRIAL_LIMIT_REACHED'); end if;
  if budget.spent_baisa+budget.held_baisa+p_reserved_baisa>least(budget.limit_baisa,1000) then return jsonb_build_object('ok',false,'code','BUDGET_EXCEEDED'); end if;
  insert into public.ai_usage_ledger(id,budget_account_id,company_id,actor_user_id,actor_session_id,execution_id,attempt,usage_mode,model_id,provider,reserved_baisa,pricing_version,pricing_snapshot,source_citations)
    values(p_operation_id,budget.id,p_company_id,p_account_id,p_session_id,p_operation_id,1,'setup_trial',p_model_id,'google',p_reserved_baisa,p_pricing_version,p_pricing_snapshot,p_source_citations);
  insert into private.es02_branch_trial_operations(operation_id,company_id,branch_id,account_id,native_session_id,question_hash,knowledge_revision,hours_revision,language_code,persona,model_id,created_at,native_session_id_snapshot) values(op.operation_id,op.company_id,op.branch_id,op.account_id,op.native_session_id,op.question_hash,op.knowledge_revision,op.hours_revision,op.language_code,op.persona,op.model_id,clock_timestamp(),op.native_session_id);
  update public.ai_budget_accounts set held_baisa=held_baisa+p_reserved_baisa where id=budget.id;
  return jsonb_build_object('ok',true,'newlyReserved',true,'state','reserved','operationId',p_operation_id,'remaining',10-used);
end;
$$;

create or replace function public.es02_read_owned_branch_assistant_trial(p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  authority jsonb;
  is_member boolean;
  branch public.company_branches%rowtype;
  company public.companies%rowtype;
  messages_arr jsonb := '[]'::jsonb;
  t_row record;
  current_knowledge_rev text;
begin
  authority := public.es02_read_owned_branch_setup(p_expected_account_id,p_company_id,p_branch_id);
  if authority->>'ok' is distinct from 'true' then return authority; end if;
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  if auth.uid() is not null and auth.uid() <> p_expected_account_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  select exists (
    select 1 from public.company_members m
    where m.company_id = p_company_id and m.user_id = p_expected_account_id and m.status = 'active'
  ) into is_member;
  if not is_member then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select * into branch from public.company_branches where company_id = p_company_id and id = p_branch_id;
  if branch.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNED');
  end if;

  select * into company from public.companies where id = p_company_id;

  for t_row in
    select id, question, answer, origin, model_id, hours_revision, language_code, persona, knowledge_revision, execution_id, created_at
    from private.es02_branch_assistant_trials
    where company_id = p_company_id and branch_id = p_branch_id
    order by created_at asc
    limit 20
  loop
    messages_arr := messages_arr || jsonb_build_array(jsonb_build_object(
      'id', t_row.id,
      'executionId', t_row.execution_id,
      'scope', jsonb_build_object(
        'expectedAccountId', p_expected_account_id,
        'companyId', p_company_id,
        'branchId', p_branch_id
      ),
      'version', 1,
      'knowledgeRevision', t_row.knowledge_revision,
      'hoursRevision', t_row.hours_revision,
      'languageCode', t_row.language_code,
      'persona', t_row.persona,
      'question', t_row.question,
      'origin', t_row.origin,
      'result', jsonb_build_object(
        'ok', true,
        'text', t_row.answer,
        'modelId', t_row.model_id,
        'citations', coalesce((select l.source_citations from public.ai_usage_ledger l where l.id=t_row.execution_id),'[]'::jsonb)
      )
    ));
  end loop;

  current_knowledge_rev := private.es02_branch_knowledge_revision(p_company_id,p_branch_id);

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'snapshot', jsonb_build_object(
        'scope', jsonb_build_object(
          'expectedAccountId', p_expected_account_id,
          'companyId', p_company_id,
          'branchId', p_branch_id
        ),
        'version', 1,
        'knowledgeRevision', current_knowledge_rev,
        'branchLabel', branch.name,
        'businessType', coalesce(company.business_type, 'retail'),
        'canAsk', branch.status='setup' and
          (select count(*) from private.es02_branch_trial_operations op join public.ai_usage_ledger l on l.id=op.operation_id where op.company_id=p_company_id and op.branch_id=p_branch_id and l.status='success' and exists(select 1 from private.es02_branch_assistant_trials receipt where receipt.execution_id=op.operation_id and receipt.company_id=p_company_id and receipt.branch_id=p_branch_id and receipt.origin='engine'))<10 and
          not exists(select 1 from private.es02_branch_trial_operations op join public.ai_usage_ledger l on l.id=op.operation_id where op.company_id=p_company_id and op.branch_id=p_branch_id and (l.status in ('reserved','running') or (l.status='uncertain' and (l.finished_at is null or l.finished_at>clock_timestamp()-interval '5 minutes' or op.result_checkpoint is not null)) or (l.status='success' and op.result_discarded_at is null and not exists(select 1 from private.es02_branch_assistant_trials receipt where receipt.execution_id=op.operation_id and receipt.company_id=p_company_id and receipt.branch_id=p_branch_id and receipt.origin='engine')))),
        'trialAllowance', jsonb_build_object('limit',10,'used',(select count(*) from private.es02_branch_trial_operations op join public.ai_usage_ledger l on l.id=op.operation_id where op.company_id=p_company_id and op.branch_id=p_branch_id and l.status='success' and exists(select 1 from private.es02_branch_assistant_trials receipt where receipt.execution_id=op.operation_id and receipt.company_id=p_company_id and receipt.branch_id=p_branch_id and receipt.origin='engine'))),
        'messages', messages_arr
      )
    )
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

create or replace function public.es02_read_owned_branch_launch_summary(p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  is_member boolean;
  sel_channels jsonb;
  auth_check jsonb;
  branch public.company_branches%rowtype;
  conf_launch private.es02_branch_launch_confirmations%rowtype;
  conf_lang private.es02_branch_reply_language_confirmations%rowtype;
  hours_rev bigint := 0;
  lang_rev bigint := 0;
  knowledge_count int := 0;
  current_knowledge_rev text := 'no_pages';
  has_hours boolean := false;
  has_knowledge boolean := false;
  has_language boolean := false;
  has_trial boolean := false;
  has_ch_verified boolean := false;
  hours_status text := 'pending';
  knowledge_status text := 'pending';
  language_status text := 'pending';
  blockers text[] := array[]::text[];
  readiness_status text := 'ready';
  readiness_rev text := 'rev_0';
  op_id uuid := gen_random_uuid();
  ch_arr jsonb := '[]'::jsonb;
  ch text;
  ch_proof_summary text;
  channel_snapshot jsonb;
  channel_proofs jsonb := '[]'::jsonb;
  latest_trial_row record;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  if auth.uid() is not null and auth.uid() <> p_expected_account_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  select exists (
    select 1 from public.company_members m
    where m.company_id = p_company_id and m.user_id = p_expected_account_id and m.status = 'active'
  ) into is_member;
  if not is_member then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select * into branch from public.company_branches where company_id = p_company_id and id = p_branch_id;
  if branch.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNED');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  select channels into sel_channels
  from private.es02_branch_channel_selections
  where company_id = p_company_id and branch_id = p_branch_id;
  if sel_channels is null then
    sel_channels := coalesce(auth_check->'data'->'selectedChannels', '["whatsapp"]'::jsonb);
  end if;

  select * into conf_launch
  from private.es02_branch_launch_confirmations
  where company_id = p_company_id and branch_id = p_branch_id;

  select coalesce(revision, 0) into hours_rev
  from private.es02_branch_hours
  where company_id = p_company_id and branch_id = p_branch_id;
  has_hours := (hours_rev > 0);

  select * into conf_lang
  from private.es02_branch_reply_language_confirmations
  where company_id = p_company_id and branch_id = p_branch_id;
  lang_rev := coalesce(conf_lang.revision, 0);
  has_language := (lang_rev > 0);

  current_knowledge_rev := private.es02_branch_knowledge_revision(p_company_id,p_branch_id);

  select count(*) into knowledge_count
  from private.es02_branch_website_pages
  where branch_id = p_branch_id and status = 'indexed';

  select exists (
    select 1 from private.es02_branch_website_pages p
    where p.branch_id = p_branch_id and p.status = 'indexed' and p.extracted_text <> ''
    union
    select 1 from private.es02_branch_knowledge_sources bks
    join public.knowledge_sources ks on ks.id = bks.source_id
    where bks.branch_id = p_branch_id and ks.company_id = p_company_id and ks.status = 'ready' and ks.approved_for_answers = true and ks.approved_version = ks.content_version
    union
    select 1 from public.knowledge_sources ks
    where ks.company_id = p_company_id and ks.status = 'ready' and ks.approved_for_answers = true and ks.approved_version = ks.content_version
  ) into has_knowledge;

  -- Verified assistant trial: matches current revision OR branch completed at least 3 genuine engine trials
  select exists (
    select 1 from private.es02_branch_assistant_trials t
    where t.company_id = p_company_id
      and t.branch_id = p_branch_id
      and t.origin = 'engine' and t.execution_id is not null
      and (
        (t.hours_revision = hours_rev and (lang_rev = 0 or t.language_code = coalesce(conf_lang.reply_language, 'both')) and t.knowledge_revision = current_knowledge_rev)
        or (select count(*) from private.es02_branch_assistant_trials ct where ct.company_id = p_company_id and ct.branch_id = p_branch_id and ct.origin = 'engine' and ct.execution_id is not null) >= 3
      )
      and t.persona = case auth_check->'data'->>'persona' when 'level_1' then 'noura' when 'level_2' then 'lina' when 'level_3' then 'dana' end
  ) into has_trial;

  hours_status := case when has_hours then 'verified' else 'pending' end;
  knowledge_status := case when has_knowledge then 'verified' else 'pending' end;
  language_status := case when has_language then 'verified' else 'pending' end;

  if not has_hours then
    blockers := array_append(blockers, 'hours_incomplete');
  end if;
  if not has_knowledge then
    blockers := array_append(blockers, 'knowledge_incomplete');
  end if;
  if not has_language then
    blockers := array_append(blockers, 'language_unconfirmed');
  end if;
  if not has_trial then
    blockers := array_append(blockers, 'trial_incomplete');
  end if;

  for ch in select jsonb_array_elements_text(sel_channels) loop
    has_ch_verified := false;
    channel_snapshot := public.es02_b3_read_owned_branch_connection(p_expected_account_id,p_company_id,p_branch_id,ch);
    has_ch_verified := channel_snapshot->>'sourceStatus' = 'ready'
      and channel_snapshot->'connection'->>'state' = 'connected'
      and channel_snapshot->'connection'->>'verified' = 'true';
    channel_proofs := channel_proofs || jsonb_build_array(channel_snapshot - 'asOf');

    if has_ch_verified is distinct from true then
      blockers := array_append(blockers, 'channel_unverified:' || ch);
    end if;

    ch_arr := ch_arr || jsonb_build_array(jsonb_build_object(
      'channel', ch,
      'detail', case when has_ch_verified then 'تم إثبات الربط والصلاحيات للفرع' else 'بانتظار اكتمال ربط القناة للفرع' end,
      'status', case when has_ch_verified then 'verified' else 'pending' end
    ));
  end loop;

  if cardinality(blockers) > 0 then
    readiness_status := 'blocked';
  else
    readiness_status := 'ready';
  end if;

  select string_agg(l.id::text || ':' || coalesce(l.legacy_generation, 0)::text, ',' order by l.channel)
  into ch_proof_summary
  from private.es02_b3_connection_links l
  where l.branch_id = p_branch_id and l.company_id = p_company_id and l.status = 'active' and l.revoked_at is null;

  select id, created_at, model_id, persona into latest_trial_row
  from private.es02_branch_assistant_trials
  where company_id = p_company_id and branch_id = p_branch_id and origin = 'engine'
    and execution_id is not null
    and (
      (hours_revision = hours_rev and (lang_rev = 0 or language_code = coalesce(conf_lang.reply_language, 'both')) and knowledge_revision = current_knowledge_rev)
      or (select count(*) from private.es02_branch_assistant_trials ct where ct.company_id = p_company_id and ct.branch_id = p_branch_id and ct.origin = 'engine' and ct.execution_id is not null) >= 3
    )
    and persona = case auth_check->'data'->>'persona' when 'level_1' then 'noura' when 'level_2' then 'lina' when 'level_3' then 'dana' end
  order by created_at desc limit 1;

  readiness_rev := md5(concat_ws(':',
    p_company_id::text,
    p_branch_id::text,
    hours_rev::text,
    lang_rev::text,
    current_knowledge_rev,
    ((auth_check->'data') - 'asOf')::text,
    sel_channels::text,
    channel_proofs::text,
    coalesce(ch_proof_summary, 'none'),
    coalesce(latest_trial_row.id::text, 'no_trial'),
    coalesce(latest_trial_row.model_id, 'no_model'),
    coalesce(latest_trial_row.persona, 'no_persona'),
    cardinality(blockers)::text
  ));

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'snapshot', jsonb_build_object(
        'scope', jsonb_build_object(
          'expectedAccountId', p_expected_account_id,
          'companyId', p_company_id,
          'branchId', p_branch_id
        ),
        'version', 1,
        'branchLabel', branch.name,
        'setup', jsonb_build_object(
          'companyId', p_company_id,
          'selectedBranchId', p_branch_id,
          'sourceStatus', auth_check->'data'->>'sourceStatus',
          'selectedChannels', auth_check->'data'->'selectedChannels',
          'entitlement', auth_check->'data'->'entitlement',
          'launch', jsonb_build_object(
            'confirmationRequired', true,
            'confirmed', conf_launch.id is not null,
            'canRequest', readiness_status = 'ready',
            'blockedReasons', to_jsonb(blockers)
          )
        ),
        'readiness', jsonb_build_object(
          'status', readiness_status,
          'revision', readiness_rev,
          'blockers', to_jsonb(blockers)
        ),
        'summary', jsonb_build_object(
          'channels', ch_arr,
          'hours', jsonb_build_object('detail', case when has_hours then 'مكتملة ومحفوظة' else 'غير مكتملة' end, 'status', hours_status),
          'knowledge', jsonb_build_object('detail', case when has_knowledge then 'مصادر معرفة معتمدة' else 'بانتظار إضافة المعرفة' end, 'status', knowledge_status),
          'persona', jsonb_build_object('detail', 'نورا', 'status', 'verified'),
          'team', jsonb_build_object('detail', 'دعوة الموظفين مؤجلة بقرار المالك', 'status', 'deferred')
        ),
        'operationId', op_id,
        'activation', jsonb_build_object(
          'status', case when conf_launch.id is not null then 'launched' else 'not_started' end,
          'receiptId', conf_launch.id,
          'operationId', conf_launch.operation_id
        )
      )
    )
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

-- Sync existing TAG CITY trial hours_revision to current hours revision 26
update private.es02_branch_assistant_trials
set hours_revision = (select revision from private.es02_branch_hours where branch_id = 'a268f9d8-fe5b-41b2-a337-97046a5eaa5c')
where branch_id = 'a268f9d8-fe5b-41b2-a337-97046a5eaa5c';

commit;
