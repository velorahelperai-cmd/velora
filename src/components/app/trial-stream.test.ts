import {it,expect,vi,afterEach} from 'vitest';
import {readTrialStream,recoverTrialRequest} from './trial-stream';
afterEach(()=>vi.unstubAllGlobals());
const scope={expectedAccountId:'account',companyId:'company',branchId:'branch'};
it('decodes fragmented Arabic UTF-8 and updates text without sending a question',async()=>{
 const bytes=new TextEncoder().encode(JSON.stringify({text:'الأحد 10:00–14:00'})+'\n');
 const fetcher=vi.fn(async(url:string)=>{expect(url).not.toContain('question');return new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(new Uint8Array([byte]));c.close();}}));});
 vi.stubGlobal('fetch',fetcher);const text=vi.fn();await readTrialStream(scope,'operation','boundary',new AbortController().signal,text);
 expect(text).toHaveBeenCalledWith('الأحد 10:00–14:00');expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0]?.[0]).not.toContain('question');
});
it('clears stale partial content on lost authorization',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:403})));const text=vi.fn();await readTrialStream(scope,'op','boundary',new AbortController().signal,text);expect(text).toHaveBeenCalledWith('');
});

it('posts recovery independently with boundary and cancellation, never a new question',async()=>{
 const fetcher=vi.fn(async()=>Response.json({ok:false,code:'TRIAL_PENDING'}));vi.stubGlobal('fetch',fetcher);
 const result=await recoverTrialRequest(scope,'operation','boundary',new AbortController().signal);
 expect(result).toEqual({ok:false,code:'TRIAL_PENDING'});
 expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('operationId=operation'),expect.objectContaining({method:'POST',credentials:'same-origin',cache:'no-store',headers:{'x-velora-boundary':'boundary'},signal:expect.any(AbortSignal)}));
 expect(JSON.stringify(fetcher.mock.calls)).not.toContain('question');
});
