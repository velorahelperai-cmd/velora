import {it,expect,vi,afterEach} from 'vitest';
import {readTrialStream} from './trial-stream';
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
