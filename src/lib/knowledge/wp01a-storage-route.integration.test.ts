import {beforeAll,afterAll,test,expect,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
const context=vi.hoisted(()=>({jar:new Map<string,string>()}));
vi.mock('next/headers',()=>({cookies:async()=>({getAll:()=>[...context.jar].map(([name,value])=>({name,value})),get:(n:string)=>context.jar.has(n)?{value:context.jar.get(n)}:undefined,set:(n:string,v:string)=>context.jar.set(n,v)}),headers:async()=>new Headers()}));
vi.mock('next/cache',()=>({revalidatePath:()=>{}}));
type StorageUser={id:string;email:string;password:string};
type StorageStack={
  url:string;anonKey:string;serviceRoleKey:string;
  close:()=>Promise<void>;
  sql:(query:string)=>Promise<string>;
  rows:(query:string)=>Promise<Record<string,unknown>[]>;
  adminCreateUser:(input:{email:string})=>Promise<StorageUser>;
};
type KnowledgeAction=typeof import('@/lib/knowledge/actions').adminGetKnowledgeFileUrl;
type SetupFileGet=typeof import('@/app/api/knowledge/setup-file/route').GET;
type ServerClient=Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>;
const enabled=process.env.WP01A_STORAGE_ROUTE==='1';
let stack!:StorageStack;let user!:StorageUser;const company=randomUUID(),source=randomUUID();let setupSource!:string;let setupPath!:string;const draft=randomUUID(),intent=randomUUID();
const bytes=Buffer.from('%PDF-1.4\nSynthetic route fixture\n%%EOF');
const q=(v:string)=>"'"+v.replaceAll("'","''")+"'";
const fixtureRecord=(value:unknown):Record<string,unknown>=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('OWN_STORAGE_FIXTURE_OBJECT_REQUIRED');
 return value as Record<string,unknown>;
};
const fixtureString=(value:unknown):string=>{
 if(typeof value!=='string')throw Error('OWN_STORAGE_FIXTURE_STRING_REQUIRED');
 return value;
};
const rawFetch=globalThis.fetch;let afterDownload:(()=>Promise<unknown>)|undefined;
let nativeDownloads=0,authorizeCalls=0;const knowledgeQueries:URL[]=[];
let action!:KnowledgeAction;let GET!:SetupFileGet;let client!:ServerClient;
async function upload(path:string){const r=await rawFetch('http://127.0.0.1:3650/object/company-knowledge/'+path,{method:'POST',headers:{Authorization:'Bearer '+stack.serviceRoleKey,'Content-Type':'application/pdf'},body:bytes});expect(r.ok,'real Storage upload '+r.status).toBe(true);}
async function login(actor:Pick<StorageUser,'email'|'password'>){context.jar.clear();const anchor=randomBytes(32).toString('base64url');context.jar.set('vel_bc',anchor);const {bindBrowserContinuityFromAnchor}=await import('@/lib/auth/broker/continuity');expect((await bindBrowserContinuityFromAnchor(anchor,anchor)).ok).toBe(true);const {brokerPasswordLogin}=await import('@/lib/auth/broker/login');expect(await brokerPasswordLogin({email:actor.email,password:actor.password,requestNonce:randomUUID(),reader:{getAll:()=>[...context.jar].map(([name,value])=>({name,value}))},writer:{set:(n,v)=>{context.jar.set(n,v);}}})).toEqual({ok:true});const {createClient}=await import('@/lib/supabase/server');client=await createClient();}
// Default checks the fixed source. Explicit repro mode recreates only the historical helper-owner defect.
const verifyCapabilityOwnerRepair=async()=>{
 const signature='private.vel_broker_capability_contract_matches()';
 const inspect=()=>stack.rows(`select pg_get_userbyid(proowner) as owner,proacl::text as acl,has_function_privilege('anon',oid,'execute') as anon_execute,has_function_privilege('authenticated',oid,'execute') as user_execute,has_function_privilege('service_role',oid,'execute') as service_execute from pg_proc where oid='${signature}'::regprocedure`);
 let before=await inspect();const reproduce=process.env.VELORA_WP01A_CAPABILITY_OWNER_REPRO==='1';
 if(reproduce){
  if(before[0].owner==='postgres'){await stack.sql(`alter function ${signature} owner to supabase_admin`);before=await inspect();}
  expect(before[0].owner).toBe('supabase_admin');let denied=false;try{await stack.sql('BEGIN;SET LOCAL ROLE service_role;SELECT public.vel_broker_capability_probe();ROLLBACK;');}catch(error){denied=String((error as Error).message).includes('permission denied for function vel_broker_capability_contract_matches');}expect(denied,'original native service-role probe permission failure').toBe(true);
  await stack.sql(`alter function ${signature} owner to postgres`);
 }
 const after=await inspect();expect(after[0]).toMatchObject({owner:'postgres',anon_execute:false,user_execute:false,service_execute:false});
 const result=JSON.parse(await stack.sql('BEGIN;SET LOCAL ROLE service_role;SELECT public.vel_broker_capability_probe();COMMIT;'));expect(result.ok,JSON.stringify(result)).toBe(true);
 console.log((reproduce?'NATIVE_SERVICE_CAPABILITY_OWNER_REPAIR ':'NATIVE_SERVICE_CAPABILITY_OWNER_HEALTHY ')+JSON.stringify({before,after,serviceProbeOk:result.ok}));
};

beforeAll(async()=>{if(!enabled)return;
 const fixtureModule='C:/Users/DELL/Desktop/Velora new/scripts/integration/local-http-stack.mjs'; const {startStack}=await import(/* @vite-ignore */ fixtureModule);
 stack=await startStack({gatewayPort:3630,authPort:3640,restPort:3641,databasePort:3642,nativeStoragePort:3650,migrationScope:'wp01a-auth',canonicalSqlLineEndings:true,reuseUpstreamConnections:true,progress:(stage:string)=>console.log('STORAGE_ROUTE_STAGE '+stage)}) as StorageStack;
 process.env.NEXT_PUBLIC_SUPABASE_URL=stack.url;process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=stack.anonKey;process.env.SUPABASE_SERVICE_ROLE_KEY=stack.serviceRoleKey;process.env.VELORA_SESSION_BROKER_KEY=randomBytes(32).toString('base64');
 globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{const sourceUrl=typeof input==='string'?input:input instanceof URL?input.href:input.url;const url=new URL(sourceUrl);let nextInput:RequestInfo|URL=input;const isStorage=url.origin===stack.url&&url.pathname.startsWith('/storage/v1/');if(isStorage){url.port='3650';url.pathname=url.pathname.slice('/storage/v1'.length);nextInput=url.toString();}if(url.pathname.endsWith('/rest/v1/knowledge_sources'))knowledgeQueries.push(url);if(url.pathname.endsWith('/rpc/master_authorize_setup_file'))authorizeCalls++;const response=await rawFetch(nextInput,init);if(isStorage&&url.pathname.startsWith('/object/company-knowledge/')){nativeDownloads++;if(afterDownload){const hook=afterDownload;afterDownload=undefined;await hook();}}return response;};
 await verifyCapabilityOwnerRepair();const {createAdminClient}=await import('@/lib/supabase/admin');const capability=await createAdminClient()!.rpc('vel_broker_capability_probe' as never);if(capability.error)throw Error('NATIVE_SERVICE_CAPABILITY_RPC_'+capability.error.code+':'+capability.error.message);expect((capability.data as {ok?:boolean})?.ok,'native service capability contract').toBe(true);user=await stack.adminCreateUser({email:'wp01a-storage-route-'+randomUUID()+'@example.invalid'});await stack.sql(`insert into public.companies(id,display_name,created_by) values(${q(company)},'Synthetic Route',${q(user.id)});insert into public.company_members(company_id,user_id,role,status)values(${q(company)},${q(user.id)},'owner','active');insert into public.platform_admins(user_id,role,status)values(${q(user.id)},'delegated','active');insert into public.platform_admin_scopes(admin_user_id,company_id,usable_capabilities)values(${q(user.id)},${q(company)},ARRAY['knowledge.read']);insert into public.knowledge_sources(id,company_id,kind,title,content,file_name,storage_path,status,created_by) values(${q(source)},${q(company)},'file','Synthetic','','synthetic.pdf',${q(company+'/'+source+'/synthetic.pdf')},'draft',${q(user.id)});`);
 await upload(company+'/'+source+'/synthetic.pdf');await login(user);({adminGetKnowledgeFileUrl:action}=await import('@/lib/knowledge/actions'));({GET}=await import('@/app/api/knowledge/setup-file/route'));
},600000);
afterAll(async()=>{globalThis.fetch=rawFetch;if(stack)await stack.close();},60000);
const assertPolicyRebind=async()=>{
 const snapshot=()=>stack.rows("select oid::text,polname,polroles::text,polcmd,polpermissive from pg_policy where polrelid='public.knowledge_sources'::regclass order by oid");
 const before=await snapshot();
 await stack.sql(`do $restore$ declare p record; q text; c text; stmt text; begin perform set_config('search_path','',true); for p in select pol.* from pg_policy pol where polrelid='public.knowledge_sources'::regclass and exists(select 1 from pg_depend d where d.classid='pg_policy'::regclass and d.objid=pol.oid and d.refobjid='public.has_company_capability(uuid,text)'::regprocedure) loop q:=pg_get_expr(p.polqual,p.polrelid);c:=pg_get_expr(p.polwithcheck,p.polrelid);stmt:=format('alter policy %I on public.knowledge_sources',p.polname);if q is not null then stmt:=stmt||' using ('||replace(q,'public.has_company_capability(','public.lifecycle_native_has_company_capability(')||')';end if;if c is not null then stmt:=stmt||' with check ('||replace(c,'public.has_company_capability(','public.lifecycle_native_has_company_capability(')||')';end if;execute stmt;end loop;end;$restore$;`);
 expect(await action({companyId:company,sourceId:source})).toMatchObject({ok:false,code:'AUTH_ERROR',message:'permission denied for function lifecycle_native_has_company_capability'});
 const {readFile}=await import('node:fs/promises');const migration=await readFile('supabase/migrations/20261016170000_wp01a_session_broker_correction_c5_r4.sql','utf8');const begin=migration.indexOf('do $wp01a_storage_policy_binding$');const end=migration.indexOf('end;$wp01a_storage_policy_binding$;',begin)+'end;$wp01a_storage_policy_binding$;'.length;expect(begin).toBeGreaterThan(0);await stack.sql(migration.slice(begin,end));
 expect(await snapshot()).toEqual(before);
 const [acl]=await stack.rows("select has_function_privilege('authenticated','public.lifecycle_native_has_company_capability(uuid,text)','execute') as user_execute,has_function_privilege('anon','public.lifecycle_native_has_company_capability(uuid,text)','execute') as anon_execute");expect(acl).toEqual({user_execute:false,anon_execute:false});
 console.log('M30_ACTUAL_ACTION_ORIGINAL_PERMISSION_DENIAL_REPRODUCED_FIXED_WITH_POLICY_OID_ROLES_COMMAND_ACL_PRESERVED');
};

test.skipIf(!enabled)('M30 exact existing admin action: native gate, source/company/path filters, real 60s link',async()=>{
 await assertPolicyRebind(); const good=await action({companyId:company,sourceId:source});const query=knowledgeQueries.at(-1)!;expect(query.searchParams.get('kind')).toBe('eq.file');expect(query.searchParams.get('company_id')).toBe('eq.'+company);expect(query.searchParams.get('id')).toBe('eq.'+source);expect(good.ok,JSON.stringify(good)).toBe(true);if(!good.data)throw Error('OWN_STORAGE_FIXTURE_POSITIVE_DATA_REQUIRED');const link=new URL(good.data.url);expect(link.port).toBe('3630');link.port='3650';link.pathname=link.pathname.replace('/storage/v1','');const token=link.searchParams.get('token')!;const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());expect(claims.exp-claims.iat).toBe(60);const downloaded=await rawFetch(link);expect(downloaded.status).toBe(200);expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
 expect((await action({companyId:randomUUID(),sourceId:source})).ok).toBe(false);expect((await action({companyId:company,sourceId:randomUUID()})).ok).toBe(false);
 await stack.sql(`update public.knowledge_sources set kind='text',file_name=null,storage_path=null where id=${q(source)}`);expect((await action({companyId:company,sourceId:source})).ok).toBe(false);await stack.sql(`update public.knowledge_sources set kind='file',file_name='synthetic.pdf',storage_path=${q(company+'/'+source+'/synthetic.pdf')} where id=${q(source)}`);
 await stack.sql(`alter table public.knowledge_sources drop constraint knowledge_sources_storage_prefix_chk;update public.knowledge_sources set storage_path=${q(randomUUID()+'/'+source+'/wrong.pdf')} where id=${q(source)}`);expect(await action({companyId:company,sourceId:source})).toMatchObject({ok:false,code:'FORBIDDEN',message:'path_mismatch'});
 await stack.sql(`update public.knowledge_sources set storage_path=${q(company+'/'+source+'/synthetic.pdf')} where id=${q(source)};alter table public.knowledge_sources add constraint knowledge_sources_storage_prefix_chk check(storage_path is null or storage_path like(company_id::text||'/%'));update public.platform_admins set status='disabled' where user_id=${q(user.id)}`);expect((await action({companyId:company,sourceId:source})).ok).toBe(false);await stack.sql(`update public.platform_admins set status='active' where user_id=${q(user.id)}`);primaryActionPassed=true;
},60000);
test.skipIf(!enabled)('M31 actual GET and native before/after authorization, generation and closed-scope races',async()=>{
 const payload={setupStep:0,business:{name:'',type:'',replyLanguage:'en',country:'',city:'',hours:'',contactPhone:'',contactEmail:''}};
 await stack.sql(`insert into public.company_setup_drafts(draft_id,user_id,company_id,payload,last_meaningful_activity_at,expires_at)values(${q(draft)},${q(user.id)},${q(company)},${q(JSON.stringify(payload))}::jsonb,clock_timestamp(),clock_timestamp()+interval '1 day')`);
 const reserved=await client.rpc('master_reserve_setup_file' as never,{p_expected_user_id:user.id,p_company_id:company,p_draft_id:draft,p_expected_generation:1,p_attempt_id:intent,p_file_name:'setup.pdf',p_content_type:'application/pdf',p_byte_size:bytes.length} as never);expect(reserved.error).toBeNull();const reservedBody=fixtureRecord(reserved.data);expect(reservedBody.ok,JSON.stringify(reserved.data)).toBe(true);const reservedData=fixtureRecord(reservedBody.data);setupPath=fixtureString(reservedData.path);setupSource=fixtureString(reservedData.sourceId);await upload(setupPath);const finalized=await client.rpc('master_finalize_setup_file' as never,{p_expected_user_id:user.id,p_intent_id:intent} as never);expect(fixtureRecord(finalized.data).ok,JSON.stringify(finalized)).toBe(true);
 const {resolveBrokerSession,commitWorkspaceForGeneration}=await import('@/lib/auth/broker');const resolved=await resolveBrokerSession({getAll:()=>[...context.jar].map(([name,value])=>({name,value}))});expect(resolved.ok).toBe(true);if(resolved.ok)commitWorkspaceForGeneration({set:(n,v)=>context.jar.set(n,v)},resolved.boundary.generation,user.id,company);
 const request=()=>new Request('http://127.0.0.1:3630/api/knowledge/setup-file?companyId='+company+'&sourceId='+setupSource);
 let count=authorizeCalls;let download=nativeDownloads;let r=await GET(request());expect(r.status).toBe(200);expect(Buffer.from(await r.arrayBuffer())).toEqual(bytes);expect(r.headers.get('cache-control')).toBe('private, no-store, max-age=0');expect(r.headers.get('x-content-type-options')).toBe('nosniff');expect(authorizeCalls-count).toBe(2);expect(nativeDownloads-download).toBe(1);
 afterDownload=()=>stack.sql(`update storage.objects set updated_at=updated_at+interval '1 second' where name=${q(setupPath)}`);count=authorizeCalls;download=nativeDownloads;r=await GET(request());expect(r.status).toBe(403);expect((await r.arrayBuffer()).byteLength).toBe(0);expect(authorizeCalls-count).toBe(2);expect(nativeDownloads-download).toBe(1);
 download=nativeDownloads;r=await GET(request());expect(r.status).toBe(403);expect((await r.arrayBuffer()).byteLength).toBe(0);expect(nativeDownloads).toBe(download);
 await stack.sql(`update private.master_setup_file_intents i set object_updated_at=o.updated_at from storage.objects o where i.id=${q(intent)} and o.name=i.path`);
 await stack.sql(`update private.master_setup_file_intents set byte_size=byte_size+1 where id=${q(intent)}`);r=await GET(request());expect(r.status).toBe(403);expect((await r.arrayBuffer()).byteLength).toBe(0);await stack.sql(`update private.master_setup_file_intents set byte_size=byte_size-1 where id=${q(intent)}`);
 afterDownload=()=>stack.sql(`update public.company_setup_drafts set state='cancelled' where draft_id=${q(draft)}`);count=authorizeCalls;r=await GET(request());expect(r.status).toBe(403);expect((await r.arrayBuffer()).byteLength).toBe(0);expect(authorizeCalls-count).toBe(2);
 download=nativeDownloads;r=await GET(request());expect(r.status).toBe(403);expect((await r.arrayBuffer()).byteLength).toBe(0);expect(nativeDownloads).toBe(download);const {readBoundedKnowledgeStream}=await import('@/lib/knowledge/bounded-read');await expect(readBoundedKnowledgeStream(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(10*1024*1024+1));controller.close();}}),new AbortController().signal)).rejects.toThrow('FILE_LIMIT');primaryRoutePassed=true;
},60000);






let primaryActionPassed=false,primaryRoutePassed=false,staff!:StorageUser;
const foreignCompany=randomUUID(),assignedConversation=randomUUID(),unassignedConversation=randomUUID(),foreignConversation=randomUUID();
test.skipIf(!enabled)('M28 exact sessionHasCompanyCapability native own/foreign/removed-grant',async()=>{
 expect(primaryActionPassed&&primaryRoutePassed,'primary M30/M31 must pass first').toBe(true);
 staff=await stack.adminCreateUser({email:'wp01a-storage-route-staff-'+randomUUID()+'@example.invalid'});
 await stack.sql(`insert into public.companies(id,display_name,created_by)values(${q(foreignCompany)},'Synthetic Foreign Scope',${q(user.id)});insert into public.company_members(company_id,user_id,role,status)values(${q(company)},${q(staff.id)},'staff','active');insert into public.company_member_grants(company_id,user_id,capabilities,conversation_scope,status)values(${q(company)},${q(staff.id)},ARRAY['knowledge.read','wa.conversations.read'],'assigned_only','active');`);
 await login(staff);const {sessionHasCompanyCapability}=await import('@/lib/access/actions');
 expect(await sessionHasCompanyCapability(company,'knowledge.read')).toBe(true);expect(await sessionHasCompanyCapability(foreignCompany,'knowledge.read')).toBe(false);
 await stack.sql(`delete from public.company_member_grants where company_id=${q(company)} and user_id=${q(staff.id)}`);expect(await sessionHasCompanyCapability(company,'knowledge.read')).toBe(false);
 await stack.sql(`insert into public.company_member_grants(company_id,user_id,capabilities,conversation_scope,status)values(${q(company)},${q(staff.id)},ARRAY['knowledge.read','wa.conversations.read'],'assigned_only','active')`);
},60000);
test.skipIf(!enabled)('M29 exact readSessionConversationScope plus native target relation/foreign/removed staff',async()=>{
 expect(primaryActionPassed&&primaryRoutePassed&&staff,'primary cases and staff fixture required').toBeTruthy();
 const {readSessionConversationScope}=await import('@/lib/access/conversation-scope');expect(await readSessionConversationScope(company)).toEqual({ok:true,scope:'assigned_only'});expect(await readSessionConversationScope(foreignCompany)).toEqual({ok:false,code:'FORBIDDEN'});
 await stack.sql(`insert into public.whatsapp_conversations(id,company_id,phone_number_id,customer_wa_id,assigned_to)values(${q(assignedConversation)},${q(company)},'synthetic-local-phone','synthetic-target-assigned',${q(staff.id)}),(${q(unassignedConversation)},${q(company)},'synthetic-local-phone','synthetic-target-unassigned',null),(${q(foreignConversation)},${q(foreignCompany)},'synthetic-foreign-phone','synthetic-target-foreign',null)`);
 const readTargets=async()=>{const r=await client.from('whatsapp_conversations').select('id').in('id',[assignedConversation,unassignedConversation,foreignConversation]);expect(r.error).toBeNull();if(r.data===null)throw Error('OWN_STORAGE_FIXTURE_QUERY_DATA_REQUIRED');return r.data.map((r:{id:string})=>r.id);};expect(await readTargets()).toEqual([assignedConversation]);
 await stack.sql(`update public.company_member_grants set status='disabled' where company_id=${q(company)} and user_id=${q(staff.id)}`);expect(await readSessionConversationScope(company)).toEqual({ok:false,code:'FORBIDDEN'});expect(await readTargets()).toEqual([]);
 await stack.sql(`update public.company_member_grants set status='active' where company_id=${q(company)} and user_id=${q(staff.id)};update public.company_members set status='disabled' where company_id=${q(company)} and user_id=${q(staff.id)}`);expect(await readSessionConversationScope(company)).toEqual({ok:false,code:'FORBIDDEN'});expect(await readTargets()).toEqual([]);
},60000);









