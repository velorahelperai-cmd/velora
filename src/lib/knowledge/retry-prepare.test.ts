import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({client:vi.fn(),access:vi.fn(),generation:vi.fn(),extract:vi.fn(),publish:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:mocks.client}));
vi.mock("@/lib/tenancy/access",()=>({getCompanyAccess:mocks.access,requirePlatformAdmin:vi.fn()}));
vi.mock("@/lib/access/actions",()=>({sessionHasCompanyCapability:vi.fn()}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("./exact-generation",()=>({readExactStorageGeneration:mocks.generation}));
vi.mock("./extract",()=>({extractKnowledgeText:mocks.extract}));
vi.mock("./prepared-publication",()=>({publishPreparedFile:mocks.publish}));
import { retryKnowledgePrepare } from "./actions";

type Row=Record<string,unknown>;
let row:Row,updates:Row[],tick:number;
function client(){
 return {
  from:()=>{
   const filters:Array<[string,unknown]>=[];let patch:Row|null=null;
   const q={
    select:()=>q,eq:(k:string,v:unknown)=>{filters.push([k,v]);return q;},
    update:(v:Row)=>{patch=v;return q;},
    limit:async()=>({data:[],error:null}),
    maybeSingle:async()=>{
     if(!filters.every(([k,v])=>row[k]===v))return {data:null,error:null};
     if(patch){
      updates.push({...patch});
      const changed=patch.content!==undefined&&patch.content!==row.content;
      row={...row,...patch,updated_at:`2026-10-31T10:00:${String(++tick).padStart(2,'0')}.000Z`,...(changed?{content_version:Number(row.content_version)+1,approved_for_answers:false,approved_version:null}:{})};
     }
     return {data:{...row},error:null};
    },
   };return q;
  },
  storage:{from:()=>({download:()=>({asStream:async()=>({data:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('stored bytes'));c.close();}}),error:null})})})},
 };
}
beforeEach(()=>{
 tick=0;updates=[];
 row={id:'source',company_id:'company',kind:'file',status:'failed',content:'',file_name:'menu.txt',storage_path:'company/source/menu.txt',content_type:'text/plain',content_version:2,updated_at:'2026-10-31T10:00:00.000Z'};
 mocks.client.mockReset().mockResolvedValue(client());
 mocks.access.mockReset().mockResolvedValue({ok:true,context:{userId:'owner',company:{id:'company',status:'active'},membership:{role:'owner'}}});
 mocks.generation.mockReset().mockResolvedValue({status:'ok',generation:{objectId:'object',updatedAt:'2026-10-31T09:00:00Z'}});
 mocks.extract.mockReset().mockResolvedValue({ok:true,text:'Prepared menu'});
 mocks.publish.mockReset().mockImplementation(async()=>{row={...row,status:'ready',content:'Prepared menu'};return {ok:true,row};});
});
describe('canonical stored-file retry claim',()=>{
 it('claims once after download, then extracts and publishes',async()=>{
  const result=await retryKnowledgePrepare('source');
  expect(result.ok).toBe(true);expect(updates.filter(x=>x.status==='processing')).toHaveLength(1);
  expect(mocks.extract).toHaveBeenCalledTimes(1);expect(mocks.publish).toHaveBeenCalledTimes(1);
 });
 it('clears prior approval on claim before extract when reprocessing an approved ready file',async()=>{
  row={...row,status:'ready',content:'old approved text',content_version:3,approved_for_answers:true,approved_version:3};
  let sawApprovedDuringExtract=false;
  mocks.extract.mockImplementation(async()=>{
   sawApprovedDuringExtract=row.approved_for_answers===true;
   return {ok:true,text:'Prepared menu'};
  });
  const result=await retryKnowledgePrepare('source');
  expect(result.ok).toBe(true);
  expect(updates[0]).toMatchObject({status:'processing',content:''});
  expect(sawApprovedDuringExtract).toBe(false);
  expect(mocks.extract).toHaveBeenCalledTimes(1);
  expect(mocks.publish).toHaveBeenCalledTimes(1);
 });
 it('allows only one of concurrent retries to dispatch extraction',async()=>{
  let finish!:(value:unknown)=>void;
  mocks.extract.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const first=retryKnowledgePrepare('source');
  await vi.waitFor(()=>expect(mocks.extract).toHaveBeenCalledTimes(1));
  expect(await retryKnowledgePrepare('source')).toMatchObject({ok:false,code:'CONFLICT'});
  finish({ok:true,text:'Prepared menu'});await first;
  expect(mocks.extract).toHaveBeenCalledTimes(1);expect(mocks.publish).toHaveBeenCalledTimes(1);
 });
 it('does not strand a processing claim on a storage transport failure',async()=>{
  mocks.generation.mockResolvedValue({status:'error'});
  expect(await retryKnowledgePrepare('source')).toMatchObject({ok:false,code:'STORAGE_ERROR'});
  expect(row.status).toBe('failed');expect(updates).toHaveLength(0);expect(mocks.extract).not.toHaveBeenCalled();
 });
 it('rejects an in-flight source including an old interrupted claim without unsafe takeover',async()=>{
  row.status='processing';row.updated_at='2020-01-01T00:00:00Z';
  expect(await retryKnowledgePrepare('source')).toMatchObject({ok:false,code:'CONFLICT'});
  expect(updates).toHaveLength(0);expect(mocks.generation).not.toHaveBeenCalled();
 });
 it('releases its own claim as failed when extraction throws',async()=>{
  mocks.extract.mockRejectedValue(new Error('extract failed'));
  expect(await retryKnowledgePrepare('source')).toMatchObject({ok:false,code:'INVALID_INPUT'});
  expect(row.status).toBe('failed');expect(mocks.publish).not.toHaveBeenCalled();
 });
 it('does not let an older failed extractor overwrite a newer row',async()=>{
  mocks.extract.mockImplementation(async()=>{row={...row,status:'ready',content:'newer content',updated_at:'2026-10-31T11:00:00.000Z',content_version:9};return {ok:false,code:'extract_failed'};});
  await retryKnowledgePrepare('source');
  expect(row).toMatchObject({status:'ready',content:'newer content',content_version:9});
  expect(updates).toHaveLength(1);expect(mocks.publish).not.toHaveBeenCalled();
 });
 it('does not process a source in another company or unknown state',async()=>{
  row.company_id='other';expect(await retryKnowledgePrepare('source')).toMatchObject({ok:false,code:'INVALID_INPUT'});
  row.company_id='company';row.status='unknown';expect(await retryKnowledgePrepare('source')).toMatchObject({ok:false,code:'INVALID_INPUT'});
  expect(updates).toHaveLength(0);expect(mocks.extract).not.toHaveBeenCalled();
 });
});

it('racing requests both loaded before claiming still extract only once',async()=>{
 let finish!:(value:unknown)=>void;
 mocks.extract.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const first=retryKnowledgePrepare('source'),second=retryKnowledgePrepare('source');
 await vi.waitFor(()=>expect(mocks.extract).toHaveBeenCalledTimes(1));
 finish({ok:true,text:'Prepared menu'});
 const results=await Promise.all([first,second]);
 expect(results.filter(result=>result.ok)).toHaveLength(1);
 expect(results.filter(result=>!result.ok&&result.code==='CONFLICT')).toHaveLength(1);
 expect(mocks.publish).toHaveBeenCalledTimes(1);
});

it('releases only its own processing row when the final object observation fails',async()=>{
 mocks.generation.mockResolvedValueOnce({status:'ok',generation:{objectId:'object',updatedAt:'2026-10-31T09:00:00Z'}})
  .mockResolvedValueOnce({status:'ok',generation:{objectId:'object',updatedAt:'2026-10-31T09:00:00Z'}})
  .mockResolvedValueOnce({status:'ok',generation:{objectId:'object',updatedAt:'2026-10-31T09:00:00Z'}})
  .mockResolvedValue({status:'error'});
 expect(await retryKnowledgePrepare('source')).toMatchObject({ok:false,code:'INVALID_INPUT'});
 expect(row.status).toBe('failed');expect(mocks.publish).not.toHaveBeenCalled();
});
it('does not release a newer replacement after the final object observation fails',async()=>{
 mocks.extract.mockImplementation(async()=>{row={...row,status:'stored',updated_at:'2026-10-31T11:00:00Z',storage_path:'company/source/new.txt'};mocks.generation.mockResolvedValue({status:'error'});return {ok:true,text:'old text'};});
 await retryKnowledgePrepare('source');
 expect(row).toMatchObject({status:'stored',storage_path:'company/source/new.txt'});
 expect(updates).toHaveLength(1);expect(mocks.publish).not.toHaveBeenCalled();
});
