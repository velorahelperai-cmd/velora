create function pg_temp.must(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'PASSAGE_FAILED:%',label;end if;
end;$$;
create temporary table passage_results(label text, value numeric);
do $$declare sample text; samples integer:=0;begin
 foreach sample in array array['','a',repeat('x',1800),repeat('x',1801),repeat(' ',6000),
  repeat(E'Paragraph one.\n\nParagraph two\n',350),repeat('أَسْعَار القهوة ١.٢٥٠ ريال 😊 ',500),
  repeat('unbroken😊العربية',14000),repeat(E'\r\n',2400),repeat('price 12.500 OMR. ',12000)] loop
  perform pg_temp.must(not exists(select 1 from private.split_knowledge_passages(sample) p
   where p.body<>substring(sample from p.start_char for p.end_char-p.start_char)
    or length(p.body)>1800 or p.start_char>=p.end_char),'unaltered bounded Unicode text');
  perform pg_temp.must(not exists(select 1 from (
   select *,lag(end_char) over(order by ordinal) previous_end,lag(start_char) over(order by ordinal) previous_start
   from private.split_knowledge_passages(sample)) p
   where p.start_char>p.previous_end or p.start_char<=p.previous_start),'complete coverage and forward progress');
  if length(sample)>0 then
   perform pg_temp.must((select min(start_char)=1 and max(end_char)=length(sample)+1
    and min(ordinal)=1 and max(ordinal)=count(*) from private.split_knowledge_passages(sample)),'complete endpoints and ordinals');
  else perform pg_temp.must(not exists(select 1 from private.split_knowledge_passages(sample)),'empty has no passages');end if;
  samples:=samples+1;
 end loop;
 insert into passage_results values('split fixtures with 3 invariants each',samples);
 perform pg_temp.must(private.knowledge_search_text('أَسْعَار إِبْرِيل آيس ٱلقهوة')='اسعار ابريل ايس القهوة','Arabic normalized only for search');
end;$$;
do $$declare u uuid:=gen_random_uuid();c uuid:=gen_random_uuid();s uuid:=gen_random_uuid();v integer;
 started timestamptz; original_ctid tid; sample text:=repeat('General catalog details. تفاصيل الكتالوج. ',4000)||E'\n\nأَسْعَار القهوة الخاصة ١.٢٥٠ ريال. Specialespresso costs 1.250 OMR.';
begin
 insert into auth.users(id,email) values(u,'passages-'||u||'@example.invalid');
 insert into public.companies(id,display_name,status,created_by) values(c,'Synthetic passage tenant','active',u);
 insert into public.knowledge_sources(id,company_id,kind,title,content,status,created_by)
 values(s,c,'text','Synthetic menu',sample,'ready',u);
 perform pg_temp.must(not exists(select 1 from private.knowledge_source_passages where source_id=s),'unapproved is not indexed');
 perform set_config('velora.knowledge_approval','1',true);
 started:=clock_timestamp();
 update public.knowledge_sources set approved_for_answers=true where id=s;
 insert into passage_results values('approval and index milliseconds',extract(epoch from clock_timestamp()-started)*1000);
 insert into passage_results values('source characters',length(sample));
 insert into passage_results select 'passages',count(*) from private.knowledge_source_passages where source_id=s;
 select content_version into v from public.knowledge_sources where id=s;
 perform pg_temp.must((select count(*)>50 and bool_and(content_version=v and company_id=c) from private.knowledge_source_passages where source_id=s),'current version and company');
 perform pg_temp.must(exists(select 1 from private.knowledge_source_passages where source_id=s
  and search_vector@@plainto_tsquery('simple',private.knowledge_search_text('اسعار القهوة'))
  and body like '%١.٢٥٠%'),'Arabic recall and price retained');
 perform pg_temp.must(exists(select 1 from private.knowledge_source_passages where source_id=s
  and search_vector@@plainto_tsquery('simple','Specialespresso') and body like '%1.250 OMR%'),'English recall and price retained');
 insert into passage_results select 'matching excerpt characters',length(body)
  from private.knowledge_source_passages where source_id=s
   and search_vector@@plainto_tsquery('simple','Specialespresso') order by ordinal limit 1;
 perform pg_temp.must(length(sample)>12000 and (select sum(length(body))<12000
  from private.knowledge_source_passages where source_id=s and search_vector@@plainto_tsquery('simple','Specialespresso')),
  'large source can supply bounded relevant excerpts without changing original');
 select ctid into original_ctid from private.knowledge_source_passages where source_id=s and ordinal=1;
 update public.knowledge_sources set updated_at=clock_timestamp() where id=s;
 perform pg_temp.must((select ctid=original_ctid from private.knowledge_source_passages where source_id=s and ordinal=1),'metadata timestamp does not rebuild');
 update public.knowledge_sources set content='Changed menu price 2 OMR' where id=s;
 perform pg_temp.must(not exists(select 1 from private.knowledge_source_passages where source_id=s),'edit atomically removes stale passages');
 perform set_config('velora.knowledge_approval','1',true);
 update public.knowledge_sources set approved_for_answers=true where id=s;
 perform pg_temp.must((select count(*)=1 and bool_and(body='Changed menu price 2 OMR') from private.knowledge_source_passages where source_id=s),'reapproval indexes new text only');
 perform set_config('velora.knowledge_approval','0',true);
 update public.knowledge_sources set approved_for_answers=false where id=s;
 perform pg_temp.must((select approved_for_answers from public.knowledge_sources where id=s),'direct approval-field mutation is ignored by native guard');
 perform pg_temp.must(exists(select 1 from private.knowledge_source_passages where source_id=s),'ignored mutation does not revoke derived index');
 perform set_config('velora.knowledge_approval','1',true);
 update public.knowledge_sources set approved_for_answers=false where id=s;
 perform pg_temp.must(not exists(select 1 from private.knowledge_source_passages where source_id=s),'revocation clears index');
 update public.knowledge_sources set usage_role='business_instructions' where id=s;
 perform set_config('velora.knowledge_approval','1',true);
 update public.knowledge_sources set approved_for_answers=true where id=s;
 perform pg_temp.must(not exists(select 1 from private.knowledge_source_passages where source_id=s),'mandatory instructions never fragmented');
 update public.knowledge_sources set usage_role='knowledge' where id=s;
 perform set_config('velora.knowledge_approval','1',true);
 update public.knowledge_sources set approved_for_answers=true where id=s;
 delete from public.knowledge_sources where id=s;
 perform pg_temp.must(not exists(select 1 from private.knowledge_source_passages where source_id=s),'parent delete cascades');
end;$$;
do $$declare role_name text;fn regprocedure;begin
 foreach role_name in array array['anon','authenticated','service_role'] loop
  perform pg_temp.must(not has_table_privilege(role_name,'private.knowledge_source_passages','SELECT,INSERT,UPDATE,DELETE'),'no direct index access for '||role_name);
  foreach fn in array array['private.knowledge_search_text(text)'::regprocedure,'private.split_knowledge_passages(text)'::regprocedure,
   'private.refresh_knowledge_passages(uuid)'::regprocedure,'private.knowledge_passages_changed()'::regprocedure] loop
   perform pg_temp.must(not has_function_privilege(role_name,fn,'EXECUTE'),'no direct function access for '||role_name);
  end loop;
 end loop;
 perform pg_temp.must((select relrowsecurity from pg_class where oid='private.knowledge_source_passages'::regclass),'RLS enabled');
end;$$;
select jsonb_agg(to_jsonb(r)) from passage_results r;
select 'PASS: split invariants, Arabic/English recall, source lifecycle and index ACL; transaction rolled back';
