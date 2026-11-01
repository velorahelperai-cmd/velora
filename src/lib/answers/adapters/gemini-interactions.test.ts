vi.mock('server-only',()=>({}));
import {describe,it,expect,vi} from 'vitest';
import {GoogleGenAI} from '@google/genai';
import {startGeminiTrial,retrieveGeminiTrial,streamGeminiTrial} from './gemini-interactions';
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

describe('Flash-Lite and Arabic streaming',()=>{
 it('creates Flash-Lite with minimal thinking, exact approved Arabic context and no tools',async()=>{
  const {client,create}=sdk();
  const result=await startGeminiTrial(client,input,'gemini-3.5-flash-lite');
  expect(result).toMatchObject({pending:true,handle:{modelId:'gemini-3.5-flash-lite'}});
  const request=create.mock.calls[0][0];
  expect(request).toMatchObject({model:'gemini-3.5-flash-lite',generation_config:{thinking_level:'minimal',max_output_tokens:256},background:true,store:true});
  expect(request.input).toContain('ما مواعيد العمل؟');expect(request.input).toContain('Sunday 10:00-14:00');
  expect(request.system_instruction).toContain('منع التأليف والتخمين');expect(request.tools).toBeUndefined();
 });
 it.each(['gemini-3.8-flash','gemini-3.5-flash-lite'] as const)('retrieves retained %s handles with their original model',async model=>{
  const {client}=sdk(undefined,vi.fn().mockResolvedValue({...fixture(),model:`models/${model}-001`}));
  expect(await retrieveGeminiTrial(client,{id:'int_fixture',modelId:model,startedAt:1,promptChars:1,contextChars:1,sourceCount:1})).toMatchObject({ok:true,modelId:model,usage:{modelId:model,completionTokens:50}});
 });
 it('streams Arabic via the real SDK GET only, omitting thoughts and duplicate events',async()=>{
  const events=[
   {event_type:'step.start',index:0,step:{type:'model_output',content:[]}},
   {event_type:'step.delta',index:0,event_id:'e1',delta:{type:'text',text:'الأحد إلى الخميس '}},
   {event_type:'step.delta',index:0,event_id:'e1',delta:{type:'text',text:'الأحد إلى الخميس '}},
   {event_type:'step.delta',index:0,event_id:'e2',delta:{type:'thought_summary',text:'private thought'}},
   {event_type:'step.delta',index:0,event_id:'e3',delta:{type:'text',text:'10:00–14:00، والجمعة والسبت مغلق.'}},
   {event_type:'interaction.completed',interaction:fixture()}
  ];
  const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
   const request=url instanceof Request?url:new Request(url,init);
   expect(request.method).toBe('GET');expect(request.url).toContain('stream=true');
   return new Response(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
  });
  const client=new GoogleGenAI({apiKey:'unit-test-not-a-key',httpOptions:{fetch:fetcher}});const parts=[];
  for await(const text of streamGeminiTrial(client,{id:'int_fixture',modelId:'gemini-3.5-flash-lite',startedAt:1,promptChars:1,contextChars:1,sourceCount:1},new AbortController().signal))parts.push(text);
  expect(parts).toEqual(['الأحد إلى الخميس ','الأحد إلى الخميس 10:00–14:00، والجمعة والسبت مغلق.']);expect(fetcher).toHaveBeenCalledOnce();
 });
});
