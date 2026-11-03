import {beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({access:vi.fn(),cap:vi.fn(),wa:vi.fn(),ig:vi.fn(),channels:vi.fn()}));
vi.mock('@/lib/channels/read',()=>({readCompanyChannelContractResult:async(...args:unknown[])=>{const value=await f.channels(...args);return value?.ok===false?value:value?{ok:true,contract:value}:{ok:false,code:'UNAVAILABLE'};}}));
vi.mock('@/lib/tenancy/access',()=>({getCompanyAccess:f.access}));
vi.mock('@/lib/access/actions',()=>({sessionHasCompanyCapability:f.cap}));
vi.mock('@/lib/whatsapp/inbox',()=>({loadWhatsappInboxInitialPage:f.wa}));
vi.mock('@/lib/instagram/inbox-actions',()=>({loadInstagramInboxPage:f.ig}));
import {readServiceInbox} from './service-inbox-actions';
const access=(companyId='company',userId='actor')=>({ok:true,context:{userId,company:{id:companyId,status:'active'},membership:{role:'owner'}}});
const contract=()=>({companyId:'company',planVersionId:'v1',plan_entitlements:{status:'approved',channelCount:2},selected_channels:{planVersionId:'v1',revision:1,channels:['whatsapp','instagram']},subscription:{state:'active',expiresAt:'2026-11-01T00:00:00Z'}});
beforeEach(()=>{vi.resetAllMocks();f.channels.mockResolvedValue(contract());f.access.mockResolvedValue(access());f.cap.mockResolvedValue(true);f.wa.mockResolvedValue({ok:true,meta:{companyId:'company'}});f.ig.mockResolvedValue({ok:true,data:{companyId:'company',actorId:'actor'}});});
it('uses independent native channel reads without provider execution or inferred paid status',async()=>{expect(await readServiceInbox()).toMatchObject({ok:true,companyId:'company',waAllowed:true,igAllowed:true});expect(f.ig).toHaveBeenCalledWith({companyId:'company'});});
it('does not even request a channel lacking authoritative permission',async()=>{f.cap.mockImplementation((_:string,c:string)=>Promise.resolve(c.startsWith('wa.')));const r=await readServiceInbox();expect(r).toMatchObject({ok:true,igAllowed:false,ig:{ok:false,code:'FORBIDDEN'}});expect(f.ig).not.toHaveBeenCalled();});
it('does not infer a grant from unavailable permission evidence',async()=>{f.cap.mockResolvedValue(null);expect(await readServiceInbox()).toMatchObject({ok:true,wa:{code:'UNAVAILABLE'},ig:{code:'UNAVAILABLE'}});expect(f.wa).not.toHaveBeenCalled();expect(f.ig).not.toHaveBeenCalled();});
it.each([access('other'),access('company','other')])('drops both snapshots after a company or session actor switch',async current=>{f.access.mockResolvedValueOnce(access()).mockResolvedValueOnce(current);expect(await readServiceInbox()).toEqual({ok:false,code:'SCOPE_CHANGED'});});
it('treats a temporary failure of the final access check as unavailable without returning loaded data',async()=>{f.access.mockResolvedValueOnce(access()).mockResolvedValueOnce({ok:false,code:'UNAVAILABLE'});expect(await readServiceInbox()).toEqual({ok:false,code:'UNAVAILABLE'});});
it('drops loaded data when the final session is no longer authenticated',async()=>{f.access.mockResolvedValueOnce(access()).mockResolvedValueOnce({ok:false,code:'UNAUTHENTICATED'});expect(await readServiceInbox()).toEqual({ok:false,code:'SCOPE_CHANGED'});});
it('rejects a provider store response with a different actor, retaining no foreign thread',async()=>{f.ig.mockResolvedValue({ok:true,data:{companyId:'company',actorId:'other'}});expect(await readServiceInbox()).toEqual({ok:false,code:'SCOPE_CHANGED'});});
it.each([{...contract(),planVersionId:'upgraded'},{...contract(),subscription:{state:'locked',expiresAt:'2026-09-01T00:00:00Z'}}])('does not load data from access grants or former connections when commercial authority is missing',async c=>{f.channels.mockResolvedValue(c);expect(await readServiceInbox()).toMatchObject({ok:true,waAllowed:false,igAllowed:false});expect(f.wa).not.toHaveBeenCalled();expect(f.ig).not.toHaveBeenCalled();});
it('null contract in both reads fails closed as UNAVAILABLE without assuming entitlement or calling channel stores',async()=>{
 f.channels.mockResolvedValue(null);
 const r=await readServiceInbox();
 expect(r).toEqual({ok:false,code:'UNAVAILABLE'});
 expect(f.wa).not.toHaveBeenCalled();
 expect(f.ig).not.toHaveBeenCalled();
});
it('rejects a channel selection changed while native rows were loading',async()=>{f.channels.mockResolvedValueOnce(contract()).mockResolvedValue({...contract(),selected_channels:{...contract().selected_channels,revision:2}});expect(await readServiceInbox()).toEqual({ok:false,code:'SCOPE_CHANGED'});});
it('rejects when subscription state transitions while native rows were loading',async()=>{
 f.channels.mockResolvedValueOnce(contract()).mockResolvedValue({...contract(),subscription:{...contract().subscription,state:'locked'}});
 expect(await readServiceInbox()).toEqual({ok:false,code:'SCOPE_CHANGED'});
});
it('treats a temporary failure of the final contract read as UNAVAILABLE instead of false SCOPE_CHANGED',async()=>{f.channels.mockResolvedValueOnce(contract()).mockResolvedValue(null);expect(await readServiceInbox()).toEqual({ok:false,code:'UNAVAILABLE'});});
it('treats a temporary failure of the initial contract read as UNAVAILABLE instead of false SCOPE_CHANGED',async()=>{f.channels.mockResolvedValueOnce(null).mockResolvedValue(contract());expect(await readServiceInbox()).toEqual({ok:false,code:'UNAVAILABLE'});});
it('UNCONFIGURED preserves existing native access without inventing commercial selection',async()=>{f.channels.mockResolvedValue({...contract(),plan_entitlements:{status:'UNCONFIGURED'},selected_channels:{planVersionId:null,revision:0,channels:[]}});f.cap.mockImplementation((_,c)=>Promise.resolve(c.startsWith('wa.')));expect(await readServiceInbox()).toMatchObject({ok:true,waAllowed:true,igAllowed:false,channelContract:{selected_channels:{channels:[]}}});expect(f.wa).toHaveBeenCalledOnce();expect(f.ig).not.toHaveBeenCalled();});

it.each([0,1])('preserves explicit contract denial at read %s',async index=>{if(index)f.channels.mockResolvedValueOnce(contract());f.channels.mockResolvedValueOnce({ok:false,code:'FORBIDDEN'});expect(await readServiceInbox()).toEqual({ok:false,code:'FORBIDDEN'});});
