import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {inspectExpiredCheckpoint,createExpiredCheckpointReader} from './expired-checkpoint-reconciliation';
const binding={accountId:'a',sessionId:'s',companyId:'c',branchId:'b',attemptId:'i',generation:17};
const config={enabled:true,appId:'111',configId:'123',appSecret:'synthetic-app-secret',graphVersion:'v25.0'};
const checkpoint={token:'synthetic-secret',phoneNumberId:'333',wabaId:'222',appId:'111',configId:'123',graphVersion:'v25.0'};
function provider(options:{expired?:boolean;missingScope?:boolean;wrongPhone?:boolean;pending?:boolean;noSubscription?:boolean;fail?:boolean}={}){
 const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
  expect(init?.method).toBe('GET');if(options.fail)throw Error('synthetic-secret');
  const path=new URL(url).pathname;
  if(path.endsWith('/debug_token'))return Response.json({data:{is_valid:true,app_id:'111',scopes:options.missingScope?[]:['whatsapp_business_management','whatsapp_business_messaging'],expires_at:options.expired?1:0,data_access_expires_at:0,granular_scopes:['whatsapp_business_management','whatsapp_business_messaging'].map(scope=>({scope,target_ids:['222']}))}});
  if(path.endsWith('/222/phone_numbers'))return Response.json({data:[{id:options.wrongPhone?'444':'333',code_verification_status:'VERIFIED'}]});
  if(path.endsWith('/222/subscribed_apps'))return Response.json({data:options.noSubscription?[]:[{whatsapp_business_api_data:{id:'111'}}]});
  if(path.endsWith('/222'))return Response.json({id:'222'});
  return Response.json({id:'333',display_phone_number:'synthetic',code_verification_status:'VERIFIED',status:options.pending?'PENDING':'CONNECTED',platform_type:options.pending?'NOT_APPLICABLE':'CLOUD_API',is_on_biz_app:false});
 });return fetcher;
}
describe('expired checkpoint review',()=>{
 it('reports only bounded provider evidence after valid scoped token, membership, registration and subscription; never sends POST',async()=>{
  const fetcher=provider();const result=await inspectExpiredCheckpoint(binding,{read:async()=>checkpoint,fetcher,config});
  expect(result).toEqual({outcome:'REVIEW_REQUIRED',evidence:'META_ACCESS_REGISTERED_SUBSCRIBED'});
  expect(fetcher.mock.calls.length).toBeGreaterThan(4);expect(JSON.stringify(result)).not.toContain('synthetic-secret');
 });
 it('rejects a changed or revoked binding after the provider read',async()=>{
  const read=vi.fn().mockResolvedValueOnce(checkpoint).mockResolvedValueOnce(null);
  expect(await inspectExpiredCheckpoint(binding,{read,fetcher:provider(),config})).toEqual({outcome:'UNKNOWN',reason:'UNAVAILABLE'});
  expect(read).toHaveBeenCalledTimes(2);
 });
 it.each([{expired:true},{missingScope:true},{wrongPhone:true},{pending:true},{noSubscription:true},{fail:true}])('leaves incomplete or failed evidence UNKNOWN: %s',async(options)=>{
  const fetcher=provider(options);const result=await inspectExpiredCheckpoint(binding,{read:async()=>checkpoint,fetcher,config});
  expect(result.outcome).toBe('UNKNOWN');expect(JSON.stringify(result)).not.toContain('synthetic-secret');
 });
 it('does not contact Meta for a denied reader, mismatched saved config or invalid generation',async()=>{
  const fetcher=provider();
  for(const [input,read] of [[binding,async()=>null],[binding,async()=>({...checkpoint,appId:'999'})],[{...binding,generation:0},async()=>checkpoint]] as const)
   expect((await inspectExpiredCheckpoint(input,{read,fetcher,config})).outcome).toBe('UNKNOWN');
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('reader forwards complete binding and never exposes denied data',async()=>{
  const rpc=vi.fn(async()=>({data:{ok:false,token:'synthetic-secret'},error:null}));const read=createExpiredCheckpointReader({rpc});
  expect(await read(binding)).toBeNull();expect(rpc).toHaveBeenCalledWith('wa_expired_checkpoint_review',{p_binding:binding});
 });
});
