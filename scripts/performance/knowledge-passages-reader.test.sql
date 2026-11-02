do $$declare u uuid:=gen_random_uuid();c uuid:=gen_random_uuid();other_c uuid:=gen_random_uuid();b uuid:=gen_random_uuid();other_b uuid:=gen_random_uuid();
 s uuid:=gen_random_uuid();unbound uuid:=gen_random_uuid();page uuid:=gen_random_uuid();instruction uuid:=gen_random_uuid();r jsonb;row_item jsonb;citations jsonb;
begin
 perform pg_temp.must(private.knowledge_context_chars('ع😊abc')=6,'UTF16 context count matches JavaScript');
 insert into auth.users(id,email) values(u,'reader-'||u||'@example.invalid');
 insert into public.companies(id,display_name,status,created_by) values(c,'Synthetic reader','active',u),(other_c,'Other reader','active',u);
 select id into b from public.company_branches where company_id=c limit 1;
 select id into other_b from public.company_branches where company_id=other_c limit 1;
 if b is null then insert into public.company_branches(company_id,name) values(c,'Own branch') returning id into b;end if;
 if other_b is null then insert into public.company_branches(company_id,name) values(other_c,'Other branch') returning id into other_b;end if;
 insert into public.knowledge_sources(id,company_id,kind,title,content,status,created_by) values
  (s,c,'text','Menu',repeat('Unrelated introduction. ',8000)||'Specialespresso price 1.250 OMR. سعر القهوة الخاصة ١.٢٥٠ ريال.','ready',u),
  (unbound,c,'text','Unbound','Specialespresso wrong price 9999 OMR.','ready',u);
 perform set_config('velora.knowledge_approval','1',true);
 update public.knowledge_sources set approved_for_answers=true where id in (s,unbound);
 insert into private.es02_branch_knowledge_sources(company_id,branch_id,source_id) values(c,b,s);
 r:=private.es02_select_knowledge_passages(c,b,'Specialespresso');
 perform pg_temp.must(r->>'ok'='true' and jsonb_array_length(r->'sources')=1,'long source accepted, unbound excluded');
 row_item:=r->'sources'->0;
 citations:=jsonb_build_array(jsonb_build_object('sourceId',row_item->>'id','title',row_item->>'title','contentVersion',row_item->'content_version'));
 perform pg_temp.must(private.es02_whatsapp_citations_current(c,b,citations),'selected passage passes native scoped citation guard');
 perform pg_temp.must(not private.es02_whatsapp_citations_current(other_c,b,citations),'passage citations reject foreign company');
 perform pg_temp.must(row_item->>'id'=s::text and row_item->>'retrieval_mode'='passages_v1'
  and row_item->>'content' like '%1.250 OMR%' and private.knowledge_context_chars(row_item->>'content')<12000,'explicit bounded excerpt with price');
 perform pg_temp.must((private.es02_select_knowledge_passages(c,b,'القهوة')->>'ok')='true','Arabic actual selector');
 r:=private.es02_select_knowledge_passages(c,b,'introduction');
 perform pg_temp.must(r->>'ok'='true' and (r->>'context_chars')::integer<=12000
  and (select sum(jsonb_array_length(x->'passages'))=6 from jsonb_array_elements(r->'sources') x),'ranked excerpts capped at six within budget');
 perform pg_temp.must((private.es02_select_knowledge_passages(other_c,b,'Specialespresso')->>'ok')='false','foreign company and branch rejected');
 perform pg_temp.must((private.es02_select_knowledge_passages(c,b,'unknownwidget')->>'code')='NO_KNOWLEDGE','no match denied');
 insert into public.knowledge_sources(id,company_id,kind,title,content,status,created_by,usage_role)
 values(instruction,c,'text','Voice','Use concise replies.','ready',u,'business_instructions');
 perform set_config('velora.knowledge_approval','1',true);
 update public.knowledge_sources set approved_for_answers=true where id=instruction;
 insert into private.es02_branch_knowledge_sources(company_id,branch_id,source_id) values(c,b,instruction);
 perform pg_temp.must(not private.es02_whatsapp_citations_current(c,b,citations),'new mandatory instruction invalidates earlier passage context');
 r:=private.es02_select_knowledge_passages(c,b,'Specialespresso');
 perform pg_temp.must(exists(select 1 from jsonb_array_elements(r->'sources') x where x->>'id'=instruction::text
  and x->>'content'='Use concise replies.' and not x ? 'retrieval_mode'),'instructions complete and not marked excerpts');
 insert into private.es02_branch_website_pages(id,company_id,branch_id,url,title,extracted_text,status)
 values(page,c,b,'https://example.invalid/menu','Web menu',repeat('General details. ',1000)||'Specialespresso website price 1.250 OMR.','pending');
 perform pg_temp.must(not exists(select 1 from private.branch_website_passages where source_id=page),'pending page excluded');
 update private.es02_branch_website_pages set status='indexed' where id=page;
 r:=private.es02_select_knowledge_passages(c,b,'Specialespresso');
 perform pg_temp.must(exists(select 1 from jsonb_array_elements(r->'sources') x where x->>'id'='page-'||page::text),'indexed page selected');
 update private.es02_branch_website_pages set version=2,extracted_text='Replacement tea menu.' where id=page;
 perform pg_temp.must((select bool_and(content_version=2 and body='Replacement tea menu.') from private.branch_website_passages where source_id=page),'page replacement removes stale text');
 r:=private.es02_select_knowledge_passages(c,b,'Specialespresso');
 perform pg_temp.must(not exists(select 1 from jsonb_array_elements(r->'sources') x where x->>'id'='page-'||page::text),'old page match disappears');
 update private.es02_branch_website_pages set status='failed' where id=page;
 perform pg_temp.must(not exists(select 1 from private.branch_website_passages where source_id=page),'failed page deindexed');
 update private.es02_branch_website_pages set status='indexed' where id=page;
 delete from private.es02_branch_website_pages where id=page;
 perform pg_temp.must(not exists(select 1 from private.branch_website_passages where source_id=page),'page delete cascades');
 update public.knowledge_sources set content=repeat('rule ',2380) where id=instruction;
 perform set_config('velora.knowledge_approval','1',true);
 update public.knowledge_sources set approved_for_answers=true where id=instruction;
 perform pg_temp.must((private.es02_select_knowledge_passages(c,b,'Specialespresso')->>'code')='CONTEXT_OVERFLOW','matching passage cannot fit remaining budget');
 update public.knowledge_sources set content=repeat('Mandatory instruction. ',700) where id=instruction;
 perform set_config('velora.knowledge_approval','1',true);
 update public.knowledge_sources set approved_for_answers=true where id=instruction;
 perform pg_temp.must((private.es02_select_knowledge_passages(c,b,'Specialespresso')->>'code')='CONTEXT_OVERFLOW','mandatory overflow denied');
 update public.knowledge_sources set approved_for_answers=false where id=instruction;
 delete from private.es02_branch_knowledge_sources where source_id=s;
 perform pg_temp.must(not private.es02_whatsapp_citations_current(c,b,citations),'unbinding invalidates previously selected passage citations');
 perform pg_temp.must((private.es02_select_knowledge_passages(c,b,'Specialespresso')->>'code')='NO_KNOWLEDGE','unbinding prevents selection');
end;$$;
do $$declare role_name text;begin
 foreach role_name in array array['anon','authenticated','service_role'] loop
  perform pg_temp.must(not has_table_privilege(role_name,'private.branch_website_passages','SELECT,INSERT,UPDATE,DELETE'),'website index private');
  perform pg_temp.must(not has_function_privilege(role_name,'private.es02_select_knowledge_passages(uuid,uuid,text)','EXECUTE'),'selector not callable without worker gate');
  perform pg_temp.must(not has_function_privilege(role_name,'private.refresh_website_passages(uuid)','EXECUTE'),'website writer private');
 end loop;
end;$$;
select 'PASS: bounded reader, instructions, UTF16, Arabic, website lifecycle and scope ACL; not a claimed-worker acceptance';
