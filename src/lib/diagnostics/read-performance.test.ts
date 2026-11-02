import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {measureRead,measureDataHttp,traceRead} from './read-performance';

it('retains the original result and error when the timing sink fails',async()=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{throw new Error('sink unavailable');});
 try{
  const result={ok:true};
  expect(await traceRead('setup_entry',async()=>result)).toBe(result);
  const error=new Error('original');
  await expect(traceRead('setup_entry',async()=>{throw error;})).rejects.toBe(error);
 }finally{log.mockRestore();}
});

it('attributes HTTP work to a bounded category without retaining URL data',async()=>{
 const logs:Record<string,unknown>[]=[];
 const log=vi.spyOn(console,'info').mockImplementation(value=>logs.push(JSON.parse(value)));
 try{
  const work=vi.fn(async()=> 'response-secret');
  await traceRead('service_inbox',async()=>{
   await measureDataHttp('https://example.test/rest/v1/rpc/check_app_session?token=query-secret',work);
   await measureDataHttp(new URL('https://example.test/rest/v1/profiles?user=actor-secret'),work);
   await measureDataHttp(new Request('https://example.test/rest/v1/rpc/customer-secret'),work);
  });
  expect(work).toHaveBeenCalledTimes(3);
  expect(logs[0].stages).toMatchObject({
   data_http:{count:3},http_session:{count:1},http_identity:{count:1},http_other:{count:1},
  });
  expect(JSON.stringify(logs)).not.toMatch(/query-secret|actor-secret|customer-secret|response-secret|example/);
 }finally{log.mockRestore();}
});

it('isolates concurrent journeys and reports no values or exception details',async()=>{
 const logs:Record<string,unknown>[]=[];
 const log=vi.spyOn(console,'info').mockImplementation(value=>logs.push(JSON.parse(value)));
 let release!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve;});
 try{
  const first=traceRead('service_inbox',()=>measureRead('broker',async()=>{await pending;return 'private-value';}));
  await traceRead('workspace',()=>measureRead('client',async()=>42));
  release();expect(await first).toBe('private-value');
  expect(logs[0].operation).toBe('workspace');expect(logs[1].operation).toBe('service_inbox');
  expect(logs[0].stages).toEqual({client:{count:1,total_ms:expect.any(Number)}});
  expect(logs[1].stages).toEqual({broker:{count:1,total_ms:expect.any(Number)}});
  expect(JSON.stringify(logs)).not.toContain('private-value');
  await expect(traceRead('workspace',()=>measureRead('client',async()=>{throw new Error('private-error');}))).rejects.toThrow('private-error');
  expect(logs[2].outcome).toBe('threw');expect(JSON.stringify(logs)).not.toContain('private-error');
 }finally{release();log.mockRestore();}
});

it('preserves untraced and failing fetch behavior without leaking the input',async()=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 try{
  const response={ok:true};
  expect(await measureDataHttp('invalid-secret',async()=>response)).toBe(response);
  expect(log).not.toHaveBeenCalled();
  const error=new Error('fetch-secret');
  await expect(traceRead('workspace',()=>measureDataHttp('invalid-secret',async()=>{throw error;}))).rejects.toBe(error);
  const report=JSON.parse(log.mock.calls[0][0]);
  expect(report.stages).toMatchObject({data_http:{count:1},http_other:{count:1}});
  expect(JSON.stringify(report)).not.toContain('secret');
 }finally{log.mockRestore();}
});
