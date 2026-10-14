import {beforeEach,afterEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
afterEach(()=>vi.unstubAllEnvs());
const state=vi.hoisted(()=>({access:vi.fn(),client:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/tenancy/access',()=>({getCompanyAccess:state.access}));
vi.mock('@/lib/supabase/server',()=>({createClient:state.client}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
import {createBusinessAttempt,saveBusinessProfile} from './business-authority-actions';
const user='11111111-1111-4111-8111-111111111111',company='22222222-2222-4222-8222-222222222222';
const key='33333333-3333-4333-8333-333333333333';
const payload={name:'Shop',type:'store',country:'OM',replyLanguage:'both',city:'',hours:'',contactPhone:'',contactEmail:''};
beforeEach(()=>{vi.stubEnv('VELORA_MASTER_JOURNEY_ENABLED','true');vi.clearAllMocks();state.access.mockResolvedValue({ok:true,context:{userId:user,isPlatformAdmin:false,company:null,membership:null,workspaceChoices:[],needsCompanyContext:false}});state.client.mockResolvedValue({rpc:state.rpc});state.rpc.mockResolvedValue({data:{ok:true,data:{id:company,version:1}},error:null});});
it('default-off creation never calls Auth or a new-schema RPC',async()=>{vi.stubEnv('VELORA_MASTER_JOURNEY_ENABLED','false');expect(await createBusinessAttempt({expectedUserId:user,idempotencyKey:key,business:payload})).toEqual({ok:false,code:'UNCONFIGURED'});expect(state.access).not.toHaveBeenCalled();expect(state.rpc).not.toHaveBeenCalled();});
it('allows quick creation with only name/type/country and uses the same stable attempt key',async()=>{
 const input={expectedUserId:user,idempotencyKey:key,business:payload};
 expect(await createBusinessAttempt(input)).toMatchObject({ok:true,data:{id:company}});
 await createBusinessAttempt(input);
 expect(state.rpc.mock.calls.map(c=>c[1].p_idempotency_key)).toEqual([key,key]);
 expect(state.rpc).toHaveBeenCalledWith('create_owner_company_attempt',expect.objectContaining({p_expected_user_id:user,p_payload:payload}));
});
it.each(['name','type','country'])('requires %s on the server before any database mutation',async field=>{
 expect(await createBusinessAttempt({expectedUserId:user,idempotencyKey:key,business:{...payload,[field]:''}})).toMatchObject({ok:false,code:'INVALID_INPUT'});
 expect(state.rpc).not.toHaveBeenCalled();
});
it('rejects a stale account before constructing a client',async()=>{
 expect(await createBusinessAttempt({expectedUserId:company,idempotencyKey:key,business:payload})).toMatchObject({ok:false,code:'UNAUTHENTICATED'});
 expect(state.client).not.toHaveBeenCalled();
});
it('does not turn a platform role or staff invitation into ownership',async()=>{
 for(const context of [{isPlatformAdmin:true,membership:null,workspaceChoices:[]},{isPlatformAdmin:false,membership:{role:'staff'},workspaceChoices:[{role:'staff'}]}]){
 state.access.mockResolvedValue({ok:true,context:{userId:user,company:null,...context}});
 expect(await createBusinessAttempt({expectedUserId:user,idempotencyKey:key,business:payload})).toMatchObject({ok:false,code:'FORBIDDEN'});
 }
 expect(state.rpc).not.toHaveBeenCalled();
});
it('keeps database phone verification and active-draft denials explicit',async()=>{
 for(const code of ['PHONE_REQUIRED','DRAFT_ACTIVE','CONFLICT','THROTTLED']){
 state.rpc.mockResolvedValue({data:{ok:false,code},error:null});
 expect(await createBusinessAttempt({expectedUserId:user,idempotencyKey:key,business:payload})).toEqual({ok:false,code});
 }
});
it('requires the version displayed to the owner and preserves a database conflict',async()=>{
 state.access.mockResolvedValue({ok:true,context:{userId:user,isPlatformAdmin:false,company:{id:company},membership:{role:'owner'}}});
 expect(await saveBusinessProfile({expectedUserId:user,companyId:company,expectedVersion:0,business:payload})).toMatchObject({ok:false,code:'INVALID_INPUT'});
 expect(state.rpc).not.toHaveBeenCalled();
 state.rpc.mockResolvedValue({data:{ok:false,code:'CONFLICT',currentVersion:3},error:null});
 expect(await saveBusinessProfile({expectedUserId:user,companyId:company,expectedVersion:2,business:payload})).toMatchObject({ok:false,code:'CONFLICT',currentVersion:3});
});
it('rejects a changed selected company and never persists secret/unknown fields',async()=>{
 state.access.mockResolvedValue({ok:true,context:{userId:user,company:{id:company},membership:{role:'owner'}}});
 expect(await saveBusinessProfile({expectedUserId:user,companyId:key,expectedVersion:1,business:payload})).toMatchObject({ok:false,code:'FORBIDDEN'});
 expect(await createBusinessAttempt({expectedUserId:user,idempotencyKey:key,business:{...payload,password:'private'}})).toMatchObject({ok:false,code:'INVALID_INPUT'});
 expect(state.rpc).not.toHaveBeenCalled();
});
