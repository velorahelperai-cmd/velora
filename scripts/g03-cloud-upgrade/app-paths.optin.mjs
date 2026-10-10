import { beforeAll,afterAll,it,expect,vi } from 'vitest';
import { createHash } from 'node:crypto';
import { isolatedPostgres,lit } from '../g03-review-acceptance/postgres.mjs';
import { assemble } from './build.mjs';
const state=vi.hoisted(()=>({client:null,service:null,actor:null,company:null}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>state.service}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>state.client}));
vi.mock('@/lib/tenancy/access',()=>({getCompanyAccess:async()=>({ok:true,context:{userId:state.actor.user,company:state.company,membership:{role:'owner',status:'active'}}}),requirePlatformAdmin:async()=>({ok:false})}));
vi.mock('@/lib/access/actions',()=>({sessionHasCompanyCapability:async()=>false}));
vi.mock('next/cache',()=>({revalidatePath:()=>{}}));
import { saveTextKnowledgeSource, uploadKnowledgeFiles } from '@/lib/knowledge/actions';
import { publishPreparedFile } from '@/lib/knowledge/prepared-publication';
import { prepareReviewProof,reviewStorageReader } from '@/lib/tenancy/review-proof';
const uuid=s=>createHash('md5').update(s).digest('hex').replace(/^(........)(....)(....)(....)(............)$/,'$1-$2-$3-$4-$5');
let db;const a={user:uuid('application-owner'),sid:uuid('application-session'),company:uuid('application-company')};
const value=v=>v===null?'NULL':typeof v==='number'||typeof v==='boolean'?String(v):typeof v==='object'?`${lit(JSON.stringify(v))}::jsonb`:lit(v);
const ident=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw Error('INVALID_IDENTIFIER');return `"${s}"`;};
const storageBytes=new Map();
function client(service=false) {
 const transaction=q=>db.sql(`BEGIN;SET LOCAL ROLE ${service?'service_role':'authenticated'};${service?'':`SET LOCAL "request.jwt.claim.sub"=${lit(a.user)};SET LOCAL "request.jwt.claims"=${lit(JSON.stringify({sub:a.user,session_id:a.sid,role:'authenticated'}))};`}${q}COMMIT;`);
 const allowed=new Set(['g03_begin_review_check','g03_complete_review_check','g03_publish_prepared_file','transition_company_review','set_knowledge_source_approval','g03_read_review_request','g03_read_file_generation']);
 return {auth:{getClaims:async()=>({data:{claims:{sub:a.user,session_id:a.sid}},error:null})},
  storage:{from:bucket=>{if(bucket!=='company-knowledge')throw Error('BUCKET_OUTSIDE_SCOPE');return {
    upload:async(path,bytes)=>{storageBytes.set(path,bytes);await db.sql(`INSERT INTO storage.objects(id,bucket_id,name,owner) VALUES(${lit(uuid(path))},'company-knowledge',${lit(path)},${lit(a.user)});`);return {error:null};},
    download:path=>({asStream:async()=>({data:storageBytes.has(path)?new ReadableStream({start(c){c.enqueue(storageBytes.get(path));c.close();}}):null,error:null})}),
  };}},
  rpc:async(name,args)=>{if(!allowed.has(name))throw Error('RPC_OUTSIDE_SCOPE');try{return {data:JSON.parse(await transaction(`SELECT public.${ident(name)}(${Object.entries(args).map(([k,v])=>`${ident(k)}=>${value(v)}`).join(',')});`)),error:null};}catch(e){return {data:null,error:{message:e.message}};}},
  from:table=>{if(table!=='knowledge_sources')throw Error('TABLE_OUTSIDE_SCOPE');let fields='*',operation='read',values={},single=false;const where=[];
   const run=async()=>{try{let q;if(operation==='read')q=`SELECT ${fields} FROM public.knowledge_sources ${where.length?'WHERE '+where.join(' AND '):''}`;
    else if(operation==='insert')q=`INSERT INTO public.knowledge_sources (${Object.keys(values).map(ident).join(',')}) VALUES (${Object.values(values).map(value).join(',')}) RETURNING ${fields}`;
    else q=`UPDATE public.knowledge_sources SET ${Object.entries(values).map(([k,v])=>`${ident(k)}=${value(v)}`).join(',')} WHERE ${where.join(' AND ')} RETURNING ${fields}`;
    const rows=JSON.parse(await transaction(operation==='read'?`SELECT coalesce(jsonb_agg(r),'[]'::jsonb) FROM (${q}) r;`:`WITH changed AS (${q}) SELECT coalesce(jsonb_agg(r),'[]'::jsonb) FROM changed r;`));return {data:single?(rows[0]??null):rows,error:null};
   }catch(e){return {data:null,error:{message:e.message}};}};
   const query={select:cols=>{fields=cols.split(',').map(s=>ident(s.trim())).join(',');return query;},eq:(k,v)=>{where.push(`${ident(k)}=${value(v)}`);return query;},limit:()=>query,order:()=>query,
    insert:v=>{operation='insert';values=v;return query;},update:v=>{operation='update';values=v;return query;},single:()=>{single=true;return run();},maybeSingle:()=>{single=true;return run();},then:(ok,fail)=>run().then(ok,fail)};return query;
  }};
}
beforeAll(async()=>{
 const path=process.env.VELORA_G03_SCHEMA;if(!path)throw Error('PRIVATE_METADATA_PATH_REQUIRED: VELORA_G03_SCHEMA');
 db=await isolatedPostgres();await db.bootstrap({baselineMetadataPath:path});const pkg=assemble();await db.sql(pkg.containment);await db.sql(pkg.bundle);await db.file("supabase/migrations/20261010050337_g03_exact_file_generation.sql");
 await db.sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${lit(a.user)},'application@example.invalid',now());INSERT INTO auth.sessions(id,user_id) VALUES(${lit(a.sid)},${lit(a.user)});INSERT INTO private.app_session_activity(session_id,user_id,last_activity_at) VALUES(${lit(a.sid)},${lit(a.user)},clock_timestamp());
INSERT INTO public.companies(id,display_name,business_type,hours,created_by) VALUES(${lit(a.company)},'Synthetic shop','shop','09-18',${lit(a.user)});INSERT INTO public.company_members(company_id,user_id,role,status) VALUES(${lit(a.company)},${lit(a.user)},'owner','active');`);
 state.actor=a;state.company={id:a.company,status:'setup'};state.client=client();state.service=client(true);
});
afterAll(async()=>{if(db)await db.close();});
let textSource,fileSource;
it('real saveTextKnowledgeSource persists usage_role/current columns through actual ACL/RLS',async()=>{
 const result=await saveTextKnowledgeSource({title:'Menu',content:'Tea 1 OMR',usageRole:'knowledge',expectedCompanyId:a.company});expect(result.ok).toBe(true);textSource=result.data.id;
 expect(result.data.prepared_file_sha256).toBe(null);expect(result.data.approved_for_answers).toBe(false);
 const wrong=await saveTextKnowledgeSource({title:'Fake',content:'Other',expectedCompanyId:uuid('other-company')});expect(wrong.code).toBe('FORBIDDEN');
});
it('actual upload preparation publishes downloaded TXT bytes through the exact reader and SQL guards',async()=>{
 const form=new FormData();form.append('expectedCompanyId',a.company);form.append('files',new File(['Synthetic TXT content'],'synthetic-upload.txt',{type:'text/plain'}));
 const result=await uploadKnowledgeFiles(form);expect(result.ok).toBe(true);
 expect(result.data).toHaveLength(1);expect(result.data[0]).toMatchObject({ok:true,source:{status:'ready',approved_for_answers:false,prepared_file_sha256:createHash('sha256').update('Synthetic TXT content').digest('hex'),prepared_text_sha256:createHash('sha256').update('Synthetic TXT content').digest('hex')}});
 expect(result.data[0].source.prepared_content_version).toBe(result.data[0].source.content_version);
});
it('real publishPreparedFile binds synthetic bytes to SQL object generation and approval',async()=>{
 fileSource=uuid('application-file');const object=uuid('application-object'),path=`${a.company}/${fileSource}/menu.txt`;
 await db.sql(`INSERT INTO storage.objects(id,bucket_id,name,owner) VALUES(${lit(object)},'company-knowledge',${lit(path)},${lit(a.user)});INSERT INTO public.knowledge_sources(id,company_id,kind,title,content,status,file_name,content_type,byte_size,storage_path,created_by) VALUES(${lit(fileSource)},${lit(a.company)},'file','Menu file','','processing','menu.txt','text/plain',3,${lit(path)},${lit(a.user)});`);
 const generation=JSON.parse(await db.sql(`SELECT jsonb_build_object('objectId',id,'updatedAt',updated_at) FROM storage.objects WHERE id=${lit(object)};`));
 const result=await publishPreparedFile(state.client,{sourceId:fileSource,companyId:a.company,expectedVersion:1,storagePath:path,text:'Synthetic extraction',bytes:Buffer.from('abc'),generation});
 expect(result.ok).toBe(true);expect(result.row.prepared_file_sha256).toBe(createHash('sha256').update('abc').digest('hex'));
 await state.client.rpc('set_knowledge_source_approval',{p_source_id:textSource,p_approved:true});await state.client.rpc('set_knowledge_source_approval',{p_source_id:fileSource,p_approved:true});
});
const reader=()=>reviewStorageReader({
 download:()=>({asStream:async()=>({data:new ReadableStream({start(c){c.enqueue(Buffer.from('abc'));c.close();}}),error:null})}),
}, {client:state.client,companyId:a.company,action:'submit'});
it('actual preflight checks synthetic Storage bytes, completes SQL proof and preserves own-number preference',async()=>{
 const input={action:'submit',companyId:a.company,numberOwnership:'own',whatsappNumber:'+96800000000',ready:true};
 expect(await prepareReviewProof(state.client,state.service,input,reader())).toEqual({ok:true});
 const result=await state.client.rpc('transition_company_review',{p_action:'submit',p_company_id:a.company,p_number_ownership:'own',p_whatsapp_number:'+96800000000',p_readiness_confirmed:true});
 expect(result.data.ok).toBe(true);expect(result.data.request.proof_current).toBe(true);expect(result.data.request.number_ownership).toBe('own');
});
it('same-size altered Storage bytes fail, and server edit invalidates prior review',async()=>{
 const changed=reader();changed.download=async()=>Buffer.from('xyz');
 const result=await prepareReviewProof(state.client,state.service,{action:'resubmit',companyId:a.company,expectedRevision:1,numberOwnership:'own',whatsappNumber:'+96800000000',ready:true},changed);expect(result.code).toBe('FILE_CHANGED');
 expect((await saveTextKnowledgeSource({id:textSource,title:'Menu',content:'Tea 2 OMR',expectedCompanyId:a.company})).ok).toBe(true);
 const review=await state.client.rpc('g03_read_review_request',{p_company_id:a.company});expect(review.data.proof_current).toBe(false);
});
