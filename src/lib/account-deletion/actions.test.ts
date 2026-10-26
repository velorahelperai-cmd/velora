import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({owner:vi.fn(),rpc:vi.fn(),adminRpc:vi.fn(),authGet:vi.fn(),authDelete:vi.fn(),storageRemove:vi.fn()}));
vi.mock('@/lib/tenancy/access',()=>({requirePlatformOwner:mocks.owner}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({rpc:mocks.adminRpc,auth:{admin:{getUserById:mocks.authGet,deleteUser:mocks.authDelete}},storage:{from:()=>({remove:mocks.storageRemove})}})}));
import {accountDeletionAction,advanceAccountDeletion} from './actions';
const id='10000000-0000-4000-8000-000000000001';
beforeEach(()=>{vi.resetAllMocks();mocks.owner.mockResolvedValue({ok:true});mocks.rpc.mockImplementation(async(name,args)=>({data:args.p_action==='authorize'?{actor:id,session:id}:args.p_action==='claim'?{stage:'AUTH',state:'UNKNOWN',claim:id,target:id,objects:[]}:{id,states:{AUTH:'SUCCEEDED'}},error:null}));mocks.adminRpc.mockResolvedValue({data:{ok:true},error:null});});
it('rejects ordinary users before any privileged effect or receipt read',async()=>{
 mocks.owner.mockResolvedValue({ok:false,code:'FORBIDDEN'});
 expect(await accountDeletionAction('preview',{target:id})).toEqual({ok:false,code:'FORBIDDEN'});
 expect(await advanceAccountDeletion(id)).toEqual({ok:false,code:'FORBIDDEN'});
 expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.authDelete).not.toHaveBeenCalled();expect(mocks.adminRpc).not.toHaveBeenCalled();
});
it('only authoritative native 404 proves an already deleted Auth identity',async()=>{
 mocks.authGet.mockResolvedValue({data:{user:null},error:{status:404,code:'user_not_found'}});
 expect((await advanceAccountDeletion(id)).ok).toBe(true);
 expect(mocks.authDelete).not.toHaveBeenCalled();
 expect(mocks.adminRpc.mock.calls.at(-1)?.[1]).toMatchObject({p_outcome:'SUCCEEDED'});
});
it('a network failure inspecting Auth stays UNKNOWN and never deletes blindly',async()=>{
 mocks.authGet.mockResolvedValue({data:{user:null},error:{status:0,message:'secret token'}});
 await advanceAccountDeletion(id);expect(mocks.authDelete).not.toHaveBeenCalled();
 expect(mocks.adminRpc.mock.calls.at(-1)?.[1]).toMatchObject({p_outcome:'UNKNOWN',p_code:'EFFECT_UNCONFIRMED'});
 expect(JSON.stringify(mocks.adminRpc.mock.calls)).not.toContain('secret token');
});
it('hard deletes with shouldSoftDelete=false and inspects the effect',async()=>{
 mocks.authGet.mockResolvedValueOnce({data:{user:{id}},error:null}).mockResolvedValueOnce({data:{user:null},error:{status:404,code:'user_not_found'}});
 mocks.authDelete.mockResolvedValue({data:{},error:null});
 await advanceAccountDeletion(id);expect(mocks.authDelete).toHaveBeenCalledExactlyOnceWith(id,false);
 expect(mocks.adminRpc.mock.calls.at(-1)?.[1]).toMatchObject({p_outcome:'SUCCEEDED'});
});
it('confirmed Auth rejection is FAILED, transport uncertainty is UNKNOWN',async()=>{
 mocks.authGet.mockResolvedValue({data:{user:{id}},error:null});mocks.authDelete.mockResolvedValue({error:{status:403}});
 await advanceAccountDeletion(id);expect(mocks.adminRpc.mock.calls.at(-1)?.[1]).toMatchObject({p_outcome:'FAILED',p_code:'PROVIDER_REJECTED'});
});
it('Storage only removes frozen exact paths and readback confirms absence',async()=>{
 mocks.rpc.mockImplementation(async(name,args)=>({data:args.p_action==='authorize'?{actor:id,session:id}:args.p_action==='claim'?{stage:'STORAGE',state:'UNKNOWN',claim:id,target:id,objects:[{bucket:'company-knowledge',path:'fixed-object',version:'v1'}]}:{id},error:null}));
 let checks=0;mocks.adminRpc.mockImplementation(async(name,args)=>({data:args.p_action==='inspect'?{effect:++checks<3?'PRESENT':'ABSENT',presentObjects:[{bucket:'company-knowledge',path:'fixed-object',version:'v1'}]}:{ok:true},error:null}));
 mocks.storageRemove.mockResolvedValue({error:null});await advanceAccountDeletion(id);
 expect(mocks.storageRemove).toHaveBeenCalledExactlyOnceWith([{path:'fixed-object',versionId:'v1'}]);
 expect(mocks.adminRpc.mock.calls.at(-1)?.[1]).toMatchObject({p_outcome:'SUCCEEDED'});
});
it('changed object generation cannot be deleted',async()=>{
 mocks.rpc.mockImplementation(async(name,args)=>({data:args.p_action==='authorize'?{actor:id,session:id}:args.p_action==='claim'?{stage:'STORAGE',state:'PENDING',claim:id,target:id,objects:[]}:{id},error:null}));
 mocks.adminRpc.mockResolvedValue({data:{effect:'CHANGED'},error:null});await advanceAccountDeletion(id);
 expect(mocks.storageRemove).not.toHaveBeenCalled();expect(mocks.adminRpc.mock.calls.at(-1)?.[1]).toMatchObject({p_outcome:'FAILED',p_code:'SCOPE_CHANGED'});
});
it('Storage confirmed rejection and network loss remain distinct',async()=>{
 mocks.rpc.mockImplementation(async(name,args)=>({data:args.p_action==='authorize'?{actor:id,session:id}:args.p_action==='claim'?{stage:'STORAGE',state:'PENDING',claim:id,target:id,objects:[{bucket:'company-knowledge',path:'fixed-object',version:'v1'}]}:{id},error:null}));
 mocks.adminRpc.mockImplementation(async(name,args)=>({data:args.p_action==='inspect'?{effect:'PRESENT',presentObjects:[{bucket:'company-knowledge',path:'fixed-object',version:'v1'}]}:{ok:true},error:null}));
 mocks.storageRemove.mockResolvedValue({error:{statusCode:'403',message:'secret'}});await advanceAccountDeletion(id);
 expect(mocks.adminRpc.mock.calls.at(-1)?.[1]).toMatchObject({p_outcome:'FAILED',p_code:'PROVIDER_REJECTED'});
 mocks.storageRemove.mockRejectedValue(Error('network secret'));await advanceAccountDeletion(id);
 expect(mocks.adminRpc.mock.calls.at(-1)?.[1]).toMatchObject({p_outcome:'UNKNOWN',p_code:'EFFECT_UNCONFIRMED'});
 expect(JSON.stringify(mocks.adminRpc.mock.calls)).not.toContain('secret');
});
it('resumes a partially removed file set without repeating removal of an absent object',async()=>{
 mocks.rpc.mockImplementation(async(name,args)=>({data:args.p_action==='authorize'?{actor:id,session:id}:args.p_action==='claim'?{stage:'STORAGE',state:'UNKNOWN',claim:id,target:id,objects:[{bucket:'company-knowledge',path:'already-removed',version:'v1'},{bucket:'company-knowledge',path:'remaining',version:'v2'}]}:{id},error:null}));
 let removed=false;mocks.adminRpc.mockImplementation(async(name,args)=>({data:args.p_action==='inspect'?{effect:removed?'ABSENT':'PRESENT',presentObjects:removed?[]:[{bucket:'company-knowledge',path:'remaining',version:'v2'}]}:{ok:true},error:null}));
 mocks.storageRemove.mockImplementation(async()=>{removed=true;return {error:null};});await advanceAccountDeletion(id);
 expect(mocks.storageRemove).toHaveBeenCalledExactlyOnceWith([{path:'remaining',versionId:'v2'}]);expect(mocks.adminRpc.mock.calls.at(-1)?.[1]).toMatchObject({p_outcome:'SUCCEEDED'});
});
it('removes large Storage scopes in supported 1000-object batches and reconciles between batches',async()=>{
 const objects=Array.from({length:1001},(_,i)=>({bucket:'company-knowledge',path:`isolated/${i}`,version:`v${i}`}));let removed=0;
 mocks.rpc.mockImplementation(async(name,args)=>({data:args.p_action==='authorize'?{actor:id,session:id}:args.p_action==='claim'?{stage:'STORAGE',state:'PENDING',claim:id,target:id,objects}:{id},error:null}));
 mocks.adminRpc.mockImplementation(async(name,args)=>{
  if(args.p_action!=='inspect')return {data:{ok:true},error:null};
  const presentObjects=objects.slice(removed);
  return {data:{effect:presentObjects.length?'PRESENT':'ABSENT',presentObjects},error:null};
 });
 mocks.storageRemove.mockImplementation(async(paths:{path:string;versionId:string}[])=>{removed+=paths.length;return {error:null};});
 await advanceAccountDeletion(id);
 expect(mocks.storageRemove.mock.calls.map(([paths])=>paths.length)).toEqual([1000,1]);
 expect(mocks.adminRpc.mock.calls.at(-1)?.[1]).toMatchObject({p_outcome:'SUCCEEDED'});
});
