-- Synthetic/local PostgreSQL only. No customer tables, providers or persistent objects.
\set ON_ERROR_STOP on
begin;
set local statement_timeout='45s';
set local jit=off;
create temporary table perf_knowledge (
 id bigint primary key, company_id integer not null, title text not null,
 content text not null, status text not null, approved_for_answers boolean not null,
 content_version integer not null, approved_version integer not null, usage_role text not null
) on commit drop;
create index perf_company on perf_knowledge(company_id,id);
create temporary table perf_results(size integer,variant text,run integer,execution_ms numeric,planning_ms numeric,rows integer,shared_hits integer,local_hits integer,result_md5 text,plan jsonb) on commit drop;
do $bench$
declare n integer; pass integer; variant text; plan jsonb; digest text; q text;
begin
 foreach n in array array[1000,10000,30000] loop
  insert into perf_knowledge
  select i,1+i%10,'Synthetic knowledge '||i,
   repeat('معلومات النشاط وخدمة العملاء business service information. ',40)||case when i%101=0 then ' warranty ضمان' else ' general عام' end,
   'ready',i%17<>0,1,case when i%19=0 then 2 else 1 end,
   case when i%211=0 then 'business_instructions' else 'knowledge' end
  from generate_series(coalesce((select max(id) from perf_knowledge),0)+1,n) i;
  analyze perf_knowledge;
  foreach variant in array array['existing_or','indexed_or','indexed_union'] loop
   if variant='indexed_or' then
    create index perf_search on perf_knowledge using gin(to_tsvector('simple'::regconfig,title||' '||content))
     where status='ready' and approved_for_answers and approved_version=content_version and length(btrim(content))>0;
    create index perf_instructions on perf_knowledge(company_id,id)
     where status='ready' and approved_for_answers and approved_version=content_version and usage_role='business_instructions';
    analyze perf_knowledge;
   end if;
   if variant='indexed_union' then
    q:=$q$select id,usage_role from perf_knowledge where company_id=1 and status='ready' and approved_for_answers and approved_version=content_version and length(btrim(content))>0 and usage_role='business_instructions'
     union all
     select id,usage_role from perf_knowledge where company_id=1 and status='ready' and approved_for_answers and approved_version=content_version and length(btrim(content))>0 and usage_role<>'business_instructions' and to_tsvector('simple'::regconfig,title||' '||content)@@to_tsquery('simple','warranty | ضمان')$q$;
   else
    q:=$q$select id,usage_role from perf_knowledge where company_id=1 and status='ready' and approved_for_answers and approved_version=content_version and length(btrim(content))>0 and (usage_role='business_instructions' or to_tsvector('simple'::regconfig,title||' '||content)@@to_tsquery('simple','warranty | ضمان'))$q$;
   end if;
   q:='select * from ('||q||') candidates order by usage_role,id limit 41';
   execute 'select md5(coalesce(string_agg(id::text,'','' order by usage_role,id),'''')) from ('||q||') selected' into digest;
   for pass in 1..3 loop
    execute 'explain (analyze,buffers,format json) '||q into plan;
    insert into perf_results values(n,variant,pass,(plan->0->>'Execution Time')::numeric,(plan->0->>'Planning Time')::numeric,
     (plan->0->'Plan'->>'Actual Rows')::integer,(plan->0->'Plan'->>'Shared Hit Blocks')::integer,
     (plan->0->'Plan'->>'Local Hit Blocks')::integer,digest,plan);
   end loop;
  end loop;
  drop index perf_search;
  drop index perf_instructions;
 end loop;
 if exists(select 1 from perf_results group by size having count(distinct result_md5)<>1) then raise exception 'result parity failed';end if;
end $bench$;
select jsonb_agg(jsonb_build_object('size',size,'variant',variant,'run',run,'execution_ms',execution_ms,'planning_ms',planning_ms,'rows',rows,'local_hits',local_hits,'result_md5',result_md5) order by size,variant,run) from perf_results;
rollback;
