vi.mock('server-only',()=>({}));
import {describe,it,expect,vi} from 'vitest';
import {GoogleGenAI} from '@google/genai';
import {startGeminiTrial,retrieveGeminiTrial} from './gemini-interactions';
const input={question:'ما مواعيد العمل؟',locale:'ar' as const,chunks:[{sourceId:'hours',title:'Hours',contentVersion:1,text:'Sunday 10:00-14:00'}],maxOutputTokens:256};
const fixture=()=>({id:'int_fixture',model:'gemini-3.8-flash',status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'الأحد من 10:00 إلى 14:00.'}]}],usage:{total_input_tokens:100,total_output_tokens:20,total_thought_tokens:30,total_cached_tokens:10,total_tokens:150,total_tool_use_tokens:0}});
const sdk=(create=vi.fn().mockResolvedValue({id:'int_fixture',status:'in_progress'}),get=vi.fn().mockResolvedValue(fixture()))=>({client:{interactions:{create,get}} as unknown as GoogleGenAI,create,get});
describe('durable Gemini trial',()=>{
 it('does not let the installed SDK retry a real HTTP503 response',async()=>{
  const fetcher=vi.fn(async()=>Response.json({error:{code:503,status:'UNAVAILABLE',message:'Fixture unavailable'}},{status:503}));
  const client=new GoogleGenAI({apiKey:'unit-test-not-a-key',httpOptions:{fetch:fetcher}});
  expect(await startGeminiTrial(client,input)).toMatchObject({ok:false,providerErrorCode:'GEMINI_HTTP_503',retrySafe:false});expect(fetcher).toHaveBeenCalledOnce();
 });
 it('uses the real SDK transport with one POST and subsequent GET only',async()=>{
  const requests:Array<{url:string;method:string;body:unknown}>=[];
  const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
    const request=url instanceof Request?url:new Request(url,init);
    requests.push({url:request.url,method:request.method,body:request.method==='POST'?await request.json():null});
    return Response.json(request.method==='POST'?{id:'int_fixture',model:'gemini-3.8-flash',status:'in_progress',steps:[]}:fixture());
  });
  const client=new GoogleGenAI({apiKey:'unit-test-not-a-key',httpOptions:{fetch:fetcher}});
  const start=await startGeminiTrial(client,input);expect(start).toMatchObject({pending:true});if(!('pending'in start))throw Error('missing handle');
  expect(await retrieveGeminiTrial(client,start.handle)).toMatchObject({ok:true});
  expect(requests.map(r=>r.method)).toEqual(['POST','GET']);expect(requests[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
  expect(requests[0].body).toMatchObject({background:true,store:true,generation_config:{max_output_tokens:256,thinking_level:'low'}});
  expect(requests[1].url).toContain('/interactions/int_fixture');
 });
 it('creates once, returns a persistable handle and retrieves without creating again',async()=>{
  const {client,create,get}=sdk();const started=await startGeminiTrial(client,input);
  expect(started).toMatchObject({pending:true,handle:{id:'int_fixture'}});if(!('pending' in started))throw Error('handle missing');
  expect(create).toHaveBeenCalledWith(expect.objectContaining({background:true,store:true,model:'gemini-3.8-flash',generation_config:expect.objectContaining({max_output_tokens:256})}),expect.objectContaining({maxRetries:0}));
  expect(await retrieveGeminiTrial(client,started.handle)).toMatchObject({ok:true,text:'الأحد من 10:00 إلى 14:00.',usage:{promptTokens:100,completionTokens:50,reasoningTokens:30,totalTokens:150,requestId:'int_fixture'}});
  expect(create).toHaveBeenCalledOnce();expect(get).toHaveBeenCalledWith('int_fixture',undefined,expect.objectContaining({maxRetries:0}));
 });
 it('retains a known handle on retrieval transport failure without generation retry',async()=>{
  const {client,create}=sdk(undefined,vi.fn().mockRejectedValue({status:503}));const start=await startGeminiTrial(client,input);if(!('pending'in start))throw Error('missing');
  expect(await retrieveGeminiTrial(client,start.handle)).toMatchObject({pending:true,handle:{id:'int_fixture'}});expect(create).toHaveBeenCalledOnce();
 });
 it.each(['queued','in_progress'])('keeps %s pending without usage or financial classification',async status=>{
  const {client}=sdk(undefined,vi.fn().mockResolvedValue({id:'int_fixture',status,steps:[]}));const start=await startGeminiTrial(client,input);if(!('pending'in start))throw Error('missing');
  expect(await retrieveGeminiTrial(client,start.handle)).toMatchObject({pending:true});
 });
 it.each(['incomplete','budget_exceeded','failed','cancelled'])('records %s as terminal, with usage but no successful answer',async status=>{
  const {client}=sdk(undefined,vi.fn().mockResolvedValue({...fixture(),status}));const start=await startGeminiTrial(client,input);if(!('pending'in start))throw Error('missing');
  expect(await retrieveGeminiTrial(client,start.handle)).toMatchObject({ok:false,providerErrorCode:'GEMINI_INCOMPLETE_RESPONSE',usage:{completionTokens:50}});
 });
 it('classifies an expired missing handle for review without retrying generation',async()=>{
  const {client,create}=sdk(undefined,vi.fn().mockRejectedValue({status:404}));const start=await startGeminiTrial(client,input);if(!('pending'in start))throw Error('missing');
  expect(await retrieveGeminiTrial(client,start.handle)).toMatchObject({ok:false,providerErrorCode:'GEMINI_HTTP_404',retrySafe:false});expect(create).toHaveBeenCalledOnce();
 });
 it('never converts lost creation response into a rejection or retry grant',async()=>{
  const {client,create}=sdk(vi.fn().mockRejectedValue({status:504}));expect(await startGeminiTrial(client,input)).toMatchObject({ok:false,providerErrorCode:'GEMINI_HTTP_504',providerAttempted:true,retrySafe:false});expect(create).toHaveBeenCalledOnce();
 });
 it.each([{total_tokens:149},{total_thought_tokens:-1},{total_cached_tokens:101}])('rejects unverifiable usage %j',async override=>{
  const data=fixture();Object.assign(data.usage,override);const {client}=sdk(undefined,vi.fn().mockResolvedValue(data));const start=await startGeminiTrial(client,input);if(!('pending'in start))throw Error('missing');
  expect(await retrieveGeminiTrial(client,start.handle)).toMatchObject({ok:false,providerErrorCode:'GEMINI_USAGE_UNVERIFIED'});
 });
 it('refuses a mismatched provider identity',async()=>{
  const {client}=sdk(undefined,vi.fn().mockResolvedValue({...fixture(),id:'other'}));const start=await startGeminiTrial(client,input);if(!('pending'in start))throw Error('missing');
  expect(await retrieveGeminiTrial(client,start.handle)).toMatchObject({ok:false,providerErrorCode:'GEMINI_MODEL_MISMATCH'});
 });
});
