// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {setupTiming,observeSetupUsable} from './setup-timing';
afterEach(()=>{window.history.replaceState(null,'','/');vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('is silent outside development',()=>{vi.stubEnv('NODE_ENV','production');const log=vi.spyOn(console,'info').mockImplementation(()=>{});setupTiming('entry')();expect(log).not.toHaveBeenCalled();});
it('emits only fixed stages and numeric durations',()=>{vi.stubEnv('NODE_ENV','development');const log=vi.spyOn(console,'info').mockImplementation(()=>{});let now=100;vi.spyOn(performance,'now').mockImplementation(()=>now);const finish=setupTiming('workspace');now=350;finish();const rows=log.mock.calls.map(([row])=>JSON.parse(String(row)));expect(rows[0]).toEqual({service:'velora.setup.timing',stage:'workspace',phase:'start',elapsed_ms:100,duration_ms:0});expect(rows[1]).toEqual({service:'velora.setup.timing',stage:'workspace',phase:'end',elapsed_ms:350,duration_ms:250});});
it('does not fail a read when console is unavailable',()=>{vi.stubEnv('NODE_ENV','development');vi.spyOn(console,'info').mockImplementation(()=>{throw Error('offline');});expect(()=>setupTiming('owner')()).not.toThrow();});

it('reports document milestones and numeric script totals without resource URLs or bodies',()=>{
 vi.stubEnv('NODE_ENV','production');window.history.replaceState(null,'','/setup#velora-performance');
 const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 vi.stubGlobal('performance',{now:()=>5000,getEntriesByType:(type:string)=>type==='navigation'?[{name:'https://private.test/account',responseStart:400,responseEnd:430,domInteractive:700,domContentLoadedEventEnd:900,loadEventEnd:0,encodedBodySize:1500}]:type==='resource'?[{name:'https://private.test/script?secret',initiatorType:'script',encodedBodySize:200,decodedBodySize:600,transferSize:0,responseEnd:800},{name:'https://private.test/customer',initiatorType:'fetch',encodedBodySize:9000}]:[{name:'first-contentful-paint',startTime:600}]});
 setupTiming('session_ready')();
 const row=JSON.parse(String(log.mock.calls[2][0]));
 expect(row).toMatchObject({service:'velora.setup.document',observed_ms:5000,response_start_ms:400,response_end_ms:430,load_end_ms:null,first_contentful_paint_ms:600,script_count:1,script_encoded_bytes:200,script_decoded_bytes:600,script_transfer_bytes:0,last_script_response_ms:800});
 expect(JSON.stringify(log.mock.calls)).not.toMatch(/private.test|secret|customer/);
 expect(Object.entries(row).every(([key,value])=>key==='service'||value===null||typeof value==='number')).toBe(true);
});

it('does not read document timing when disabled and tolerates an unavailable performance API',()=>{
 vi.stubEnv('NODE_ENV','production');const entries=vi.fn(()=>{throw Error('unsupported');});
 vi.stubGlobal('performance',{now:()=>1,getEntriesByType:entries});const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 setupTiming('session_ready')();expect(entries).not.toHaveBeenCalled();expect(log).not.toHaveBeenCalled();
 window.history.replaceState(null,'','/setup#velora-performance');expect(()=>setupTiming('session_ready')()).not.toThrow();
 expect(entries).toHaveBeenCalledOnce();
});

it('allows tab-local production measurement without logging URL or account data',()=>{
 vi.stubEnv('NODE_ENV','production');window.history.replaceState(null,'','/setup?account=private#velora-performance');
 const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 const finish=setupTiming('workspace');finish();
 expect(log).toHaveBeenCalledTimes(2);
 for(const [row] of log.mock.calls){
  expect(Object.keys(JSON.parse(String(row))).sort()).toEqual(['duration_ms','elapsed_ms','phase','service','stage']);
  expect(String(row)).not.toMatch(/private|account|setup\?/);
 }
 window.history.replaceState(null,'','/setup');setupTiming('entry')();expect(log).toHaveBeenCalledTimes(2);
});

it('does not enable production timing from a query parameter or partial fragment',()=>{
 vi.stubEnv('NODE_ENV','production');const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 for(const url of ['/setup?velora-performance=1','/setup#velora-performance-extra']){
  window.history.replaceState(null,'',url);setupTiming('entry')();
 }
 expect(log).not.toHaveBeenCalled();
});

it('records usability only when admitted content is visible, once',async()=>{
 vi.stubEnv('NODE_ENV','development');const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 const shell=document.createElement('div');shell.hidden=true;const root=document.createElement('div');root.innerHTML='<section data-connection-ui-state="pending"><button>Recover</button></section>';shell.append(root);document.body.append(shell);
 const stop=observeSetupUsable(root,()=>true);expect(log).not.toHaveBeenCalled();shell.hidden=false;await Promise.resolve();expect(log).toHaveBeenCalledTimes(2);root.setAttribute('hidden','');await Promise.resolve();expect(log).toHaveBeenCalledTimes(2);stop();shell.remove();
});
it('does not report usable data after an authority boundary is lost',async()=>{
 vi.stubEnv('NODE_ENV','development');const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 const root=document.createElement('div');document.body.append(root);let current=true;const stop=observeSetupUsable(root,()=>current);current=false;root.innerHTML='<section data-connection-ui-state="pending"><button>Recover</button></section>';await Promise.resolve();expect(log).not.toHaveBeenCalled();stop();root.remove();
});
