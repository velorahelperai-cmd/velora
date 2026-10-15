import {beforeEach,afterEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const m=vi.hoisted(()=>({access:vi.fn(),client:vi.fn(),rpc:vi.fn(),resolve:vi.fn(),request:vi.fn()}));
vi.mock('@/lib/tenancy/access',()=>({getCompanyAccess:m.access}));vi.mock('@/lib/supabase/server',()=>({createClient:m.client}));vi.mock('./public-import-http',()=>({publicImportHttp:{resolve:m.resolve,request:m.request}}));vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
import {previewKnowledgeImport,confirmKnowledgeImport} from './knowledge-import-actions';
import {readBusinessLifecycle,readBusinessFinancialHistory,requestBusinessDeletion,setBusinessArchive} from '@/lib/tenancy/business-archive-actions';
const id=(n:number)=>`e2000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={expectedUserId:id(1),companyId:id(201)},input={...scope,url:'https://public.example/services',rightsAttested:true,attemptId:id(301)};
beforeEach(()=>{vi.stubEnv('VELORA_MASTER_JOURNEY_ENABLED','true');vi.clearAllMocks();m.access.mockResolvedValue({ok:true,context:{userId:id(1),company:{id:id(201)}}});m.client.mockResolvedValue({rpc:m.rpc});m.resolve.mockResolvedValue(['93.184.216.34']);m.request.mockImplementation(async(url:URL)=>({status:200,headers:{'content-type':'text/plain'},body:url.pathname==='/robots.txt'?'User-agent: *\nAllow: /':'Our public facts'}));});afterEach(()=>vi.unstubAllEnvs());
it('rollout disabled and stale account/company reject before database or HTTP',async()=>{
 vi.stubEnv('VELORA_MASTER_JOURNEY_ENABLED','false');expect(await previewKnowledgeImport(input)).toEqual({ok:false,code:'UNCONFIGURED'});expect(await readBusinessLifecycle(id(1))).toEqual({ok:false,code:'UNCONFIGURED'});expect(m.access).not.toHaveBeenCalled();
 vi.stubEnv('VELORA_MASTER_JOURNEY_ENABLED','true');expect(await previewKnowledgeImport({...input,companyId:id(202)})).toEqual({ok:false,code:'FORBIDDEN'});expect(await previewKnowledgeImport({...input,expectedUserId:id(2)})).toEqual({ok:false,code:'UNAUTHENTICATED'});expect(m.client).not.toHaveBeenCalled();expect(m.request).not.toHaveBeenCalled();
});
it('native authorization/config failure never fetches public data',async()=>{for(const code of ['FORBIDDEN','UNCONFIGURED']){m.rpc.mockResolvedValue({data:{ok:false,code},error:null});expect(await previewKnowledgeImport(input)).toEqual({ok:false,code});}expect(m.request).not.toHaveBeenCalled();});
it('native version gates fetched staging and malformed preview receipts fail closed',async()=>{
 m.rpc.mockResolvedValueOnce({data:{ok:true,data:{companyVersion:7}},error:null}).mockResolvedValueOnce({data:{ok:true,data:{confidence:'verified'}},error:null});expect(await previewKnowledgeImport(input)).toEqual({ok:false,code:'UNAVAILABLE'});expect(m.rpc).toHaveBeenLastCalledWith('master_stage_knowledge_import',expect.objectContaining({p_expected_company_version:7,p_text:'Our public facts',p_rights_attested:true}));
});
it('confirm preserves conflict and refuses any receipt claiming approval',async()=>{
 const c={...scope,previewId:id(302),expectedRevision:1,contentHash:'a'.repeat(64)};m.rpc.mockResolvedValue({data:{ok:false,code:'CONFLICT'},error:null});expect(await confirmKnowledgeImport(c)).toEqual({ok:false,code:'CONFLICT'});m.rpc.mockResolvedValue({data:{ok:true,data:{sourceId:id(601),approved:true}},error:null});expect(await confirmKnowledgeImport(c)).toEqual({ok:false,code:'UNAVAILABLE'});
});
it('history operations use native ownership without requiring an active selected workspace',async()=>{
 m.access.mockResolvedValue({ok:true,context:{userId:id(1),company:null}});m.rpc.mockResolvedValue({data:{ok:true,data:[]},error:null});expect(await readBusinessLifecycle(id(1))).toEqual({ok:true,data:[]});m.rpc.mockResolvedValue({data:{ok:false,code:'FORBIDDEN'},error:null});expect(await setBusinessArchive({...scope,expectedVersion:1,archived:false})).toEqual({ok:false,code:'FORBIDDEN'});
});
it('delete request never interprets unexpected approval as destruction success',async()=>{
 m.rpc.mockResolvedValue({data:{ok:true,data:{id:id(401),state:'deleted',legalPolicy:'APPROVED'}},error:null});expect(await requestBusinessDeletion({...scope,expectedVersion:1,attemptId:id(401),reason:'Close business'})).toEqual({ok:false,code:'UNAVAILABLE'});
});
it('archived financial history does not need a workspace and rechecks native ownership after reads',async()=>{
 m.access.mockResolvedValue({ok:true,context:{userId:id(1),company:null}});let listReads=0;m.rpc.mockImplementation(async(name:string)=>({error:null,data:name==='master_list_owned_businesses'?++listReads===1?{ok:true,data:[{id:id(201),name:'Archived',status:'active',version:2,archivedAt:'2026-10-14',restoreAllowed:true}]}:{ok:false,code:'UNAUTHENTICATED'}:name==='billing_read_company_display_evidence'?{ok:true,data:{company_id:id(201),environment:'live',billing_paid:true,qualified_paid_through:null}}:{ok:true,data:{subscription:null,orders:[]}}}));expect(await readBusinessFinancialHistory(scope)).toEqual({ok:false,code:'UNAUTHENTICATED'});expect(m.rpc).toHaveBeenCalledWith('billing_read_company_display_evidence',{p_company_id:id(201)});expect(m.rpc).toHaveBeenCalledWith('billing_read_company_journey',{p_company_id:id(201)});
});
